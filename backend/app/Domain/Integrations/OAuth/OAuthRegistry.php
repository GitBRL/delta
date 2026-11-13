<?php

declare(strict_types=1);

namespace App\Domain\Integrations\OAuth;

use App\Domain\Integrations\ConnectionManager;
use App\Domain\Integrations\ConnectorRegistry;
use App\Domain\Integrations\ConnectorUnavailable;
use App\Domain\Integrations\OAuth\Apps\AppVendor;
use App\Domain\Integrations\OAuth\Apps\PlatformApps;
use App\Domain\Integrations\OAuth\Apps\VerifiesApp;

/**
 * Qual login (OAuth) atende cada plataforma de dados, e se o login real está disponível
 * para a agência do contexto (depende do app cadastrado por ela ou do servidor).
 */
final readonly class OAuthRegistry
{
    private const WHERE = 'Um dono ou administrador da agência faz isso em Integrações › Apps das plataformas.';

    public function __construct(
        private MetaOAuth $meta,
        private GoogleOAuth $google,
        private TikTokOAuth $tiktok,
        private LinkedInOAuth $linkedin,
        private DemoOAuth $demo,
        private ConnectorRegistry $connectors,
        private PlatformApps $apps,
    ) {}

    public function for(string $platform, string $mode): OAuthProvider
    {
        $vendor = AppVendor::forPlatform($platform) ?? throw ConnectorUnavailable::unknown($platform);

        return $mode === 'sandbox' ? $this->demo : $this->live($vendor);
    }

    public function live(AppVendor $vendor): OAuthProvider&VerifiesApp
    {
        return match ($vendor) {
            AppVendor::Meta => $this->meta,
            AppVendor::Google => $this->google,
            AppVendor::Tiktok => $this->tiktok,
            AppVendor::Linkedin => $this->linkedin,
        };
    }

    /** @return list<'sandbox'|'live'> */
    public function modes(string $platform): array
    {
        if (AppVendor::forPlatform($platform) === null) {
            return [];
        }

        return $this->for($platform, 'live')->isConfigured($platform) ? ['sandbox', 'live'] : ['sandbox'];
    }

    /** Aviso para mostrar junto ao botão de conexão real (null = nada a avisar). */
    public function liveNote(string $platform): ?string
    {
        $vendor = AppVendor::forPlatform($platform);
        if ($vendor === null) {
            return null;
        }

        $provider = $this->live($vendor);
        if (! $provider->isConfigured($platform)) {
            // Só o Google Ads pode estar sem login com o app cadastrado: falta o developer token.
            return $platform === 'google_ads' && $provider->isConfigured('ga4')
                ? 'Login real indisponível: falta o developer token do Google Ads. '.self::WHERE
                : 'Login real indisponível: falta cadastrar '.$vendor->appPhrase().'. '.self::WHERE;
        }

        if ($this->apps->agencyApp($vendor)?->verificationStatus() === 'invalid') {
            $who = match ($vendor) {
                AppVendor::Meta => 'A Meta',
                AppVendor::Google => 'O Google',
                AppVendor::Tiktok => 'O TikTok',
                AppVendor::Linkedin => 'O LinkedIn',
            };

            return "{$who} recusou as credenciais d{$vendor->appPhrase()} na última verificação, então o login pode falhar. ".self::WHERE;
        }

        if (! ConnectionManager::isDestination($platform) && ! $this->connectors->hasLiveConnector($platform)) {
            return 'Login real disponível. A coleta de dados reais desta plataforma ainda está em desenvolvimento: as contas ficam conectadas e a sincronização começa quando o conector estiver pronto.';
        }

        return null;
    }

    /** @return list<string> plataformas do app ainda sem login real (ex.: Google Ads sem developer token) */
    public function missingPlatforms(AppVendor $vendor): array
    {
        $provider = $this->live($vendor);

        return array_values(array_filter($vendor->platforms(), fn (string $p): bool => ! $provider->isConfigured($p)));
    }
}
