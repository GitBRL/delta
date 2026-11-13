<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<style>
    html, body { margin: 0; }
    body { font-family: "Inter", "Noto Sans", "Liberation Sans", Arial, sans-serif; font-size: 7.5pt; color: #8e8e93; padding: 0 0.45in; }
</style>
</head>
<body>
{{-- Uma linha só, alinhada à esquerda: a área de rodapé do Chromium corta o que fica no canto direito. --}}
<span>Página <span class="pageNumber"></span> de <span class="totalPages"></span> · {{ $agency ?? '' }} · {{ $title }} · gerado em {{ $generated }}</span>
</body>
</html>
