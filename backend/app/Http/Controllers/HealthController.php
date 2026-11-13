<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Laravel\Horizon\Contracts\MasterSupervisorRepository;
use Throwable;

/**
 * Saúde das dependências para monitoramento (sem dados sensíveis): banco, cache, workers
 * (Horizon) e gerador de PDF. 200 quando tudo responde; 503 com o que falhou.
 */
final class HealthController extends Controller
{
    public function __invoke(): JsonResponse
    {
        $checks = [
            'database' => self::probe(fn (): bool => DB::scalar('select 1') == 1),
            'cache' => self::probe(function (): bool {
                Cache::put('health:probe', 'ok', 10);

                return Cache::get('health:probe') === 'ok';
            }),
            'workers' => self::probe(fn (): bool => app(MasterSupervisorRepository::class)->all() !== []),
            'pdf' => self::probe(function (): bool {
                $base = config('services.gotenberg.url');

                return Http::timeout(2)->get(rtrim(is_string($base) ? $base : '', '/').'/health')->successful();
            }),
        ];

        $healthy = ! in_array('fail', $checks, true);

        return response()->json(['status' => $healthy ? 'ok' : 'degraded', 'checks' => $checks], $healthy ? 200 : 503);
    }

    /** @param callable(): bool $check */
    private static function probe(callable $check): string
    {
        try {
            return $check() ? 'ok' : 'fail';
        } catch (Throwable) {
            return 'fail';
        }
    }
}
