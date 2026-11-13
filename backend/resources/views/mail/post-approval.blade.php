<x-mail::message>
# Tem um post esperando sua aprovação

Olá, {{ $contactName }}! {{ $agency ?? 'Sua agência' }} preparou {{ $postTitle ? '"'.$postTitle.'"' : 'um post' }} para {{ $projectName }}.

Veja como vai ficar em cada rede e responda com um clique: **Aprovar** ou **Pedir ajuste**.

<x-mail::button :url="$url">
Ver e responder
</x-mail::button>

O link vale por 14 dias.
</x-mail::message>
