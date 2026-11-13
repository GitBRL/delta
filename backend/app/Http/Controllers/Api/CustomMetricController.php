<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Domain\Metrics\Catalog\Catalog;
use App\Domain\Metrics\Catalog\MetricDirection;
use App\Domain\Metrics\Catalog\MetricSet;
use App\Domain\Metrics\Catalog\MetricUnit;
use App\Domain\Metrics\Custom\CustomMetricDefinition;
use App\Domain\Metrics\Custom\CustomMetricTemplates;
use App\Domain\Metrics\Formula\FormulaException;
use App\Domain\Metrics\Query\Comparison;
use App\Domain\Metrics\Query\MetricQuery;
use App\Domain\Metrics\Query\MetricQueryService;
use App\Http\Controllers\Controller;
use App\Http\Requests\PreviewCustomMetricRequest;
use App\Http\Requests\SaveCustomMetricRequest;
use App\Models\CustomMetric;
use App\Models\Project;
use App\Support\Audit\Audit;
use App\Support\Tenancy\AuthIdentifier;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;
use Illuminate\Validation\ValidationException;

/** Indicadores personalizados da agência (§7.1 do plano). */
final class CustomMetricController extends Controller
{
    private const PREVIEW_KEY = 'custom:pre_visualizacao';

    public function __construct(
        private readonly Catalog $catalog,
        private readonly Audit $audit,
    ) {}

    public function index(): JsonResponse
    {
        $set = MetricSet::forCurrentTenant($this->catalog);

        return response()->json([
            'data' => CustomMetric::query()->orderBy('name')->get()->map(fn (CustomMetric $m) => $this->present($m, $set))->all(),
        ]);
    }

    public function templates(): JsonResponse
    {
        return response()->json(['data' => CustomMetricTemplates::all()]);
    }

    public function store(SaveCustomMetricRequest $request): JsonResponse
    {
        $set = MetricSet::forCurrentTenant($this->catalog);
        $key = CustomMetricDefinition::keyFor($request->string('name')->toString());

        if (isset($set->custom()[$key]) || $this->catalog->metric($key) !== null) {
            throw ValidationException::withMessages(['name' => 'Já existe um indicador com esse nome.']);
        }

        $references = $this->validateDefinition($request, $set, $key);
        $user = $request->user() ?? abort(401);

        $metric = CustomMetric::query()->create([
            ...$this->attributes($request),
            'key' => $key,
            'references' => $references,
            'created_by' => AuthIdentifier::of($user),
        ]);

        $this->audit->record('custom_metric.created', $metric, ['key' => $key, 'formula' => $metric->formula]);

        return response()->json(['data' => $this->present($metric, $set->with($metric->toSpec()))], 201);
    }

    public function update(SaveCustomMetricRequest $request, CustomMetric $customMetric): JsonResponse
    {
        $set = MetricSet::forCurrentTenant($this->catalog);
        $references = $this->validateDefinition($request, $set, $customMetric->key);
        $before = $customMetric->formula;

        // A chave não muda: outras fórmulas e relatórios dependem dela.
        $customMetric->fill([...$this->attributes($request), 'references' => $references])->save();

        $this->audit->record('custom_metric.updated', $customMetric, ['formula_before' => $before, 'formula' => $customMetric->formula]);

        return response()->json(['data' => $this->present($customMetric, $set->with($customMetric->toSpec()))]);
    }

    /** Rota protegida pelo middleware "staff". */
    public function destroy(CustomMetric $customMetric): Response
    {
        $dependents = CustomMetric::query()
            ->whereJsonContains('references', $customMetric->key)
            ->whereKeyNot($customMetric->id)
            ->orderBy('name')
            ->pluck('name')
            ->map(fn (mixed $name): string => is_string($name) ? $name : '')
            ->all();

        if ($dependents !== []) {
            throw ValidationException::withMessages([
                'id' => 'Este indicador é usado por: '.implode(', ', $dependents).'. Ajuste esses indicadores antes de excluir.',
            ]);
        }

        $customMetric->delete();
        $this->audit->record('custom_metric.deleted', $customMetric, ['key' => $customMetric->key]);

        return response()->noContent();
    }

    /** Resultado da fórmula ainda não salva, para o preview ao vivo do editor. */
    public function preview(PreviewCustomMetricRequest $request, MetricQueryService $service): JsonResponse
    {
        $set = MetricSet::forCurrentTenant($this->catalog);

        try {
            $spec = CustomMetricDefinition::build(
                $set,
                self::PREVIEW_KEY,
                'Pré-visualização',
                null,
                $request->string('formula')->toString(),
                $request->enum('unit', MetricUnit::class) ?? MetricUnit::Decimal,
                $request->enum('direction', MetricDirection::class) ?? MetricDirection::Neutral,
                $request->integer('decimals'),
            )['spec'];
        } catch (FormulaException $e) {
            throw ValidationException::withMessages(['formula' => $e->getMessage()]);
        }

        $project = Project::query()->findOrFail($request->string('project_id')->toString());

        $result = $service->run(new MetricQuery(
            project: $project,
            start: CarbonImmutable::parse($request->string('start')->toString()),
            end: CarbonImmutable::parse($request->string('end')->toString()),
            comparison: $request->enum('compare', Comparison::class) ?? Comparison::None,
            metrics: [self::PREVIEW_KEY],
            withSeries: true,
            set: $set->with($spec),
        ));

        return response()->json(['data' => $result['metrics'][0]]);
    }

    /** @return list<string> referências da fórmula */
    private function validateDefinition(SaveCustomMetricRequest $request, MetricSet $set, string $key): array
    {
        try {
            return CustomMetricDefinition::build(
                $set,
                $key,
                $request->string('name')->toString(),
                $request->filled('description') ? $request->string('description')->toString() : null,
                $request->string('formula')->toString(),
                $request->enum('unit', MetricUnit::class) ?? MetricUnit::Decimal,
                $request->enum('direction', MetricDirection::class) ?? MetricDirection::Neutral,
                $request->integer('decimals'),
            )['references'];
        } catch (FormulaException $e) {
            throw ValidationException::withMessages(['formula' => $e->getMessage()]);
        }
    }

    /** @return array<string, mixed> */
    private function attributes(SaveCustomMetricRequest $request): array
    {
        return [
            'name' => $request->string('name')->trim()->toString(),
            'description' => $request->filled('description') ? $request->string('description')->trim()->toString() : null,
            'formula' => $request->string('formula')->trim()->toString(),
            'unit' => $request->enum('unit', MetricUnit::class),
            'direction' => $request->enum('direction', MetricDirection::class),
            'decimals' => $request->integer('decimals'),
        ];
    }

    /** @return array<string, mixed> */
    private function present(CustomMetric $metric, MetricSet $set): array
    {
        try {
            $providers = $set->providersFor($metric->key);
        } catch (FormulaException) {
            $providers = [];
        }

        return [
            'id' => $metric->id,
            'key' => $metric->key,
            'name' => $metric->name,
            'description' => $metric->description,
            'formula' => $metric->formula,
            'unit' => $metric->unit->value,
            'direction' => $metric->direction->value,
            'decimals' => $metric->decimals,
            'providers' => $providers,
            'created_at' => $metric->created_at?->toIso8601String(),
            'updated_at' => $metric->updated_at?->toIso8601String(),
        ];
    }
}
