<?php

declare(strict_types=1);

namespace App\Http\Requests;

use App\Domain\Integrations\OAuth\Apps\AppVendor;
use App\Models\OAuthApp;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Cadastro das credenciais do app de uma plataforma. Quem pode: middleware "tenant.admin".
 * Chave secreta e developer token em branco = manter os atuais (o navegador nunca os recebe
 * de volta, então não tem como reenviá-los).
 */
final class SavePlatformAppRequest extends FormRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        $vendor = $this->vendor();
        $hasSecret = OAuthApp::query()->where('vendor', $vendor->value)->exists();

        return [
            'client_id' => ['required', 'string', 'max:255', match ($vendor) {
                AppVendor::Meta, AppVendor::Tiktok => 'regex:/^\d{6,25}$/',
                AppVendor::Google => 'regex:/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/',
                AppVendor::Linkedin => 'regex:/^[A-Za-z0-9]{8,40}$/',
            }],
            'client_secret' => [$hasSecret ? 'nullable' : 'required', 'string', 'min:8', 'max:255', 'regex:/^\S+$/'],
            'developer_token' => $vendor->supportsDeveloperToken()
                ? ['nullable', 'string', 'regex:/^[A-Za-z0-9_-]{10,64}$/']
                : ['prohibited'],
        ];
    }

    /** @return array<string, string> */
    public function messages(): array
    {
        [$required, $format] = match ($this->vendor()) {
            AppVendor::Meta => ['Informe o ID do app da Meta.', 'O ID do app da Meta tem só números. Ele aparece em Configurações › Básico, no painel do app.'],
            AppVendor::Google => ['Informe o ID do cliente OAuth do Google.', 'O ID do cliente do Google termina em ".apps.googleusercontent.com".'],
            AppVendor::Tiktok => ['Informe o App ID do TikTok for Business.', 'O App ID do TikTok tem só números (veja em My Apps no portal de desenvolvedores).'],
            AppVendor::Linkedin => ['Informe o Client ID do app do LinkedIn.', 'O Client ID do LinkedIn tem só letras e números (aba Auth do app).'],
        };

        return [
            'client_id.required' => $required,
            'client_id.regex' => $format,
            'client_secret.required' => 'Informe a chave secreta do app.',
            'client_secret.min' => 'A chave secreta parece incompleta. Copie de novo do painel da plataforma.',
            'client_secret.regex' => 'A chave secreta não pode ter espaços. Copie de novo do painel da plataforma.',
            'developer_token.regex' => 'O developer token do Google Ads tem só letras, números, "-" e "_" (copie da Central de API).',
            'developer_token.prohibited' => 'Developer token só existe para o Google Ads.',
        ];
    }

    public function vendor(): AppVendor
    {
        $vendor = $this->route('vendor');

        return $vendor instanceof AppVendor ? $vendor : AppVendor::from(is_string($vendor) ? $vendor : '');
    }
}
