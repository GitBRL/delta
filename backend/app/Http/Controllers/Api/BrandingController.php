<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Domain\Billing\Entitlements;
use App\Domain\Branding\Brand;
use App\Domain\Branding\DnsResolver;
use App\Domain\Branding\LogoImage;
use App\Http\Controllers\Controller;
use App\Models\Branding;
use App\Support\Audit\Audit;
use App\Support\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\StreamedResponse;

/** Marca da agência (white label). Leitura para todos; escrita só dono/admin. ADR 0019. */
final class BrandingController extends Controller
{
    public function __construct(
        private readonly TenantContext $context,
        private readonly Audit $audit,
    ) {}

    public function show(): JsonResponse
    {
        return response()->json(['data' => $this->present()]);
    }

    public function update(Request $request): JsonResponse
    {
        $request->validate([
            'display_name' => ['nullable', 'string', 'max:80'],
            'primary_color' => ['nullable', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'hide_delta_badge' => ['boolean'],
            'email_reply_to' => ['nullable', 'email:rfc', 'max:255'],
            'custom_domain' => ['nullable', 'string', 'max:253', 'regex:/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i'],
        ], [
            'primary_color.regex' => 'Use uma cor no formato #RRGGBB.',
            'custom_domain.regex' => 'Informe só o domínio, como relatorios.suaagencia.com.br.',
        ]);

        if ($request->filled('custom_domain') || $request->boolean('hide_delta_badge')) {
            app(Entitlements::class)->ensureFeature('white_label');
        }
        $branding = $this->branding();
        $domain = $request->filled('custom_domain') ? strtolower($request->string('custom_domain')->toString()) : null;
        $branding->forceFill([
            'display_name' => $request->filled('display_name') ? $request->string('display_name')->toString() : null,
            'primary_color' => $request->filled('primary_color') ? strtolower($request->string('primary_color')->toString()) : null,
            'hide_delta_badge' => $request->boolean('hide_delta_badge'),
            'email_reply_to' => $request->filled('email_reply_to') ? $request->string('email_reply_to')->toString() : null,
            'domain_verified_at' => $domain === $branding->custom_domain ? $branding->domain_verified_at : null,
            'custom_domain' => $domain,
            'updated_by' => $this->context->userId(),
        ])->save();
        $this->audit->record('branding.updated', $branding);

        return response()->json(['data' => $this->present()]);
    }

    public function uploadLogo(Request $request): JsonResponse
    {
        $request->validate(['logo' => ['required', 'file', 'max:2048', 'mimes:png,jpg,jpeg,webp']], [
            'logo.mimes' => 'Use PNG, JPG ou WebP (SVG não é aceito por segurança).',
            'logo.max' => 'O logo pode ter no máximo 2 MB.',
        ]);
        $file = $request->file('logo');
        abort_unless($file instanceof UploadedFile, 422);

        $branding = $this->branding();
        $branding->forceFill(['logo_path' => LogoImage::store($file, (string) $this->context->tenantId()), 'updated_by' => $this->context->userId()])->save();
        $this->audit->record('branding.logo_updated', $branding);

        return response()->json(['data' => $this->present()]);
    }

    public function deleteLogo(): JsonResponse
    {
        $branding = $this->branding();
        if ($branding->logo_path !== null) {
            Storage::disk('local')->delete($branding->logo_path);
            $branding->forceFill(['logo_path' => null])->save();
        }

        return response()->json(['data' => $this->present()]);
    }

    /** Confere o CNAME do domínio próprio apontando para o Delta. */
    public function verifyDomain(DnsResolver $dns): JsonResponse
    {
        $branding = $this->branding();
        $domain = $branding->custom_domain ?? throw ValidationException::withMessages(['custom_domain' => 'Informe o domínio antes de verificar.']);
        $target = self::cnameTarget();

        $ok = in_array($target, $dns->cnames($domain), true);
        $branding->forceFill(['domain_verified_at' => $ok ? now() : null])->save();

        return response()->json(['data' => $this->present(), 'verification' => [
            'ok' => $ok,
            'message' => $ok ? "O domínio {$domain} aponta para o Delta." : "Ainda não encontramos o CNAME de {$domain} para {$target}. A propagação do DNS pode levar algumas horas.",
        ]]);
    }

    /** Logo público (link assinado de 10 min): páginas do relatório e portal do cliente. */
    public function publicLogo(string $tenant, TenantContext $context): StreamedResponse
    {
        $path = $context->run($tenant, null, fn (): mixed => Branding::query()->value('logo_path'));
        abort_unless(is_string($path) && Storage::disk('local')->exists($path), 404);

        return Storage::disk('local')->response($path, 'logo.png', ['Content-Type' => 'image/png', 'Cache-Control' => 'private, max-age=600']);
    }

    private function branding(): Branding
    {
        return Branding::query()->first() ?? new Branding;
    }

    /** @return array<string, mixed> */
    private function present(): array
    {
        $brand = Brand::current((string) $this->context->tenantId());
        $branding = Branding::query()->first();

        return [
            ...$brand->toPublic(),
            'display_name' => $branding?->display_name,
            'primary_color' => $branding?->primary_color,
            'email_reply_to' => $branding?->email_reply_to,
            'custom_domain' => $branding?->custom_domain,
            'domain_status' => $branding?->custom_domain === null ? null : ($branding->domain_verified_at !== null ? 'verified' : 'pending'),
            'cname_target' => self::cnameTarget(),
        ];
    }

    private static function cnameTarget(): string
    {
        $target = config('delta.cname_target');

        return is_string($target) && $target !== '' ? strtolower($target) : 'relatorios.delta.app';
    }
}
