<?php

declare(strict_types=1);

namespace App\Domain\Integrations\OAuth\Apps;

/** Dono do app OAuth. Um app serve a várias plataformas de dados (com escopos diferentes). */
enum AppVendor: string
{
    case Meta = 'meta';
    case Google = 'google';
    case Tiktok = 'tiktok';
    case Linkedin = 'linkedin';

    public static function forPlatform(string $platform): ?self
    {
        return match ($platform) {
            'meta_ads', 'facebook', 'instagram' => self::Meta,
            'google_ads', 'ga4', 'search_console', 'youtube', 'google_business', 'google_sheets' => self::Google,
            'tiktok_ads' => self::Tiktok,
            'linkedin_ads' => self::Linkedin,
            default => null,
        };
    }

    public function label(): string
    {
        return match ($this) {
            self::Meta => 'Meta',
            self::Google => 'Google',
            self::Tiktok => 'TikTok',
            self::Linkedin => 'LinkedIn',
        };
    }

    /** "o app da Meta" / "o app do Google" */
    public function appPhrase(): string
    {
        return match ($this) {
            self::Meta => 'o app da Meta',
            self::Google => 'o app do Google',
            self::Tiktok => 'o app do TikTok for Business',
            self::Linkedin => 'o app do LinkedIn',
        };
    }

    /** @return list<string> plataformas de dados atendidas por este app */
    public function platforms(): array
    {
        return match ($this) {
            self::Meta => ['meta_ads', 'facebook', 'instagram'],
            self::Google => ['ga4', 'google_ads', 'search_console', 'youtube', 'google_business', 'google_sheets'],
            self::Tiktok => ['tiktok_ads'],
            self::Linkedin => ['linkedin_ads'],
        };
    }

    /** Onde o administrador cria o app e copia as credenciais. */
    public function consoleUrl(): string
    {
        return match ($this) {
            self::Meta => 'https://developers.facebook.com/apps',
            self::Google => 'https://console.cloud.google.com/apis/credentials',
            self::Tiktok => 'https://business-api.tiktok.com/portal/apps',
            self::Linkedin => 'https://www.linkedin.com/developers/apps',
        };
    }

    /** O Google Ads exige developer token (o GA4 não). */
    public function supportsDeveloperToken(): bool
    {
        return $this === self::Google;
    }
}
