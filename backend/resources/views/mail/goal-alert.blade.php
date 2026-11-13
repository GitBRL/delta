<x-mail::message>
# Metas dos seus clientes

@foreach ($alerts as $alert)
**{{ $alert['project'] }}** · {{ $alert['headline'] }}
{{ $alert['text'] }}

@endforeach

<x-mail::button :url="rtrim((string) config('delta.frontend_url'), '/').'/metas'">
Ver metas
</x-mail::button>
</x-mail::message>
