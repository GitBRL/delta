import { HttpClient, HttpErrorResponse, HttpEventType, httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { LucideFilm, LucideUpload } from '@lucide/angular';
import { DsButton, DsSkeleton, DsToastService } from 'design-system';
import { Subscription, firstValueFrom } from 'rxjs';
import { API, ApiEnvelope, MediaAsset, TENANT_HEADER } from '../../core/api/api.types';
import { extractFieldErrors } from '../../core/forms/server-errors';
import { TenantService } from '../../core/tenant/tenant.service';
import { ACCEPTED_UPLOAD, mediaSize, uploadProblem } from './publishing';

interface Upload {
  id: number;
  name: string;
  /** 0–100. */
  progress: number;
  error: string | null;
}

/**
 * Biblioteca de mídia do Publishing (ADR 0028): grade com envio (arrastar e soltar ou seletor),
 * progresso, remoção e, no editor, escolha da mídia do post. Imagens viram JPEG no servidor.
 */
@Component({
  selector: 'app-media-library',
  imports: [DsButton, DsSkeleton, LucideFilm, LucideUpload],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (canManage()) {
      <div
        class="drop"
        [class.over]="dragging()"
        data-testid="drop-zone"
        (dragover)="$event.preventDefault(); dragging.set(true)"
        (dragleave)="dragging.set(false)"
        (drop)="onDrop($event)"
      >
        <svg lucideUpload [size]="20" aria-hidden="true"></svg>
        <p class="m-0 text-subhead">Arraste imagens e vídeos para cá</p>
        <p class="m-0 text-caption text-fg-muted">JPG, PNG ou WebP (viram JPEG, até 2160 px) e MP4 ou MOV de até 100 MB.</p>
        <label class="pick">
          <input type="file" class="ds-visually-hidden" [accept]="accepted" multiple (change)="onPick($event)" data-testid="file-input" />
          <span ds-button variant="secondary" size="sm">Escolher arquivos</span>
        </label>
      </div>

      @if (uploads().length > 0) {
        <ul class="uploads" aria-label="Envios">
          @for (u of uploads(); track u.id) {
            <li>
              <span class="text-footnote">{{ u.name }}</span>
              @if (u.error) {
                <span class="text-caption err" role="alert">{{ u.error }}</span>
              } @else {
                <progress max="100" [value]="u.progress" [attr.aria-label]="'Enviando ' + u.name">{{ u.progress }}%</progress>
                <span class="text-caption text-fg-muted">{{ u.progress }}%</span>
              }
            </li>
          }
        </ul>
      }
    }

    @if (media.isLoading() && !media.hasValue()) {
      <div class="grid"><ds-skeleton height="120px" /><ds-skeleton height="120px" /><ds-skeleton height="120px" /></div>
    } @else if (media.error()) {
      <p class="m-0 text-footnote" role="alert">
        Não foi possível carregar a biblioteca.
        <button ds-button variant="ghost" size="sm" (click)="media.reload()">Tentar de novo</button>
      </p>
    } @else if (list().length === 0) {
      <p class="m-0 text-footnote text-fg-muted" data-testid="media-empty">
        {{ canManage() ? 'Nenhuma mídia ainda. Envie a primeira imagem ou vídeo.' : 'Nenhuma mídia.' }}
      </p>
    } @else {
      <ul class="grid" aria-label="Mídias da biblioteca">
        @for (m of list(); track m.id) {
          @let chosen = isSelected(m);
          <li class="item" [attr.data-media]="m.id" [class.chosen]="chosen">
            <div class="thumb">
              @if (m.kind === 'image') {
                <img [src]="m.url" [alt]="m.original_name" loading="lazy" />
              } @else {
                <video [src]="m.url" muted preload="metadata" [attr.aria-label]="'Vídeo ' + m.original_name"></video>
                <span class="badge"><svg lucideFilm [size]="12" aria-hidden="true"></svg> Vídeo</span>
              }
            </div>
            <div class="meta">
              <span class="name text-caption" [title]="m.original_name">{{ m.original_name }}</span>
              <span class="text-caption text-fg-muted">
                {{ size(m.size_bytes) }}@if (m.width && m.height) { · {{ m.width }}×{{ m.height }} }
              </span>
            </div>
            <div class="item-actions">
              @if (selectable()) {
                <button ds-button size="sm" [variant]="chosen ? 'secondary' : 'primary'" [disabled]="chosen || full()" (click)="picked.emit(m)">
                  {{ chosen ? 'No post' : 'Usar' }}
                </button>
              }
              @if (canManage()) {
                @if (confirming() === m.id) {
                  <button ds-button variant="ghost" size="sm" (click)="confirming.set(null)">Cancelar</button>
                  <button ds-button variant="destructive" size="sm" [loading]="removing() === m.id" (click)="remove(m)">Remover</button>
                } @else {
                  <button ds-button variant="ghost" size="sm" (click)="confirming.set(m.id)" [attr.aria-label]="'Remover ' + m.original_name">Remover</button>
                }
              }
            </div>
          </li>
        }
      </ul>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-3);
    }
    .drop {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--ds-space-1);
      padding: var(--ds-space-5) var(--ds-space-4);
      border: 1.5px dashed var(--ds-separator);
      border-radius: var(--ds-radius-lg);
      text-align: center;
      color: var(--ds-text-secondary);
    }
    .drop.over {
      border-color: var(--ds-accent);
      background: var(--ds-accent-soft, var(--ds-fill));
    }
    .pick {
      margin-top: var(--ds-space-2);
      cursor: pointer;
    }
    .uploads {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .uploads li {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--ds-space-2);
    }
    progress {
      flex: 1;
      min-width: 120px;
      height: 6px;
      accent-color: var(--ds-accent);
    }
    .err {
      color: var(--ds-status-critical);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: var(--ds-space-3);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .item {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 6px;
      border: 1px solid var(--ds-separator);
      border-radius: var(--ds-radius-md);
      background: var(--ds-bg-elevated);
    }
    .item.chosen {
      border-color: var(--ds-accent);
    }
    .thumb {
      position: relative;
      overflow: hidden;
      aspect-ratio: 1;
      border-radius: calc(var(--ds-radius-md) - 4px);
      background: var(--ds-fill);
    }
    .thumb img,
    .thumb video {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .badge {
      position: absolute;
      bottom: 6px;
      left: 6px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: var(--ds-radius-full);
      background: rgb(0 0 0 / 0.6);
      color: white;
      font: var(--ds-text-caption);
    }
    .meta {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .item-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
  `,
})
export class MediaLibrary {
  /** Projeto do filtro (as gerais da agência aparecem junto); null = todas. */
  readonly projectId = input<string | null>(null);
  /** Modo de escolha (editor do post). */
  readonly selectable = input(false);
  readonly selectedIds = input<readonly string[]>([]);
  /** Limite de mídias do post atingido: não escolhe mais. */
  readonly full = input(false);
  readonly canManage = input(false);
  readonly picked = output<MediaAsset>();

  private readonly http = inject(HttpClient);
  private readonly toast = inject(DsToastService);
  private readonly tenant = inject(TenantService);

  protected readonly accepted = ACCEPTED_UPLOAD;
  protected readonly size = mediaSize;

  readonly media = httpResource<ApiEnvelope<MediaAsset[]>>(() => {
    const tenantId = this.tenant.currentId();
    if (!tenantId) return undefined;
    const projectId = this.projectId();
    const params: Record<string, string> = projectId ? { project_id: projectId } : {};
    return { url: API.media, params, headers: { [TENANT_HEADER]: tenantId } };
  });
  protected readonly list = computed(() => (this.media.hasValue() ? this.media.value().data : []));

  readonly uploads = signal<Upload[]>([]);
  readonly dragging = signal(false);
  readonly confirming = signal<string | null>(null);
  readonly removing = signal<string | null>(null);
  private nextUpload = 1;
  private readonly subscriptions: Subscription[] = [];

  constructor() {
    inject(DestroyRef).onDestroy(() => this.subscriptions.forEach((s) => s.unsubscribe()));
  }

  protected isSelected(m: MediaAsset): boolean {
    return this.selectedIds().includes(m.id);
  }

  onPick(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.upload([...(input.files ?? [])]);
    input.value = '';
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    this.upload([...(event.dataTransfer?.files ?? [])]);
  }

  upload(files: File[]): void {
    for (const file of files) {
      const id = this.nextUpload++;
      const problem = uploadProblem(file);
      this.uploads.update((list) => [...list, { id, name: file.name, progress: 0, error: problem }]);
      if (problem) continue;

      const body = new FormData();
      body.append('file', file);
      const projectId = this.projectId();
      if (projectId) body.append('project_id', projectId);

      const sub = this.http.post<ApiEnvelope<MediaAsset>>(API.media, body, { reportProgress: true, observe: 'events' }).subscribe({
        next: (event) => {
          if (event.type === HttpEventType.UploadProgress) {
            const progress = event.total ? Math.round((event.loaded / event.total) * 100) : 0;
            this.patchUpload(id, { progress: Math.min(progress, 99) });
          } else if (event.type === HttpEventType.Response && event.body) {
            this.uploads.update((list) => list.filter((u) => u.id !== id));
            this.media.reload();
            if (this.selectable() && !this.full()) this.picked.emit(event.body.data);
          }
        },
        error: (error: unknown) => {
          const fields = extractFieldErrors(error);
          const message =
            fields?.['file'] ??
            (error instanceof HttpErrorResponse && error.status === 413 ? 'O arquivo passa do limite de envio (100 MB).' : 'O envio falhou. Tente de novo.');
          this.patchUpload(id, { error: message });
        },
      });
      this.subscriptions.push(sub);
    }
  }

  async remove(m: MediaAsset): Promise<void> {
    if (this.removing()) return;
    this.removing.set(m.id);
    try {
      await firstValueFrom(this.http.delete(API.mediaItem(m.id)));
      this.confirming.set(null);
      this.media.reload();
      this.toast.success('Mídia removida');
    } catch (error) {
      const fields = extractFieldErrors(error);
      if (fields) this.toast.error('Não foi possível remover', { message: fields['media'] ?? 'Tente de novo.' });
    } finally {
      this.removing.set(null);
    }
  }

  private patchUpload(id: number, change: Partial<Upload>): void {
    this.uploads.update((list) => list.map((u) => (u.id === id ? { ...u, ...change } : u)));
  }
}
