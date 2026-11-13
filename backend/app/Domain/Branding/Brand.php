<?php

declare(strict_types=1);

namespace App\Domain\Branding;

use App\Models\Branding;
use App\Models\Tenant;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\URL;

/** Marca efetiva da agência do contexto (com padrões quando ela não configurou nada). */
final readonly class Brand
{
    public const DEFAULT_COLOR = '#0a84ff';

    public function __construct(
        public string $tenantId,
        public string $name,
        public string $color,
        public ?string $logoPath,
        public bool $hideBadge,
        public ?string $replyTo,
    ) {}

    public static function current(string $tenantId): self
    {
        $branding = Branding::query()->first();
        $tenantName = Tenant::query()->whereKey($tenantId)->value('name');
        $logo = $branding?->logo_path;

        return new self(
            $tenantId,
            $branding?->display_name ?: (is_string($tenantName) ? $tenantName : 'Delta'),
            $branding?->primary_color ?: self::DEFAULT_COLOR,
            $logo !== null && Storage::disk('local')->exists($logo) ? $logo : null,
            $branding !== null && $branding->hide_delta_badge,
            $branding?->email_reply_to,
        );
    }

    /** URL relativa assinada (10 min) do logo, para páginas públicas e o app. */
    public function logoUrl(): ?string
    {
        return $this->logoPath === null ? null : URL::temporarySignedRoute('public.branding.logo', now()->addMinutes(10), ['tenant' => $this->tenantId], absolute: false);
    }

    /** @return array{name: string, color: string, logo_url: string|null, hide_delta_badge: bool} */
    public function toPublic(): array
    {
        return ['name' => $this->name, 'color' => $this->color, 'logo_url' => $this->logoUrl(), 'hide_delta_badge' => $this->hideBadge];
    }
}
