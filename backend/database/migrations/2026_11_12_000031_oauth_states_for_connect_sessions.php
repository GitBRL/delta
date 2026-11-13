<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Login pela sessão hospedada do Connect (ADR 0032) não tem usuário do Delta: o estado do OAuth
 * pertence à pessoa logada OU à sessão hospedada, nunca a nenhum dos dois.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE oauth_states ALTER COLUMN user_id DROP NOT NULL');
        DB::statement('ALTER TABLE oauth_states ADD CONSTRAINT oauth_states_owner_check CHECK (user_id IS NOT NULL OR connect_session_id IS NOT NULL)');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE oauth_states DROP CONSTRAINT IF EXISTS oauth_states_owner_check');
        DB::statement('DELETE FROM oauth_states WHERE user_id IS NULL');
        DB::statement('ALTER TABLE oauth_states ALTER COLUMN user_id SET NOT NULL');
    }
};
