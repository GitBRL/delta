<?php

declare(strict_types=1);

namespace App\Domain\Studio;

use App\Domain\Branding\Brand;
use App\Domain\Reports\Pdf\Gotenberg;
use App\Models\Presentation;
use App\Models\PresentationVersion;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Storage;

/**
 * PDF de uma versão do Studio com o mesmo template dos relatórios (e a marca da agência):
 * em slides, uma página por slide em paisagem 16:9; em página única, A4 retrato.
 */
final readonly class PresentationPdf
{
    public function __construct(private Gotenberg $gotenberg) {}

    public function generate(Presentation $presentation, PresentationVersion $version): string
    {
        $brand = Brand::current($presentation->tenant_id);
        $slides = $presentation->format === 'slides';
        $tz = config('delta.timezone');

        $html = view('reports.pdf', ['data' => $version->rendered, 'brand' => $brand, 'slides' => $slides])->render();
        $footer = view('reports.pdf-footer', [
            'agency' => $brand->name,
            'title' => $presentation->title,
            'generated' => CarbonImmutable::now()->timezone(is_string($tz) ? $tz : 'America/Sao_Paulo')->format('d/m/Y H:i'),
        ])->render();
        $assets = $brand->logoPath !== null ? ['logo.png' => (string) Storage::disk('local')->get($brand->logoPath)] : [];

        return $this->gotenberg->htmlToPdf($html, $footer, $assets, $slides
            ? ['paperWidth' => '11.69', 'paperHeight' => '6.58', 'marginTop' => '0.4', 'marginBottom' => '0.5', 'marginLeft' => '0.5', 'marginRight' => '0.5']
            : []);
    }
}
