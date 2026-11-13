<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Domain\Branding\Brand;
use App\Domain\Publishing\Networks;
use App\Domain\Publishing\PostPresenter;
use App\Domain\Publishing\PublishingService;
use App\Http\Controllers\Controller;
use App\Models\Post;
use App\Models\PostApproval;
use App\Models\PostTarget;
use App\Support\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * Aprovação de post pelo cliente, por link público (ADR 0028). O token é procurado pelo hash em
 * app.post_approval_by_token; o resto roda no contexto da agência do link, sem usuário.
 */
final class PublicApprovalController extends Controller
{
    public function __construct(
        private readonly TenantContext $context,
        private readonly PublishingService $publishing,
        private readonly PostPresenter $presenter,
    ) {}

    public function show(string $token): JsonResponse
    {
        $row = self::lookup($token);

        return $this->context->run($row->tenant_id, null, function () use ($row): JsonResponse {
            $post = Post::query()->with('project:id,name')->findOrFail($row->post_id);
            $approval = PostApproval::query()->findOrFail($row->approval_id);
            $full = $this->presenter->present($post, staff: false);

            return response()->json(['data' => [
                'brand' => Brand::current($row->tenant_id)->toPublic(),
                'project' => ['name' => $post->project?->name],
                'post' => [
                    'title' => $post->title,
                    'caption' => $post->caption,
                    'media' => $full['media'],
                    'scheduled_at' => $post->scheduled_at?->toIso8601String(),
                    'targets' => $post->targets()->with('account:id,name')->get()->map(fn (PostTarget $t): array => [
                        'network' => $t->network,
                        'network_label' => Networks::SPEC[$t->network]['label'],
                        'format' => $t->format,
                        'account' => $t->account?->name,
                    ])->values()->all(),
                ],
                'approval' => [
                    'state' => match (true) {
                        $approval->decided_at !== null => 'decided',
                        $approval->expires_at->isPast() => 'expired',
                        default => 'open',
                    },
                    'decision' => $approval->decision,
                    'comment' => $approval->comment,
                    'decided_at' => $approval->decided_at?->toIso8601String(),
                    'expires_at' => $approval->expires_at->toIso8601String(),
                ],
            ]]);
        });
    }

    public function decide(Request $request, string $token): JsonResponse
    {
        $request->validate([
            'decision' => ['required', Rule::in(['approved', 'changes_requested'])],
            'comment' => ['nullable', 'string', 'max:2000'],
            'name' => ['nullable', 'string', 'max:120'],
        ], ['decision.required' => 'Escolha aprovar ou pedir ajuste.']);
        $row = self::lookup($token);

        return $this->context->run($row->tenant_id, null, function () use ($row, $request): JsonResponse {
            $post = $this->publishing->decide(
                PostApproval::query()->findOrFail($row->approval_id),
                $request->string('decision')->toString(),
                $request->filled('comment') ? $request->string('comment')->toString() : null,
                $request->filled('name') ? $request->string('name')->toString() : null,
            );

            return response()->json(['data' => ['status' => $post->status, 'decision' => $request->string('decision')->toString()]]);
        });
    }

    /** @return object{approval_id: string, tenant_id: string, post_id: string} */
    private static function lookup(string $token): object
    {
        /** @var object{approval_id: string, tenant_id: string, post_id: string}|null $row */
        $row = DB::selectOne('select * from app.post_approval_by_token(?)', [hash('sha256', $token)]);
        abort_if($row === null, 404, 'Link de aprovação inválido.');

        return $row;
    }
}
