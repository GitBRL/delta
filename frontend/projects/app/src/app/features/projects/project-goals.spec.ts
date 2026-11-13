import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UpdateProjectBody } from '../../core/api/api.types';
import { ProjectGoalsPanel } from './project-goals';

describe('ProjectGoalsPanel', () => {
  let fixture: ComponentFixture<ProjectGoalsPanel>;
  let el: HTMLElement;
  let saved: UpdateProjectBody[];

  const input = (name: string) => el.querySelector<HTMLInputElement>(`input[name=${name}]`)!;
  const type = (name: string, value: string) => {
    const field = input(name);
    field.value = value;
    field.dispatchEvent(new Event('input'));
  };
  const editButton = () => [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Editar'));

  beforeEach(() => {
    fixture = TestBed.createComponent(ProjectGoalsPanel);
    el = fixture.nativeElement as HTMLElement;
    saved = [];
    fixture.componentInstance.save.subscribe((body) => saved.push(body));
  });

  it('cliente vê as metas formatadas, sem editar', async () => {
    fixture.componentRef.setInput('goals', { gross_margin_pct: 40, target_cpa: 75.5, target_roas: null });
    fixture.componentRef.setInput('canEdit', false);
    await fixture.whenStable();

    expect(editButton()).toBeUndefined();
    const values = [...el.querySelectorAll('dd')].map((d) => d.textContent?.replace(/\u00a0/g, ' ').trim());
    expect(values).toEqual(['40%', 'R$ 75,50', '—']);
    expect(el.textContent).toContain('Com margem de 40%, ROAS abaixo de 2,50 é prejuízo.');

    // mesmo que alguém peça edição, o papel cliente continua somente leitura
    fixture.componentInstance.editing.set(true);
    await fixture.whenStable();
    expect(el.querySelector('form')).toBeNull();
  });

  it('calcula o ROAS de equilíbrio ao vivo e salva com nulos nos campos vazios', async () => {
    fixture.componentRef.setInput('goals', { gross_margin_pct: 40, target_cpa: 75.5, target_roas: null });
    fixture.componentRef.setInput('canEdit', true);
    await fixture.whenStable();

    editButton()!.click();
    await fixture.whenStable();
    expect(input('gross_margin_pct').value).toBe('40');
    expect(input('target_cpa').value).toBe('75,5');

    type('gross_margin_pct', '25');
    type('target_cpa', '');
    await fixture.whenStable();
    expect(el.querySelector('form .effect')?.textContent).toContain('Com margem de 25%, ROAS abaixo de 4,00 é prejuízo.');

    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    expect(saved).toEqual([{ goals: { gross_margin_pct: 25, target_cpa: null, target_roas: null } }]);
  });

  it('não envia valores inválidos e mostra o erro no campo', async () => {
    fixture.componentRef.setInput('canEdit', true);
    await fixture.whenStable();

    editButton()!.click();
    await fixture.whenStable();
    type('gross_margin_pct', '150');
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();

    expect(saved).toEqual([]);
    expect(el.querySelector('ds-text-field .error')?.textContent).toContain('A margem bruta vai de 0 a 100%.');
  });

  it('mostra o erro 422 do backend no campo certo', async () => {
    fixture.componentRef.setInput('canEdit', true);
    fixture.componentInstance.editing.set(true);
    fixture.componentRef.setInput('serverErrors', { 'goals.target_roas': 'A meta de ROAS é alta demais.' });
    await fixture.whenStable();

    const fields = [...el.querySelectorAll('ds-text-field')];
    expect(fields[2].querySelector('.error')?.textContent).toContain('A meta de ROAS é alta demais.');
    expect(fields[0].querySelector('.error')).toBeNull();
  });

  it('sem metas, convida a equipe a preenchê-las', async () => {
    fixture.componentRef.setInput('goals', { gross_margin_pct: null, target_cpa: null, target_roas: null });
    fixture.componentRef.setInput('canEdit', true);
    await fixture.whenStable();

    expect(el.textContent).toContain('Sem metas definidas.');
    expect(el.textContent).toContain('Informe a margem e as metas');
  });
});
