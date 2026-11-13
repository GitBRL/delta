<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Domain\Billing\Entitlements;
use App\Domain\Publishing\Networks;
use App\Domain\Publishing\PostPresenter;
use App\Domain\Publishing\PublishingService;
use App\Http\Controllers\Controller;
use App\Jobs\PublishPost;
use App\Models\MediaAsset;
use App\Models\Post;
use App\Models\Project;
use App\Support\Audit\Audit;
use App\Support\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * Posts do Publishing (ADR 0028). Ler: equipe e o cliente (só os projetos dele, pelo RLS);
 * criar, editar, pedir aprovação, agendar e publicar: equipe.
 */
final class PostController extends Controller
{
    public function __construct(
        private readonly PublishingService $publishing,
        private readonly PostPresenter $presenter,
        private readonly TenantContext $context,
        private readonly Audit $audit,
    ) {}

    /** Calendário: posts do intervalo (data agendada, publicada ou de criação). */
    public function index(Request $request): JsonResponse
    {
        $request->validate([
            'project_id' => ['nullable', 'uuid'],
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date'],
            'status' => ['nullable', 'string'],
        ]);

        $query = Post::query()->with('project:id,name')->orderByRaw('coalesce(scheduled_at, published_at, created_at)')->limit(500);
        if ($request->filled('project_id')) {
            $query->where('project_id', $request->string('project_id')->toString());
        }
        if ($request->filled('status')) {
            $query->whereIn('status', explode(',', $request->string('status')->toString()));
        }
        if ($request->filled('from')) {
            $query->whereRaw('coalesce(scheduled_at, published_at, created_at) >= ?', [CarbonImmutable::parse($request->string('from')->toString())->startOfDay()]);
        }
        if ($request->filled('to')) {
            $query->whereRaw('coalesce(scheduled_at, published_at, created_at) <= ?', [CarbonImmutable::parse($request->string('to')->toString())->endOfDay()]);
        }

        $staff = $this->isStaff();

        return response()->json(['data' => $query->get()->map(fn (Post $p): array => $this->presenter->present($p, $staff))->values()->all()]);
    }

    public function show(Post $post): JsonResponse
    {
        return response()->json(['data' => $this->presenter->present($post->load('project:id,name'), $this->isStaff())]);
    }

    public function store(Request $request): JsonResponse
    {
        app(Entitlements::class)->ensureFeature('publishing');
        $data = $this->validated($request, null);

        $post = DB::transaction(function () use ($data): Post {
            $post = Post::query()->create([
                'project_id' => $data['project_id'],
                'title' => $data['title'] ?? null,
                'caption' => $data['caption'] ?? '',
                'media' => $data['media'] ?? [],
                'requires_approval' => $data['requires_approval'] ?? true,
                'external_reference' => $data['external_reference'] ?? null,
                'created_by' => $this->context->userId(),
                'updated_by' => $this->context->userId(),
            ]);
            $this->syncTargets($post, $data['targets'] ?? []);

            return $post;
        });
        $this->audit->record('post.created', $post, ['project_id' => $post->project_id]);

        return response()->json(['data' => $this->presenter->present($post->load('project:id,name'))], 201);
    }

    public function update(Request $request, Post $post): JsonResponse
    {
        if (! in_array($post->status, Post::EDITABLE, true)) {
            throw ValidationException::withMessages(['post' => 'Este post não pode mais ser editado.']);
        }
        $data = $this->validated($request, $post);

        $reset = DB::transaction(function () use ($post, $data): bool {
            $post->fill(array_intersect_key($data, array_flip(['title', 'caption', 'media', 'requires_approval'])));
            $post->updated_by = $this->context->userId();
            $contentChanged = $post->isDirty(['title', 'caption', 'media']) || array_key_exists('targets', $data);
            $post->save();

            if (array_key_exists('targets', $data)) {
                if ($post->targets()->where('status', 'published')->exists()) {
                    throw ValidationException::withMessages(['targets' => 'Alguns destinos já foram publicados; as redes não podem mais mudar.']);
                }
                $this->syncTargets($post, $data['targets']);
            }

            return $contentChanged && $this->publishing->contentChanged($post);
        });

        return response()->json([
            'data' => $this->presenter->present($post->refresh()->load('project:id,name')),
            'meta' => ['approval_reset' => $reset],
        ]);
    }

    public function destroy(Post $post): Response
    {
        if (in_array($post->status, ['publishing', 'published'], true) || $post->targets()->where('status', 'published')->exists()) {
            throw ValidationException::withMessages(['post' => 'Posts publicados ficam no histórico. Para tirar do calendário, cancele.']);
        }
        $this->audit->record('post.deleted', $post);
        $post->delete();

        return response()->noContent();
    }

    public function requestApproval(Request $request, Post $post): JsonResponse
    {
        $request->validate(['notify' => ['sometimes', 'boolean']]);
        $result = $this->publishing->requestApproval($post, $request->boolean('notify', true));

        return response()->json(['data' => $this->presenter->present($post->refresh()->load('project:id,name')), 'meta' => $result]);
    }

    public function schedule(Request $request, Post $post): JsonResponse
    {
        $request->validate(['scheduled_at' => ['required', 'date']], ['scheduled_at.required' => 'Escolha a data e o horário.']);
        $this->publishing->schedule($post, CarbonImmutable::parse($request->string('scheduled_at')->toString()));

        return response()->json(['data' => $this->presenter->present($post->refresh()->load('project:id,name'))]);
    }

