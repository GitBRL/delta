<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Passkeys (WebAuthn) sob RLS. ADR 0025.
 *
 * Cada pessoa só vê e altera as próprias passkeys. O login por passkey acontece antes de existir
 * contexto: a busca pela credencial passa por app.auth_passkey_by_credential, que devolve só a
 * linha daquela credencial (a chave pública não é segredo) e a trava até o fim da transação,
 * para a conferência do contador de assinaturas não sofrer corrida.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('passkeys', function (Blueprint $table): void {
            $table->id();
            $table->foreignUuid('user_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->string('credential_id', 1400)->unique();
            $table->jsonb('credential');
            $table->timestampTz('last_used_at')->nullable();
            $table->timestampsTz();
            $table->index('user_id');
        });

        Rls::enable('passkeys');
        DB::statement(<<<'SQL'
            CREATE POLICY passkeys_owner ON passkeys
                USING      (user_id = (SELECT app.current_user_id()))
                WITH CHECK (user_id = (SELECT app.current_user_id()))
        SQL);

        // VOLATILE: tem FOR UPDATE (a trava vale até o fim da transação de quem chamou).
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION app.auth_passkey_by_credential(p_credential_id text) RETURNS SETOF public.passkeys
                LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
                AS $$ SELECT * FROM public.passkeys WHERE credential_id = p_credential_id LIMIT 1 FOR UPDATE $$
        SQL);
        DB::statement('REVOKE ALL ON FUNCTION app.auth_passkey_by_credential(text) FROM PUBLIC');
        DB::statement('GRANT EXECUTE ON FUNCTION app.auth_passkey_by_credential(text) TO delta_app');
    }

    public function down(): void
    {
        DB::statement('DROP FUNCTION IF EXISTS app.auth_passkey_by_credential(text)');
        Schema::dropIfExists('passkeys');
    }
};
