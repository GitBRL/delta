<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Laravel\Passkeys\Passkey;

/**
 * Passkeys da própria pessoa (o RLS já limita a ela). Cadastrar e remover ficam nas rotas do
 * Fortify em /auth/user/passkeys, com a senha confirmada. ADR 0025.
 */
final class PasskeyController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();

        return response()->json(['data' => $user->passkeys()->orderBy('created_at')->get()->map(fn (Passkey $p): array => [
            'id' => $p->getKey(),
            'name' => $p->getAttribute('name'),
            'authenticator' => $p->getAttribute('authenticator'),
            'created_at' => $p->created_at?->toIso8601String(),
            'last_used_at' => $p->last_used_at?->toIso8601String(),
        ])->values()->all()]);
    }
}
