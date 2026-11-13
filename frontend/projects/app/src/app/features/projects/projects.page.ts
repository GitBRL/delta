import { DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse, httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { LucideChevronRight, LucideFolderOpen, LucidePlus } from '@lucide/angular';
import { DsButton, DsGlassCard, DsSkeleton, DsTextField, DsToastService } from 'design-system';
import { firstValueFrom } from 'rxjs';
import { API, ApiEnvelope, CreateProjectBody, Project, TENANT_HEADER } from '../../core/api/api.types';
import { FieldErrors, clientErrorMessage, extractFieldErrors } from '../../core/forms/server-errors';
import { TenantService } from '../../core/tenant/tenant.service';
import { NICHES, nicheLabel } from './niches';

@Component({
  selector: 'app-projects-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    DatePipe,
    DsButton,
    DsGlassCard,
    DsSkeleton,
    DsTextField,
    LucidePlus,
    LucideFolderOpen,
    LucideChevronRight,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './projects.page.html',
  styleUrl: './projects.page.css',
})
export class ProjectsPage {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(DsToastService);
  protected readonly tenant = inject(TenantService);

  protected readonly niches = NICHES;
  protected readonly nicheLabel = nicheLabel;

  /** Lista reativa: refaz a busca quando a agência selecionada muda. */
  protected readonly projects = httpResource<ApiEnvelope<Project[]>>(() => {
    const tenantId = this.tenant.currentId();
    return tenantId ? { url: API.projects, headers: { [TENANT_HEADER]: tenantId } } : undefined;
  });

  protected readonly items = computed(() => (this.projects.hasValue() ? this.projects.value().data : []));

  protected readonly loadError = computed(() => {
    const error = this.projects.error();
    if (!error) return null;
    const status = error instanceof HttpErrorResponse ? error.status : (error.cause as HttpErrorResponse | undefined)?.status;
    return status === 403
      ? 'Você não tem acesso aos projetos desta agência.'
      : 'Não foi possível carregar os projetos.';
  });

  protected readonly creating = signal(false);
  protected readonly serverErrors = signal<FieldErrors>({});

  protected readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(120)] }),
    niche: new FormControl<string>('', { nonNullable: true }),
  });

  protected nameError(): string | null {
    return this.serverErrors()['name'] ?? clientErrorMessage(this.form.controls.name, 'o nome do projeto');
  }

  protected async create(): Promise<void> {
    this.form.markAllAsTouched();
    this.serverErrors.set({});
    const tenantId = this.tenant.currentId();
    if (this.form.invalid || !tenantId) {
      return;
    }

    const { name, niche } = this.form.getRawValue();
    const body: CreateProjectBody = { name: name.trim(), niche: niche || null };

    this.creating.set(true);
    try {
      const res = await firstValueFrom(
        this.http.post<ApiEnvelope<Project>>(API.projects, body, { headers: { [TENANT_HEADER]: tenantId } }),
      );
      this.projects.update((current) => ({ data: [res.data, ...(current?.data ?? [])] }));
      this.form.reset();
      this.toast.success('Projeto criado', { message: res.data.name });
    } catch (error) {
      const fields = extractFieldErrors(error);
      if (fields) {
        this.serverErrors.set(fields);
        if (fields['niche']) {
          this.toast.error('Nicho inválido', { message: fields['niche'] });
        }
      } else if (!(error instanceof HttpErrorResponse && (error.status === 403 || error.status >= 500 || error.status === 0))) {
        // 403/5xx/rede já viram toast no interceptor global.
        this.toast.error('Não foi possível criar o projeto');
      }
    } finally {
      this.creating.set(false);
    }
  }
}
