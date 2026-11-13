<!doctype html>
<html lang="pt-BR">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex">
    <title>Delta · Autorização de demonstração</title>
    @include('oauth._style')
</head>
<body>
<main class="card">
    <span class="badge">Modo demonstração</span>
    <div class="icon demo" aria-hidden="true">⇄</div>
    <h1>Conectar {{ $platform }} ao Delta</h1>
    <p>Esta é uma simulação da tela de autorização da plataforma. Nenhuma conta real é acessada e nenhuma senha é pedida.</p>
    <ul>
        <li>Ler métricas das contas (somente leitura)</li>
        <li>Listar as contas disponíveis para o seu usuário</li>
    </ul>
    <div class="actions">
        <a class="button secondary" href="{{ $cancelUrl }}">Cancelar</a>
        <a class="button" href="{{ $authorizeUrl }}">Autorizar</a>
    </div>
</main>
</body>
</html>
