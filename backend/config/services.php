<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Resend, Postmark, AWS, and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    // Login das plataformas de dados (OAuth). Vazio = login real indisponível; o modo
    // demonstração continua funcionando. Redirect a cadastrar no app de cada plataforma:
    // {FRONTEND_URL}/oauth/{meta_ads|facebook|instagram|google_ads|ga4}/callback
    'meta' => [
        'client_id' => env('META_APP_ID'),
        'client_secret' => env('META_APP_SECRET'),
        'graph_version' => env('META_GRAPH_VERSION', 'v24.0'),
    ],

    'google' => [
        'client_id' => env('GOOGLE_CLIENT_ID'),
        'client_secret' => env('GOOGLE_CLIENT_SECRET'),
        // Exigido pela API do Google Ads (Basic access) para listar e ler contas.
        'ads_developer_token' => env('GOOGLE_ADS_DEVELOPER_TOKEN'),
        'ads_api_version' => env('GOOGLE_ADS_API_VERSION', 'v22'),
    ],

    // TikTok for Business e LinkedIn (padrão opcional do servidor; o normal é o app da agência).
    'tiktok' => ['client_id' => env('TIKTOK_APP_ID'), 'client_secret' => env('TIKTOK_APP_SECRET')],
    'linkedin' => ['client_id' => env('LINKEDIN_CLIENT_ID'), 'client_secret' => env('LINKEDIN_CLIENT_SECRET'), 'api_version' => env('LINKEDIN_API_VERSION', '202410')],

    // Copiloto de IA: chave PADRÃO do servidor (opcional). O normal é cada agência cadastrar a
    // dela em Configurações › IA (ADR 0021), que tem precedência.
    'anthropic' => [
        'key' => env('ANTHROPIC_API_KEY'),
    ],

    // PDF dos relatórios (Chromium sem JavaScript e sem rede). Ver compose.yaml.
    'gotenberg' => [
        'url' => env('GOTENBERG_URL', 'http://gotenberg:3000'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

];
