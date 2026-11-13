<?php

declare(strict_types=1);

namespace Tests;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;

/**
 * Base dos testes de Feature: Postgres real (banco delta_test), porque RLS não existe em SQLite.
 *
 * As migrations rodam com a role dona (pgsql_owner), como em produção. Cada teste roda dentro
 * de uma transação na conexão da aplicação (delta_app), sujeita a RLS, e é desfeito no final.
 */
abstract class TestCase extends BaseTestCase
{
    use RefreshDatabase {
        migrateFreshUsing as baseMigrateFreshUsing;
    }

    /** @return array<string, mixed> */
    protected function migrateFreshUsing(): array
    {
        return [...$this->baseMigrateFreshUsing(), '--database' => 'pgsql_owner'];
    }
}
