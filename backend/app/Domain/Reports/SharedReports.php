<?php

declare(strict_types=1);

namespace App\Domain\Reports;

use App\Models\Report;
use App\Models\ReportSnapshot;
use App\Models\ShareLink;
use App\Support\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * Links públicos de relatórios publicados (ADR 0011). O token (40 caracteres) só existe no
 * link; o banco guarda o sha256. A leitura pública passa por app.shared_report (busca exata).
 */
final readonly class SharedReports
{
    public function __construct(private TenantContext $context) {}

    /**
     * Link de uma versão publicada (números congelados) ou, com um relatório, ao vivo.
     *
     * @return array{0: ShareLink, 1: string} link e token
     */
    public function create(ReportSnapshot|Report $target, ?int $expiresInDays, ?string $password): array
    {
        $token = Str::random(40);
        $link = ShareLink::query()->create([
            'snapshot_id' => $target instanceof ReportSnapshot ? $target->id : null,
            'report_id' => $target instanceof Report ? $target->id : null,
            'token_hash' => self::hash($token),
            'password_hash' => $password !== null && $password !== '' ? Hash::make($password) : null,
            'expires_at' => $expiresInDays !== null ? now()->addDays($expiresInDays) : null,
            'created_by' => $this->context->userId(),
        ]);

        return [$link, $token];
    }

    /** @return object{link_id: string, snapshot_id: string|null, report_id: string|null, tenant_id: string, tenant_name: string, title: string, data: string|null, pdf_status: string|null, pdf_path: string|null, password_hash: string|null, expires_at: string|null, revoked_at: string|null, created_at: string}|null */
    public function find(string $token): ?object
    {
        if (! self::looksLikeToken($token)) {
            return null;
        }

        /** @var object{link_id: string, snapshot_id: string|null, report_id: string|null, tenant_id: string, tenant_name: string, title: string, data: string|null, pdf_status: string|null, pdf_path: string|null, password_hash: string|null, expires_at: string|null, revoked_at: string|null, created_at: string}|null $row */
        $row = DB::selectOne('select * from app.shared_report(?)', [self::hash($token)]);

        return $row;
    }

    /** null = válido; senão o motivo para quem abriu o link. */
    public static function unavailable(object $row): ?string
    {
        if (($row->revoked_at ?? null) !== null) {
            return 'Este link foi desativado pela agência.';
        }
        $expires = $row->expires_at ?? null;
        if (is_string($expires) && CarbonImmutable::parse($expires)->isPast()) {
            return 'Este link expirou. Peça um novo à agência.';
        }

        return null;
    }

    public function countView(string $token): void
    {
        DB::statement('select app.count_report_view(?)', [self::hash($token)]);
    }

    public static function url(string $token): string
    {
        $base = config('delta.frontend_url');

        return rtrim(is_string($base) ? $base : '', '/').'/r/'.$token;
    }

    public static function looksLikeToken(string $token): bool
    {
        return preg_match('/^[A-Za-z0-9]{40}$/', $token) === 1;
    }

    private static function hash(string $token): string
    {
        return hash('sha256', $token);
    }
}
