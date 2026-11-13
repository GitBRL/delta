import { HttpClient, HttpErrorResponse, httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { LucideArrowDown, LucideArrowUp, LucideCopy, LucideExternalLink, LucideTriangleAlert, LucideX } from '@lucide/angular';
import { DsButton, DsGlassCard, DsSkeleton, DsToastService } from 'design-system';
import { firstValueFrom } from 'rxjs';
import {
  API,
  ApiEnvelope,
  MediaAsset,
  Post,
  PostApprovalResponse,
  PostTargetBody,
  PostUpdateResponse,
  Project,
  PublishNetwork,
  PublishingNetworks,
  TENANT_HEADER,
} from '../../core/api/api.types';
import { FieldErrors, extractFieldErrors, validationMessage } from '../../core/forms/server-errors';
import { pollWhile } from '../../core/polling/poll-while';
import { HasUnsavedChanges } from '../../core/reports/unsaved-changes.guard';
import { TenantService } from '../../core/tenant/tenant.service';
import { ProviderIcon } from '../integrations/provider-icon';
import { copyText } from '../settings/settings';
import { MediaLibrary } from './media-library';
import { PostPreview } from './post-preview';
import {
  POST_LIMITS,
  PostDraft,
  STATUS_TEXT,
  TARGET_STATUS_TEXT,
  WHATSAPP_WINDOW_HINT,
  captionInfo,
  draftChanged,
  emptyPostDraft,
  fieldMessages,
  formatDateTime,
  formatLongDateTime,
  formatText,
  fromLocalInput,
  moveItem,
  notifiedText,
  postActions,
  postBody,
  postDraftFrom,
  scheduleHint,
  statusTone,
  toLocalInput,
  validatePostDraft,
} from './publishing';

/** Enquanto o post está publicando, a tela acompanha a cada 5 s. */
export const POST_POLL_MS = 5_000;

type LoadState = 'loading' | 'ready' | 'missing' | 'error';

/**
 * Editor do post (ADR 0028): conteúdo, mídia, destinos por rede, aprovação do cliente por link,
 * agendamento e publicação. A equipe edita; o cliente vê o post (só leitura).
 * Rotas: /publicacoes/novo (?projeto=) e /publicacoes/:id
 */
@Component({
  selector: 'app-post-editor-page',
  imports: [
    RouterLink,
    DsButton,
    DsGlassCard,
    DsSkeleton,
    ProviderIcon,
    MediaLibrary,
    PostPreview,
    LucideArrowDown,
    LucideArrowUp,
    LucideCopy,
    LucideExternalLink,
    LucideTriangleAlert,
    LucideX,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="back text-footnote" routerLink="/publicacoes">← Publicações</a>

    @switch (state()) {
      @case ('loading') {
        <ds-glass-card padding="lg" aria-busy="true"><ds-skeleton width="50%" /><ds-skeleton width="80%" /></ds-glass-card>
      }
      @case ('missing') {
        <ds-glass-card padding="lg" role="alert">
          <p class="m-0 text-headline">Post não encontrado</p>
          <p class="m-0 mt-2 text-footnote text-fg-muted">Ele pode ter sido excluído.</p>
        </ds-glass-card>
      }
      @case ('error') {
        <ds-glass-card padding="lg" role="alert">
          <p class="m-0">Não foi possível carregar o post.</p>
          <button ds-button variant="secondary" size="sm" class="mt-3" (click)="load()">Tentar de novo</button>
        </ds-glass-card>
      }
      @default {
        @let d = draft();
        @let p = post();
        <header class="head">
          <div class="min-w-0 flex-1">
            <h1 class="m-0 text-title-1 font-bold tracking-tight">{{ p ? p.title || 'Post sem título' : 'Novo post' }}</h1>
            @if (p) {
              <p class="m-0 mt-1 text-footnote text-fg-muted">
                {{ p.project.name ?? 'Projeto' }}
                @if (p.scheduled_at) {
                  · {{ p.status === 'in_review' ? 'data guardada para' : 'agendado para' }} {{ longDate(p.scheduled_at) }}
                }
                @if (p.published_at) {
                  · publicado {{ dateTime(p.published_at) }}
                }
              </p>
            }
          </div>
          @if (p) {
            <span class="status" [attr.data-tone]="tone(p.status)" role="status" data-testid="post-status">{{ statusText[p.status] }}</span>
          }
        </header>

        @if (approvalReset()) {
          <p class="notice" role="alert" data-testid="approval-reset">
            <svg lucideTriangleAlert [size]="16" aria-hidden="true"></svg>
            O conteúdo mudou depois de pedir a aprovação: a aprovação anterior não vale mais e o post voltou a rascunho. Peça a aprovação de novo.
          </p>
        }

        @if (problems().length > 0) {
          <div class="problems" role="alert" data-testid="problems">
            <strong class="text-subhead">O que falta para aprovar, agendar ou publicar</strong>
            <ul>
              @for (problem of problems(); track problem) {
                <li class="text-footnote">{{ problem }}</li>
              }
            </ul>
          </div>
        }

        <div class="layout">
          <div class="col">
            <!-- Conteúdo -->
            <ds-glass-card padding="lg">
              <h2 class="m-0 text-headline">Conteúdo</h2>
              <div class="form">
                @if (!d.id && canEdit()) {
                  <label class="field">
                    <span class="label">Projeto</span>
                    <select name="project_id" [value]="d.project_id" (change)="setProject($any($event.target).value)" data-testid="project-select">
                      <option value="">Escolha…</option>
                      @for (pr of projectList(); track pr.id) {
                        <option [value]="pr.id" [selected]="pr.id === d.project_id">{{ pr.name }}</option>
                      }
                    </select>
                    @if (errors()['project_id']) {
                      <small class="error" role="alert">{{ errors()['project_id'] }}</small>
                    }
                  </label>
                }

                <label class="field">
                  <span class="label">Título (interno; no YouTube vira o título do vídeo)</span>
                  <input
                    type="text"
                    name="title"
                    [maxLength]="limits.titleMax"
                    [value]="d.title"
                    [readOnly]="!canEdit()"
                    (input)="patch({ title: $any($event.target).value })"
                  />
                  @if (errors()['title']) {
                    <small class="error" role="alert">{{ errors()['title'] }}</small>
                  }
                </label>

                <label class="field">
                  <span class="label">Legenda</span>
                  <textarea
                    name="caption"
                    rows="6"
                    [value]="d.caption"
                    [readOnly]="!canEdit()"
                    (input)="patch({ caption: $any($event.target).value })"
                    aria-describedby="caption-counter"
                  ></textarea>
                  @let info = caption();
                  <small id="caption-counter" class="counter" data-testid="caption-counter" [class.over]="info.over || info.hashtagsOver" aria-live="polite">
                    {{ info.length }}{{ info.max !== null ? ' / ' + info.max : '' }} caracteres{{ info.limitedBy ? ' (limite do ' + info.limitedBy + ')' : '' }}
                    @if (info.hashtagMax !== null) {
                      · {{ info.hashtags }} / {{ info.hashtagMax }} hashtags
                    }
                  </small>
                  @if (errors()['caption']) {
                    <small class="error" role="alert">{{ errors()['caption'] }}</small>
                  }
                </label>

                @if (canEdit()) {
                  <label class="toggle">
                    <input type="checkbox" name="requires_approval" [checked]="d.requires_approval" (change)="patch({ requires_approval: $any($event.target).checked })" />
                    <span>
                      <strong class="text-subhead">Exige aprovação do cliente</strong>
                      <small class="block text-caption text-fg-muted">Desligue para conteúdo interno: o post pode ser agendado e publicado direto.</small>
                    </span>
                  </label>
                } @else {
                  <p class="m-0 text-footnote text-fg-muted">{{ d.requires_approval ? 'Exige aprovação do cliente.' : 'Não exige aprovação do cliente.' }}</p>
                }
              </div>
            </ds-glass-card>

            <!-- Mídia -->
            <ds-glass-card padding="lg">
              <div class="section-head">
                <h2 class="m-0 text-headline">Mídia <span class="text-footnote text-fg-muted">({{ d.media.length }}/{{ limits.mediaMax }})</span></h2>
                @if (canEdit()) {
                  <button ds-button size="sm" variant="secondary" (click)="libraryOpen.set(!libraryOpen())" [attr.aria-expanded]="libraryOpen()" [disabled]="!d.project_id">
                    {{ libraryOpen() ? 'Fechar biblioteca' : 'Escolher da biblioteca' }}
                  </button>
                }
              </div>
              @if (!d.project_id && canEdit()) {
                <p class="m-0 mt-2 text-footnote text-fg-muted">Escolha o projeto para usar a biblioteca de mídia.</p>
              }
              @if (d.media.length === 0) {
                <p class="m-0 mt-3 text-footnote text-fg-muted">Nenhuma mídia no post.</p>
              } @else {
                <ol class="chosen" aria-label="Mídias do post, na ordem">
                  @for (m of d.media; track m.id; let i = $index) {
                    <li [attr.data-chosen]="m.id">
                      <span class="order text-caption" aria-hidden="true">{{ i + 1 }}</span>
                      <span class="mini">
                        @if (m.kind === 'image') {
                          <img [src]="m.url" [alt]="m.original_name" />
                        } @else {
                          <video [src]="m.url" muted preload="metadata" [attr.aria-label]="'Vídeo ' + m.original_name"></video>
                        }
                      </span>
                      <span class="min-w-0 flex-1 truncate text-footnote">{{ m.original_name }}</span>
                      @if (canEdit()) {
                        <button class="icon-btn" type="button" (click)="moveMedia(i, -1)" [disabled]="i === 0" [attr.aria-label]="'Mover ' + m.original_name + ' para cima'">
                          <svg lucideArrowUp [size]="14"></svg>
                        </button>
                        <button class="icon-btn" type="button" (click)="moveMedia(i, 1)" [disabled]="i === d.media.length - 1" [attr.aria-label]="'Mover ' + m.original_name + ' para baixo'">
                          <svg lucideArrowDown [size]="14"></svg>
                        </button>
                        <button class="icon-btn" type="button" (click)="removeMedia(i)" [attr.aria-label]="'Tirar ' + m.original_name + ' do post'">
                          <svg lucideX [size]="14"></svg>
                        </button>
                      }
                    </li>
                  }
                </ol>
              }
              @if (errors()['media']) {
                <small class="error" role="alert">{{ errors()['media'] }}</small>
              }
              @if (libraryOpen() && canEdit() && d.project_id) {
                <div class="library" data-testid="library">
                  <app-media-library
                    [projectId]="d.project_id"
                    [selectable]="true"
                    [canManage]="true"
                    [selectedIds]="mediaIds()"
                    [full]="d.media.length >= limits.mediaMax"
                    (picked)="addMedia($event)"
                  />
                </div>
              }
            </ds-glass-card>

            <!-- Destinos -->
            <ds-glass-card padding="lg">
              <div class="section-head">
                <h2 class="m-0 text-headline">Onde publicar</h2>
                @if (canEdit()) {
                  <button ds-button size="sm" variant="secondary" (click)="addTarget()" [disabled]="!d.project_id || d.targets.length >= limits.targetsMax || !networks.hasValue()">
                    Adicionar rede
                  </button>
                }
              </div>
              @if (canEdit() && d.project_id && networks.hasValue() && accountsList().length === 0) {
                <p class="m-0 mt-2 text-footnote text-fg-muted" data-testid="no-accounts">
                  Nenhum perfil do Instagram, página do Facebook ou canal do YouTube ligado a este projeto.
                  <a [routerLink]="['/projetos', d.project_id]">Ligue as contas no projeto</a>.
                </p>
              }
              @if (d.targets.length === 0) {
                <p class="m-0 mt-3 text-footnote text-fg-muted">Nenhuma rede escolhida.</p>
              } @else {
                <ul class="targets" aria-label="Redes do post">
                  @for (t of d.targets; track $index; let i = $index) {
                    @let saved = savedTarget(i);
                    <li class="target" [attr.data-target]="i">
                      <div class="target-row">
                        <app-provider-icon [provider]="t.network" [size]="18" />
                        @if (canEdit()) {
                          <label class="mini-field">
                            <span class="ds-visually-hidden">Rede</span>
                            <select [value]="t.network" (change)="setTargetNetwork(i, $any($event.target).value)" [attr.aria-label]="'Rede do destino ' + (i + 1)">
                              @for (n of networkSpecs(); track n.key) {
                                <option [value]="n.key" [selected]="n.key === t.network">{{ n.label }}</option>
                              }
                            </select>
                          </label>
                          <label class="mini-field">
                            <span class="ds-visually-hidden">Formato</span>
                            <select [value]="t.format" (change)="patchTarget(i, { format: $any($event.target).value })" [attr.aria-label]="'Formato do destino ' + (i + 1)">
                              @for (f of formatsOf(t.network); track f.key) {
                                <option [value]="f.key" [selected]="f.key === t.format">{{ f.label }}</option>
                              }
                            </select>
                          </label>
                          <label class="mini-field grow">
                            <span class="ds-visually-hidden">Conta</span>
                            <select [value]="t.account_id ?? ''" (change)="patchTarget(i, { account_id: $any($event.target).value || null })" [attr.aria-label]="'Conta do destino ' + (i + 1)">
                              <option value="">Escolha a conta…</option>
                              @for (a of accountsOf(t.network); track a.id) {
                                <option [value]="a.id" [selected]="a.id === t.account_id">{{ a.name }}{{ a.mode === 'sandbox' ? ' (demonstração)' : '' }}</option>
                              }
                            </select>
                          </label>
                          <button class="icon-btn" type="button" (click)="removeTarget(i)" [attr.aria-label]="'Remover o destino ' + (i + 1)">
                            <svg lucideX [size]="14"></svg>
                          </button>
                        } @else {
                          <span class="text-subhead">{{ networkLabel(t.network) }} · {{ formatLabel(t.format) }}</span>
                          <span class="text-footnote text-fg-muted">{{ saved?.account?.name ?? '' }}</span>
                        }
                      </div>
                      @if (accountMode(t.account_id) === 'sandbox') {
                        <small class="text-caption text-fg-muted" data-testid="sandbox-note">Conta em demonstração: a publicação é simulada, nada sai na rede.</small>
                      }
                      @if (errors()['targets.' + i + '.account_id'] || errors()['targets.' + i + '.format']) {
                        <small class="error" role="alert">{{ errors()['targets.' + i + '.account_id'] ?? errors()['targets.' + i + '.format'] }}</small>
                      }
                      @if (saved && !dirty()) {
                        <div class="target-status">
                          <span class="pill" [attr.data-status]="saved.status">{{ targetStatusText[saved.status] }}</span>
                          @if (saved.permalink) {
                            <a [href]="saved.permalink" target="_blank" rel="noopener noreferrer" class="text-footnote">
                              Ver na rede <svg lucideExternalLink [size]="12" aria-hidden="true"></svg>
                            </a>
                          }
                          @if (saved.error) {
                            <span class="text-footnote err" role="alert">{{ saved.error }}</span>
                          }
                        </div>
                      }
                    </li>
                  }
                </ul>
              }
              @if (errors()['targets']) {
                <small class="error" role="alert">{{ errors()['targets'] }}</small>
              }
            </ds-glass-card>
          </div>

          <div class="col side">
            <!-- Ações -->
            @if (isStaff() && (canEdit() || p)) {
              <ds-glass-card padding="lg" data-testid="actions">
                <h2 class="m-0 text-headline">Ações</h2>
                <div class="stack mt-3">
                  @if (canEdit()) {
                    <button ds-button [block]="true" (click)="save()" [loading]="saving()" [disabled]="saving() || (!!d.id && !dirty())">
                      {{ d.id ? 'Salvar alterações' : 'Criar post' }}
                    </button>
                  }
                  @if (p && dirty()) {
                    <p class="m-0 text-caption text-fg-muted">Salve as alterações para pedir aprovação, agendar ou publicar.</p>
                  }

                  @if (p && actions(); as a) {
                    @if (a.requestApproval && p.requires_approval) {
                      <div class="box">
                        <label class="check text-footnote">
                          <input type="checkbox" [checked]="notify()" (change)="notify.set($any($event.target).checked)" />
                          Avisar os contatos do projeto (e-mail e WhatsApp)
                        </label>
                        <button ds-button variant="secondary" [block]="true" (click)="requestApproval()" [loading]="busy() === 'approval'" [disabled]="busy() !== null || dirty()">
                          {{ p.status === 'in_review' ? 'Pedir aprovação de novo' : 'Pedir aprovação' }}
                        </button>
                      </div>
                    }

                    @if (a.schedule) {
                      <div class="box">
                        <label class="field">
                          <span class="label">Data e hora da publicação (seu fuso)</span>
                          <input type="datetime-local" name="scheduled_at" [value]="scheduleAt()" (input)="scheduleAt.set($any($event.target).value); scheduleError.set(null)" />
                        </label>
                        @if (hintFor(p); as hint) {
                          <small class="text-caption text-fg-muted">{{ hint }}</small>
                        }
                        @if (scheduleError()) {
                          <small class="error" role="alert">{{ scheduleError() }}</small>
                        }
                        <button ds-button variant="secondary" [block]="true" (click)="schedule()" [loading]="busy() === 'schedule'" [disabled]="busy() !== null || dirty()">
                          {{ p.status === 'scheduled' ? 'Mudar a data' : 'Agendar' }}
                        </button>
                      </div>
                    }
                    @if (a.unschedule) {
                      <button ds-button variant="ghost" [block]="true" (click)="unschedule()" [loading]="busy() === 'unschedule'" [disabled]="busy() !== null">Desagendar</button>
                    }
                    @if (a.publishNow) {
                      @if (confirm() === 'publish') {
                        <p class="m-0 text-footnote">Publicar agora em {{ p.targets.length }} {{ p.targets.length === 1 ? 'rede' : 'redes' }}?</p>
                        <div class="row">
                          <button ds-button variant="ghost" size="sm" (click)="confirm.set(null)">Cancelar</button>
                          <button ds-button size="sm" (click)="publishNow()" [loading]="busy() === 'publish'">Publicar</button>
                        </div>
                      } @else {
                        <button ds-button variant="secondary" [block]="true" (click)="confirm.set('publish')" [disabled]="busy() !== null || dirty()">Publicar agora</button>
                      }
                    }
                    @if (a.cancel) {
                      @if (confirm() === 'cancel') {
                        <p class="m-0 text-footnote">Cancelar o post? Ele sai da agenda e o link de aprovação deixa de valer.</p>
                        <div class="row">
                          <button ds-button variant="ghost" size="sm" (click)="confirm.set(null)">Voltar</button>
                          <button ds-button variant="destructive" size="sm" (click)="cancelPost()" [loading]="busy() === 'cancel'">Cancelar post</button>
                        </div>
                      } @else {
                        <button ds-button variant="ghost" [block]="true" (click)="confirm.set('cancel')" [disabled]="busy() !== null">Cancelar post</button>
                      }
                    }
                    @if (a.remove) {
                      @if (confirm() === 'remove') {
                        <p class="m-0 text-footnote">Excluir o post de vez?</p>
                        <div class="row">
                          <button ds-button variant="ghost" size="sm" (click)="confirm.set(null)">Voltar</button>
                          <button ds-button variant="destructive" size="sm" (click)="remove()" [loading]="busy() === 'remove'">Excluir</button>
                        </div>
                      } @else {
                        <button ds-button variant="ghost" [block]="true" (click)="confirm.set('remove')" [disabled]="busy() !== null">Excluir</button>
                      }
                    }
                  }
                </div>
              </ds-glass-card>
            }

            <!-- Aprovação -->
            @if (approvalLink(); as link) {
              <ds-glass-card padding="lg" data-testid="approval">
                <h2 class="m-0 text-headline">Aprovação do cliente</h2>
                @let ap = p?.approval;
                @if (ap?.decision === 'approved') {
                  <p class="m-0 mt-2 text-subhead decision ok">Aprovado{{ ap?.decided_by_name ? ' por ' + ap?.decided_by_name : '' }} em {{ dateTime(ap?.decided_at ?? null) }}.</p>
                } @else if (ap?.decision === 'changes_requested') {
                  <p class="m-0 mt-2 text-subhead decision warn">Ajustes pedidos{{ ap?.decided_by_name ? ' por ' + ap?.decided_by_name : '' }} em {{ dateTime(ap?.decided_at ?? null) }}:</p>
                  <blockquote class="comment text-footnote">{{ ap?.comment }}</blockquote>
                } @else if (ap && !ap.active) {
                  <p class="m-0 mt-2 text-footnote text-fg-muted">Este link expirou ou foi substituído. Peça a aprovação de novo.</p>
                } @else {
                  <p class="m-0 mt-2 text-footnote text-fg-muted">Aguardando o cliente. O link vale até {{ dateTime(ap?.expires_at ?? null) }}.</p>
                }

                @if (ap?.active || approvalResult()) {
                  <div class="copy mt-3">
                    <label class="ds-visually-hidden" for="approval-link">Link de aprovação</label>
                    <input id="approval-link" type="text" readonly [value]="link" (focus)="$any($event.target).select()" />
                    <button ds-button size="sm" variant="secondary" (click)="copy(link)" aria-label="Copiar o link de aprovação">
                      <svg lucideCopy [size]="14"></svg> Copiar
                    </button>
                  </div>
                  @if (approvalResult(); as r) {
                    <p class="m-0 mt-2 text-footnote" role="status" data-testid="notified">{{ notifiedText(r.notified) }}</p>
                    @if (r.notified.whatsapp === 0) {
                      <p class="m-0 mt-1 text-caption text-fg-muted">{{ whatsappHint }}</p>
                    }
                  }
                }
              </ds-glass-card>
            }

            <!-- Prévia -->
            <ds-glass-card padding="lg">
              <h2 class="m-0 text-headline">Prévia</h2>
              @if (d.targets.length > 1) {
                <div class="tabs mt-3" role="tablist" aria-label="Prévia por rede">
                  @for (t of d.targets; track $index; let i = $index) {
                    <button type="button" role="tab" class="tab" [class.on]="previewIndex() === i" [attr.aria-selected]="previewIndex() === i" (click)="previewIndex.set(i)">
                      {{ networkLabel(t.network) }} · {{ formatLabel(t.format) }}
                    </button>
                  }
                </div>
              }
              <div class="preview mt-3">
                @if (previewTarget(); as t) {
                  <app-post-preview
                    [network]="t.network"
                    [format]="t.format"
                    [media]="d.media"
                    [caption]="d.caption"
                    [title]="d.title || null"
                    [account]="accountName(t.account_id)"
                  />
                } @else {
                  <p class="m-0 text-footnote text-fg-muted">Escolha uma rede para ver a prévia.</p>
                }
              </div>
            </ds-glass-card>
          </div>
        </div>
      }
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-5);
    }
    .back {
      color: var(--ds-accent);
      text-decoration: none;
    }
    .head {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      gap: var(--ds-space-3);
    }
    .status,
    .pill {
      flex: none;
      padding: 2px 10px;
      border-radius: var(--ds-radius-full);
      background: var(--ds-fill);
      color: var(--ds-text-secondary);
      font: var(--ds-text-caption);
      font-weight: 600;
    }
    .status[data-tone='accent'],
    .pill[data-status='publishing'] {
      background: color-mix(in oklch, var(--ds-accent) 14%, transparent);
      color: var(--ds-accent);
    }
    .status[data-tone='attention'] {
      background: color-mix(in oklch, var(--ds-status-attention) 18%, transparent);
      color: var(--ds-status-attention);
    }
    .status[data-tone='healthy'],
    .pill[data-status='published'] {
      background: color-mix(in oklch, var(--ds-status-healthy) 16%, transparent);
      color: var(--ds-status-healthy);
    }
    .status[data-tone='critical'],
    .pill[data-status='failed'] {
      background: color-mix(in oklch, var(--ds-status-critical) 14%, transparent);
      color: var(--ds-status-critical);
    }
    .status[data-tone='muted'] {
      opacity: 0.7;
    }
    .notice,
    .problems {
      display: flex;
      gap: var(--ds-space-2);
      margin: 0;
      padding: var(--ds-space-3) var(--ds-space-4);
      border-radius: var(--ds-radius-lg);
      background: color-mix(in oklch, var(--ds-status-attention) 14%, transparent);
      font: var(--ds-text-footnote);
    }
    .problems {
      flex-direction: column;
    }
    .problems ul {
      margin: 0;
      padding-left: 1.2em;
    }
    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: var(--ds-space-5);
    }
    @media (min-width: 1024px) {
      .layout {
        grid-template-columns: minmax(0, 1.6fr) minmax(280px, 1fr);
        align-items: start;
      }
    }
    .col {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-5);
      min-width: 0;
    }
    .form,
    .stack {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-4);
    }
    .form {
      margin-top: var(--ds-space-4);
    }
    .stack {
      gap: var(--ds-space-3);
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-2);
    }
    .label {
      font: var(--ds-text-footnote);
      font-weight: 600;
      color: var(--ds-text-secondary);
    }
    input[type='text'],
    input[type='datetime-local'],
    select,
    textarea {
      width: 100%;
      min-height: 40px;
      padding: 8px 10px;
      border: 1px solid var(--ds-separator);
      border-radius: var(--ds-radius-md);
      background: var(--ds-bg-elevated);
      color: var(--ds-text);
      font: var(--ds-text-subhead);
    }
    textarea {
      resize: vertical;
      line-height: 1.45;
    }
    .counter {
      font: var(--ds-text-caption);
      color: var(--ds-text-tertiary);
    }
    .counter.over,
    .error,
    .err {
      color: var(--ds-status-critical);
    }
    .error {
      font: var(--ds-text-caption);
    }
    .toggle,
    .check {
      display: flex;
      align-items: flex-start;
      gap: var(--ds-space-2);
    }
    .toggle input,
    .check input {
      margin-top: 3px;
    }
    .section-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--ds-space-2);
    }
    .chosen,
    .targets {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-2);
      margin: var(--ds-space-3) 0 0;
      padding: 0;
      list-style: none;
    }
    .chosen li {
      display: flex;
      align-items: center;
      gap: var(--ds-space-2);
    }
    .order {
      width: 20px;
      text-align: center;
      color: var(--ds-text-tertiary);
    }
    .mini {
      width: 48px;
      height: 48px;
      flex: none;
      overflow: hidden;
      border-radius: var(--ds-radius-md);
      background: var(--ds-fill);
    }
    .mini img,
    .mini video {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .icon-btn {
      display: inline-grid;
      place-items: center;
      width: 32px;
      height: 32px;
      flex: none;
      border: 1px solid var(--ds-separator);
      border-radius: var(--ds-radius-md);
      background: transparent;
      color: var(--ds-text);
      cursor: pointer;
    }
    .icon-btn:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .library {
      margin-top: var(--ds-space-4);
      padding-top: var(--ds-space-4);
      border-top: 1px solid var(--ds-separator);
    }
    .target {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: var(--ds-space-3);
      border: 1px solid var(--ds-separator);
      border-radius: var(--ds-radius-md);
    }
    .target-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--ds-space-2);
    }
    .mini-field {
      min-width: 130px;
    }
    .mini-field.grow {
      flex: 1;
    }
    .target-status,
    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--ds-space-2);
    }
    .box {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-2);
      padding: var(--ds-space-3);
      border-radius: var(--ds-radius-md);
      background: var(--ds-fill);
    }
    .decision.ok {
      color: var(--ds-status-healthy);
    }
    .decision.warn {
      color: var(--ds-status-attention);
    }
    .comment {
      margin: var(--ds-space-2) 0 0;
      padding: var(--ds-space-2) var(--ds-space-3);
      border-left: 3px solid var(--ds-status-attention);
      white-space: pre-wrap;
    }
    .copy {
      display: flex;
      gap: var(--ds-space-2);
    }
    .tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .tab {
      padding: 4px 10px;
      border: 1px solid var(--ds-separator);
      border-radius: var(--ds-radius-full);
      background: transparent;
      color: var(--ds-text);
      font: var(--ds-text-caption);
      cursor: pointer;
    }
    .tab.on {
      border-color: var(--ds-accent);
      color: var(--ds-accent);
      font-weight: 600;
    }
    .preview {
      display: flex;
      justify-content: center;
    }
  `,
})
export class PostEditorPage implements OnInit, HasUnsavedChanges {
  /** Parâmetro da rota (/publicacoes/:id); vazio em /publicacoes/novo. */
  readonly id = input<string | undefined>(undefined);
  /** ?projeto= ao criar a partir do projeto. */
  readonly projeto = input<string | undefined>(undefined);

  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly toast = inject(DsToastService);
  private readonly tenant = inject(TenantService);

  protected readonly limits = POST_LIMITS;
  protected readonly statusText = STATUS_TEXT;
  protected readonly targetStatusText = TARGET_STATUS_TEXT;
  protected readonly tone = statusTone;
  protected readonly dateTime = formatDateTime;
  protected readonly longDate = formatLongDateTime;
  protected readonly formatLabel = formatText;
  protected readonly notifiedText = notifiedText;
  protected readonly whatsappHint = WHATSAPP_WINDOW_HINT;
  protected readonly hintFor = scheduleHint;

  readonly state = signal<LoadState>('loading');
  readonly post = signal<Post | null>(null);
  readonly draft = signal<PostDraft>(emptyPostDraft());
  private readonly baseline = signal<PostDraft>(emptyPostDraft());
  readonly errors = signal<FieldErrors>({});
  readonly serverProblems = signal<string[]>([]);
  readonly saving = signal(false);
  readonly busy = signal<string | null>(null);
  readonly confirm = signal<string | null>(null);
  readonly notify = signal(true);
  readonly scheduleAt = signal('');
  readonly scheduleError = signal<string | null>(null);
  readonly approvalResult = signal<PostApprovalResponse['meta'] | null>(null);
  readonly approvalReset = signal(false);
  readonly libraryOpen = signal(false);
  readonly previewIndex = signal(0);

  protected readonly isStaff = computed(() => !!this.tenant.current() && this.tenant.current()?.role !== 'client');
  protected readonly actions = computed(() => {
    const p = this.post();
    return p ? postActions(p) : null;
  });
  /** A equipe edita posts novos e os que ainda podem mudar; o cliente só lê. */
  protected readonly canEdit = computed(() => this.isStaff() && (this.post() === null || (this.actions()?.edit ?? false)));
  protected readonly dirty = computed(() => draftChanged(this.draft(), this.baseline()));

  private readonly staffRequest = (url: string, params: Record<string, string> = {}) => {
    const tenantId = this.tenant.currentId();
    return tenantId ? { url, params, headers: { [TENANT_HEADER]: tenantId } } : undefined;
  };

  /* Dependências primitivas: editar o texto não refaz as buscas abaixo. */
  private readonly isNewPost = computed(() => this.draft().id === null);
  private readonly draftProjectId = computed(() => this.draft().project_id);

  readonly projects = httpResource<ApiEnvelope<Project[]>>(() =>
    this.isStaff() && this.isNewPost() && this.state() === 'ready' ? this.staffRequest(API.projects) : undefined,
  );
  protected readonly projectList = computed(() => (this.projects.hasValue() ? this.projects.value().data : []));

  readonly networks = httpResource<ApiEnvelope<PublishingNetworks>>(() => {
    const projectId = this.draftProjectId();
    return projectId ? this.staffRequest(API.publishingNetworks, { project_id: projectId }) : undefined;
  });
  protected readonly networkSpecs = computed(() => (this.networks.hasValue() ? this.networks.value().data.networks : []));
  protected readonly accountsList = computed(() => (this.networks.hasValue() ? this.networks.value().data.accounts : []));

  protected readonly caption = computed(() =>
    captionInfo(
      this.draft().caption,
      this.networkSpecs(),
      this.draft().targets.map((t) => t.network),
    ),
  );
  protected readonly mediaIds = computed(() => this.draft().media.map((m) => m.id));
  /** Pendências do servidor (ao salvar ou agir) ou as do post salvo. */
  protected readonly problems = computed(() => (this.serverProblems().length > 0 ? this.serverProblems() : (this.post()?.problems ?? [])));
  protected readonly previewTarget = computed(() => {
    const targets = this.draft().targets;
    return targets[Math.min(this.previewIndex(), targets.length - 1)] ?? null;
  });
  protected readonly approvalLink = computed(() => this.approvalResult()?.link ?? this.post()?.approval?.link ?? null);

  constructor() {
    // Publicando (ou agendado para agora): acompanha até sair o resultado de cada rede.
    pollWhile(
      () => {
        const p = this.post();
        return !!p && (p.status === 'publishing' || (p.status === 'scheduled' && !!p.scheduled_at && new Date(p.scheduled_at).getTime() <= Date.now()));
      },
      () => void this.refresh(),
      POST_POLL_MS,
    );
  }

  ngOnInit(): void {
    void this.load();
  }

  hasUnsavedChanges(): boolean {
    return this.isStaff() && this.state() === 'ready' && this.dirty();
  }

  async load(): Promise<void> {
    const id = this.id();
    if (!id) {
      const start = emptyPostDraft(this.projeto() ?? '');
      this.draft.set(start);
      this.baseline.set(start);
      this.state.set('ready');
      return;
    }
    this.state.set('loading');
    try {
      const res = await firstValueFrom(this.http.get<ApiEnvelope<Post>>(API.post(id)));
      this.apply(res.data);
      this.state.set('ready');
    } catch (error) {
      this.state.set(error instanceof HttpErrorResponse && error.status === 404 ? 'missing' : 'error');
    }
  }

  /** Recarga silenciosa (acompanhamento da publicação). */
  private async refresh(): Promise<void> {
    const p = this.post();
    if (!p || this.busy()) return;
    try {
      const res = await firstValueFrom(this.http.get<ApiEnvelope<Post>>(API.post(p.id)));
      this.apply(res.data, !this.dirty());
    } catch {
      /* segue com o que tem */
    }
  }

  private apply(post: Post, resetDraft = true): void {
    this.post.set(post);
    if (resetDraft) {
      const draft = postDraftFrom(post);
      this.draft.set(draft);
      this.baseline.set(draft);
    }
    this.scheduleAt.set(toLocalInput(post.scheduled_at));
    this.serverProblems.set([]);
  }

  /* ---------- Edição ---------- */

  patch(change: Partial<PostDraft>): void {
    this.draft.update((d) => ({ ...d, ...change }));
  }

  setProject(projectId: string): void {
    // As contas e a mídia são do projeto: trocar o projeto zera os destinos e a mídia.
    this.patch({ project_id: projectId, targets: [], media: [] });
    this.libraryOpen.set(false);
  }

  addMedia(media: MediaAsset): void {
    const d = this.draft();
    if (d.media.some((m) => m.id === media.id) || d.media.length >= POST_LIMITS.mediaMax) return;
    this.patch({ media: [...d.media, media] });
  }

  moveMedia(index: number, delta: -1 | 1): void {
    this.patch({ media: moveItem(this.draft().media, index, delta) });
  }

  removeMedia(index: number): void {
    this.patch({ media: this.draft().media.filter((_, i) => i !== index) });
  }

  protected formatsOf(network: PublishNetwork) {
    return this.networkSpecs().find((n) => n.key === network)?.formats ?? [];
  }

  protected accountsOf(network: PublishNetwork) {
    return this.accountsList().filter((a) => a.network === network);
  }

  protected networkLabel(network: PublishNetwork): string {
    return this.networkSpecs().find((n) => n.key === network)?.label ?? network;
  }

  protected accountMode(accountId: string | null): string | null {
    if (!accountId) return null;
    return this.accountsList().find((a) => a.id === accountId)?.mode ?? this.post()?.targets.find((t) => t.account?.id === accountId)?.account?.mode ?? null;
  }

  protected accountName(accountId: string | null): string | null {
    if (!accountId) return null;
    return this.accountsList().find((a) => a.id === accountId)?.name ?? this.post()?.targets.find((t) => t.account?.id === accountId)?.account?.name ?? null;
  }

  /** Destino salvo na mesma posição (para status, permalink e erro). */
  protected savedTarget(index: number) {
    return this.post()?.targets[index] ?? null;
  }

  addTarget(): void {
    const specs = this.networkSpecs();
    const used = new Set(this.draft().targets.map((t) => t.network));
    const spec = specs.find((s) => this.accountsOf(s.key).length > 0 && !used.has(s.key)) ?? specs.find((s) => this.accountsOf(s.key).length > 0) ?? specs[0];
    if (!spec) return;
    const accounts = this.accountsOf(spec.key);
    const target: PostTargetBody = { network: spec.key, format: spec.formats[0]?.key ?? '', account_id: accounts.length === 1 ? accounts[0].id : null };
    this.patch({ targets: [...this.draft().targets, target] });
    this.previewIndex.set(this.draft().targets.length - 1);
  }

  setTargetNetwork(index: number, network: PublishNetwork): void {
    const spec = this.networkSpecs().find((n) => n.key === network);
    const accounts = this.accountsOf(network);
    this.patchTarget(index, { network, format: spec?.formats[0]?.key ?? '', account_id: accounts.length === 1 ? accounts[0].id : null });
  }

  patchTarget(index: number, change: Partial<PostTargetBody>): void {
    this.patch({ targets: this.draft().targets.map((t, i) => (i === index ? { ...t, ...change } : t)) });
  }

  removeTarget(index: number): void {
    this.patch({ targets: this.draft().targets.filter((_, i) => i !== index) });
    this.previewIndex.set(0);
  }

  /* ---------- Salvar ---------- */

  async save(): Promise<boolean> {
    const d = this.draft();
    if (this.saving()) return false;
    const errors = validatePostDraft(d);
    this.errors.set(errors);
    if (Object.keys(errors).length > 0) return false;

    this.saving.set(true);
    try {
      if (d.id === null) {
        const res = await firstValueFrom(this.http.post<ApiEnvelope<Post>>(API.posts, postBody(d)));
        this.apply(res.data);
        this.toast.success('Post criado');
        void this.router.navigate(['/publicacoes', res.data.id], { replaceUrl: true });
      } else {
        const res = await firstValueFrom(this.http.patch<PostUpdateResponse>(API.post(d.id), postBody(d)));
        this.apply(res.data);
        this.approvalResult.set(null);
        if (res.meta?.approval_reset) {
          this.approvalReset.set(true);
          this.toast.info('A aprovação foi invalidada', { message: 'O post voltou a rascunho: peça a aprovação do cliente de novo.' });
        } else {
          this.toast.success('Post salvo');
        }
      }
      this.errors.set({});
      return true;
    } catch (error) {
      this.handleError(error, 'Não foi possível salvar o post');
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  /* ---------- Ações ---------- */

  async requestApproval(): Promise<void> {
    const p = this.post();
    if (!p) return;
    await this.act('approval', async () => {
      const res = await firstValueFrom(this.http.post<PostApprovalResponse>(API.postApproval(p.id), { notify: this.notify() }));
      this.apply(res.data);
      this.approvalResult.set(res.meta);
      this.approvalReset.set(false);
      this.toast.success('Aprovação pedida', { message: 'Copie o link para enviar ao cliente, se precisar.' });
    });
  }

  async schedule(): Promise<void> {
    const p = this.post();
    if (!p) return;
    const at = fromLocalInput(this.scheduleAt());
    if (!at) {
      this.scheduleError.set('Escolha a data e o horário.');
      return;
    }
    if (new Date(at).getTime() <= Date.now()) {
      this.scheduleError.set('Escolha um horário no futuro.');
      return;
    }
    await this.act('schedule', async () => {
      const res = await firstValueFrom(this.http.post<ApiEnvelope<Post>>(API.postSchedule(p.id), { scheduled_at: at }));
      this.apply(res.data);
      this.toast.success(
        res.data.status === 'in_review' ? 'Data guardada' : 'Post agendado',
        res.data.status === 'in_review' ? { message: 'Ele é agendado sozinho quando o cliente aprovar.' } : { message: formatLongDateTime(at) },
      );
    });
  }

  async unschedule(): Promise<void> {
    const p = this.post();
    if (!p) return;
    await this.act('unschedule', async () => {
      const res = await firstValueFrom(this.http.post<ApiEnvelope<Post>>(API.postUnschedule(p.id), {}));
      this.apply(res.data);
      this.toast.success('Post desagendado');
    });
  }

  async publishNow(): Promise<void> {
    const p = this.post();
    if (!p) return;
    await this.act('publish', async () => {
      const res = await firstValueFrom(this.http.post<ApiEnvelope<Post>>(API.postPublish(p.id), {}));
      this.apply(res.data);
      this.confirm.set(null);
      if (res.data.status === 'published') this.toast.success('Publicado');
      else if (res.data.status === 'failed') this.toast.error('O post falhou em alguma rede', { message: 'Veja o erro em cada destino.' });
      else this.toast.info('Publicando…', { message: 'A tela atualiza sozinha.' });
    });
  }

  async cancelPost(): Promise<void> {
    const p = this.post();
    if (!p) return;
    await this.act('cancel', async () => {
      const res = await firstValueFrom(this.http.post<ApiEnvelope<Post>>(API.postCancel(p.id), {}));
      this.apply(res.data);
      this.confirm.set(null);
      this.toast.success('Post cancelado');
    });
  }

  async remove(): Promise<void> {
    const p = this.post();
    if (!p) return;
    await this.act('remove', async () => {
      await firstValueFrom(this.http.delete(API.post(p.id)));
      this.baseline.set(this.draft()); // nada a salvar: sai sem perguntar
      this.toast.success('Post excluído');
      void this.router.navigate(['/publicacoes']);
    });
  }

  async copy(link: string): Promise<void> {
    if (await copyText(link)) this.toast.success('Link copiado');
    else this.toast.error('Não foi possível copiar', { message: 'Selecione o link e copie manualmente.' });
  }

  private async act(key: string, action: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(key);
    this.serverProblems.set([]);
    try {
      await action();
    } catch (error) {
      this.handleError(error, 'Não foi possível concluir');
    } finally {
      this.busy.set(null);
    }
  }

  /** 422: pendências (`errors.post`), data (`errors.scheduled_at`) e campos; o resto vira aviso. */
  private handleError(error: unknown, title: string): void {
    const problems = fieldMessages(error, 'post');
    const scheduled = fieldMessages(error, 'scheduled_at');
    const fields = extractFieldErrors(error);
    if (problems.length > 0) this.serverProblems.set(problems);
    if (scheduled.length > 0) this.scheduleError.set(scheduled[0]);
    if (fields) {
      const rest = Object.fromEntries(Object.entries(fields).filter(([key]) => key !== 'post' && key !== 'scheduled_at'));
      if (Object.keys(rest).length > 0) this.errors.set(rest);
      if (problems.length === 0 && scheduled.length === 0 && Object.keys(rest).length === 0) {
        this.toast.error(title, { message: validationMessage(error) ?? 'Tente de novo em instantes.' });
      }
      return;
    }
    if (!(error instanceof HttpErrorResponse && (error.status === 0 || error.status >= 500 || error.status === 403))) {
      this.toast.error(title, { message: 'Tente de novo em instantes.' });
    }
  }
}
