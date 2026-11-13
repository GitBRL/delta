<x-mail::message>
# Franquia do plano {{ $planName }}

@foreach ($alerts as $alert)
**{{ ucfirst($alert['label']) }}:** {{ number_format($alert['used'], 0, ',', '.') }} de {{ number_format($alert['limit'], 0, ',', '.') }} no mês ({{ $alert['threshold'] >= 100 ? 'esgotada' : 'acima de 80%' }}).

@endforeach
@if (collect($alerts)->contains(fn ($a) => $a['threshold'] >= 100))
Com a franquia esgotada, os envios automáticos de WhatsApp ficam suspensos e a IA para até o próximo mês. O e-mail continua funcionando.
@endif

<x-mail::button :url="rtrim((string) config('delta.frontend_url'), '/').'/configuracoes/plano'">
Ver plano e uso
</x-mail::button>
</x-mail::message>
