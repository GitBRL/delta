<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Domain\Messaging\WhatsApp\MetaCloudWhatsApp;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Models\WhatsAppAccount;
use App\Support\Audit\Audit;
use App\Support\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * WhatsApp da agência (dono e administrador): demonstração por padrão, ou o número oficial
 * pela Cloud API da Meta. Token e app secret entram e não saem. Ver ADR 0013.
 */
final class WhatsAppSettingsController extends Controller
{
    public const TEMPLATE_EXAMPLE = 'Olá, {{1}}! O relatório de {{2}} referente a {{3}} está pronto. Destaques: {{4}}. Veja o relatório completo em {{5}} . Qualquer dúvida, é só responder esta mensagem.';

    public function __construct(
        private readonly MetaCloudWhatsApp $cloud,
        private readonly TenantContext $context,
        private readonly Audit $audit,
    ) {}

    public function show(): JsonResponse
    {
        return response()->json(['data' => $this->present(WhatsAppAccount::query()->first())]);
    }

    public function update(Request $request): JsonResponse
    {
        $account = WhatsAppAccount::query()->first() ?? new WhatsAppAccount(['mode' => 'sandbox']);
        $cloud = $request->input('mode') === 'cloud';
        $request->validate([
            'mode' => ['required', Rule::in(['sandbox', 'cloud'])],
            'phone_number_id' => [$cloud ? 'required' : 'nullable', 'string', 'regex:/^\d{6,30}$/'],
            'waba_id' => ['nullable', 'string', 'regex:/^\d{6,30}$/'],
            'access_token' => [$cloud && $account->access_token === null ? 'required' : 'nullable', 'string', 'min:20', 'max:1000', 'regex:/^\S+$/'],
            'app_secret' => [$cloud && $account->app_secret === null ? 'required' : 'nullable', 'string', 'regex:/^[a-f0-9]{32}$/'],
            'template_name' => [$cloud ? 'required' : 'nullable', 'string', 'regex:/^[a-z0-9_]{1,120}$/'],
            'template_language' => ['nullable', 'string', 'regex:/^[a-z]{2}(_[A-Z]{2})?$/'],
        ], [
            'phone_number_id.required' => 'Informe o ID do número de telefone (WhatsApp › Configuração da API).',
            'phone_number_id.regex' => 'O ID do número tem só dígitos.',
            'access_token.required' => 'Informe o token de acesso permanente (usuário do sistema).',
            'app_secret.required' => 'Informe a chave secreta do app (confere a assinatura do webhook).',
            'app_secret.regex' => 'A chave secreta do app tem 32 caracteres (0–9, a–f).',
            'template_name.required' => 'Informe o nome do template aprovado (ex.: relatorio_periodico).',
            'template_name.regex' => 'O nome do template usa só letras minúsculas, números e _.',
        ]);

        $optional = fn (string $key): ?string => $request->filled($key) ? $request->string($key)->toString() : null;
        $account->fill([
            'mode' => $request->string('mode')->toString(),
            'phone_number_id' => $optional('phone_number_id'),
            'waba_id' => $optional('waba_id'),
            'template_name' => $optional('template_name'),
            'template_language' => $optional('template_language') ?? 'pt_BR',
            'updated_by' => $this->context->userId(),
        ]);
        foreach (['access_token', 'app_secret'] as $secret) {
            if (($value = $optional($secret)) !== null) {
                $account->{$secret} = $value;
            }
        }
        if ($account->verify_token === null) {
            $token = Str::random(32);
            $account->verify_token = $token;
            $account->verify_token_hash = hash('sha256', $token);
        }

        $account->verified_at = null;
        $account->verification_error = null;
        $account->save();

        $result = $account->mode === 'cloud' ? $this->check($account) : null;
        $this->audit->record('whatsapp.saved', $account, ['mode' => $account->mode, 'verification' => $result['ok'] ?? null]);

        return response()->json(['data' => $this->present($account->refresh()), 'verification' => $result]);
    }

    public function verify(): JsonResponse
    {
        $account = WhatsAppAccount::query()->first();
        if ($account === null || $account->mode !== 'cloud') {
            throw ValidationException::withMessages(['mode' => 'Configure o número oficial antes de testar.']);
        }

        $result = $this->check($account);

        return response()->json(['data' => $this->present($account->refresh()), 'verification' => $result]);
    }

    public function destroy(): Response
    {
        $account = WhatsAppAccount::query()->first();
        if ($account !== null) {
            $this->audit->record('whatsapp.removed', $account);
            $account->delete();
        }

        return response()->noContent();
    }

    /** @return array{ok: bool, message: string, display_phone: string|null} */
    private function check(WhatsAppAccount $account): array
    {
        $result = $this->cloud->verify($account);
        $account->forceFill([
            'verified_at' => $result['ok'] ? now() : null,
            'verification_error' => $result['ok'] ? null : $result['message'],
            'display_phone' => $result['display_phone'] ?? $account->display_phone,
        ])->save();

        return $result;
    }

    /** @return array<string, mixed> */
    private function present(?WhatsAppAccount $a): array
    {
        $appUrl = config('app.url');

        return [
            'mode' => $a->mode ?? 'sandbox',
            'configured' => $a !== null,
            'status' => match (true) {
                $a === null || $a->mode === 'sandbox' => 'sandbox',
                $a->verification_error !== null => 'invalid',
                $a->verified_at !== null => 'verified',
                default => 'unverified',
            },
            'phone_number_id' => $a?->phone_number_id,
            'waba_id' => $a?->waba_id,
            'display_phone' => $a?->display_phone,
            'template_name' => $a?->template_name,
            'template_language' => $a->template_language ?? 'pt_BR',
            'has_access_token' => $a?->access_token !== null,
            'has_app_secret' => $a?->app_secret !== null,
            'verify_token' => $a?->verify_token,
            'webhook_url' => rtrim(is_string($appUrl) ? $appUrl : '', '/').'/api/webhooks/whatsapp',
            'template_example' => self::TEMPLATE_EXAMPLE,
            'verified_at' => $a?->verified_at?->toIso8601String(),
            'verification_error' => $a?->verification_error,
            'updated_by' => $a?->updated_by !== null ? User::query()->whereKey($a->updated_by)->value('name') : null,
            'updated_at' => $a?->updated_at?->toIso8601String(),
        ];
    }
}
