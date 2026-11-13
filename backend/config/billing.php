<?php

declare(strict_types=1);

/*
| Planos do Delta (ADR 0031). Limites e preços são PROVISÓRIOS: a decisão nº 8 do plano
| (franquia por plano + pacote adicional) e os valores ainda precisam ser validados. null = sem
| limite. "price_brl" null = "fale com a gente". O teste grátis libera tudo (limites do Agência).
*/

return [
    'trial_days' => (int) env('BILLING_TRIAL_DAYS', 14),
    'trial_plan' => 'agencia',

    'plans' => [
        'essencial' => [
            'name' => 'Essencial',
            'price_brl' => null,
            'limits' => ['projects' => 5, 'seats' => 3, 'live_connections' => 15, 'automations' => 10, 'whatsapp_messages' => 300, 'ai_tokens' => 500_000],
            'features' => ['api' => false, 'mcp' => false, 'white_label' => false, 'publishing' => true, 'studio' => false, 'ads_management' => false],
        ],
        'pro' => [
            'name' => 'Pro',
            'price_brl' => null,
            'limits' => ['projects' => 25, 'seats' => 10, 'live_connections' => 75, 'automations' => 100, 'whatsapp_messages' => 2_000, 'ai_tokens' => 3_000_000],
            'features' => ['api' => true, 'mcp' => true, 'white_label' => false, 'publishing' => true, 'studio' => true, 'ads_management' => true],
        ],
        'agencia' => [
            'name' => 'Agência',
            'price_brl' => null,
            'limits' => ['projects' => 100, 'seats' => 30, 'live_connections' => 300, 'automations' => 500, 'whatsapp_messages' => 10_000, 'ai_tokens' => 10_000_000],
            'features' => ['api' => true, 'mcp' => true, 'white_label' => true, 'publishing' => true, 'studio' => true, 'ads_management' => true],
        ],
    ],
];
