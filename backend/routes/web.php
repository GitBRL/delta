<?php

declare(strict_types=1);

use App\Http\Controllers\OAuthController;
use Illuminate\Support\Facades\Route;

// O backend é só API. Rotas de autenticação (Fortify) ficam em /auth/*.
Route::get('/', fn () => response()->json(['name' => 'Delta API']));

// Login das plataformas em pop-up. Servidas na origem do app (proxy /oauth → API), então o
// retorno das plataformas chega com o cookie de sessão (SameSite=Lax vale em navegação GET).
Route::prefix('oauth/{provider}')
    ->where(['provider' => 'meta_ads|google_ads|ga4|instagram|facebook|search_console|youtube|google_business|tiktok_ads|linkedin_ads|google_sheets'])
    ->middleware('throttle:30,1')
    ->group(function (): void {
        Route::get('start', [OAuthController::class, 'start'])->name('oauth.start');
        Route::get('callback', [OAuthController::class, 'callback'])->name('oauth.callback');
        Route::get('demo', [OAuthController::class, 'demo'])->name('oauth.demo');
    });
