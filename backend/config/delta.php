<?php

declare(strict_types=1);

return [
    // Fuso padrão das agências enquanto não houver configuração por agência.
    'timezone' => env('DELTA_TIMEZONE', 'America/Sao_Paulo'),

    // Origem da SPA. As rotas /oauth/* são servidas por ela (via proxy em dev), então o
    // retorno das plataformas cai na mesma origem do app e os cookies de sessão valem.
    'frontend_url' => env('FRONTEND_URL', 'http://localhost:4300'),

    // Domínio próprio da agência (white label): o CNAME precisa apontar para cá.
    'cname_target' => env('DELTA_CNAME_TARGET', 'relatorios.delta.app'),
];
