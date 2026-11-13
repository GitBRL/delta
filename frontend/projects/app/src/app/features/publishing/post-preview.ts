import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MediaAsset, PublishNetwork } from '../../core/api/api.types';
import { ProviderIcon } from '../integrations/provider-icon';
import { NETWORK_TEXT, formatText, previewShape } from './publishing';

/**
 * Prévia simples de como o post aparece numa rede: feed quadrado; Reels, Story e Shorts verticais.
 * Não imita a interface das redes (marcas de terceiros), só proporção, mídia e legenda.
 */
@Component({
  selector: 'app-post-preview',
  imports: [ProviderIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <figure class="frame" [attr.data-shape]="shape()" [attr.aria-label]="'Prévia: ' + networkLabel() + ' ' + formatLabel()">
      <figcaption class="head">
        <app-provider-icon [provider]="network()" [size]="14" />
        <span class="text-caption font-semibold">{{ account() ?? networkLabel() }}</span>
        <span class="text-caption text-fg-muted">· {{ formatLabel() }}</span>
      </figcaption>
      <div class="media">
        @if (first(); as m) {
          @if (m.kind === 'image') {
            <img [src]="m.url" [alt]="m.original_name" />
          } @else {
            <video [src]="m.url" muted playsinline controls preload="metadata" [attr.aria-label]="'Vídeo ' + m.original_name"></video>
          }
          @if (media().length > 1) {
            <span class="count" aria-label="Quantidade de mídias">1/{{ media().length }}</span>
          }
        } @else {
          <span class="none text-caption text-fg-muted">Sem mídia</span>
        }
      </div>
      @if (showCaption()) {
        <p class="caption text-footnote">
          @if (title() && network() === 'youtube') {
            <strong>{{ title() }}</strong><br />
          }
          {{ shortCaption() }}
        </p>
      }
    </figure>
  `,
  styles: `
    .frame {
      display: flex;
      flex-direction: column;
      gap: 6px;
      width: 100%;
      max-width: 300px;
      margin: 0;
      padding: 8px;
      border: 1px solid var(--ds-separator);
      border-radius: var(--ds-radius-lg);
      background: var(--ds-bg-elevated);
    }
    .frame[data-shape='vertical'] {
      max-width: 220px;
    }
    .head {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .media {
      position: relative;
      display: grid;
      place-items: center;
      overflow: hidden;
      aspect-ratio: 1;
      border-radius: var(--ds-radius-md);
      background: var(--ds-fill);
    }
    .frame[data-shape='vertical'] .media {
      aspect-ratio: 9 / 16;
    }
    .media img,
    .media video {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .count {
      position: absolute;
      top: 6px;
      right: 6px;
      padding: 1px 8px;
      border-radius: var(--ds-radius-full);
      background: rgb(0 0 0 / 0.6);
      color: white;
      font: var(--ds-text-caption);
    }
    .caption {
      margin: 0;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
  `,
})
export class PostPreview {
  readonly network = input.required<PublishNetwork>();
  readonly format = input.required<string>();
  readonly media = input<readonly MediaAsset[]>([]);
  readonly caption = input('');
  readonly title = input<string | null>(null);
  readonly account = input<string | null>(null);

  protected readonly shape = computed(() => previewShape(this.format()));
  protected readonly first = computed(() => this.media()[0] ?? null);
  protected readonly networkLabel = computed(() => NETWORK_TEXT[this.network()] ?? this.network());
  protected readonly formatLabel = computed(() => formatText(this.format()));
  /** Story não tem legenda visível. */
  protected readonly showCaption = computed(() => this.format() !== 'story' && (this.caption().trim() !== '' || !!this.title()));
  protected readonly shortCaption = computed(() => {
    const text = this.caption();
    return text.length > 220 ? `${text.slice(0, 220)}… mais` : text;
  });
}
