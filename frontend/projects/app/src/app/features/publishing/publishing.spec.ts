import { HttpErrorResponse } from '@angular/common/http';
import {
  calendarRange,
  calendarTitle,
  captionInfo,
  dayKey,
  draftChanged,
  emptyPostDraft,
  fieldMessages,
  fromLocalInput,
  groupByDay,
  hashtagCount,
  mediaSize,
  monthGrid,
  moveItem,
  notifiedText,
  postActions,
  postBody,
  postCounters,
  postDraftFrom,
  previewShape,
  scheduleHint,
  shiftAnchor,
  statusTone,
  toLocalInput,
  uploadProblem,
  validatePostDraft,
  weekDays,
} from './publishing';
import { IMAGE, SPECS, makePost } from './publishing-fixtures';

describe('legenda', () => {
  it('conta hashtags como o backend (sem pegar # no meio de palavra)', () => {
    expect(hashtagCount('Fornada #padaria #pão_quente e#nao #1')).toBe(3);
    expect(hashtagCount('sem hashtag')).toBe(0);
  });

  it('usa o limite da rede mais restritiva escolhida e conta hashtags só com o Instagram', () => {
    const tags = Array.from({ length: 31 }, (_, i) => `#t${i}`).join(' ');
    const info = captionInfo(tags, SPECS, ['facebook', 'instagram']);
    expect(info.max).toBe(2200);
    expect(info.limitedBy).toBe('Instagram');
    expect(info.hashtags).toBe(31);
    expect(info.hashtagMax).toBe(30);
    expect(info.hashtagsOver).toBe(true);

    const fb = captionInfo('x'.repeat(3000), SPECS, ['facebook']);
    expect(fb).toMatchObject({ max: 63206, over: false, hashtagMax: null, hashtagsOver: false });
    expect(captionInfo('x'.repeat(2201), SPECS, ['instagram']).over).toBe(true);
    expect(captionInfo('olá', SPECS, []).max).toBeNull();
    // Emoji conta como 1 caractere (mb_strlen no servidor).
    expect(captionInfo('🍞🍞', SPECS, []).length).toBe(2);
  });
});

