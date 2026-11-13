<x-mail::message>
# Você foi convidado para a {{ $tenantName }}

{{ $inviterName ?? 'A agência' }} convidou você para a equipe da **{{ $tenantName }}** no Delta, como **{{ $roleLabel }}**.

@if ($projectNames !== [])
Você vai acompanhar: {{ implode(', ', $projectNames) }}.
@endif

<x-mail::button :url="$url">
Aceitar convite
</x-mail::button>

O convite vale até {{ $expiresAt }}. Se você não esperava este e-mail, pode ignorá-lo: nada acontece sem o seu aceite.

<x-mail::subcopy>
Se o botão não funcionar, copie e cole este endereço no navegador: {{ $url }}
</x-mail::subcopy>
</x-mail::message>
