import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { breakEvenRoas, maxCpa, freelanceRate, funnel } from '../assets/calc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function htmlFiles(dir = ROOT) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'test' || name === 'node_modules') return [];
    return statSync(path).isDirectory() ? htmlFiles(path) : name.endsWith('.html') ? [path] : [];
  });
}

test('calculadoras: ROAS de equilíbrio e CPA máximo', () => {
  assert.equal(breakEvenRoas(35).toFixed(2), '2.86');
  assert.equal(breakEvenRoas(0), null);
  assert.equal(breakEvenRoas(120), null);
  assert.deepEqual(maxCpa(180, 40, 10), { breakEven: 72, target: 54 });
  assert.equal(maxCpa(0, 40), null);
  assert.equal(maxCpa(180, 40, 50).target, 0); // lucro acima da margem: não há CPA possível
});

test('calculadoras: preço de freela e funil', () => {
  const r = freelanceRate({ monthlyIncome: 8000, monthlyCosts: 900, billableHoursPerWeek: 25, weeksOff: 5, taxPct: 6 });
  assert.equal(r.billableHours, 1175);
  assert.equal(r.hourly.toFixed(2), (106800 / 1175 / 0.94).toFixed(2));
  assert.equal(freelanceRate({ monthlyIncome: 8000, billableHoursPerWeek: 0 }), null);

  const f = funnel({ impressions: 50000, clicks: 450, conversions: 9 }, { ctr: 1.2, conversionRate: 2.5 });
  assert.equal(f.ctr.toFixed(2), '0.90');
  assert.equal(f.conversionRate.toFixed(2), '2.00');
  assert.equal(f.bottleneck, 'clique'); // 0,9/1,2 = 75% < 2,0/2,5 = 80%
  assert.equal(funnel({ impressions: 10, clicks: 20, conversions: 0 }), null);
  assert.equal(funnel({ impressions: 1000, clicks: 50, conversions: 5 }).bottleneck, null);
});

test('toda página tem idioma, título, descrição, canonical e um único h1', () => {
  const pages = htmlFiles();
  assert.ok(pages.length >= 15);
  for (const file of pages) {
    const html = readFileSync(file, 'utf8');
    const where = file.replace(ROOT, '');
    assert.match(html, /<html lang="pt-BR">/, where);
    assert.match(html, /<title>[^<]{10,}<\/title>/, where);
    assert.match(html, /<meta name="description" content="[^"]{20,}">/, where);
    assert.match(html, /<link rel="canonical" href="[^"]+">/, where);
    assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1, `${where}: um h1`);
    assert.doesNotMatch(html, /lorem ipsum/i, where);
    assert.doesNotMatch(html, /\bTODO\b|\bFIXME\b/, where); // maiúsculas: "todo dia" é português
  }
});

test('links internos apontam para arquivos que existem', () => {
  for (const file of htmlFiles()) {
    const html = readFileSync(file, 'utf8');
    for (const [, href] of html.matchAll(/(?:href|src)="(\/[^"#?]*)/g)) {
      const target = join(ROOT, href.endsWith('/') ? `${href}index.html` : href);
      assert.ok(existsSync(target), `${file.replace(ROOT, '')} → ${href}`);
    }
  }
});

test('o sitemap lista todas as páginas (menos a 404)', () => {
  const sitemap = readFileSync(join(ROOT, 'sitemap.xml'), 'utf8');
  const pages = htmlFiles().filter((f) => !f.endsWith('404.html'));
  assert.equal((sitemap.match(/<loc>/g) ?? []).length, pages.length);
});
