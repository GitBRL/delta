<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\MeResource;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Usuário autenticado + agências às quais pertence (com o papel em cada uma). */
final class MeController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();
        $user->load(['tenants' => fn ($query) => $query->orderBy('tenants.name')]);

        // Status explícito: JsonResource responderia 201 se o usuário tivesse acabado de ser criado.
        return (new MeResource($user))->response()->setStatusCode(200);
    }
}
