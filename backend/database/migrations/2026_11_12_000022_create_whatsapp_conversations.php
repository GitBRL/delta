<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** Caixa de respostas do WhatsApp: mensagens recebidas dos clientes e as respostas da equipe. ADR 0023. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('whatsapp_messages', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('contact_id')->nullable()->constrained()->nullOnDelete();
            $table->string('phone', 20);
            $table->string('direction', 3); // in | out
            $table->text('body');
            $table->string('provider_message_id', 128)->nullable()->unique();
            $table->string('status', 10)->default('received'); // received | sent | delivered | read | failed
            $table->uuid('sent_by')->nullable();
            $table->timestampTz('read_at')->nullable();
            $table->timestampTz('created_at')->useCurrent();

            $table->index(['tenant_id', 'phone', 'created_at']);
        });
        DB::statement("ALTER TABLE whatsapp_messages ADD CONSTRAINT whatsapp_messages_direction_check CHECK (direction IN ('in', 'out'))");

        Rls::tenantIsolation('whatsapp_messages');
        DB::statement('CREATE POLICY whatsapp_messages_staff_only ON whatsapp_messages AS RESTRICTIVE USING ((SELECT app.is_staff())) WITH CHECK ((SELECT app.is_staff()))');
    }

    public function down(): void
    {
        Schema::dropIfExists('whatsapp_messages');
    }
};
