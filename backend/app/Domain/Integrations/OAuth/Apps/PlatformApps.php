<?php

declare(strict_types=1);

namespace App\Domain\Integrations\OAuth\Apps;

use App\Models\OAuthApp;

/**
 * De onde vêm as credenciais do app OAuth de cada plataforma:
 *  1. as cadastradas pela agência do contexto (tabela oauth_apps, sob RLS);
 *  2. senão, as do servidor (.env → config/services.php), se existirem.
 *
 * O cadastro da agência é usado inteiro: nada é misturado com o do servidor (o developer
 * token do Google Ads fica preso ao projeto do Google Cloud do app que o usa).
 * Sem cache de propósito: o serviço pode viver entre requests (Octane) e trocar de agência.
 */
final readonly class PlatformApps
{
    public function credentials(AppVendor $vendor): ?AppCredentials
    {
        $app = $this->agencyApp($vendor);

        if ($app !== null) {
            return new AppCredentials($app->client_id, $app->client_secret, $app->developer_token, 'agency');
        }

        return $this->server($vendor);
    }

    /** Cadastro da agência do contexto (null sem contexto ou sem cadastro). */
    public function agencyApp(AppVendor $vendor): ?OAuthApp
    {
        return OAuthApp::query()->where('vendor', $vendor->value)->first();
    }

    /** Credenciais padrão do servidor, se configuradas. */
    public function server(AppVendor $vendor): ?AppCredentials
    {
        $id = self::config($vendor, 'client_id');
        $secret = self::config($vendor, 'client_secret');

        if ($id === '' || $secret === '') {
            return null;
        }

        $token = $vendor->supportsDeveloperToken() ? self::config($vendor, 'ads_developer_token') : '';

        return new AppCredentials($id, $secret, $token !== '' ? $token : null, 'server');
    }

    private static function config(AppVendor $vendor, string $key): string
    {
        $value = config("services.{$vendor->value}.{$key}");

        return is_string($value) ? trim($value) : '';
    }
}
