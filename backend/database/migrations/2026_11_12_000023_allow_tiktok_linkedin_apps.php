<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/** Apps das plataformas: TikTok for Business e LinkedIn passam a ser aceitos (ADR 0024). */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE oauth_apps DROP CONSTRAINT oauth_apps_vendor_check');
        DB::statement("ALTER TABLE oauth_apps ADD CONSTRAINT oauth_apps_vendor_check CHECK (vendor IN ('meta', 'google', 'tiktok', 'linkedin'))");
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE oauth_apps DROP CONSTRAINT oauth_apps_vendor_check');
        DB::statement("ALTER TABLE oauth_apps ADD CONSTRAINT oauth_apps_vendor_check CHECK (vendor IN ('meta', 'google'))");
    }
};
