<?php

declare(strict_types=1);

namespace App\Domain\Contacts;

use App\Models\Contact;
use App\Models\ContactConsent;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\URL;

/**
 * Contatos e consentimento (LGPD e regras da Meta para WhatsApp): toda mudança de opt-in vira
 * um registro append-only com quem, quando, canal e origem. Descadastro por link assinado.
 */
final readonly class Contacts
{
    public function __construct(private TenantContext $context) {}

    /** @param array{project_id?: string, name: string, email: string|null, phone: string|null, role: string|null, email_opt_in: bool, whatsapp_opt_in: bool} $data */
    public function save(?Contact $contact, array $data, ?string $ip): Contact
    {
        return DB::transaction(function () use ($contact, $data, $ip): Contact {
            $contact ??= new Contact(['project_id' => $data['project_id'] ?? null]);
            $before = ['email' => $contact->exists && $contact->email_opt_in, 'whatsapp' => $contact->exists && $contact->whatsapp_opt_in];

            $contact->fill([
                'name' => $data['name'],
                'email' => $data['email'],
                'phone' => Phone::normalize($data['phone']),
                'role' => $data['role'],
                'email_opt_in' => $data['email_opt_in'] && $data['email'] !== null,
                'whatsapp_opt_in' => $data['whatsapp_opt_in'] && $data['phone'] !== null,
            ])->save();

            foreach (['email' => $contact->email_opt_in, 'whatsapp' => $contact->whatsapp_opt_in] as $channel => $now) {
                if ($now !== $before[$channel]) {
                    $this->record($contact, $channel, $now, 'manual', $ip);
                }
            }

            return $contact;
        });
    }

    public function optOut(Contact $contact, string $channel, string $source, ?string $ip): void
    {
        $field = $channel === 'whatsapp' ? 'whatsapp_opt_in' : 'email_opt_in';
        if (! $contact->{$field}) {
            return;
        }

        DB::transaction(function () use ($contact, $field, $channel, $source, $ip): void {
            $contact->forceFill([$field => false])->save();
            $this->record($contact, $channel, false, $source, $ip);
        });
    }

    /** Link de descadastro (página do app) com parâmetros assinados para a API pública. */
    public static function unsubscribeUrl(Contact $contact, string $channel): string
    {
        $signed = URL::signedRoute('public.unsubscribe', ['tenant' => $contact->tenant_id, 'contact' => $contact->id, 'channel' => $channel], absolute: false);
        $query = (string) parse_url($signed, PHP_URL_QUERY);
        $base = config('delta.frontend_url');

        return rtrim(is_string($base) ? $base : '', '/').'/descadastrar?'.$query;
    }

    private function record(Contact $contact, string $channel, bool $granted, string $source, ?string $ip): void
    {
        ContactConsent::query()->create([
            'contact_id' => $contact->id,
            'channel' => $channel,
            'granted' => $granted,
            'source' => $source,
            'recorded_by' => $this->context->userId(),
            'ip' => $ip,
        ]);
    }
}
