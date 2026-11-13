<?php

declare(strict_types=1);

namespace App\Mcp\Tools;

use App\Models\Project;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request as HttpRequest;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Str;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Tool;

/**
 * Base das ferramentas do servidor MCP (ADR 0026). Cada ferramenta exige, além de "mcp:tools",
 * o escopo de leitura correspondente no token; sem ele, nem aparece na lista. Os dados vêm dos
 * mesmos controllers e serviços da API v1, sob o RLS da agência do token.
 */
abstract class DeltaTool extends Tool
{
    /** Escopo do token de API exigido por esta ferramenta. */
    abstract protected function scope(): string;

    public function shouldRegister(HttpRequest $request): bool
    {
        $scopes = $request->attributes->get('api_scopes');

        return is_array($scopes) && in_array($this->scope(), $scopes, true);
    }

    /** Projeto pelo id (o RLS já restringe à agência do token). */
    protected function project(Request $request): ?Project
    {
        $id = $request->get('project_id');

        return is_string($id) && Str::isUuid($id) ? Project::query()->find($id) : null;
    }

    protected static function projectNotFound(): Response
    {
        return Response::error('Projeto não encontrado. Use list_projects para ver os ids dos projetos da agência.');
    }

    /** "data" de uma resposta JSON ou de um resource, como a API v1 devolveria. */
    protected static function data(JsonResponse|JsonResource $response): mixed
    {
        $payload = $response instanceof JsonResource ? $response->response()->getData(true) : $response->getData(true);

        return is_array($payload) ? ($payload['data'] ?? null) : null;
    }

    /** @param array<string, mixed> $query */
    protected static function httpRequest(array $query = []): HttpRequest
    {
        return HttpRequest::create('/', 'GET', $query);
    }
}
