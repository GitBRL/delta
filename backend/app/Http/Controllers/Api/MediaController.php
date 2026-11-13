<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Domain\Billing\Entitlements;
use App\Domain\Publishing\MediaLibrary;
use App\Domain\Publishing\PostPresenter;
use App\Http\Controllers\Controller;
use App\Models\MediaAsset;
use App\Models\Post;
use App\Support\Audit\Audit;
use App\Support\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/** Biblioteca de mídia do Publishing (ADR 0028). Ler: quem vê o projeto; enviar e remover: equipe. */
final class MediaController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $query = MediaAsset::query()->orderByDesc('created_at')->limit(200);
        if (is_string($projectId = $request->query('project_id')) && $projectId !== '') {
            $query->where(fn ($q) => $q->where('project_id', $projectId)->orWhereNull('project_id'));
        }

        return response()->json(['data' => $query->get()->map(PostPresenter::media(...))->values()->all()]);
    }

    public function store(Request $request, MediaLibrary $library, Audit $audit): JsonResponse
    {
        app(Entitlements::class)->ensureFeature('publishing');
        $request->validate([
            'file' => ['required', 'file', 'max:102400'],
            'project_id' => ['nullable', 'uuid', Rule::exists('projects', 'id')],
        ], ['file.max' => 'O arquivo pode ter no máximo 100 MB.', 'file.uploaded' => 'O envio do arquivo falhou (ele passa de 100 MB?).']);

        $file = $request->file('file');
        abort_unless($file instanceof UploadedFile, 422);
        $asset = $library->store($file, $request->filled('project_id') ? $request->string('project_id')->toString() : null);
        $audit->record('media.uploaded', $asset, ['kind' => $asset->kind, 'size' => $asset->size_bytes]);

        return response()->json(['data' => PostPresenter::media($asset)], 201);
    }

    public function destroy(MediaAsset $media, Audit $audit): Response
    {
        $inUse = Post::query()->whereJsonContains('media', $media->id)->whereNotIn('status', ['published', 'cancelled'])->exists();
        if ($inUse) {
            throw ValidationException::withMessages(['media' => 'Esta mídia está em um post ainda não publicado. Tire-a do post antes de remover.']);
        }

        Storage::disk(MediaLibrary::DISK)->delete($media->path);
        $audit->record('media.removed', $media);
        $media->delete();

        return response()->noContent();
    }

    /** Arquivo pelo link assinado (app, página de aprovação e redes): roda no contexto da agência do link. */
    public function file(string $tenant, string $asset, TenantContext $context): BinaryFileResponse
    {
        $path = $context->run($tenant, null, fn (): mixed => MediaAsset::query()->whereKey($asset)->first(['path', 'mime']));
        abort_unless($path instanceof MediaAsset && Storage::disk(MediaLibrary::DISK)->exists($path->path), 404);

        return response()->file(Storage::disk(MediaLibrary::DISK)->path($path->path), [
            'Content-Type' => $path->mime,
            'X-Content-Type-Options' => 'nosniff',
            'Content-Disposition' => 'inline',
            'Cache-Control' => 'private, max-age=1800',
        ]);
    }
}
