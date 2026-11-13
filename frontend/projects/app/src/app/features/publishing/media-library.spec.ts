import { HttpEventType, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DsToastService } from 'design-system';
import { MediaAsset, Me, Role } from '../../core/api/api.types';
import { AuthService } from '../../core/auth/auth.service';
import { MediaLibrary } from './media-library';
import { IMAGE, VIDEO } from './publishing-fixtures';

const me = (role: Role): Me => ({
  id: 'u1',
  name: 'Ana Lima',
  email: 'ana@agencia.com',
  two_factor_enabled: false,
  tenants: [{ id: 't1', name: 'Agência Norte', slug: 'norte', role }],
});

describe('MediaLibrary', () => {
  let fixture: ComponentFixture<MediaLibrary>;
  let backend: HttpTestingController;
  let el: HTMLElement;
  let toast: DsToastService;
  let picked: MediaAsset[];

  const drain = () => new Promise<void>((resolve) => setTimeout(resolve));
  async function tick(): Promise<void> {
    await drain();
    TestBed.tick();
    await drain();
    TestBed.tick();
  }
  const button = (text: string, root: ParentNode = el) =>
    [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text);

  async function mount(inputs: { selectable?: boolean; canManage?: boolean; selected?: string[] } = {}, media: MediaAsset[] = [IMAGE, VIDEO]): Promise<void> {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { user: signal(me('analyst')), status: signal('authenticated') } },
      ],
    });
    backend = TestBed.inject(HttpTestingController);
    toast = TestBed.inject(DsToastService);
    fixture = TestBed.createComponent(MediaLibrary);
    fixture.componentRef.setInput('projectId', 'p1');
    fixture.componentRef.setInput('selectable', inputs.selectable ?? false);
    fixture.componentRef.setInput('canManage', inputs.canManage ?? true);
    fixture.componentRef.setInput('selectedIds', inputs.selected ?? []);
    picked = [];
    fixture.componentInstance.picked.subscribe((m) => picked.push(m));
    el = fixture.nativeElement as HTMLElement;
    await tick();
    const req = backend.expectOne((r) => r.url === '/api/media');
    expect(req.request.params.get('project_id')).toBe('p1');
    expect(req.request.headers.get('X-Tenant-Id')).toBe('t1');
    req.flush({ data: media });
    await tick();
  }

  afterEach(() => backend.verify());

  it('mostra a grade com imagem e vídeo pelos links assinados', async () => {
    await mount();
    const img = el.querySelector<HTMLImageElement>('[data-media="m1"] img');
    expect(img?.getAttribute('src')).toBe(IMAGE.url);
    expect(img?.getAttribute('alt')).toBe('pao.png');
    expect(el.querySelector('[data-media="m2"] video')?.getAttribute('src')).toBe(VIDEO.url);
    expect(el.querySelector('[data-media="m1"]')?.textContent).toContain('512 KB · 2160×1440');
  });

  it('envia com progresso e, no editor, já usa a mídia nova', async () => {
    await mount({ selectable: true });
    const file = new File(['x'], 'foto.jpg', { type: 'image/jpeg' });
    fixture.componentInstance.upload([file]);
    await tick();

    const req = backend.expectOne((r) => r.method === 'POST' && r.url === '/api/media');
    const body = req.request.body as FormData;
    expect(body.get('file')).toBe(file);
    expect(body.get('project_id')).toBe('p1');
    req.event({ type: HttpEventType.UploadProgress, loaded: 50, total: 100 });
    await tick();
    expect(el.querySelector('progress')?.getAttribute('value')).toBe('50');

    req.flush({ data: { ...IMAGE, id: 'm9', original_name: 'foto.jpg' } });
    await tick();
    expect(picked.map((m) => m.id)).toEqual(['m9']);
    backend.expectOne((r) => r.url === '/api/media' && r.method === 'GET').flush({ data: [IMAGE] });
  });

  it('recusa no navegador o tipo errado e mostra o erro do servidor', async () => {
    await mount();
    fixture.componentInstance.upload([new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' })]);
    await tick();
    expect(el.querySelector('.uploads [role="alert"]')?.textContent).toContain('use imagem JPG, PNG ou WebP');
    backend.expectNone((r) => r.method === 'POST');

    fixture.componentInstance.upload([new File(['x'], 'falso.mp4', { type: 'video/mp4' })]);
    await tick();
    backend
      .expectOne((r) => r.method === 'POST')
      .flush({ message: 'x', errors: { file: ['Use imagem JPG, PNG ou WebP, ou vídeo MP4 ou MOV.'] } }, { status: 422, statusText: 'Unprocessable' });
    await tick();
    expect(el.textContent).toContain('Use imagem JPG, PNG ou WebP, ou vídeo MP4 ou MOV.');
  });

  it('escolha: marca o que já está no post', async () => {
    await mount({ selectable: true, selected: ['m1'] });
    const chosen = el.querySelector<HTMLElement>('[data-media="m1"]')!;
    expect(button('No post', chosen)?.disabled).toBe(true);
    button('Usar', el.querySelector<HTMLElement>('[data-media="m2"]')!)?.click();
    expect(picked.map((m) => m.id)).toEqual(['m2']);
  });

  it('remover pede confirmação e explica quando a mídia está em uso', async () => {
    await mount();
    const errorSpy = vi.spyOn(toast, 'error');
    const card = el.querySelector<HTMLElement>('[data-media="m1"]')!;
    card.querySelector<HTMLButtonElement>('[aria-label="Remover pao.png"]')!.click();
    await tick();
    button('Remover', card)!.click();
    await tick();
    backend
      .expectOne((r) => r.method === 'DELETE' && r.url === '/api/media/m1')
      .flush({ message: 'x', errors: { media: ['Esta mídia está em um post ainda não publicado.'] } }, { status: 422, statusText: 'Unprocessable' });
    await tick();
    expect(errorSpy).toHaveBeenCalledWith('Não foi possível remover', { message: 'Esta mídia está em um post ainda não publicado.' });
  });

  it('cliente (sem gerenciar) não vê envio nem remover', async () => {
    await mount({ canManage: false });
    expect(el.querySelector('[data-testid="drop-zone"]')).toBeNull();
    expect(button('Remover')).toBeUndefined();
  });
});
