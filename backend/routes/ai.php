<?php

declare(strict_types=1);

use App\Mcp\Servers\DeltaServer;
use Laravel\Mcp\Facades\Mcp;

/*
| Servidor MCP (ADR 0026): Streamable HTTP em /mcp, com o token da API pública ("Bearer dlt_…")
| e o escopo mcp:tools. Mesmo limite por token da API v1.
*/
Mcp::web('/mcp', DeltaServer::class)->middleware(['api.token', 'api.scope:mcp:tools', 'plan.feature:mcp', 'throttle:api-v1']);
