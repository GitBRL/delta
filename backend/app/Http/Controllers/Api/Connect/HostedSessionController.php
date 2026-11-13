<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\Connect;

use App\Domain\Branding\Brand;
use App\Domain\Integrations\OAuth\OAuthRegistry;
use App\Domain\Metrics\Catalog\Catalog;
use App\Http\Controllers\Controller;
use App\Models\ConnectSession;
use App\Models\IntegrationAccount;
use App\Models\Project;
use App\Support\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * Página pública da sessão hospedada do Connect (ADR 0032): marca do merchant, plataformas
 * liberadas e o que já foi conectado. O login de cada plataforma usa /oauth/{p}/start?connect_session=…
 */
final class HostedSessionController extends Controller
{
    public function show(string $token, TenantContext $context, Catalog $catalog, OAuthRegistry $registry): JsonResponse
    {
        /** @var object{session_id: string, tenant_id: string, project_id: string, expires_at: string}|null $row */
        $row = DB::selectOne('select * from app.connect_session_by_token(?)', [hash('sha256', $token)]);
        abort_if($row === null, 404, 'Link de conexão inválido.');
        $expired = CarbonImmutable::parse($row->expires_at)->isPast();

        return $context->run($row->tenant_id, null, function () use ($row, $expired, $catalog, $registry): JsonResponse {
            $session = ConnectSession::query()->findOrFail($row->session_id);
            $project = Project::query()->findOrFail($row->project_id);
            $connected = $project->accounts()->get()->groupBy('provider')->map(fn ($accounts): array => $accounts->map(fn (IntegrationAccount $a): string => $a->name)->values()->all());

            return response()->json(['data' => [
                'brand' => Brand::current($row->tenant_id)->toPublic(),
                'customer' => ['name' => $project->name],
                'expired' => $expired,
                'expires_at' => $session->expires_at->toIso8601String(),
                'return_url' => $session->return_url,
                'platforms' => array_values(array_filter(array_map(function (string $key) use ($catalog, $registry, $connected): ?array {
                    $provider = $catalog->provider($key);

                    return $provider === null ? null : [
                        'key' => $key, 'name' => $provider->name(), 'category' => $provider->category(),
                        'modes' => $registry->modes($key), 'connected_accounts' => $connected->get($key, []),
                    ];
                }, $session->platforms))),
            ]]);
        });
    }
}
