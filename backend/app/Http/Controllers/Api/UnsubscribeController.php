<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Domain\Contacts\Contacts;
use App\Http\Controllers\Controller;
use App\Models\Contact;
use App\Models\Tenant;
use App\Support\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Descadastro em um clique, sem login. A URL é assinada pelo Delta (tenant, contato e canal):
 * só com a assinatura válida o contexto da agência é definido e o opt-out gravado.
 */
final class UnsubscribeController extends Controller
{
    public function __construct(
        private readonly Contacts $contacts,
        private readonly TenantContext $context,
    ) {}

    public function show(Request $request): JsonResponse
    {
        return $this->withContact($request, fn (Contact $contact, string $channel, ?string $agency): JsonResponse => response()->json(['data' => [
            'name' => explode(' ', trim($contact->name))[0],
            'channel' => $channel,
            'agency' => $agency,
            'subscribed' => $channel === 'whatsapp' ? $contact->whatsapp_opt_in : $contact->email_opt_in,
        ]]));
    }

    public function confirm(Request $request): JsonResponse
    {
        return $this->withContact($request, function (Contact $contact, string $channel) use ($request): JsonResponse {
            $this->contacts->optOut($contact, $channel, 'unsubscribe_link', $request->ip());

            return response()->json(['data' => ['subscribed' => false]]);
        });
    }

    /** @param callable(Contact, string, string|null): JsonResponse $then */
    private function withContact(Request $request, callable $then): JsonResponse
    {
        $tenant = $request->query('tenant');
        $contactId = $request->query('contact');
        $channel = $request->query('channel');
        abort_unless(is_string($tenant) && is_string($contactId) && in_array($channel, ['email', 'whatsapp'], true), 404);

        return $this->context->run($tenant, null, function () use ($contactId, $channel, $tenant, $then): JsonResponse {
            $contact = Contact::query()->find($contactId) ?? abort(404, 'Contato não encontrado.');
            $agency = Tenant::query()->whereKey($tenant)->value('name');

            return $then($contact, $channel, is_string($agency) ? $agency : null);
        });
    }
}
