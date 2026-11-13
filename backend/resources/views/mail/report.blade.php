<x-mail::message>
{!! nl2br(e($body)) !!}

<x-mail::button :url="$url">
Ver relatório completo
</x-mail::button>

@if ($pdfPath)
O relatório em PDF segue anexo.
@endif

<x-mail::subcopy>
Você recebe este e-mail porque {{ $agency ?? 'a agência' }} cadastrou você para acompanhar este relatório. [Não quero mais receber]({{ $unsubscribeUrl }}).
</x-mail::subcopy>
</x-mail::message>
