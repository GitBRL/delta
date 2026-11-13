import { DOCUMENT } from '@angular/common';
import { HttpClient, HttpErrorResponse, httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DsButton, DsGlassCard, DsIcon, DsSkeleton, DsToastService } from 'design-system';
import { firstValueFrom } from 'rxjs';
import {
  API,
  ApiEnvelope,
  ApiToken,
  ApiTokenBody,
  ApiTokenCreated,
  ApiTokenList,
  WebhookBody,
  WebhookDelivery,
  WebhookEndpoint,
  WebhookList,
  WebhookSecretResponse,
} from '../../core/api/api.types';
import { relativeTime } from '../../core/format/relative-time';
import { FieldErrors, extractFieldErrors } from '../../core/forms/server-errors';
import { TenantService } from '../../core/tenant/tenant.service';
import {
  API_ENDPOINTS,
  CONNECT_ENDPOINTS,
  CONNECT_EVENTS,
  MCP_PROMPTS,
  MCP_TOOLS,
  SIGNATURE_NODE,
  SIGNATURE_PHP,
  TOKEN_EXPIRY,
  apiBase,
  cliExample,
  connectBase,
  connectCurlExample,
  copyText,
  curlExample,
  eventsText,
  isDevFrontOrigin,
  mcpConfig,
  mcpUrl,
  tokenState,
  webhookState,
} from './settings';

interface WebhookDraft {
  id: string | null;
  url: string;
  description: string;
  events: string[];
  active: boolean;
}

const DELIVERY_LABEL: Readonly<Record<WebhookDelivery['status'], string>> = {
  pending: 'Na fila',
  delivered: 'Entregue',
  failed: 'Falhou',
};

/**
 * Configurações › API e webhooks (dono/admin). Token e segredo aparecem uma única vez:
 * o servidor guarda só o hash (token) ou criptografado (segredo).
 */
