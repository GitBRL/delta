<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Domain\Integrations\ConnectionManager;
use App\Domain\Integrations\OAuth\Apps\AppVendor;
use App\Domain\Integrations\OAuth\Apps\AppVerification;
use App\Domain\Integrations\OAuth\Apps\PlatformApps;
use App\Domain\Integrations\OAuth\OAuthFlow;
use App\Domain\Integrations\OAuth\OAuthRegistry;
use App\Domain\Metrics\Catalog\Catalog;
use App\Http\Controllers\Controller;
use App\Http\Requests\SavePlatformAppRequest;
use App\Models\OAuthApp;
use App\Models\User;
use App\Support\Audit\Audit;
use App\Support\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;

/**
 * Apps das plataformas (Meta, Google): o dono ou administrador da agência cadastra as credenciais
 * do app OAuth pela tela, sem mexer no servidor. Chave secreta e developer token entram e nunca
 * saem: a resposta traz só os 4 últimos caracteres. Ver ADR 0009.
 */
final class PlatformAppController extends Controller
{
    public function __construct(
        private readonly PlatformApps $apps,
        private readonly OAuthRegistry $registry,
        private readonly Catalog $catalog,
        private readonly Audit $audit,
        private readonly TenantContext $context,
    ) {}

    public function index(): JsonResponse
    {
        return response()->json(['data' => array_map($this->present(...), AppVendor::cases())]);
    }

    /** Salva e já confere com a plataforma (falha de rede não impede salvar). */
    public function update(SavePlatformAppRequest $request, AppVendor $vendor): JsonResponse
    {
        $app = $this->apps->agencyApp($vendor) ?? new OAuthApp(['vendor' => $vendor]);

        $app->client_id = $request->string('client_id')->toString();
        if ($request->filled('client_secret')) {
            $app->client_secret = $request->string('client_secret')->toString();
        }
        if ($vendor->supportsDeveloperToken() && $request->filled('developer_token')) {
            $app->developer_token = $request->string('developer_token')->toString();
        }

        $changed = array_keys(array_intersect_key($app->getDirty(), array_flip(['client_id', 'client_secret', 'developer_token'])));
        if ($changed !== []) {
            // Credencial nova = verificação antiga não vale mais.
            $app->verified_at = null;
            $app->verification_error = null;
        }

        $created = ! $app->exists;
        $app->updated_by = $this->context->userId();
        $app->save();

        $verification = $this->verify($vendor, $app);

        $this->audit->record($created ? 'oauth_app.created' : 'oauth_app.updated', $app, [
            'vendor' => $vendor->value,
            'changed' => $changed,
            'verification' => $verification->status,
        ]);

        return response()->json(['data' => $this->present($vendor), 'verification' => $verification->toArray()]);
    }

    public function check(AppVendor $vendor): JsonResponse
    {
        $app = $this->apps->agencyApp($vendor) ?? abort(404, 'A agência ainda não cadastrou '.$vendor->appPhrase().'.');

        $verification = $this->verify($vendor, $app);
        $this->audit->record('oauth_app.verified', $app, ['vendor' => $vendor->value, 'verification' => $verification->status]);

        return response()->json(['data' => $this->present($vendor), 'verification' => $verification->toArray()]);
    }

    public function destroy(AppVendor $vendor): Response
    {
        $app = $this->apps->agencyApp($vendor) ?? abort(404, 'A agência ainda não cadastrou '.$vendor->appPhrase().'.');

        $this->audit->record('oauth_app.removed', $app, ['vendor' => $vendor->value]);
        $app->delete();

        return response()->noContent();
    }

    /** Confere com a plataforma e guarda o resultado (inconclusivo não muda nada). */
    private function verify(AppVendor $vendor, OAuthApp $app): AppVerification
    {
        $credentials = $this->apps->credentials($vendor);
        if ($credentials === null || $credentials->source !== 'agency') {
            return AppVerification::unreachable(match ($vendor) {
                AppVendor::Meta => 'a Meta', AppVendor::Google => 'o Google', AppVendor::Tiktok => 'o TikTok', AppVendor::Linkedin => 'o LinkedIn',
            });
        }

        $verification = $this->registry->live($vendor)->verifyApp($credentials);

        if ($verification->status !== 'unreachable') {
            $app->verified_at = $verification->status === 'verified' ? now() : null;
            $app->verification_error = $verification->status === 'invalid' ? mb_substr($verification->message, 0, 300) : null;
            $app->save();
        }

        return $verification;
    }

    /** @return array<string, mixed> */
    private function present(AppVendor $vendor): array
    {
        $app = $this->apps->agencyApp($vendor);
        $server = $app === null ? $this->apps->server($vendor) : null;

        return [
            'vendor' => $vendor->value,
            'name' => $vendor->label(),
            'platforms' => array_map(fn (string $key): array => [
                'key' => $key,
                'name' => $this->catalog->provider($key)?->name() ?? ConnectionManager::DESTINATIONS[$key] ?? $key,
            ], $vendor->platforms()),
            'status' => $app?->verificationStatus() ?? ($server !== null ? 'server' : 'missing'),
            'source' => $app !== null ? 'agency' : ($server !== null ? 'server' : null),
            'client_id' => $app?->client_id,
            'client_secret_hint' => $app !== null ? self::hint($app->client_secret) : null,
            'developer_token_hint' => $app?->developer_token !== null ? self::hint($app->developer_token) : null,
            'requires_developer_token' => $vendor->supportsDeveloperToken(),
            'verified_at' => $app?->verified_at?->toIso8601String(),
            'verification_error' => $app?->verification_error,
            'updated_at' => $app?->updated_at?->toIso8601String(),
            'updated_by' => $app?->updated_by !== null ? User::query()->whereKey($app->updated_by)->value('name') : null,
            'redirect_uris' => array_map(OAuthFlow::redirectUri(...), $vendor->platforms()),
            'console_url' => $vendor->consoleUrl(),
            'missing_platforms' => $this->registry->missingPlatforms($vendor),
        ];
    }

    /** Só o final, e só quando o segredo é longo o bastante para isso não ajudar a adivinhá-lo. */
    private static function hint(string $secret): string
    {
        return '••••'.(mb_strlen($secret) >= 16 ? mb_substr($secret, -4) : '');
    }
}
