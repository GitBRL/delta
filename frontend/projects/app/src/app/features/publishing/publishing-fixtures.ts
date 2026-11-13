import { MediaAsset, Post, PublishNetworkSpec, PublishingNetworks } from '../../core/api/api.types';

/** Dados de exemplo dos testes do Publishing (formato real da API). */
export const SPECS: PublishNetworkSpec[] = [
  { key: 'instagram', label: 'Instagram', caption_max: 2200, formats: [{ key: 'feed', label: 'Feed (1 imagem ou vídeo)' }, { key: 'reels', label: 'Reels (1 vídeo)' }] },
  { key: 'facebook', label: 'Facebook', caption_max: 63206, formats: [{ key: 'feed', label: 'Feed (texto, até 10 imagens ou 1 vídeo)' }] },
  { key: 'youtube', label: 'YouTube', caption_max: 5000, formats: [{ key: 'short', label: 'Shorts (1 vídeo vertical)' }] },
];

export const IMAGE: MediaAsset = {
  id: 'm1',
  kind: 'image',
  mime: 'image/jpeg',
  url: '/api/public/media/t1/m1?expires=1&signature=x',
  width: 2160,
  height: 1440,
  size_bytes: 524288,
  original_name: 'pao.png',
  project_id: 'p1',
  created_at: '2026-11-12T10:00:00Z',
};

export function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: 'post1',
    project: { id: 'p1', name: 'Padaria Aurora' },
    title: 'Pão de fermentação natural',
    caption: 'Fornada nova! #padaria',
    media: [IMAGE],
    status: 'draft',
    requires_approval: true,
    scheduled_at: null,
    published_at: null,
    external_reference: null,
    targets: [
      { id: 't1', network: 'instagram', format: 'feed', account: { id: 'a1', name: '@padaria', mode: 'sandbox' }, status: 'pending', permalink: null, error: null, published_at: null },
    ],
    problems: [],
    approval: null,
    created_at: '2026-11-12T10:00:00Z',
    updated_at: '2026-11-12T10:00:00Z',
    ...overrides,
  };
}

export const VIDEO: MediaAsset = { ...IMAGE, id: 'm2', kind: 'video', mime: 'video/mp4', url: '/api/public/media/t1/m2?expires=1&signature=y', width: null, height: null, original_name: 'reels.mp4' };

export const NETWORKS: PublishingNetworks = {
  networks: SPECS,
  accounts: [
    { id: 'a1', network: 'instagram', name: '@padaria', mode: 'sandbox', status: 'active' },
    { id: 'a2', network: 'facebook', name: 'Padaria Aurora', mode: 'live', status: 'active' },
  ],
};
