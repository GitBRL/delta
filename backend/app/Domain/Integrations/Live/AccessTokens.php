<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Live;

use App\Domain\Integrations\ConnectorUnavailable;
use App\Domain\Integrations\OAuth\Apps\AppVendor;
use App\Domain\Integrations\OAuth\Apps\PlatformApps;
use App\Domain\Integrations\OAuth\LinkedInOAuth;
use App\Models\IntegrationConnection;
use Carbon\CarbonImmutable;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

/**
 * Token de acesso válido de uma conexão real.
 *  - Google e LinkedIn: renovam com o refresh token, com lock distribuído (dois workers não
 *    renovam juntos, e o segundo aproveita o token que o primeiro acabou de gravar).
 *  - Meta (e LinkedIn sem refresh token): o token de longa duração (~60 dias) expirado marca a
 *    conexão como "expired" para a agência reconectar em um clique.
 *  - TikTok: o token de anunciante não expira; só é trocado quando a autorização é revogada.
 */
final readonly class AccessTokens
{
    public const MARGIN_SECONDS = 300;

    public function __construct(private PlatformApps $apps) {}

    public function for(IntegrationConnection $connection): string
    {
        $creds = $connection->credentials ?? [];
        $token = $creds['access_token'] ?? null;
        if (! is_string($token) || $token === '') {
            throw ConnectorUnavailable::reauthorize($connection->provider);
        }

        if (! self::expiring($creds)) {
            return $token;
        }

        $vendor = AppVendor::forPlatform($connection->provider);
        if (($vendor !== AppVendor::Google && $vendor !== AppVendor::Linkedin) || ! is_string($creds['refresh_token'] ?? null)) {
            $this->expire($connection);
        }

        /** @var string */
        return Cache::lock("oauth-refresh:{$connection->id}", 30)->block(20, fn (): string => $this->refresh($connection, $vendor));
    }

    /** Token de longa duração da Meta perto do fim (aviso na tela para reconectar com antecedência). */
    public static function expiresSoon(IntegrationConnection $connection, int $days = 7): bool
    {
        $creds = $connection->credentials ?? [];
        $expires = is_string($creds['expires_at'] ?? null) ? CarbonImmutable::parse($creds['expires_at']) : null;

        return ! is_string($creds['refresh_token'] ?? null) && $expires !== null && $expires->lt(CarbonImmutable::now()->addDays($days));
    }

    private function refresh(IntegrationConnection $connection, AppVendor $vendor): string
    {
        [$url, $who] = $vendor === AppVendor::Linkedin ? [LinkedInOAuth::TOKEN_URL, 'o LinkedIn'] : ['https://oauth2.googleapis.com/token', 'o Google'];

        $connection->refresh(); // outro worker pode ter renovado enquanto esperávamos o lock
        $creds = $connection->credentials ?? [];
        if (! self::expiring($creds) && is_string($creds['access_token'] ?? null)) {
            return $creds['access_token'];
        }

        $app = $this->apps->credentials($vendor);
        if ($app === null) {
            $this->expire($connection, ucfirst($vendor->appPhrase()).' foi removido em Apps das plataformas: cadastre-o de novo e reconecte a conta.');
        }

        try {
            $response = Http::asForm()->timeout(15)->acceptJson()->post($url, [
                'grant_type' => 'refresh_token',
                'refresh_token' => $creds['refresh_token'] ?? '',
                'client_id' => $app->clientId,
                'client_secret' => $app->clientSecret,
            ]);
        } catch (ConnectionException) {
            throw new LiveApiException("Não foi possível renovar o acesso com {$who} agora.");
        }

        // LinkedIn responde invalid_request quando o refresh token venceu (dura 1 ano).
        $dead = ['invalid_grant', 'unauthorized_client', 'invalid_client', ...($vendor === AppVendor::Linkedin ? ['invalid_request'] : [])];
        if (in_array($response->json('error'), $dead, true)) {
            $this->expire($connection);
        }

        $token = $response->json('access_token');
        if ($response->failed() || ! is_string($token)) {
            throw new LiveApiException(ucfirst($who).' não renovou o acesso agora (HTTP '.$response->status().').');
        }

        $expiresIn = $response->json('expires_in');
        $rotated = $response->json('refresh_token');
        $connection->forceFill(['credentials' => [
            ...$creds,
            'access_token' => $token,
            'refresh_token' => is_string($rotated) && $rotated !== '' ? $rotated : $creds['refresh_token'] ?? null,
            'expires_at' => CarbonImmutable::now()->addSeconds(is_numeric($expiresIn) ? (int) $expiresIn : 3600)->toIso8601String(),
        ]])->save();

        return $token;
    }

    private function expire(IntegrationConnection $connection, ?string $message = null): never
    {
        $exception = ConnectorUnavailable::reauthorize($connection->provider);
        $connection->forceFill(['status' => 'expired', 'last_error' => $message ?? $exception->getMessage()])->save();

        throw $exception;
    }

    /** @param array<string, mixed> $creds */
    private static function expiring(array $creds): bool
    {
        $expires = is_string($creds['expires_at'] ?? null) ? CarbonImmutable::parse($creds['expires_at']) : null;

        return $expires !== null && $expires->lte(CarbonImmutable::now()->addSeconds(self::MARGIN_SECONDS));
    }
}