    public function unschedule(Post $post): JsonResponse
    {
        $this->publishing->unschedule($post);

        return response()->json(['data' => $this->presenter->present($post->refresh()->load('project:id,name'))]);
    }

    public function publish(Post $post): JsonResponse
    {
        $this->publishing->publishNow($post);
        $this->audit->record('post.publish_now', $post);
        try {
            PublishPost::dispatch($post->id);
        } catch (Throwable $e) {
            report($e); // fila síncrona: o resultado já ficou em cada destino
        }

        return response()->json(['data' => $this->presenter->present($post->refresh()->load('project:id,name'))], 202);
    }

    public function cancel(Post $post): JsonResponse
    {
        $this->publishing->cancel($post);

        return response()->json(['data' => $this->presenter->present($post->refresh()->load('project:id,name'))]);
    }

    /** Redes, formatos e as contas do projeto que podem receber posts. */
    public function networks(Request $request): JsonResponse
    {
        $request->validate(['project_id' => ['nullable', 'uuid']]);
        $accounts = [];
        if ($request->filled('project_id')) {
            $project = Project::query()->findOrFail($request->string('project_id')->toString());
            foreach ($project->accounts()->with('integration:id,mode,status')->get() as $account) {
                $network = Networks::networkForProvider($account->provider);
                if ($network !== null) {
                    $accounts[] = ['id' => $account->id, 'network' => $network, 'name' => $account->name, 'mode' => $account->integration?->mode, 'status' => $account->integration?->status];
                }
            }
        }

        return response()->json(['data' => [
            'networks' => array_map(fn (string $key, array $spec): array => [
                'key' => $key, 'label' => $spec['label'], 'caption_max' => $spec['caption_max'],
                'formats' => array_map(fn (string $f, string $label): array => ['key' => $f, 'label' => $label], array_keys($spec['formats']), $spec['formats']),
            ], array_keys(Networks::SPEC), Networks::SPEC),
            'accounts' => $accounts,
        ]]);
    }

    /** @return array<string, mixed> */
    private function validated(Request $request, ?Post $post): array
    {
        $creating = $post === null;
        /** @var array<string, mixed> $data */
        $data = $request->validate([
            'project_id' => [$creating ? 'required' : 'prohibited', 'uuid', Rule::exists('projects', 'id')],
            'title' => ['nullable', 'string', 'max:120'],
            'caption' => ['nullable', 'string', 'max:63206'],
            'media' => ['sometimes', 'array', 'max:10'],
            'media.*' => ['uuid', 'distinct'],
            'requires_approval' => ['sometimes', 'boolean'],
            'external_reference' => [$creating ? 'nullable' : 'prohibited', 'string', 'max:100', Rule::unique('posts', 'external_reference')],
            'targets' => ['sometimes', 'array', 'max:6'],
            'targets.*.network' => ['required', Rule::in(array_keys(Networks::SPEC))],
            'targets.*.format' => ['required', 'string'],
            'targets.*.account_id' => ['nullable', 'uuid'],
        ], ['project_id.exists' => 'Projeto não encontrado.', 'external_reference.unique' => 'Já existe um post com esta referência externa.']);

        if (array_key_exists('caption', $data) && $data['caption'] === null) {
            $data['caption'] = '';
        }

        $projectId = $creating ? (is_string($data['project_id'] ?? null) ? $data['project_id'] : '') : $post->project_id;

        if (isset($data['media']) && is_array($data['media'])) {
            $media = array_values(array_filter($data['media'], 'is_string'));
            $found = MediaAsset::query()->whereIn('id', $media)->where(fn ($q) => $q->where('project_id', $projectId)->orWhereNull('project_id'))->count();
            if ($found !== count($media)) {
                throw ValidationException::withMessages(['media' => 'Alguma mídia não existe na biblioteca deste projeto.']);
            }
            $data['media'] = $media;
        }

        if (isset($data['targets']) && is_array($data['targets'])) {
            $linked = Project::query()->findOrFail($projectId)->accounts()->pluck('integration_accounts.provider', 'integration_accounts.id');
            foreach ($data['targets'] as $i => $target) {
                $network = is_array($target) && is_string($target['network'] ?? null) ? $target['network'] : '';
                $format = is_array($target) && is_string($target['format'] ?? null) ? $target['format'] : '';
                $account = is_array($target) && is_string($target['account_id'] ?? null) ? $target['account_id'] : null;
                if (! isset(Networks::SPEC[$network]['formats'][$format])) {
                    throw ValidationException::withMessages(["targets.{$i}.format" => "Formato inválido para {$network}."]);
                }
                if ($account !== null && $linked->get($account) !== Networks::providerFor($network)) {
                    throw ValidationException::withMessages(["targets.{$i}.account_id" => 'Escolha uma conta de '.Networks::SPEC[$network]['label'].' ligada a este projeto.']);
                }
            }
        }

        return $data;
    }

    private function syncTargets(Post $post, mixed $targets): void
    {
        $post->targets()->delete();
        foreach (is_array($targets) ? $targets : [] as $target) {
            if (is_array($target)) {
                $post->targets()->create([
                    'network' => $target['network'], 'format' => $target['format'], 'account_id' => $target['account_id'] ?? null,
                ]);
            }
        }
    }

    private function isStaff(): bool
    {
        $row = DB::selectOne('select app.is_staff() as staff');

        return is_object($row) && ($row->staff ?? false) === true;
    }
}
