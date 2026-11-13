<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Fluxos de login OAuth em andamento (pop-up de conexão com Meta, Google...).
 *
 * O "state" enviado à plataforma é "{tenant_id}.{aleatório}": no retorno, a agência sai do
 * próprio state e o registro é buscado sob RLS, sem nenhuma função que ignore o isolamento.
 * Aqui fica só o hash do state; ele é de uso único, preso ao usuário e expira em minutos.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('oauth_states', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('user_id')->constrained()->cascadeOnDelete();
            $table->string('provider', 40);
            $table->string('mode', 10);
            $table->string('flow', 64);
            $table->string('return_mode', 10);
            $table->char('state_hash', 64)->unique();
            $table->text('code_verifier')->nullable();
            $table->string('redirect_uri', 500);
            $table->timestampTz('expires_at');
            $table->timestampTz('used_at')->nullable();
            $table->timestampTz('created_at')->useCurrent();
        });

        Rls::tenantIsolation('oauth_states');
    }

    public function down(): void
    {
        Schema::dropIfExists('oauth_states');
    }
};
