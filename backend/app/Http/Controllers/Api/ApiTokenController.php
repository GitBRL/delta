<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Domain\Billing\Entitlements;
use App\Domain\PublicApi\ApiTokens;
use App\Http\Controllers\Controller;
use App\Models\ApiToken;
use App\Support\Audit\Audit;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Validation\Rule;

/** Tokens da API pública (dono/admin). O token aparece uma única vez, na criação. */
final class ApiTokenController extends Controller
{
    public function __construct(
        private readonly ApiTokens $tokens,
        private readonly Audit $audit,
    ) {}

    public function index(): JsonResponse
    {
        return response()->json([
            'data' => ApiToken::query()->orderByDesc('created_at')->get()->map(self::present(...))->values()->all(),
            'scopes' => ApiTokens::SCOPES,
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $request->validate([
            'name' => ['required', 'string', 'min:2', 'max:80'],
            'scopes' => ['required', 'array', 'min:1'],
            'scopes.*' => [Rule::in(array_keys(ApiTokens::SCOPES))],
            'expires_in_days' => ['nullable', 'integer', 'between:1,730'],
        ], ['scopes.required' => 'Escolha ao menos uma permissão.']);

        $scopes = array_values(array_filter((array) $request->input('scopes'), 'is_string'));
        app(Entitlements::class)->ensureFeature(in_array('mcp:tools', $scopes, true) ? 'mcp' : 'api');
        [$token, $plain] = $this->tokens->create($request->string('name')->toString(), $scopes, $request->filled('expires_in_days') ? $request->integer('expires_in_days') : null);
        $this->audit->record('api_token.created', $token, ['scopes' => $scopes]);

        return response()->json(['data' => self::present($token), 'token' => $plain], 201);
    }

    public function destroy(ApiToken $apiToken): Response
    {
        if ($apiToken->revoked_at === null) {
            $apiToken->forceFill(['revoked_at' => now()])->save();
            $this->audit->record('api_token.revoked', $apiToken);
        }

        return response()->noContent();
    }

    /** @return array<string, mixed> */
    private static function present(ApiToken $t): array
    {
        return [
            'id' => $t->id,
            'name' => $t->name,
            'prefix' => $t->token_prefix,
            'scopes' => $t->scopes,
            'last_used_at' => $t->last_used_at?->toIso8601String(),
            'expires_at' => $t->expires_at?->toIso8601String(),
            'revoked_at' => $t->revoked_at?->toIso8601String(),
            'active' => $t->revoked_at === null && ($t->expires_at === null || $t->expires_at->isFuture()),
            'created_at' => $t->created_at?->toIso8601String(),
        ];
    }
}
