<?php

declare(strict_types=1);

namespace App\Domain\Publishing;

use App\Domain\Branding\Brand;
use App\Domain\Integrations\ConnectorUnavailable;
use App\Domain\Integrations\Live\LiveApiException;
use App\Domain\Messaging\WhatsApp\WhatsAppGateway;
use App\Domain\Publishing\Publishers\PublisherRegistry;
use App\Domain\Publishing\Publishers\StillProcessing;
use App\Domain\Webhooks\Webhooks;
use App\Mail\PostApprovalMail;
use App\Models\Contact;
use App\Models\MediaAsset;
use App\Models\Post;
use App\Models\PostApproval;
use App\Models\PostTarget;
use App\Models\WhatsAppMessage;
use App\Support\Audit\Audit;
use App\Support\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * Ciclo de vida do post (ADR 0028):
 *   rascunho → em revisão (link para o cliente) → aprovado | ajustes pedidos
 *   aprovado (ou sem aprovação) → agendado → publicando → publicado | falhou
 * Editar o conteúdo depois de pedir aprovação volta para rascunho (a aprovação não vale mais).
 */
final readonly class PublishingService
{
    public const APPROVAL_DAYS = 14;

    public function __construct(
        private TenantContext $context,
        private Audit $audit,
        private PublisherRegistry $publishers,
        private WhatsAppGateway $whatsapp,
    ) {}

    /** @return list<MediaAsset> na ordem do post */
    public function media(Post $post): array
    {
        $assets = MediaAsset::query()->whereIn('id', $post->media)->get()->keyBy('id');

        return array_values(array_filter(array_map(fn (string $id): ?MediaAsset => $assets->get($id), $post->media)));
    }

    /** @return list<string> */
    public function problems(Post $post): array
    {
        return Networks::problems($post, $this->media($post), $post->targets()->get());
    }

    /** Conteúdo mudou: aprovação pedida ou dada deixa de valer. */
    public function contentChanged(Post $post): bool
    {
        if (! $post->requires_approval || ! in_array($post->status, ['in_review', 'approved', 'scheduled', 'changes_requested'], true)) {
            return false;
        }

        $post->approvals()->whereNull('decided_at')->update(['expires_at' => now()]);
        $post->forceFill(['status' => 'draft'])->save();

        return true;
    }

    /**
     * Pede a aprovação do cliente: link público (14 dias) e aviso aos contatos do projeto.
     *
     * @return array{link: string, notified: array{email: int, whatsapp: int}}
     */
    public function requestApproval(Post $post, bool $notify): array
    {
        $this->assertStatus($post, ['draft', 'changes_requested', 'in_review'], 'Este post não pode ir para aprovação agora.');
        $this->assertReady($post);

        $post->approvals()->whereNull('decided_at')->update(['expires_at' => now()]);
        $token = Str::random(48);
        $link = self::approvalLink($token);
        $notified = ['email' => 0, 'whatsapp' => 0];

        $approval = PostApproval::query()->create([
            'post_id' => $post->id,
            'token_hash' => hash('sha256', $token),
            'token' => $token,
            'requested_by' => $this->context->userId(),
            'expires_at' => now()->addDays(self::APPROVAL_DAYS),
            'notified' => $notified,
        ]);
        $post->forceFill(['status' => 'in_review', 'requires_approval' => true])->save();

        if ($notify) {
            $notified = $this->notify($post, $link);
            $approval->forceFill(['notified' => $notified])->save();
        }

        $this->audit->record('post.approval_requested', $post, ['notified' => $notified]);

        return ['link' => $link, 'notified' => $notified];
    }

    /** Decisão do cliente pela página pública (contexto da agência, sem usuário). */
    public function decide(PostApproval $approval, string $decision, ?string $comment, ?string $name): Post
    {
        if ($approval->decided_at !== null) {
            throw ValidationException::withMessages(['decision' => 'Este post já foi respondido. Obrigado!']);
        }
        if ($approval->expires_at->isPast()) {
            throw ValidationException::withMessages(['decision' => 'Este link de aprovação expirou ou foi substituído por um mais novo.']);
        }
        if ($decision === 'changes_requested' && trim((string) $comment) === '') {
            throw ValidationException::withMessages(['comment' => 'Conte o que precisa ser ajustado.']);
        }

        $post = Post::query()->findOrFail($approval->post_id);

        return DB::transaction(function () use ($approval, $decision, $comment, $name, $post): Post {
            $approval->forceFill([
                'decided_at' => now(), 'decision' => $decision,
                'comment' => $comment === null ? null : mb_substr(trim($comment), 0, 2000),
                'decided_by_name' => $name === null || trim($name) === '' ? null : mb_substr(trim($name), 0, 120),
            ])->save();

            $status = match (true) {
                $decision === 'changes_requested' => 'changes_requested',
                $post->scheduled_at !== null && $post->scheduled_at->isFuture() => 'scheduled', // já tinha data: agenda sozinho
                default => 'approved',
            };
            $post->forceFill(['status' => $status])->save();

            $this->audit->record($decision === 'approved' ? 'post.approved' : 'post.changes_requested', $post, ['by' => $approval->decided_by_name]);
            Webhooks::emit($decision === 'approved' ? 'post.approved' : 'post.changes_requested', [
                'post_id' => $post->id, 'project_id' => $post->project_id, 'status' => $status, 'comment' => $approval->comment,
            ]);

            return $post;
        });
    }

    public function schedule(Post $post, CarbonImmutable $at): Post
    {
        if ($at->lt(now()->addMinute())) {
            throw ValidationException::withMessages(['scheduled_at' => 'Escolha um horário no futuro.']);
        }
        $this->assertReady($post);

        $status = match (true) {
            in_array($post->status, ['approved', 'scheduled', 'failed'], true) => 'scheduled',
            in_array($post->status, ['draft', 'changes_requested'], true) && ! $post->requires_approval => 'scheduled',
            $post->status === 'in_review' => 'in_review', // agenda sozinho quando o cliente aprovar
            default => throw ValidationException::withMessages(['scheduled_at' => $post->requires_approval
                ? 'Peça a aprovação do cliente antes de agendar (ou desligue a aprovação deste post).'
                : 'Este post não pode ser agendado agora.']),
        };

        if ($post->status === 'failed') {
            $post->targets()->where('status', 'failed')->update(['status' => 'pending', 'error' => null]);
        }
        $post->forceFill(['scheduled_at' => $at, 'status' => $status])->save();
        $this->audit->record('post.scheduled', $post, ['at' => $at->toIso8601String()]);

        return $post;
    }

    public function unschedule(Post $post): Post
    {
        $this->assertStatus($post, ['scheduled', 'in_review'], 'Este post não está agendado.');
        $post->forceFill([
            'scheduled_at' => null,
            'status' => $post->status === 'in_review' ? 'in_review' : ($post->requires_approval ? 'approved' : 'draft'),
        ])->save();

        return $post;
    }

    /** Publicar agora: vira agendado para este minuto; o job roda em seguida. */
    public function publishNow(Post $post): Post
    {
        $allowed = in_array($post->status, ['approved', 'scheduled', 'failed'], true)
            || (! $post->requires_approval && in_array($post->status, ['draft', 'changes_requested'], true));
        if (! $allowed) {
            throw ValidationException::withMessages(['post' => $post->requires_approval && in_array($post->status, ['draft', 'in_review', 'changes_requested'], true)
                ? 'O cliente ainda não aprovou este post.'
                : 'Este post não pode ser publicado agora.']);
        }
        $this->assertReady($post);

        $post->targets()->where('status', 'failed')->update(['status' => 'pending', 'error' => null]);
        $post->forceFill(['status' => 'scheduled', 'scheduled_at' => now()])->save();

        return $post;
    }

    public function cancel(Post $post): Post
    {
        if (in_array($post->status, ['publishing', 'published', 'cancelled'], true)) {
            throw ValidationException::withMessages(['post' => 'Este post não pode ser cancelado.']);
        }
        $post->approvals()->whereNull('decided_at')->update(['expires_at' => now()]);
        $post->forceFill(['status' => 'cancelled'])->save();
        $this->audit->record('post.cancelled', $post);

        return $post;
    }

    /**
     * Publica os destinos pendentes. Idempotente por destino: o que já saiu não sai de novo.
     * Devolve true se algum destino ainda está em processamento (o job tenta de novo).
     */
    public function publish(Post $post): bool
    {
        // Tomada atômica: dois workers não publicam o mesmo post.
        $claimed = Post::query()->whereKey($post->id)->whereIn('status', ['scheduled', 'publishing'])->update(['status' => 'publishing', 'updated_at' => now()]);
        if ($claimed === 0) {
            return false;
        }

        $media = $this->media($post->refresh());
        $pending = false;

        foreach ($post->targets()->with('account')->get() as $target) {
            if ($target->status === 'published' || $target->status === 'failed') {
                continue;
            }
            if ($target->status === 'publishing') {
                // Ficou no meio (queda do worker): pode ter saído na rede. Não publica às cegas.
                $target->forceFill(['status' => 'failed', 'error' => 'A publicação foi interrompida e pode ter saído na rede. Confira antes de tentar de novo.'])->save();

                continue;
            }

            $pending = $this->publishTarget($post, $target, $media) || $pending;
        }

        return $this->settle($post, $pending);
    }

    /** @param list<MediaAsset> $media */
    private function publishTarget(Post $post, PostTarget $target, array $media): bool
    {
        $target->forceFill(['status' => 'publishing', 'attempts' => $target->attempts + 1])->save();

        try {
            $result = $this->publishers->for($target)->publish($post, $target, $media);
            $target->forceFill([
                'status' => 'published', 'external_id' => $result['external_id'], 'permalink' => $result['permalink'],
                'published_at' => now(), 'error' => null,
            ])->save();

            return false;
        } catch (StillProcessing $e) {
            $target->forceFill(['status' => 'pending', 'error' => $e->getMessage()])->save();

            return true;
        } catch (LiveApiException $e) {
            $retry = $e->retryable && $target->attempts < 5;
            $target->forceFill(['status' => $retry ? 'pending' : 'failed', 'error' => mb_substr($e->getMessage(), 0, 500)])->save();

            return $retry;
        } catch (ConnectorUnavailable $e) {
            $target->forceFill(['status' => 'failed', 'error' => mb_substr($e->getMessage(), 0, 500)])->save();

            return false;
        } catch (Throwable $e) {
            report($e);
            $target->forceFill(['status' => 'failed', 'error' => 'Falha inesperada ao publicar. A equipe técnica foi avisada.'])->save();

            return false;
        }
    }

    private function settle(Post $post, bool $pending): bool
    {
        if ($pending) {
            return true; // continua "publicando"; o job tenta de novo
        }

        $statuses = $post->targets()->pluck('status')->all();
        $failed = in_array('failed', $statuses, true);
        $post->forceFill(['status' => $failed ? 'failed' : 'published', 'published_at' => $failed ? $post->published_at : now()])->save();

        Webhooks::emit($failed ? 'post.failed' : 'post.published', [
            'post_id' => $post->id, 'project_id' => $post->project_id, 'status' => $post->status,
            'targets' => $post->targets()->get(['network', 'format', 'status', 'permalink', 'error'])->toArray(),
        ]);

        return false;
    }

    /** @return array{email: int, whatsapp: int} */
    private function notify(Post $post, string $link): array
    {
        $sent = ['email' => 0, 'whatsapp' => 0];
        $project = $post->project()->firstOrFail();
        $brand = Brand::current($post->tenant_id);

        foreach (Contact::query()->where('project_id', $post->project_id)->get() as $contact) {
            if ($contact->canReceive('email') && $contact->email !== null) {
                Mail::to($contact->email)->queue(new PostApprovalMail($project->name, $contact->name, $post->title, $link, $brand->name, $brand->replyTo));
                $sent['email']++;
            }

            // WhatsApp livre só dentro da janela de 24 h da última mensagem do contato (regra da Meta).
            $openWindow = $contact->phone !== null && WhatsAppMessage::query()->where('phone', $contact->phone)
                ->where('direction', 'in')->where('created_at', '>', now()->subDay())->exists();
            if ($contact->canReceive('whatsapp') && $openWindow) {
                try {
                    $this->whatsapp->reply($contact->phone, "Olá, {$contact->name}! Tem um post de {$project->name} esperando sua aprovação: {$link}");
                    $sent['whatsapp']++;
                } catch (Throwable $e) {
                    report($e);
                }
            }
        }

        return $sent;
    }

    private function assertReady(Post $post): void
    {
        $problems = $this->problems($post);
        if ($problems !== []) {
            throw ValidationException::withMessages(['post' => $problems]);
        }
    }

    /** @param list<string> $allowed */
    private function assertStatus(Post $post, array $allowed, string $message): void
    {
        if (! in_array($post->status, $allowed, true)) {
            throw ValidationException::withMessages(['post' => $message]);
        }
    }

    public static function approvalLink(string $token): string
    {
        $base = config('delta.frontend_url');

        return rtrim(is_string($base) ? $base : '', '/')."/aprovar/{$token}";
    }
}
