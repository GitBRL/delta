<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\Connect;

use App\Domain\Connect\ConnectCustomers;
use App\Domain\Integrations\OAuth\OAuthRegistry;
use App\Domain\Metrics\Catalog\Catalog;
use App\Http\Controllers\Controller;
use App\Models\ConnectCustomer;
use App\Models\IntegrationAccount;
use App\Support\Audit\Audit;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Validation\Rule;

/**
 * Delta Connect, lado do merchant (token da API com o escopo "connect"): customers, catálogo
 * de integrações e a sessão hospedada de conexão. ADR 0032.
 */
final class MerchantController extends Controller
{
    public function __construct(
        private readonly ConnectCustomers $customers,
        private readonly Audit $audit,
    ) {}

    public function index(): JsonResponse
    {
        return response()->json(['data' => ConnectCustomer::query()->with('project:id,name,niche')->orderBy('created_at')->limit(1000)->get()
            ->map(fn (ConnectCustomer $c): array => self::present($c))->values()->all()]);
    }

    public function show(ConnectCustomer $customer): JsonResponse
    {
        return response()->json(['data' => self::present($customer->load('project:id,name,niche'), withIntegrations: true)]);
    }

    public function store(Request $request): JsonResponse
    {
        $request->validate([
            'name' => ['required', 'string', 'min:2', 'max:120'],
            'niche' => ['nullable', 'string', 'max:60'],
            'external_id' => ['nullable', 'string', 'max:120', Rule::unique('connect_customers', 'external_id')],
            'metadata' => ['nullable', 'array', 'max:30'],
        ], ['external_id.unique' => 'Já existe um customer com este external_id.']);

        /** @var array<string, mixed> $metadata */
        $metadata = (array) $request->input('metadata', []);
        [$customer, $token] = $this->customers->create(
            $request->string('name')->toString(),
            $request->filled('niche') ? $request->string('niche')->toString() : null,
            $request->filled('external_id') ? $request->string('external_id')->toString() : null,
            $metadata,
        );
        $this->audit->record('connect.customer_created', $customer, ['external_id' => $customer->external_id]);

        return response()->json(['data' => self::present($customer->load('project:id,name,niche')), 'customer_token' => $token], 201);
    }

    public function update(Request $request, ConnectCustomer $customer): JsonResponse
    {
        $request->validate([
            'name' => ['sometimes', 'string', 'min:2', 'max:120'],
            'niche' => ['nullable', 'string', 'max:60'],
            'metadata' => ['sometimes', 'array', 'max:30'],
        ]);
        $project = $customer->project()->firstOrFail();
        $project->fill(array_filter(['name' => $request->input('name'), 'niche' => $request->input('niche')], fn (mixed $v): bool => $v !== null))->save();
        if ($request->has('metadata')) {
            $customer->forceFill(['metadata' => (array) $request->input('metadata')])->save();
        }

        return response()->json(['data' => self::present($customer->refresh()->load('project:id,name,niche'))]);
    }

    /** Novo token (o anterior deixa de valer na hora). */
    public function rotate(ConnectCustomer $customer): JsonResponse
    {
        $token = $this->customers->rotate($customer);
        $this->audit->record('connect.customer_token_rotated', $customer);

        return response()->json(['data' => self::present($customer->refresh()->load('project:id,name,niche')), 'customer_token' => $token]);
    }

    /** Revoga o acesso do customer. O projeto e os dados continuam na agência. */
    public function destroy(ConnectCustomer $customer): Response
    {
        $customer->forceFill(['revoked_at' => now()])->save();
        $this->audit->record('connect.customer_revoked', $customer);

        return response()->noContent();
    }

    public function integrations(Catalog $catalog, OAuthRegistry $registry): JsonResponse
    {
        $data = [];
        foreach ($catalog->providers() as $provider) {
            $data[] = [
                'key' => $provider->key(), 'name' => $provider->name(), 'category' => $provider->category(),
                'account_kind' => $provider->accountKind(), 'modes' => $registry->modes($provider->key()),
                'metrics' => count($provider->metrics()),
            ];
        }

        return response()->json(['data' => $data]);
    }

    /** Sessão hospedada: link de 30 minutos em que o cliente final conecta as contas. */
    public function session(Request $request, Catalog $catalog): JsonResponse
    {
        $request->validate([
            'customer_id' => ['required', 'uuid'],
            'platforms' => ['nullable', 'array', 'min:1'],
            'platforms.*' => ['string', Rule::in(array_keys($catalog->providers()))],
            'return_url' => ['nullable', 'url:https,http', 'max:500'],
        ]);
        $customer = ConnectCustomer::query()->whereKey($request->string('customer_id')->toString())->whereNull('revoked_at')->firstOrFail();
        $platforms = $request->filled('platforms') ? array_values(array_filter((array) $request->input('platforms'), 'is_string')) : array_keys($catalog->providers());

        [$session, $token] = $this->customers->session($customer, $platforms, $request->filled('return_url') ? $request->string('return_url')->toString() : null);

        return response()->json(['data' => [
            'url' => ConnectCustomers::sessionUrl($token),
            'expires_at' => $session->expires_at->toIso8601String(),
            'platforms' => $session->platforms,
        ]], 201);
    }

    /** @return array<string, mixed> */
    public static function present(ConnectCustomer $c, bool $withIntegrations = false): array
    {
        return [
            'id' => $c->id,
            'external_id' => $c->external_id,
            'name' => $c->project?->name,
            'niche' => $c->project?->niche,
            'project_id' => $c->project_id,
            'metadata' => $c->metadata,
            'token_prefix' => $c->token_prefix,
            'revoked' => $c->revoked_at !== null,
            'created_at' => $c->created_at?->toIso8601String(),
            ...($withIntegrations ? ['integrations' => self::integrationsOf($c)] : []),
        ];
    }

    /** @return list<array<string, mixed>> */
    public static function integrationsOf(ConnectCustomer $c): array
    {
        $project = $c->project ?? $c->project()->first();
        if ($project === null) {
            return [];
        }

        return array_values($project->accounts()->with('integration:id,mode,status,last_synced_at')->orderBy('name')->get()
            ->map(fn (IntegrationAccount $a): array => [
                'id' => $a->id, 'provider' => $a->provider, 'name' => $a->name, 'external_id' => $a->external_id,
                'mode' => $a->integration?->mode, 'status' => $a->integration?->status,
            ])->all());
    }
}
