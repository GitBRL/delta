<?php

declare(strict_types=1);

use Illuminate\Support\Facades\Context;
use Illuminate\Support\Facades\Http;

it('devolve e propaga o id da requisição', function () {
    $this->getJson('/api/health')->assertHeader('X-Request-Id');

    $this->getJson('/api/health', ['X-Request-Id' => 'req-abc-12345'])->assertHeader('X-Request-Id', 'req-abc-12345');
    expect(Context::get('request_id'))->toBe('req-abc-12345');

    $forged = $this->getJson('/api/health', ['X-Request-Id' => "x\nSet-Cookie: a=b"])->headers->get('X-Request-Id');
    expect($forged)->toMatch('/^[0-9a-f-]{36}$/');
});

it('põe a agência e o usuário no contexto dos logs', function () {
    [$tenant, $owner] = tenantWithOwner();
    security()->set($tenant->id, $owner->id);

    expect(Context::get('tenant_id'))->toBe($tenant->id)->and(Context::get('user_id'))->toBe($owner->id);

    security()->clear();
    expect(Context::has('tenant_id'))->toBeFalse();
});

it('informa a saúde das dependências sem dados sensíveis', function () {
    Http::fake(['gotenberg:3000/health' => Http::response(['status' => 'up'])]);

    $body = $this->getJson('/api/health')->json();

    expect($body['checks'])->toMatchArray(['database' => 'ok', 'cache' => 'ok', 'pdf' => 'ok'])
        ->and($body['checks'])->toHaveKey('workers') // Horizon não roda nos testes
        ->and(array_keys($body))->toBe(['status', 'checks']);
});
