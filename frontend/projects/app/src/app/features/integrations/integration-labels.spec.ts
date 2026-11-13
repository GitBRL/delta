import { TestBed } from '@angular/core/testing';
import { ACCOUNT_KIND_LABEL, CATEGORY_LABEL } from './integration-labels';
import { ProviderIcon } from './provider-icon';

const CHANNELS = [
  'meta_ads',
  'google_ads',
  'ga4',
  'instagram',
  'facebook',
  'search_console',
  'youtube',
  'google_business',
  'tiktok_ads',
  'linkedin_ads',
];

describe('rótulos e ícones dos canais', () => {
  it('nomeia as categorias e os tipos de conta novos', () => {
    expect(CATEGORY_LABEL.seo).toBe('Busca orgânica');
    expect(CATEGORY_LABEL.local).toBe('Negócio local');
    expect(ACCOUNT_KIND_LABEL.site).toBe('Site');
    expect(ACCOUNT_KIND_LABEL.channel).toBe('Canal');
    expect(ACCOUNT_KIND_LABEL.location).toBe('Unidade');
  });

  it('cada um dos 10 canais tem ícone próprio (nenhum cai no genérico)', async () => {
    const render = async (provider: string) => {
      const fixture = TestBed.createComponent(ProviderIcon);
      fixture.componentRef.setInput('provider', provider);
      await fixture.whenStable();
      return (fixture.nativeElement as HTMLElement).innerHTML;
    };

    const fallback = await render('desconhecido');
    const icons = await Promise.all(CHANNELS.map(render));
    for (const [index, html] of icons.entries()) {
      expect(html, CHANNELS[index]).not.toBe(fallback);
    }
    expect(new Set(icons).size).toBe(CHANNELS.length);
  });
});
