<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Jobs\ImportFromReportei;
use App\Models\Import;
use App\Support\Audit\Audit;
use App\Support\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Importador do Reportei (dono/admin). O token só passa pela fila, criptografado. */
final class ImportController extends Controller
{
    public function __construct(
        private readonly TenantContext $context,
        private readonly Audit $audit,
    ) {}

    public function index(): JsonResponse
    {
        return response()->json(['data' => Import::query()->orderByDesc('created_at')->limit(20)->get()->map(self::present(...))->values()->all()]);
    }

    public function show(Import $import): JsonResponse
    {
        return response()->json(['data' => self::present($import)]);
    }

    public function store(Request $request): JsonResponse
    {
        $request->validate(['token' => ['required', 'string', 'min:20', 'max:2000', 'regex:/^\S+$/']], [
            'token.required' => 'Cole o token da API do Reportei (Configurações da Empresa › API).',
        ]);

        $import = Import::query()->create(['source' => 'reportei', 'status' => 'queued', 'summary' => [], 'created_by' => $this->context->userId()]);
        $this->audit->record('import.started', $import, ['source' => 'reportei']);
        try {
            ImportFromReportei::dispatch($import->id, $request->string('token')->toString());
        } catch (\Throwable $e) {
            report($e); // fila síncrona: a falha já ficou registrada na importação
        }

        return response()->json(['data' => self::present($import->refresh())], 202);
    }

    /** @return array<string, mixed> */
    private static function present(Import $i): array
    {
        return ['id' => $i->id, 'source' => $i->source, 'status' => $i->status, 'summary' => $i->summary === [] ? new \stdClass : $i->summary, 'error' => $i->error, 'created_at' => $i->created_at?->toIso8601String()];
    }
}
