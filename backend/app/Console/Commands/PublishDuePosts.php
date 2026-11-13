<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Jobs\PublishPost;
use App\Support\Tenancy\TenantContext;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * A cada minuto: posts agendados que chegaram na hora. Listagem entre agências só de ids; a
 * publicação roda sob RLS, no contexto de cada agência (ADR 0012, ADR 0028).
 */
#[Signature('posts:publish-due')]
#[Description('Publica os posts agendados que chegaram na hora')]
final class PublishDuePosts extends Command
{
    public function handle(TenantContext $context): int
    {
        /** @var list<object{tenant_id: string, post_id: string}> $rows */
        $rows = DB::select('select * from app.due_posts(now())');

        foreach ($rows as $row) {
            $context->run($row->tenant_id, null, fn () => PublishPost::dispatch($row->post_id));
        }

        $this->info(count($rows).' post(s) em publicação.');

        return self::SUCCESS;
    }
}