describe('rascunho', () => {
  it('monta o corpo do POST (com projeto) e do PATCH (sem projeto)', () => {
    const draft = { ...emptyPostDraft('p1'), title: '  Pão  ', media: [IMAGE], targets: [{ network: 'instagram' as const, format: 'feed', account_id: 'a1' }] };
    expect(postBody(draft)).toEqual({
      project_id: 'p1',
      title: 'Pão',
      caption: '',
      media: ['m1'],
      requires_approval: true,
      targets: [{ network: 'instagram', format: 'feed', account_id: 'a1' }],
    });
    const saved = postDraftFrom(makePost());
    expect(postBody(saved)).not.toHaveProperty('project_id');
    expect(postBody({ ...saved, title: '' }).title).toBeNull();
  });

  it('percebe alterações e valida limites', () => {
    const saved = postDraftFrom(makePost());
    expect(draftChanged(saved, postDraftFrom(makePost()))).toBe(false);
    expect(draftChanged({ ...saved, caption: 'outra' }, saved)).toBe(true);
    expect(validatePostDraft(emptyPostDraft())).toEqual({ project_id: 'Escolha o projeto.' });
    expect(validatePostDraft({ ...emptyPostDraft('p1'), title: 'x'.repeat(121) })).toEqual({ title: 'Use no máximo 120 caracteres.' });
  });

  it('reordena a mídia sem sair dos limites', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(moveItem(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
  });
});

describe('ações por status', () => {
  it('rascunho com aprovação: pede aprovação, não agenda nem publica', () => {
    expect(postActions(makePost())).toMatchObject({ edit: true, requestApproval: true, schedule: false, publishNow: false, cancel: true, remove: true });
    expect(scheduleHint(makePost())).toContain('Peça a aprovação do cliente');
  });

  it('sem aprovação: agenda e publica direto', () => {
    expect(postActions(makePost({ requires_approval: false }))).toMatchObject({ requestApproval: true, schedule: true, publishNow: true });
  });

  it('em revisão guarda a data; aprovado agenda e publica; publicado só lê', () => {
    expect(postActions(makePost({ status: 'in_review' }))).toMatchObject({ schedule: true, publishNow: false, unschedule: false });
    expect(postActions(makePost({ status: 'in_review', scheduled_at: '2026-12-01T12:00:00Z' })).unschedule).toBe(true);
    expect(scheduleHint(makePost({ status: 'in_review' }))).toContain('agendado sozinho');
    expect(postActions(makePost({ status: 'approved' }))).toMatchObject({ schedule: true, publishNow: true, requestApproval: false });
    expect(postActions(makePost({ status: 'published' }))).toEqual({
      edit: false, requestApproval: false, schedule: false, unschedule: false, publishNow: false, cancel: false, remove: false,
    });
    const partly = makePost({ status: 'failed', targets: [{ ...makePost().targets[0], status: 'published' }] });
    expect(postActions(partly)).toMatchObject({ edit: true, publishNow: true, remove: false });
  });

  it('cores e textos', () => {
    expect(statusTone('failed')).toBe('critical');
    expect(statusTone('in_review')).toBe('attention');
    expect(notifiedText({ email: 2, whatsapp: 1 })).toBe('Avisos enviados: 2 por e-mail e 1 por WhatsApp.');
    expect(notifiedText({ email: 0, whatsapp: 0 })).toBe('Nenhum contato foi avisado automaticamente.');
    expect(previewShape('reels')).toBe('vertical');
    expect(previewShape('carousel')).toBe('square');
    expect(mediaSize(524288)).toBe('512 KB');
    expect(mediaSize(5 * 1024 * 1024)).toBe('5 MB');
  });
});

describe('datas e calendário', () => {
  it('converte o datetime-local no fuso do navegador e volta', () => {
    const iso = fromLocalInput('2026-12-01T14:30');
    expect(iso).not.toBeNull();
    expect(toLocalInput(iso)).toBe('2026-12-01T14:30');
    expect(fromLocalInput('')).toBeNull();
    expect(toLocalInput(null)).toBe('');
  });

  it('grade do mês de domingo a sábado, com as pontas dos meses vizinhos', () => {
    const grid = monthGrid(new Date(2026, 10, 15)); // novembro de 2026 começa num domingo
    expect(grid[0][0].getDay()).toBe(0);
    expect(dayKey(grid[0][0])).toBe('2026-11-01');
    expect(dayKey(grid[grid.length - 1][6])).toBe('2026-12-05');
    expect(grid.every((w) => w.length === 7)).toBe(true);
    expect(calendarRange('month', new Date(2026, 10, 15))).toEqual({ from: '2026-11-01', to: '2026-12-05' });
    expect(calendarTitle('month', new Date(2026, 10, 15))).toBe('Novembro de 2026');
  });

  it('semana, navegação e título', () => {
    const anchor = new Date(2026, 10, 12); // quinta-feira
    expect(weekDays(anchor).map(dayKey)).toEqual(['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14']);
    expect(dayKey(shiftAnchor('week', anchor, 1))).toBe('2026-11-19');
    expect(dayKey(shiftAnchor('month', anchor, -1))).toBe('2026-10-01');
    expect(calendarTitle('week', anchor)).toContain('8');
  });

  it('agrupa por dia (data agendada, publicada ou de criação) e conta o topo', () => {
    const now = new Date('2026-11-12T12:00:00Z');
    const posts = [
      makePost({ id: 'a', status: 'scheduled', scheduled_at: '2026-11-14T15:00:00Z' }),
      makePost({ id: 'b', status: 'scheduled', scheduled_at: '2026-11-30T15:00:00Z' }), // depois de 7 dias
      makePost({ id: 'c', status: 'in_review' }),
      makePost({ id: 'd', status: 'failed', published_at: null, scheduled_at: '2026-11-10T10:00:00Z' }),
    ];
    expect(postCounters(posts, now)).toEqual({ review: 1, upcoming: 1, failed: 1 });
    const groups = groupByDay(posts);
    expect(groups.get(dayKey(new Date('2026-11-14T15:00:00Z')))?.map((p) => p.id)).toEqual(['a']);
    expect([...groups.keys()][0]).toBe(dayKey(new Date('2026-11-10T10:00:00Z'))); // ordem por data
  });
});

describe('envio e erros', () => {
  it('confere tipo e tamanho antes de enviar', () => {
    expect(uploadProblem({ name: 'a.jpg', type: 'image/jpeg', size: 1000 })).toBeNull();
    expect(uploadProblem({ name: 'a.svg', type: 'image/svg+xml', size: 10 })).toContain('use imagem JPG, PNG ou WebP');
    expect(uploadProblem({ name: 'b.mp4', type: 'video/mp4', size: 101 * 1024 * 1024 })).toContain('100 MB');
  });

  it('lê a lista inteira de pendências de um 422', () => {
    const error = new HttpErrorResponse({ status: 422, error: { message: 'x', errors: { post: ['Escolha ao menos uma rede.', 'Instagram (Feed): escolha a conta.'] } } });
    expect(fieldMessages(error, 'post')).toEqual(['Escolha ao menos uma rede.', 'Instagram (Feed): escolha a conta.']);
    expect(fieldMessages(error, 'scheduled_at')).toEqual([]);
    expect(fieldMessages(new HttpErrorResponse({ status: 500 }), 'post')).toEqual([]);
  });
});
