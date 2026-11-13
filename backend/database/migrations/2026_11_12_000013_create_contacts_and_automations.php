<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Contatos com consentimento, envios automáticos de relatório (e-mail e WhatsApp) e o
 * agendador entre agências. Ver ADR 0012 (automações e agendador) e 0013 (WhatsApp).
 *
 * Tudo é da equipe da agência (RESTRICTIVE app.is_staff); o cliente não vê contatos nem envios.
 * contact_consents é append-only (histórico de consentimento, exigência da LGPD e da Meta).
 */
return new class extends Migration
{
    private const STAFF_TABLES = ['contacts', 'contact_consents', 'automations', 'automation_recipients', 'automation_runs', 'messages', 'whatsapp_accounts'];

    public function up(): void
    {
        Schema::create('contacts', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('project_id')->constrained()->cascadeOnDelete();
            $table->string('name', 120);
            $table->string('email')->nullable();
            $table->string('phone', 20)->nullable(); // E.164: +5511999998888
            $table->string('role', 80)->nullable();
            $table->boolean('email_opt_in')->default(false);
            $table->boolean('whatsapp_opt_in')->default(false);
            $table->timestampsTz();

            $table->index(['tenant_id', 'project_id']);
            $table->index(['tenant_id', 'phone']);
        });

        Schema::create('contact_consents', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('contact_id')->constrained()->cascadeOnDelete();
            $table->string('channel', 10);
            $table->boolean('granted');
            $table->string('source', 20); // manual | unsubscribe_link | whatsapp_reply
            $table->uuid('recorded_by')->nullable();
            $table->ipAddress('ip')->nullable();
            $table->timestampTz('created_at')->useCurrent();
        });
        DB::statement("ALTER TABLE contact_consents ADD CONSTRAINT contact_consents_channel_check CHECK (channel IN ('email', 'whatsapp'))");

        Schema::create('automations', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('project_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('report_id')->constrained()->cascadeOnDelete();
            $table->string('name', 120);
            $table->jsonb('channels');
            $table->string('frequency', 10);
            $table->unsignedSmallInteger('weekday')->nullable();   // ISO: 1 = segunda … 7 = domingo
            $table->unsignedSmallInteger('month_day')->nullable(); // 1–28
            $table->time('send_time');
            $table->string('period_preset', 20);
            $table->text('message');
            $table->boolean('attach_pdf')->default(true);
            $table->boolean('requires_approval')->default(false);
            $table->boolean('active')->default(true);
            $table->timestampTz('next_run_at')->nullable();
            $table->timestampTz('last_run_at')->nullable();
            $table->uuid('created_by')->nullable();
            $table->timestampsTz();

            $table->index(['active', 'next_run_at']);
        });
        DB::statement("ALTER TABLE automations ADD CONSTRAINT automations_frequency_check CHECK (frequency IN ('daily', 'weekly', 'biweekly', 'monthly'))");

        Schema::create('automation_recipients', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('automation_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('contact_id')->constrained()->cascadeOnDelete();
            $table->unique(['automation_id', 'contact_id']);
        });

        Schema::create('automation_runs', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('automation_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('snapshot_id')->nullable()->constrained('report_snapshots')->nullOnDelete();
            $table->uuid('share_link_id')->nullable();
            $table->string('trigger', 10);
            $table->string('status', 20);
            $table->timestampTz('scheduled_for');
            $table->uuid('approved_by')->nullable();
            $table->timestampTz('approved_at')->nullable();
            $table->string('error', 300)->nullable();
            $table->timestampsTz();

            // Idempotência: uma execução por automação e horário agendado.
            $table->unique(['automation_id', 'scheduled_for']);
        });
        DB::statement("ALTER TABLE automation_runs ADD CONSTRAINT automation_runs_status_check CHECK (status IN ('awaiting_approval', 'sending', 'sent', 'partial', 'failed', 'cancelled'))");

        Schema::create('messages', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('run_id')->constrained('automation_runs')->cascadeOnDelete();
            $table->foreignUuid('contact_id')->nullable()->constrained()->nullOnDelete();
            $table->string('channel', 10);
            $table->string('recipient');
            $table->string('provider', 20)->nullable();
            $table->string('provider_message_id', 128)->nullable()->unique();
            $table->string('status', 10);
            $table->text('body')->nullable();
            $table->string('error', 300)->nullable();
            $table->timestampTz('sent_at')->nullable();
            $table->timestampTz('delivered_at')->nullable();
            $table->timestampTz('read_at')->nullable();
            $table->timestampsTz();

            $table->unique(['run_id', 'contact_id', 'channel']);
        });
        DB::statement("ALTER TABLE messages ADD CONSTRAINT messages_status_check CHECK (status IN ('queued', 'sent', 'delivered', 'read', 'failed', 'skipped'))");

        Schema::create('whatsapp_accounts', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->foreignUuid('tenant_id')->unique()->constrained()->cascadeOnDelete();
            $table->string('mode', 10); // sandbox | cloud
            $table->string('phone_number_id', 40)->nullable()->unique();
            $table->string('waba_id', 40)->nullable();
            $table->string('display_phone', 30)->nullable();
            $table->text('access_token')->nullable();  // criptografado (APP_KEY)
            $table->text('app_secret')->nullable();    // criptografado; confere a assinatura do webhook
            $table->text('verify_token')->nullable();  // criptografado; mostrado ao admin
            $table->char('verify_token_hash', 64)->nullable()->unique();
            $table->string('template_name', 120)->nullable();
            $table->string('template_language', 10)->default('pt_BR');
            $table->timestampTz('verified_at')->nullable();
            $table->string('verification_error', 300)->nullable();
            $table->uuid('updated_by')->nullable();
            $table->timestampsTz();
        });

        foreach (self::STAFF_TABLES as $table) {
            Rls::tenantIsolation($table);
            DB::statement("CREATE POLICY {$table}_staff_only ON {$table} AS RESTRICTIVE USING ((SELECT app.is_staff())) WITH CHECK ((SELECT app.is_staff()))");
        }

        // Credenciais do WhatsApp: só dono e administrador gravam (como oauth_apps).
        foreach (['INSERT' => 'WITH CHECK', 'UPDATE' => 'USING', 'DELETE' => 'USING'] as $command => $clause) {
            $extra = $command === 'UPDATE' ? ' WITH CHECK ((SELECT app.is_tenant_admin()))' : '';
            DB::statement('CREATE POLICY whatsapp_accounts_admin_'.strtolower($command)." ON whatsapp_accounts AS RESTRICTIVE FOR {$command} {$clause} ((SELECT app.is_tenant_admin())){$extra}");
        }

        // Histórico de consentimento: só se acrescenta.
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON contact_consents FROM delta_app');

        $this->schedulerFunctions();
    }

    /**
     * Agendador entre agências (ADR 0012): devolvem SÓ identificadores. O trabalho em si roda
     * depois, em job, no contexto da agência dona do registro, sob RLS.
     */
    private function schedulerFunctions(): void
    {
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION app.due_automations(p_now timestamptz)
                RETURNS TABLE (tenant_id uuid, automation_id uuid)
                LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
                AS $$
                    SELECT a.tenant_id, a.id FROM public.automations a
                    WHERE a.active AND a.next_run_at IS NOT NULL AND a.next_run_at <= p_now
                    ORDER BY a.next_run_at
                    LIMIT 500
                $$
        SQL);

        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION app.connections_for_daily_sync()
                RETURNS TABLE (tenant_id uuid, connection_id uuid)
                LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
                AS $$
                    SELECT c.tenant_id, c.id FROM public.connections c
                    WHERE c.status IN ('active', 'error')
                    ORDER BY c.tenant_id, c.id
                $$
        SQL);

        // Webhook do WhatsApp: a Meta só diz o phone_number_id; daqui sai a agência dona do número.
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION app.whatsapp_tenant_by_phone(p_phone_number_id text)
                RETURNS uuid
                LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
                AS $$
                    SELECT w.tenant_id FROM public.whatsapp_accounts w
                    WHERE w.phone_number_id = p_phone_number_id AND w.mode = 'cloud'
                    LIMIT 1
                $$
        SQL);

        // Verificação do webhook (GET hub.verify_token): existe alguma conta com este token?
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION app.whatsapp_verify_token_valid(p_token_hash text)
                RETURNS boolean
                LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
                AS $$
                    SELECT EXISTS (SELECT 1 FROM public.whatsapp_accounts w WHERE w.verify_token_hash = p_token_hash)
                $$
        SQL);

        $functions = 'app.due_automations(timestamptz), app.connections_for_daily_sync(), app.whatsapp_tenant_by_phone(text), app.whatsapp_verify_token_valid(text)';
        DB::statement("REVOKE ALL ON FUNCTION {$functions} FROM PUBLIC");
        DB::statement("GRANT EXECUTE ON FUNCTION {$functions} TO delta_app");
    }

    public function down(): void
    {
        DB::statement('DROP FUNCTION IF EXISTS app.whatsapp_verify_token_valid(text)');
        DB::statement('DROP FUNCTION IF EXISTS app.whatsapp_tenant_by_phone(text)');
        DB::statement('DROP FUNCTION IF EXISTS app.connections_for_daily_sync()');
        DB::statement('DROP FUNCTION IF EXISTS app.due_automations(timestamptz)');
        foreach (['whatsapp_accounts', 'messages', 'automation_runs', 'automation_recipients', 'automations', 'contact_consents', 'contacts'] as $table) {
            Schema::dropIfExists($table);
        }
    }
};
