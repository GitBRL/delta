<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Marca da agência (white label, ADR 0019): nome de exibição, cor, logo, selo "Feito com Delta",
 * resposta dos e-mails e domínio próprio. Toda a agência lê (o portal do cliente usa a marca);
 * só dono e administrador gravam.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('brandings', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->foreignUuid('tenant_id')->unique()->constrained()->cascadeOnDelete();
            $table->string('display_name', 80)->nullable();
            $table->char('primary_color', 7)->nullable();
            $table->string('logo_path', 200)->nullable();
            $table->boolean('hide_delta_badge')->default(false);
            $table->string('email_reply_to')->nullable();
            $table->string('custom_domain', 253)->nullable()->unique();
            $table->timestampTz('domain_verified_at')->nullable();
            $table->uuid('updated_by')->nullable();
            $table->timestampsTz();
        });

        Rls::tenantIsolation('brandings');
        foreach (['INSERT' => 'WITH CHECK', 'UPDATE' => 'USING', 'DELETE' => 'USING'] as $command => $clause) {
            $extra = $command === 'UPDATE' ? ' WITH CHECK ((SELECT app.is_tenant_admin()))' : '';
            DB::statement('CREATE POLICY brandings_admin_'.strtolower($command)." ON brandings AS RESTRICTIVE FOR {$command} {$clause} ((SELECT app.is_tenant_admin())){$extra}");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('brandings');
    }
};
