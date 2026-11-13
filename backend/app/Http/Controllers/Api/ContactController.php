<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Domain\Contacts\Contacts;
use App\Domain\Contacts\Phone;
use App\Http\Controllers\Controller;
use App\Models\Contact;
use App\Models\ContactConsent;
use App\Models\Project;
use App\Models\User;
use App\Support\Audit\Audit;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Validation\ValidationException;

/** Contatos do cliente final (quem recebe os relatórios), com consentimento por canal. Equipe da agência. */
final class ContactController extends Controller
{
    public function __construct(
        private readonly Contacts $contacts,
        private readonly Audit $audit,
    ) {}

    public function index(Project $project): JsonResponse
    {
        return response()->json(['data' => Contact::query()->where('project_id', $project->id)->orderBy('name')->get()->map(self::present(...))->values()->all()]);
    }

    public function store(Request $request, Project $project): JsonResponse
    {
        $contact = $this->contacts->save(null, ['project_id' => $project->id, ...$this->validated($request)], $request->ip());
        $this->audit->record('contact.created', $contact);

        return response()->json(['data' => self::present($contact)], 201);
    }

    public function update(Request $request, Contact $contact): JsonResponse
    {
        $contact = $this->contacts->save($contact, $this->validated($request), $request->ip());
        $this->audit->record('contact.updated', $contact);

        return response()->json(['data' => self::present($contact)]);
    }

    public function destroy(Contact $contact): Response
    {
        $this->audit->record('contact.deleted', $contact, ['name' => $contact->name]);
        $contact->delete();

        return response()->noContent();
    }

    /** Histórico de consentimento (quem, quando, canal, origem). */
    public function consents(Contact $contact): JsonResponse
    {
        $rows = ContactConsent::query()->where('contact_id', $contact->id)->orderByDesc('created_at')->get();
        $names = User::query()->whereIn('id', $rows->pluck('recorded_by')->filter()->unique()->values()->all())->pluck('name', 'id');

        return response()->json(['data' => $rows->map(fn (ContactConsent $c): array => [
            'channel' => $c->channel,
            'granted' => $c->granted,
            'source' => $c->source,
            'recorded_by' => $c->recorded_by !== null ? $names->get($c->recorded_by) : null,
            'created_at' => $c->created_at?->toIso8601String(),
        ])->values()->all()]);
    }

    /** @return array{name: string, email: string|null, phone: string|null, role: string|null, email_opt_in: bool, whatsapp_opt_in: bool} */
    private function validated(Request $request): array
    {
        $request->validate([
            'name' => ['required', 'string', 'min:2', 'max:120'],
            'email' => ['nullable', 'string', 'email:rfc', 'max:255'],
            'phone' => ['nullable', 'string', 'max:30'],
            'role' => ['nullable', 'string', 'max:80'],
            'email_opt_in' => ['boolean'],
            'whatsapp_opt_in' => ['boolean'],
        ], [
            'name.required' => 'Informe o nome do contato.',
            'email.email' => 'Este e-mail não parece válido.',
        ]);

        $email = $request->filled('email') ? mb_strtolower($request->string('email')->toString()) : null;
        $phone = $request->filled('phone') ? $request->string('phone')->toString() : null;

        if ($phone !== null && Phone::normalize($phone) === null) {
            throw ValidationException::withMessages(['phone' => 'Telefone inválido. Use DDD + número (ex.: 11 99999-8888) ou o formato internacional.']);
        }
        if ($email === null && $phone === null) {
            throw ValidationException::withMessages(['email' => 'Informe ao menos um e-mail ou um WhatsApp.']);
        }

        return [
            'name' => $request->string('name')->toString(),
            'email' => $email,
            'phone' => $phone,
            'role' => $request->filled('role') ? $request->string('role')->toString() : null,
            'email_opt_in' => $request->boolean('email_opt_in'),
            'whatsapp_opt_in' => $request->boolean('whatsapp_opt_in'),
        ];
    }

    /** @return array<string, mixed> */
    public static function present(Contact $c): array
    {
        return [
            'id' => $c->id,
            'project_id' => $c->project_id,
            'name' => $c->name,
            'email' => $c->email,
            'phone' => $c->phone,
            'phone_display' => $c->phone !== null ? Phone::display($c->phone) : null,
            'role' => $c->role,
            'email_opt_in' => $c->email_opt_in,
            'whatsapp_opt_in' => $c->whatsapp_opt_in,
            'created_at' => $c->created_at?->toIso8601String(),
        ];
    }
}
