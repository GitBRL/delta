<!doctype html>
<html lang="pt-BR">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex">
    <title>Delta · Conexão</title>
    @include('oauth._style')
</head>
<body>
<main class="card" role="status" aria-live="polite">
    @if ($result->status === 'success')
        <div class="icon success" aria-hidden="true">✓</div>
        <h1>{{ $platform }} conectado</h1>
        <p>Pronto! Você já pode voltar ao Delta. Esta janela fecha sozinha.</p>
    @elseif ($result->status === 'cancelled')
        <div class="icon cancelled" aria-hidden="true">–</div>
        <h1>Conexão cancelada</h1>
        <p>Nada foi conectado. Você pode tentar de novo quando quiser.</p>
    @else
        <div class="icon error" aria-hidden="true">!</div>
        <h1>Não deu para conectar</h1>
        <p>{{ $result->message }}</p>
    @endif
    <div class="actions">
        <button type="button" id="close">Fechar janela</button>
        <a class="button secondary" href="{{ $origin }}/integracoes">Ir para Integrações</a>
    </div>
</main>
<script nonce="{{ $nonce }}">
    (function () {
        var message = @json($message);
        var origin = @json($origin);

        // Três canais: o vínculo com a janela do app (window.opener) pode ter sido cortado pela
        // política COOP das páginas da plataforma; BroadcastChannel e localStorage não dependem dele.
        try { if (window.opener && !window.opener.closed) { window.opener.postMessage(message, origin); } } catch (e) {}
        try { var channel = new BroadcastChannel('delta-oauth'); channel.postMessage(message); channel.close(); } catch (e) {}
        try { localStorage.setItem('delta-oauth-result', JSON.stringify(message)); localStorage.removeItem('delta-oauth-result'); } catch (e) {}

        document.getElementById('close').addEventListener('click', function () { window.close(); });
        if (message.status !== 'error') { setTimeout(function () { window.close(); }, 900); }
    })();
</script>
</body>
</html>
