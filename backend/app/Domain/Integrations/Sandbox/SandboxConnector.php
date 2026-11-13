<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Sandbox;

use App\Domain\Integrations\Connector;
use App\Domain\Integrations\ConnectorUnavailable;
use App\Domain\Integrations\DiscoveredAccount;
use App\Domain\Integrations\Sandbox\Profiles\Ga4Profile;
use App\Domain\Integrations\Sandbox\Profiles\GoogleAdsProfile;
use App\Domain\Integrations\Sandbox\Profiles\GoogleExtrasProfile;
use App\Domain\Integrations\Sandbox\Profiles\LinkedInAdsProfile;
use App\Domain\Integrations\Sandbox\Profiles\MetaAdsProfile;
use App\Domain\Integrations\Sandbox\Profiles\SocialProfile;
use App\Domain\Integrations\Sandbox\Profiles\TikTokAdsProfile;
use App\Domain\Metrics\Catalog\Catalog;
use App\Models\IntegrationAccount;
use App\Models\IntegrationConnection;
use Carbon\CarbonImmutable;
use Illuminate\Support\Str;

/**
 * Conector de demonstração: dados realistas e determinísticos, sem chamar nenhuma plataforma.
 * Permite usar e testar o produto inteiro enquanto as aprovações da Meta e do Google não saem.
 */
final readonly class SandboxConnector implements Connector
{
    public function __construct(private Catalog $catalog) {}

    public function discoverAccounts(IntegrationConnection $connection): array
    {
        $profile = $this->profile($connection->provider);
        $kind = $this->catalog->provider($connection->provider)?->accountKind() ?? 'account';

        return [new DiscoveredAccount(
            externalId: 'sbx_'.$connection->provider.'_'.Str::lower(Str::random(10)),
            name: $profile->accountName(),
            kind: $kind,
            currency: $profile->currency(),
            timezone: 'America/Sao_Paulo',
        )];
    }

    public function fetchDaily(IntegrationAccount $account, CarbonImmutable $from, CarbonImmutable $to): iterable
    {
        $profile = $this->profile($account->provider);
        $seed = new Seed($account->external_id);

        for ($date = $from; $date->lte($to); $date = $date->addDay()) {
            foreach ($profile->day($seed, $date) as $metric => $value) {
                yield ['metric' => $metric, 'date' => $date->toDateString(), 'value' => $value];
            }
        }
    }

    public function fetchPeriod(IntegrationAccount $account, string $metricKey, CarbonImmutable $from, CarbonImmutable $to): ?float
    {
        $profile = $this->profile($account->provider);
        $seed = new Seed($account->external_id);
        $daily = [];

        for ($date = $from; $date->lte($to); $date = $date->addDay()) {
            $value = $profile->day($seed, $date)[$metricKey] ?? null;
            if ($value !== null) {
                $daily[] = $value;
            }
        }

        return $profile->period($metricKey, $daily);
    }

    private function profile(string $provider): SandboxProfile
    {
        return match ($provider) {
            'meta_ads' => new MetaAdsProfile,
            'google_ads' => new GoogleAdsProfile,
            'ga4' => new Ga4Profile,
            'instagram' => SocialProfile::instagram(),
            'facebook' => SocialProfile::facebook(),
            'search_console' => GoogleExtrasProfile::searchConsole(),
            'youtube' => GoogleExtrasProfile::youtube(),
            'google_business' => GoogleExtrasProfile::business(),
            'tiktok_ads' => new TikTokAdsProfile,
            'linkedin_ads' => new LinkedInAdsProfile,
            default => throw ConnectorUnavailable::unknown($provider),
        };
    }
}