@Component({
  selector: 'app-api-page',
  imports: [RouterLink, DsButton, DsGlassCard, DsIcon, DsSkeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="mb-8">
      <a class="back" routerLink="/configuracoes">‹ Configurações</a>
      <h1 class="m-0 mt-1 text-large-title font-bold tracking-tight">API e webhooks</h1>
      <p class="m-0 mt-2 max-w-2xl text-subhead text-fg-muted">
        Integre o Delta ao BI, ao CRM ou a automações (n8n, Make, Zapier): leia projetos e métricas pela API e receba
        eventos por webhook, sem login de pessoa.
      </p>
    </header>

    @if (!tenant.isAdmin()) {
      <ds-glass-card padding="lg" role="note">
        <p class="m-0 text-headline">Só donos e administradores da agência gerenciam a API e os webhooks.</p>
      </ds-glass-card>
    } @else {
      <div class="layout">
        <div class="col">
          <!-- Tokens -->
          <ds-glass-card padding="lg">
            <section aria-labelledby="tokens-title">
              <div class="head">
                <h2 id="tokens-title" class="m-0 text-title-3 font-semibold">Tokens de API</h2>
                @if (!tokenForm()) {
                  <button ds-button variant="secondary" size="sm" (click)="openTokenForm()">Novo token</button>
                }
              </div>

              @if (createdToken(); as t) {
                <div class="secret" role="status" data-testid="token-once">
                  <p class="m-0 text-subhead font-semibold">Copie o token agora: ele não será mostrado de novo.</p>
                  <code class="code">{{ t }}</code>
                  <div class="row">
                    <button ds-button size="sm" (click)="copy(t)"><svg dsIcon="copy" [size]="14"></svg> Copiar token</button>
                    <button ds-button variant="ghost" size="sm" (click)="createdToken.set(null)">Já copiei</button>
                  </div>
                </div>
              }

              @if (tokenForm()) {
                <form class="form" aria-label="Novo token" (submit)="$event.preventDefault(); createToken()">
                  <label class="field">
                    <span>Nome (para lembrar onde é usado)</span>
                    <input name="token_name" type="text" maxlength="80" placeholder="Ex.: Integração com o BI" [value]="tokenName()" (input)="tokenName.set($any($event.target).value)" [attr.aria-invalid]="!!tokenErrors()['name']" />
                    @if (tokenErrors()['name']) {
                      <small class="error" role="alert">{{ tokenErrors()['name'] }}</small>
                    }
                  </label>
                  <fieldset class="checks">
                    <legend>Permissões</legend>
                    @for (scope of scopeList(); track scope.key) {
                      <label class="check">
                        <input type="checkbox" [name]="'scope_' + scope.key" [checked]="tokenScopes().includes(scope.key)" (change)="toggleScope(scope.key)" />
                        <span><code>{{ scope.key }}</code> {{ scope.label }}</span>
                      </label>
                    }
                    @if (tokenErrors()['scopes']) {
                      <small class="error" role="alert">{{ tokenErrors()['scopes'] }}</small>
                    }
                  </fieldset>
                  <label class="field">
                    <span>Validade</span>
                    <select name="token_expiry" (change)="tokenExpiry.set($any($event.target).value === '' ? null : +$any($event.target).value)">
                      @for (o of expiryOptions; track o.label) {
                        <option [value]="o.value ?? ''" [selected]="o.value === tokenExpiry()">{{ o.label }}</option>
                      }
                    </select>
                  </label>
                  <div class="row">
                    <button ds-button type="submit" size="sm" [loading]="creatingToken()">Criar token</button>
                    <button ds-button type="button" variant="ghost" size="sm" (click)="tokenForm.set(false)">Cancelar</button>
                  </div>
                </form>
              }

              @if (tokens.isLoading() && !tokens.hasValue()) {
                <ds-skeleton height="64px" />
              } @else if (tokenList().length === 0) {
                <p class="m-0 text-footnote text-fg-muted">Nenhum token ainda.</p>
              } @else {
                <ul class="list">
                  @for (t of tokenList(); track t.id) {
                    @let st = state(t);
                    <li class="item" [attr.data-token]="t.id">
                      <div class="item-head">
                        <strong>{{ t.name }}</strong>
                        <span class="chip" [attr.data-tone]="st.tone">{{ st.label }}</span>
                      </div>
                      <p class="m-0 text-caption text-fg-muted">
                        <code>{{ t.prefix }}…</code> · {{ t.scopes.join(', ') }}
                      </p>
                      <p class="m-0 text-caption text-fg-subtle">
                        {{ t.last_used_at ? 'Usado ' + relativeTime(t.last_used_at) : 'Nunca usado' }}
                        @if (t.expires_at) {
                          · expira {{ relativeTime(t.expires_at) }}
                        }
                      </p>
                      @if (st.tone === 'ok') {
                        <div class="row">
                          @if (confirmRevoke() === t.id) {
                            <span class="text-footnote">Revogar? Sistemas que usam este token param na hora.</span>
                            <button ds-button variant="ghost" size="sm" [loading]="busy() === t.id" (click)="revoke(t)">Revogar</button>
                            <button ds-button variant="ghost" size="sm" (click)="confirmRevoke.set(null)">Manter</button>
                          } @else {
                            <button ds-button variant="ghost" size="sm" (click)="confirmRevoke.set(t.id)">Revogar</button>
                          }
                        </div>
                      }
                    </li>
                  }
                </ul>
              }
            </section>
          </ds-glass-card>

          <!-- Webhooks -->
          <ds-glass-card padding="lg">
            <section aria-labelledby="webhooks-title">
              <div class="head">
                <h2 id="webhooks-title" class="m-0 text-title-3 font-semibold">Webhooks</h2>
                @if (!hookDraft()) {
                  <button ds-button variant="secondary" size="sm" (click)="openHook(null)">Novo webhook</button>
                }
              </div>

              @if (shownSecret(); as sec) {
                <div class="secret" role="status" data-testid="secret-once">
                  <p class="m-0 text-subhead font-semibold">Segredo de assinatura: copie agora, ele não será mostrado de novo.</p>
                  <code class="code">{{ sec }}</code>
                  <div class="row">
                    <button ds-button size="sm" (click)="copy(sec)"><svg dsIcon="copy" [size]="14"></svg> Copiar segredo</button>
                    <button ds-button variant="ghost" size="sm" (click)="shownSecret.set(null)">Já copiei</button>
                  </div>
                </div>
              }

              @if (hookDraft(); as d) {
                <form class="form" [attr.aria-label]="d.id ? 'Editar webhook' : 'Novo webhook'" (submit)="$event.preventDefault(); saveHook()">
                  <label class="field">
                    <span>URL (https)</span>
                    <input name="hook_url" type="url" placeholder="https://seu-sistema.com/webhooks/delta" [value]="d.url" (input)="patchHook({ url: $any($event.target).value })" [attr.aria-invalid]="!!hookErrors()['url']" />
                    @if (hookErrors()['url']) {
                      <small class="error" role="alert">{{ hookErrors()['url'] }}</small>
                    }
                  </label>
                  <label class="field">
                    <span>Descrição (opcional)</span>
                    <input name="hook_description" type="text" maxlength="120" [value]="d.description" (input)="patchHook({ description: $any($event.target).value })" />
                  </label>
                  <fieldset class="checks">
                    <legend>Eventos</legend>
                    <label class="check">
                      <input type="checkbox" name="event_all" [checked]="d.events.includes('*')" (change)="toggleEvent('*')" />
                      <span><strong>Todos os eventos</strong></span>
                    </label>
                    @if (!d.events.includes('*')) {
                      @for (e of eventList(); track e.key) {
                        <label class="check">
                          <input type="checkbox" [name]="'event_' + e.key" [checked]="d.events.includes(e.key)" (change)="toggleEvent(e.key)" />
                          <span><code>{{ e.key }}</code> {{ e.label }}</span>
                        </label>
                      }
                    }
                    @if (hookErrors()['events']) {
                      <small class="error" role="alert">{{ hookErrors()['events'] }}</small>
                    }
                  </fieldset>
                  <div class="row">
                    <button ds-button type="submit" size="sm" [loading]="savingHook()">{{ d.id ? 'Salvar webhook' : 'Criar webhook' }}</button>
                    <button ds-button type="button" variant="ghost" size="sm" (click)="hookDraft.set(null)">Cancelar</button>
                  </div>
                </form>
              }

              @if (hooks.isLoading() && !hooks.hasValue()) {
                <ds-skeleton height="64px" />
              } @else if (hookList().length === 0) {
                <p class="m-0 text-footnote text-fg-muted">Nenhum webhook ainda.</p>
              } @else {
                <ul class="list">
                  @for (w of hookList(); track w.id) {
                    @let st = hookState(w);
                    <li class="item" [attr.data-webhook]="w.id">
                      <div class="item-head">
                        <strong class="url">{{ w.url }}</strong>
                        <span class="chip" [attr.data-tone]="st.tone">{{ st.label }}</span>
                      </div>
                      @if (w.description) {
                        <p class="m-0 text-footnote text-fg-muted">{{ w.description }}</p>
                      }
                      <p class="m-0 text-caption text-fg-subtle">{{ eventsLabel(w) }}</p>
                      <div class="row">
                        <button ds-button variant="ghost" size="sm" [loading]="busy() === 'test:' + w.id" (click)="test(w)">Enviar teste</button>
                        <button ds-button variant="ghost" size="sm" [attr.aria-expanded]="openDeliveries() === w.id" (click)="toggleDeliveries(w)">Entregas</button>
                        <button ds-button variant="ghost" size="sm" (click)="toggleActive(w)">{{ w.active && !w.disabled_at ? 'Pausar' : 'Ativar' }}</button>
                        <button ds-button variant="ghost" size="sm" (click)="openHook(w)">Editar</button>
                        @if (confirm() === 'rotate:' + w.id) {
                          <span class="text-footnote">Gerar novo segredo? O atual deixa de valer.</span>
                          <button ds-button variant="ghost" size="sm" [loading]="busy() === 'rotate:' + w.id" (click)="rotate(w)">Gerar</button>
                          <button ds-button variant="ghost" size="sm" (click)="confirm.set(null)">Manter</button>
                        } @else if (confirm() === 'remove:' + w.id) {
                          <span class="text-footnote">Remover este webhook?</span>
                          <button ds-button variant="ghost" size="sm" [loading]="busy() === 'remove:' + w.id" (click)="removeHook(w)">Remover</button>
                          <button ds-button variant="ghost" size="sm" (click)="confirm.set(null)">Manter</button>
                        } @else {
                          <button ds-button variant="ghost" size="sm" (click)="confirm.set('rotate:' + w.id)">Rotacionar segredo</button>
                          <button ds-button variant="ghost" size="sm" (click)="confirm.set('remove:' + w.id)">Remover</button>
                        }
                      </div>
                      @if (openDeliveries() === w.id) {
                        @if (deliveries() === null) {
                          <ds-skeleton height="40px" />
                        } @else if (deliveries()?.length === 0) {
                          <p class="m-0 text-footnote text-fg-muted">Nenhuma entrega ainda. Use "Enviar teste".</p>
                        } @else {
                          <table class="deliveries" aria-label="Entregas recentes">
                            <thead><tr><th>Evento</th><th>Situação</th><th>Tentativas</th><th>Resposta</th><th>Quando</th></tr></thead>
                            <tbody>
                              @for (dl of deliveries(); track dl.id) {
                                <tr [attr.data-status]="dl.status">
                                  <td><code>{{ dl.event }}</code></td>
                                  <td><span class="chip" [attr.data-tone]="dl.status === 'delivered' ? 'ok' : dl.status === 'failed' ? 'warn' : 'off'">{{ deliveryLabel[dl.status] }}</span></td>
                                  <td class="ds-tabular">{{ dl.attempts }}</td>
                                  <td>{{ dl.last_status_code ?? dl.last_error ?? '—' }}</td>
                                  <td>{{ relativeTime(dl.created_at) }}</td>
                                </tr>
                              }
                            </tbody>
                          </table>
                        }
                      }
                    </li>
                  }
                </ul>
              }
            </section>
          </ds-glass-card>
        </div>

        <!-- Como usar -->
        <aside class="help ds-glass" aria-labelledby="howto-title">
          <h2 id="howto-title" class="m-0 text-headline">Como usar</h2>
          <p class="m-0 text-footnote text-fg-muted">Base da API</p>
          <code class="code" data-testid="api-base">{{ base }}</code>
          <p class="m-0 text-footnote text-fg-muted">Exemplo</p>
          <pre class="pre"><code>{{ curl }}</code></pre>
          <ul class="endpoints">
            @for (e of endpoints; track e.path + e.method) {
              <li><code>{{ e.method }} {{ e.path }}</code> <span>{{ e.text }}</span> <small>{{ e.scope }}</small></li>
            }
          </ul>
          <p class="m-0 text-footnote">
            Limite: 120 chamadas por minuto por token. Webhooks chegam assinados no cabeçalho
            <code>X-Delta-Signature: t=&lt;unix&gt;,v1=&lt;hmac&gt;</code>, com HMAC-SHA256 de
            <code>"t.corpo"</code> usando o segredo do webhook. Responda 2xx em até 10 s; falhas são reenviadas por até 2 dias.
          </p>
          <details>
            <summary>Verificar a assinatura em PHP</summary>
            <pre class="pre"><code>{{ php }}</code></pre>
          </details>
          <details>
            <summary>Verificar a assinatura em Node.js</summary>
            <pre class="pre"><code>{{ node }}</code></pre>
          </details>

          <section class="mcp" aria-labelledby="mcp-title" data-testid="mcp-panel">
            <h2 id="mcp-title" class="m-0 text-headline">Usar com assistentes de IA (MCP)</h2>
            <p class="m-0 text-footnote">
              O Claude, o Cursor e outros assistentes compatíveis com MCP leem os dados da agência pelo servidor do Delta.
              Crie um token com a permissão <code>mcp:tools</code> e as leituras que quiser liberar (projetos, métricas,
              relatórios): cada ferramenta só aparece com a leitura correspondente. Por enquanto, o MCP só lê; não altera nada.
            </p>
            <p class="m-0 text-footnote text-fg-muted">Endereço do servidor</p>
            <code class="code" data-testid="mcp-url">{{ mcp }}</code>
            @if (devOrigin) {
              <p class="m-0 text-footnote text-fg-muted" data-testid="mcp-dev-note">
                No ambiente local, a API roda em <code>http://localhost:8000</code>: use <code>http://localhost:8000/mcp</code>
                se o endereço acima não responder.
              </p>
            }
            <div class="mcp-head">
              <p class="m-0 text-footnote text-fg-muted">Configuração do cliente MCP</p>
              <button ds-button variant="ghost" size="sm" (click)="copy(mcpJson)"><svg dsIcon="copy" [size]="14"></svg> Copiar</button>
            </div>
            <pre class="pre" data-testid="mcp-config"><code>{{ mcpJson }}</code></pre>
            <details>
              <summary>Ferramentas e prompts</summary>
              <ul class="endpoints">
                @for (t of mcpTools; track t.name) {
                  <li><code>{{ t.name }}</code> <span>{{ t.text }}</span> <small>{{ t.scope }}</small></li>
                }
                @for (p of mcpPrompts; track p.name) {
                  <li><code>{{ p.name }}</code> <span>{{ p.text }}</span> <small>prompt</small></li>
                }
              </ul>
            </details>
            <p class="m-0 text-footnote text-fg-muted">CLI <code>delta</code> (Node 20+, no repositório do Delta)</p>
            <pre class="pre" data-testid="cli-example"><code>{{ cli }}</code></pre>
            <p class="m-0 text-footnote text-fg-muted">
              No <code>--token -</code>, cole o token e tecle Enter: ele não fica no histórico do terminal.
            </p>
          </section>

          <section class="mcp" aria-labelledby="connect-title" data-testid="connect-panel">
            <h2 id="connect-title" class="m-0 text-headline">Delta Connect (para o seu SaaS)</h2>
            <p class="m-0 text-footnote">
              Leve relatórios e métricas para o seu próprio produto. Use um token com a permissão <code>connect</code>
              para criar <b>customers</b>, um por cliente seu. Cada customer recebe um token próprio <code>dct_…</code>,
              mostrado uma única vez. Com ele, no cabeçalho <code>X-Customer-Token</code>, tudo fica restrito ao projeto
              daquele cliente.
            </p>
            <p class="m-0 text-footnote text-fg-muted">Base</p>
            <code class="code" data-testid="connect-base">{{ connect }}</code>
            <ul class="endpoints" data-testid="connect-endpoints">
              @for (e of connectEndpoints; track e.path + e.method) {
                <li><code>{{ e.method }} {{ e.path }}</code> <span>{{ e.text }}</span> <small>{{ e.who === 'customer' ? 'customer' : 'merchant' }}</small></li>
              }
            </ul>
            <p class="m-0 text-footnote text-fg-muted">Eventos de webhook</p>
            <ul class="endpoints">
              @for (ev of connectEvents; track ev.name) {
                <li><code>{{ ev.name }}</code> <span>{{ ev.text }}</span></li>
              }
            </ul>
            <div class="mcp-head">
              <p class="m-0 text-footnote text-fg-muted">Criar um customer e o link de conexão</p>
              <button ds-button variant="ghost" size="sm" (click)="copy(connectCurl)"><svg dsIcon="copy" [size]="14"></svg> Copiar</button>
            </div>
            <pre class="pre" data-testid="connect-example"><code>{{ connectCurl }}</code></pre>
          </section>
        </aside>
      </div>
    }
  `,
  styles: `
    .back {
      font: var(--ds-text-footnote);
      color: var(--ds-accent);
      text-decoration: none;
    }
    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
      gap: var(--ds-space-6);
      align-items: start;
    }
    @media (max-width: 1080px) {
      .layout {
        grid-template-columns: 1fr;
      }
    }
    .col {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-4);
    }
    section {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-3);
    }
    .head,
    .item-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--ds-space-2);
    }
    .form {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-3);
      padding: var(--ds-space-3);
      border-radius: var(--ds-radius-md);
      background: var(--ds-fill);
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font: var(--ds-text-caption);
      font-weight: 600;
      color: var(--ds-text-secondary);
    }
    .field input,
    .field select {
      height: 36px;
      padding: 0 10px;
      border: 1px solid var(--ds-separator);
      border-radius: var(--ds-radius-sm);
      background: var(--ds-bg-elevated);
      color: var(--ds-text);
      font: var(--ds-text-footnote);
    }
    .checks {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin: 0;
      padding: 0;
      border: 0;
    }
    .checks legend {
      margin-bottom: 4px;
      font: var(--ds-text-caption);
      font-weight: 600;
      color: var(--ds-text-secondary);
    }
    .check {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      font: var(--ds-text-footnote);
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--ds-space-2);
    }
    .list {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .item {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: var(--ds-space-3);
      border-radius: var(--ds-radius-md);
      background: var(--ds-fill);
    }
    .url {
      overflow-wrap: anywhere;
    }
    .chip {
      flex: none;
      padding: 2px 10px;
      border-radius: var(--ds-radius-full);
      font: var(--ds-text-caption);
      font-weight: 600;
      background: var(--ds-bg-elevated);
      color: var(--ds-text-secondary);
    }
    .chip[data-tone='ok'] {
      background: color-mix(in oklch, var(--ds-status-healthy) 16%, transparent);
      color: var(--ds-status-healthy);
    }
    .chip[data-tone='warn'] {
      background: color-mix(in oklch, var(--ds-status-critical) 14%, transparent);
      color: var(--ds-status-critical);
    }
    .secret {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-2);
      padding: var(--ds-space-3);
      border-radius: var(--ds-radius-md);
      background: color-mix(in oklch, var(--ds-status-attention) 14%, transparent);
    }
    .code {
      display: block;
      padding: 8px 12px;
      border-radius: var(--ds-radius-sm);
      background: var(--ds-bg-elevated);
      font: var(--ds-text-footnote);
      font-family: ui-monospace, monospace;
      overflow-wrap: anywhere;
    }
    .mcp {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-2);
      margin-top: var(--ds-space-2);
      padding-top: var(--ds-space-4);
      border-top: 1px solid var(--ds-separator);
    }
    .mcp-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--ds-space-2);
    }
    .pre {
      margin: 0;
      padding: 10px 12px;
      border-radius: var(--ds-radius-sm);
      background: var(--ds-bg-elevated);
      font: var(--ds-text-caption);
      font-family: ui-monospace, monospace;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .help {
      position: sticky;
      top: var(--ds-space-4);
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-2);
      padding: var(--ds-space-5);
      border-radius: var(--ds-radius-xl);
    }
    .endpoints {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin: 0;
      padding: 0;
      list-style: none;
      font: var(--ds-text-caption);
    }
    .endpoints small {
      color: var(--ds-text-tertiary);
    }
    details summary {
      font: var(--ds-text-footnote);
      font-weight: 600;
      cursor: pointer;
    }
    .deliveries {
      width: 100%;
      border-collapse: collapse;
      font: var(--ds-text-caption);
    }
    .deliveries th,
    .deliveries td {
      padding: 4px 6px;
      border-bottom: 1px solid var(--ds-separator);
      text-align: left;
    }
    .error {
      color: var(--ds-status-critical);
      font: var(--ds-text-caption);
    }
  `,
})
export class ApiPage {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(DsToastService);
  protected readonly tenant = inject(TenantService);
  private readonly document = inject(DOCUMENT);

  protected readonly relativeTime = relativeTime;
  protected readonly state = tokenState;
  protected readonly hookState = webhookState;
  protected readonly expiryOptions = TOKEN_EXPIRY;
  protected readonly deliveryLabel = DELIVERY_LABEL;
  protected readonly endpoints = API_ENDPOINTS;
  protected readonly php = SIGNATURE_PHP;
  protected readonly node = SIGNATURE_NODE;
  protected readonly base = apiBase(this.document.defaultView?.location.origin ?? '');
  protected readonly curl = curlExample(this.base);
  private readonly origin = this.document.defaultView?.location.origin ?? '';
  protected readonly mcp = mcpUrl(this.origin);
  protected readonly mcpJson = mcpConfig(this.mcp);
  protected readonly mcpTools = MCP_TOOLS;
  protected readonly mcpPrompts = MCP_PROMPTS;
  protected readonly cli = cliExample(this.devOriginOrApi());
  protected readonly devOrigin = isDevFrontOrigin(this.origin);
  protected readonly connect = connectBase(this.origin);
  protected readonly connectEndpoints = CONNECT_ENDPOINTS;
  protected readonly connectEvents = CONNECT_EVENTS;
  protected readonly connectCurl = connectCurlExample(this.connect);

  private readonly admin = computed(() => this.tenant.isAdmin() && !!this.tenant.currentId());
  readonly tokens = httpResource<ApiTokenList>(() => (this.admin() ? API.apiTokens : undefined));
  readonly hooks = httpResource<WebhookList>(() => (this.admin() ? API.webhooks : undefined));

  protected readonly tokenList = computed(() => (this.tokens.hasValue() ? this.tokens.value().data : []));
  protected readonly scopeList = computed(() =>
    Object.entries(this.tokens.hasValue() ? this.tokens.value().scopes : {}).map(([key, label]) => ({ key, label })),
  );
  protected readonly hookList = computed(() => (this.hooks.hasValue() ? this.hooks.value().data : []));
  private readonly eventLabels = computed(() => (this.hooks.hasValue() ? this.hooks.value().events : {}));
  protected readonly eventList = computed(() => Object.entries(this.eventLabels()).map(([key, label]) => ({ key, label })));

  /* Tokens */
  readonly tokenForm = signal(false);
  readonly tokenName = signal('');
  readonly tokenScopes = signal<string[]>([]);
  readonly tokenExpiry = signal<number | null>(null);
  readonly tokenErrors = signal<FieldErrors>({});
  readonly creatingToken = signal(false);
  readonly createdToken = signal<string | null>(null);
  readonly confirmRevoke = signal<string | null>(null);

  /* Webhooks */
  readonly hookDraft = signal<WebhookDraft | null>(null);
  readonly hookErrors = signal<FieldErrors>({});
  readonly savingHook = signal(false);
  readonly shownSecret = signal<string | null>(null);
  readonly openDeliveries = signal<string | null>(null);
  readonly deliveries = signal<WebhookDelivery[] | null>(null);
  readonly confirm = signal<string | null>(null);
  readonly busy = signal<string | null>(null);

  protected eventsLabel(w: WebhookEndpoint): string {
    return eventsText(w.events, this.eventLabels());
  }

  openTokenForm(): void {
    this.tokenName.set('');
    this.tokenScopes.set([]);
    this.tokenExpiry.set(null);
    this.tokenErrors.set({});
    this.tokenForm.set(true);
  }

  toggleScope(scope: string): void {
    this.tokenScopes.update((list) => (list.includes(scope) ? list.filter((s) => s !== scope) : [...list, scope]));
  }

  async createToken(): Promise<void> {
    const errors: FieldErrors = {};
    if (this.tokenName().trim().length < 2) errors['name'] = 'Dê um nome ao token.';
    if (this.tokenScopes().length === 0) errors['scopes'] = 'Escolha ao menos uma permissão.';
    if (Object.keys(errors).length) {
      this.tokenErrors.set(errors);
      return;
    }
    this.creatingToken.set(true);
    const body: ApiTokenBody = { name: this.tokenName().trim(), scopes: this.tokenScopes(), expires_in_days: this.tokenExpiry() };
    try {
      const res = await firstValueFrom(this.http.post<ApiTokenCreated>(API.apiTokens, body));
      this.createdToken.set(res.token);
      this.tokenForm.set(false);
      this.tokens.update((current) => (current ? { ...current, data: [res.data, ...current.data] } : current));
    } catch (error) {
      this.fail(error, 'Não foi possível criar o token', (f) => this.tokenErrors.set(f));
    } finally {
      this.creatingToken.set(false);
    }
  }

  async revoke(t: ApiToken): Promise<void> {
    this.busy.set(t.id);
    try {
      await firstValueFrom(this.http.delete(API.apiToken(t.id)));
      this.confirmRevoke.set(null);
      this.tokens.reload();
      this.toast.success('Token revogado');
    } catch (error) {
      this.fail(error, 'Não foi possível revogar o token');
    } finally {
      this.busy.set(null);
    }
  }

  openHook(w: WebhookEndpoint | null): void {
    this.hookErrors.set({});
    this.hookDraft.set(
      w
        ? { id: w.id, url: w.url, description: w.description ?? '', events: [...w.events], active: w.active }
        : { id: null, url: '', description: '', events: ['*'], active: true },
    );
  }

  protected patchHook(change: Partial<WebhookDraft>): void {
    this.hookDraft.update((d) => (d ? { ...d, ...change } : d));
  }

  /** "Todos os eventos" é exclusivo; escolher eventos específicos o desmarca. */
  toggleEvent(event: string): void {
    this.hookDraft.update((d) => {
      if (!d) return d;
      if (event === '*') return { ...d, events: d.events.includes('*') ? [] : ['*'] };
      const specific = d.events.filter((e) => e !== '*');
      return { ...d, events: specific.includes(event) ? specific.filter((e) => e !== event) : [...specific, event] };
    });
  }

  async saveHook(): Promise<void> {
    const d = this.hookDraft();
    if (!d) return;
    const errors: FieldErrors = {};
    if (!/^https?:\/\/\S+$/i.test(d.url.trim())) errors['url'] = 'Informe a URL completa, começando com https://.';
    if (d.events.length === 0) errors['events'] = 'Escolha ao menos um evento.';
    if (Object.keys(errors).length) {
      this.hookErrors.set(errors);
      return;
    }
    this.savingHook.set(true);
    const body: WebhookBody = { url: d.url.trim(), description: d.description.trim() || null, events: d.events, active: d.active };
    try {
      if (d.id) {
        await firstValueFrom(this.http.put<ApiEnvelope<WebhookEndpoint>>(API.webhook(d.id), body));
        this.toast.success('Webhook atualizado');
      } else {
        const res = await firstValueFrom(this.http.post<WebhookSecretResponse>(API.webhooks, body));
        this.shownSecret.set(res.secret);
      }
      this.hookDraft.set(null);
      this.hooks.reload();
    } catch (error) {
      this.fail(error, 'Não foi possível salvar o webhook', (f) => this.hookErrors.set(f));
    } finally {
      this.savingHook.set(false);
    }
  }

  async toggleActive(w: WebhookEndpoint): Promise<void> {
    const active = !(w.active && !w.disabled_at);
    try {
      await firstValueFrom(this.http.put(API.webhook(w.id), { url: w.url, description: w.description, events: w.events, active }));
      this.hooks.reload();
      this.toast.success(active ? 'Webhook ativado' : 'Webhook pausado');
    } catch (error) {
      this.fail(error, 'Não foi possível mudar o webhook');
    }
  }

  async test(w: WebhookEndpoint): Promise<void> {
    this.busy.set('test:' + w.id);
    try {
      await firstValueFrom(this.http.post(API.webhookTest(w.id), {}));
      this.toast.success('Teste enviado', { message: 'Confira em "Entregas" em alguns segundos.' });
      if (this.openDeliveries() === w.id) await this.loadDeliveries(w.id);
    } catch (error) {
      this.fail(error, 'Não foi possível enviar o teste');
    } finally {
      this.busy.set(null);
    }
  }

  async rotate(w: WebhookEndpoint): Promise<void> {
    this.busy.set('rotate:' + w.id);
    try {
      const res = await firstValueFrom(this.http.post<WebhookSecretResponse>(API.webhookRotate(w.id), {}));
      this.shownSecret.set(res.secret);
      this.confirm.set(null);
    } catch (error) {
      this.fail(error, 'Não foi possível gerar um novo segredo');
    } finally {
      this.busy.set(null);
    }
  }

  async removeHook(w: WebhookEndpoint): Promise<void> {
    this.busy.set('remove:' + w.id);
    try {
      await firstValueFrom(this.http.delete(API.webhook(w.id)));
      this.confirm.set(null);
      this.hooks.reload();
    } catch (error) {
      this.fail(error, 'Não foi possível remover o webhook');
    } finally {
      this.busy.set(null);
    }
  }

  async toggleDeliveries(w: WebhookEndpoint): Promise<void> {
    if (this.openDeliveries() === w.id) {
      this.openDeliveries.set(null);
      return;
    }
    this.openDeliveries.set(w.id);
    await this.loadDeliveries(w.id);
  }

  private async loadDeliveries(id: string): Promise<void> {
    this.deliveries.set(null);
    try {
      const res = await firstValueFrom(this.http.get<ApiEnvelope<WebhookDelivery[]>>(API.webhookDeliveries(id)));
      if (this.openDeliveries() === id) this.deliveries.set(res.data);
    } catch {
      this.deliveries.set([]);
    }
  }

  /** A CLI fala direto com a API: no ambiente local, a porta da API (8000), não a do front. */
  private devOriginOrApi(): string {
    return isDevFrontOrigin(this.origin) ? 'http://localhost:8000' : this.origin;
  }

  protected async copy(text: string): Promise<void> {
    if (await copyText(text)) this.toast.success('Copiado');
    else this.toast.info('Não foi possível copiar', { message: 'Selecione o texto e copie manualmente.' });
  }

  private fail(error: unknown, title: string, onFields?: (fields: FieldErrors) => void): void {
    const fields = extractFieldErrors(error);
    if (fields && onFields) {
      onFields(fields);
      return;
    }
    const status = error instanceof HttpErrorResponse ? error.status : null;
    if (status !== 403 && status !== 0 && (status ?? 500) < 500) this.toast.error(title);
  }
}
