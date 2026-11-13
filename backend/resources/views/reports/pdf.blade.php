@php
    use App\Domain\Reports\Pdf\MetricFormat as F;
    use App\Domain\Reports\Pdf\SvgChart;
    use App\Domain\Reports\Pdf\TextBlock;

    $statusLabel = ['critical' => 'Crítico', 'attention' => 'Atenção', 'opportunity' => 'Oportunidade', 'healthy' => 'Saudável'];
    $compareCaption = ['previous_period' => 'vs período anterior', 'previous_year' => 'vs ano anterior'];
    $sentiment = fn ($m) => is_array($m) ? ($m['sentiment'] ?? 'neutral') : 'neutral';
@endphp
<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>{{ $data['title'] ?? 'Relatório' }}</title>
<style>
    :root { --fg: #1d1d1f; --muted: #6e6e73; --subtle: #8e8e93; --line: #e5e5ea; --card: #f5f5f7; --accent: #0a84ff;
            --green: #248a3d; --red: #d70015; --orange: #c93400; --blue: #0071e3; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body { font-family: "Inter", "Noto Sans", "Liberation Sans", "Helvetica Neue", Arial, sans-serif; color: var(--fg); font-size: 10.5pt; line-height: 1.45; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .cover { border-radius: 18px; padding: 26px 28px; background: linear-gradient(135deg, #0b1020 0%, #1c2440 55%, {{ $brand->color }} 140%); color: #fff; margin-bottom: 22px; }
    .cover .logo { float: right; max-height: 44px; max-width: 180px; background: #fff; border-radius: 10px; padding: 6px 10px; }
    .cover .agency { font-size: 9pt; letter-spacing: .12em; text-transform: uppercase; opacity: .75; margin: 0; }
    .cover h1 { font-size: 24pt; line-height: 1.12; margin: 6px 0 4px; letter-spacing: -.01em; }
    .cover .project { font-size: 12pt; margin: 0; opacity: .92; }
    .cover .period { margin: 14px 0 0; font-size: 10pt; opacity: .85; }
    .cover .delta { float: right; font-size: 30pt; font-weight: 700; opacity: .9; line-height: 1; }
    section { margin: 0 0 18px; }
    section > h2 { font-size: 15pt; margin: 0 0 10px; padding-bottom: 6px; border-bottom: 1px solid var(--line); letter-spacing: -.01em; }
    .block { margin: 0 0 14px; page-break-inside: avoid; break-inside: avoid; }
    .block > h3 { font-size: 10pt; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 0 0 8px; }
    .kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .kpi { background: var(--card); border-radius: 12px; padding: 10px 12px; position: relative; }
    .kpi .label { font-size: 8.5pt; color: var(--muted); margin: 0 14px 2px 0; }
    .kpi .value { font-size: 16pt; font-weight: 650; letter-spacing: -.01em; margin: 0; }
    .kpi .prev { font-size: 8pt; color: var(--subtle); margin: 2px 0 0; }
    .kpi .dot { position: absolute; top: 11px; right: 11px; width: 8px; height: 8px; border-radius: 50%; }
    .chg { display: inline-block; font-size: 8pt; font-weight: 600; border-radius: 999px; padding: 1px 7px; margin-top: 4px; }
    .chg.positive { color: var(--green); background: #e3f5e8; } .chg.negative { color: var(--red); background: #fde7ea; } .chg.neutral { color: var(--muted); background: #ececf0; }
    .dot.critical { background: #ff3b30; } .dot.attention { background: #ff9f0a; } .dot.opportunity { background: #0a84ff; } .dot.healthy { background: #34c759; }
    .chart-card { background: var(--card); border-radius: 12px; padding: 12px 14px 6px; }
    .chart-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; }
    .chart-head strong { font-size: 10.5pt; } .chart-head span { font-size: 8.5pt; color: var(--muted); }
    .chart { width: 100%; height: auto; display: block; }
    .chart .axis { font-size: 10px; fill: #8e8e93; }
    .legend { font-size: 8pt; color: var(--muted); margin: 2px 0 4px; }
    .legend i { display: inline-block; width: 14px; height: 0; border-top: 2px solid var(--accent); vertical-align: middle; margin: 0 4px 0 0; }
    .legend i.prev { border-top: 2px dashed #8e8e93; margin-left: 10px; }
    table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
    th { text-align: left; font-weight: 600; color: var(--muted); font-size: 8.5pt; border-bottom: 1px solid var(--line); padding: 6px 4px; }
    td { padding: 6px 4px; border-bottom: 1px solid var(--line); }
    td.num, th.num { text-align: right; white-space: nowrap; }
    .text { background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; }
    .text p { margin: 0 0 8px; } .text p:last-child { margin-bottom: 0; } .text ul { margin: 0 0 8px 18px; padding: 0; }
    .signals { display: grid; gap: 8px; }
    .signal { border-radius: 12px; padding: 10px 12px; border-left: 4px solid #8e8e93; background: var(--card); page-break-inside: avoid; break-inside: avoid; }
    .signal.critical { border-color: #ff3b30; } .signal.attention { border-color: #ff9f0a; } .signal.opportunity { border-color: #0a84ff; }
    .signal .tag { font-size: 7.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
    .signal.critical .tag { color: var(--red); } .signal.attention .tag { color: var(--orange); } .signal.opportunity .tag { color: var(--blue); }
    .signal h4 { margin: 2px 0 4px; font-size: 10.5pt; }
    .signal p { margin: 0 0 4px; font-size: 9.5pt; } .signal .tip { color: var(--fg); } .signal .tip b { color: var(--green); }
    .all-good { background: #e3f5e8; color: var(--green); border-radius: 12px; padding: 10px 12px; font-size: 9.5pt; }
    .empty { color: var(--subtle); font-size: 9pt; margin: 0; }
    .approx { color: var(--subtle); font-size: 7.5pt; }
    .src { color: var(--subtle); font-size: 7.5pt; }
@if ($slides ?? false)
    /* Studio (ADR 0029): uma página por slide, paisagem 16:9. */
    body { font-size: 11pt; }
    .cover { height: 5.2in; display: flex; flex-direction: column; justify-content: flex-end; margin: 0; padding: 40px 44px; }
    .cover h1 { font-size: 32pt; }
    section { page-break-before: always; break-before: page; margin: 0; }
    section > h2 { font-size: 22pt; border: 0; margin-bottom: 14px; }
    .kpis { grid-template-columns: repeat(3, 1fr); }
    .block { margin-bottom: 12px; }
@endif
</style>
</head>
<body>
<header class="cover">
    @if ($brand->logoPath)
        <img class="logo" src="logo.png" alt="{{ $brand->name }}">
    @elseif (! $brand->hideBadge)
        <span class="delta">Δ</span>
    @endif
    <p class="agency">{{ $brand->name }}</p>
    <h1>{{ $data['title'] ?? 'Relatório' }}</h1>
    <p class="project">{{ $data['project']['name'] ?? '' }}</p>
    <p class="period">
        {{ $data['period']['label'] ?? '' }}
        @if (! empty($data['comparison']))
            · comparado a {{ F::date($data['comparison']['start']) }} – {{ F::date($data['comparison']['end']) }}
        @endif
    </p>
</header>

@foreach (($data['sections'] ?? []) as $section)
<section>
    <h2>{{ $section['title'] }}</h2>
    @foreach ($section['blocks'] as $block)
        <div class="block">
            @if (! empty($block['title']) && $block['type'] !== 'chart')
                <h3>{{ $block['title'] }}</h3>
            @endif

            @switch($block['type'])
                @case('kpis')
                    @if (empty($block['metrics']))
                        <p class="empty">Sem dados: conecte as contas deste canal ao projeto.</p>
                    @else
                        <div class="kpis">
                            @foreach ($block['metrics'] as $m)
                                <div class="kpi">
                                    @if (! empty($m['status'])) <span class="dot {{ $m['status'] }}"></span> @endif
                                    <p class="label">{{ $m['label'] }}@if (! empty($block['mixed'])) <span class="src">· {{ $m['provider_name'] ?? '' }}</span>@endif</p>
                                    <p class="value">{{ F::value($m['value'], $m['unit'], $m['decimals']) }}</p>
                                    @if (($data['compare'] ?? 'none') !== 'none' && $m['change_pct'] !== null)
                                        <span class="chg {{ $sentiment($m) }}">{{ F::change($m['change_pct']) }}</span>
                                    @endif
                                    @if (($data['compare'] ?? 'none') !== 'none')
                                        <p class="prev">antes: {{ F::value($m['previous'], $m['unit'], $m['decimals']) }}</p>
                                    @endif
                                </div>
                            @endforeach
                        </div>
                    @endif
                    @break

                @case('chart')
                    @php $m = $block['metric'] ?? null; @endphp
                    <div class="chart-card">
                        <div class="chart-head">
                            <strong>{{ $block['title'] ?? ($m['label'] ?? 'Gráfico') }}</strong>
                            @if (is_array($m))
                                <span>{{ F::value($m['value'], $m['unit'], $m['decimals']) }} @if ($m['change_pct'] !== null && ($data['compare'] ?? 'none') !== 'none') · {{ F::change($m['change_pct']) }} {{ $compareCaption[$data['compare']] ?? '' }} @endif</span>
                            @endif
                        </div>
                        @if (is_array($m))
                            <div class="legend"><i></i>período @if (($data['compare'] ?? 'none') !== 'none') <i class="prev"></i>comparação @endif</div>
                            {!! SvgChart::area($m['series'] ?? [], ($data['compare'] ?? 'none') !== 'none' ? ($m['previous_series'] ?? []) : [], $m['unit'], $m['decimals']) !!}
                        @else
                            <p class="empty">Sem dados para este gráfico.</p>
                        @endif
                    </div>
                    @break

                @case('table')
                    @if (empty($block['metrics']))
                        <p class="empty">Sem dados: conecte as contas deste canal ao projeto.</p>
                    @else
                        <table>
                            <thead><tr><th>Métrica</th><th class="num">Período</th>@if (($data['compare'] ?? 'none') !== 'none')<th class="num">Anterior</th><th class="num">Variação</th>@endif</tr></thead>
                            <tbody>
                            @foreach ($block['metrics'] as $m)
                                <tr>
                                    <td>{{ $m['label'] }}@if (! empty($block['mixed'])) <span class="src">· {{ $m['provider_name'] ?? '' }}</span>@endif @if (! empty($m['approximate'])) <span class="approx">(aprox.)</span> @endif</td>
                                    <td class="num">{{ F::value($m['value'], $m['unit'], $m['decimals']) }}</td>
                                    @if (($data['compare'] ?? 'none') !== 'none')
                                        <td class="num">{{ F::value($m['previous'], $m['unit'], $m['decimals']) }}</td>
                                        <td class="num"><span class="chg {{ $sentiment($m) }}">{{ F::change($m['change_pct']) ?: '—' }}</span></td>
                                    @endif
                                </tr>
                            @endforeach
                            </tbody>
                        </table>
                    @endif
                    @break

                @case('text')
                    @if (trim($block['content'] ?? '') !== '')
                        <div class="text">{!! TextBlock::toHtml($block['content']) !!}</div>
                    @endif
                    @break

                @case('attention')
                    @if (empty($block['signals']))
                        <div class="all-good">Nenhum ponto de atenção no período: os indicadores avaliados estão dentro das boas práticas.</div>
                    @else
                        <div class="signals">
                            @foreach ($block['signals'] as $s)
                                <div class="signal {{ $s['status'] ?? '' }}">
                                    <span class="tag">{{ $statusLabel[$s['status'] ?? ''] ?? '' }}</span>
                                    <h4>{{ $s['title'] ?? '' }}</h4>
                                    <p>{{ $s['explanation'] ?? '' }}</p>
                                    @if (! empty($s['suggestion'])) <p class="tip"><b>Sugestão:</b> {{ $s['suggestion'] }}</p> @endif
                                </div>
                            @endforeach
                        </div>
                    @endif
                    @break
            @endswitch
        </div>
    @endforeach
</section>
@endforeach
</body>
</html>
