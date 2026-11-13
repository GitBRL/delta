<style nonce="{{ $nonce }}">
    :root {
        color-scheme: light dark;
        --bg: light-dark(#f4f5f8, #08090c);
        --card: light-dark(rgb(255 255 255 / 0.82), rgb(28 29 37 / 0.78));
        --border: light-dark(rgb(255 255 255 / 0.75), rgb(255 255 255 / 0.08));
        --text: light-dark(#14151a, #f3f4f7);
        --muted: light-dark(rgb(28 30 40 / 0.62), rgb(235 237 245 / 0.62));
        --accent: oklch(0.58 0.2 262);
        --healthy: light-dark(#1f9d55, #34d17a);
        --critical: light-dark(#d93a3f, #ff6369);
        --attention: light-dark(#c98500, #ffc23d);
    }
    * { box-sizing: border-box; }
    body {
        margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
        font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif;
        color: var(--text);
        background: radial-gradient(1200px 600px at 20% -10%, color-mix(in oklch, var(--accent) 18%, transparent), transparent), var(--bg);
    }
    .card {
        width: min(420px, 100%); padding: 28px; border-radius: 24px; text-align: center;
        background: var(--card); border: 1px solid var(--border);
        backdrop-filter: blur(24px) saturate(180%);
        box-shadow: 0 20px 60px rgb(0 0 0 / 0.12);
        animation: rise 420ms linear(0, 0.42 18%, 0.82 38%, 1.02 60%, 1);
    }
    .icon { width: 56px; height: 56px; margin: 0 auto 14px; border-radius: 50%; display: grid; place-items: center; font-size: 26px; color: #fff; }
    .icon.success { background: var(--healthy); }
    .icon.error { background: var(--critical); }
    .icon.cancelled { background: var(--attention); }
    .icon.demo { background: var(--accent); }
    h1 { font-size: 20px; margin: 0 0 6px; letter-spacing: -0.01em; }
    p { margin: 0 0 18px; color: var(--muted); }
    .badge { display: inline-block; font-size: 12px; padding: 3px 10px; border-radius: 999px; margin-bottom: 14px; background: color-mix(in oklch, var(--accent) 16%, transparent); color: var(--accent); font-weight: 600; }
    ul { text-align: left; margin: 0 0 20px; padding-left: 20px; color: var(--muted); }
    .actions { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
    a.button, button {
        appearance: none; border: 0; cursor: pointer; text-decoration: none; font: inherit; font-weight: 600;
        padding: 10px 18px; border-radius: 12px; background: var(--accent); color: #fff;
        transition: transform 150ms linear(0, 0.6 40%, 1), opacity 150ms;
    }
    a.button.secondary, button.secondary { background: color-mix(in oklch, var(--muted) 18%, transparent); color: var(--text); }
    a.button:active, button:active { transform: scale(0.97); }
    @keyframes rise { from { opacity: 0; transform: translateY(12px) scale(0.98); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { .card { animation: none; } a.button, button { transition: none; } }
</style>
