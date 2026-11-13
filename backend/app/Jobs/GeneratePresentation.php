<?php

declare(strict_types=1);

namespace App\Jobs;

use App\Domain\Ai\AiException;
use App\Domain\Studio\Studio;
use App\Models\Presentation;
use App\Support\Tenancy\TenantScopedJob;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Validation\ValidationException;
use Throwable;

/** Gera a primeira versão ou um ajuste de uma apresentação do Studio (ADR 0029). */
final class GeneratePresentation implements ShouldQueue
{
    use Queueable, TenantScopedJob;

    public int $tries = 1;

    public int $timeout = 300;

    public function __construct(
        public readonly string $presentationId,
        public readonly string $instruction,
    ) {
        $this->captureTenantContext();
    }

    public function handle(Studio $studio): void
    {
        $presentation = Presentation::query()->find($this->presentationId);
        if ($presentation === null) {
            return;
        }

        try {
            $studio->generate($presentation, $this->instruction);
        } catch (AiException|ValidationException $e) {
            $message = $e instanceof ValidationException ? collect($e->errors())->flatten()->first() : $e->getMessage();
            $presentation->forceFill(['status' => $presentation->current_version > 0 ? 'ready' : 'error', 'error' => mb_substr(is_string($message) ? $message : 'Falha na geração.', 0, 500)])->save();
        } catch (Throwable $e) {
            $presentation->forceFill(['status' => $presentation->current_version > 0 ? 'ready' : 'error', 'error' => 'Falha inesperada ao gerar a apresentação. A equipe técnica foi avisada.'])->save();

            throw $e;
        }
    }
}
