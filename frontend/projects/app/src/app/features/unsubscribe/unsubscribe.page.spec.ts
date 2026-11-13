import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { UnsubscribePage } from './unsubscribe.page';

const QUERY = '?channel=email&contact=c1&tenant=t1&signature=abc123';

describe('UnsubscribePage', () => {
  let fixture: ComponentFixture<UnsubscribePage>;
  let backend: HttpTestingController;
  let el: HTMLElement;

  const drain = () => new Promise<void>((resolve) => setTimeout(resolve));
  async function tick(): Promise<void> {
    await drain();
    TestBed.tick();
  }
  async function create(query: string): Promise<void> {
    history.replaceState(null, '', '/descadastrar' + query);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { user: signal(null), status: signal('guest') } },
      ],
    });
    backend = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(UnsubscribePage);
    el = fixture.nativeElement as HTMLElement;
    await tick();
  }

  afterEach(() => {
    backend.verify();
    history.replaceState(null, '', '/');
  });

  it('repassa a query assinada intacta e confirma o descadastro', async () => {
    await create(QUERY);
    backend.expectOne('/api/public/unsubscribe' + QUERY).flush({ data: { name: 'Marina', channel: 'email', agency: 'Agência Aurora', subscribed: true } });
    await tick();
    expect(el.textContent).toContain('Olá, Marina. Quer deixar de receber os relatórios da Agência Aurora por e-mail?');

    [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Não quero mais receber'))!.click();
    await tick();
    backend.expectOne('/sanctum/csrf-cookie').flush(null, { status: 204, statusText: 'No Content' });
    await tick();
    const post = backend.expectOne((r) => r.method === 'POST' && r.url === '/api/public/unsubscribe' + QUERY);
    post.flush({ data: { subscribed: false } });
    await tick();
    expect(el.textContent).toContain('Você não vai mais receber os relatórios por e-mail');
  });

  it('avisa quando o link foi alterado (403) ou o contato não existe (404)', async () => {
    await create(QUERY);
    backend.expectOne('/api/public/unsubscribe' + QUERY).flush({ message: 'Invalid signature.' }, { status: 403, statusText: 'Forbidden' });
    await tick();
    expect(el.textContent).toContain('Este link não é válido.');
  });

  it('sem parâmetros nem chama a API', async () => {
    await create('');
    backend.expectNone(() => true);
    expect(el.textContent).toContain('Este link não é válido.');
  });

  it('quem já saiu vê que não há nada a fazer', async () => {
    await create(QUERY);
    backend.expectOne('/api/public/unsubscribe' + QUERY).flush({ data: { name: 'Marina', channel: 'whatsapp', agency: null, subscribed: false } });
    await tick();
    expect(el.textContent).toContain('Você já não recebe os relatórios pelo WhatsApp.');
  });
});
