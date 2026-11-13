<?php

declare(strict_types=1);

namespace App\Domain\Reports\Pdf;

use App\Domain\Branding\Brand;
use App\Models\ReportSnapshot;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Storage;

/** PDF de um snapshot: HTML (Blade) → Gotenberg → disco local privado. */
final readonly class SnapshotPdf
{
    public function __construct(private Gotenberg $gotenberg) {}

    public function html(ReportSnapshot $snapshot, ?Brand $brand = null): string
    {
        return view('reports.pdf', ['data' => $snapshot->data, 'brand' => $brand ?? Brand::current($snapshot->tenant_id)])->render();
    }

    /** @return string caminho no disco "local" */
    public function generate(ReportSnapshot $snapshot): string
    {
        $data = $snapshot->data;
        $tz = config('delta.timezone');
        $footer = view('reports.pdf-footer', [
            'agency' => Brand::current($snapshot->tenant_id)->name,
            'title' => $snapshot->title,
            'generated' => CarbonImmutable::parse($snapshot->created_at)->timezone(is_string($tz) ? $tz : 'America/Sao_Paulo')->format('d/m/Y H:i'),
        ])->render();

        $brand = Brand::current($snapshot->tenant_id);
        // O logo vai como arquivo junto do HTML: o Chromium do Gotenberg só lê os próprios arquivos.
        $assets = $brand->logoPath !== null ? ['logo.png' => (string) Storage::disk('local')->get($brand->logoPath)] : [];
        $pdf = $this->gotenberg->htmlToPdf($this->html($snapshot, $brand), $footer, $assets);
        $path = self::path($snapshot->tenant_id, $snapshot->id);
        Storage::disk('local')->put($path, $pdf);

        return $path;
    }

    public static function path(string $tenantId, string $snapshotId): string
    {
        return "reports/{$tenantId}/{$snapshotId}.pdf";
    }
}
