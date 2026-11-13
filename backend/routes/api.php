<?php

declare(strict_types=1);

use App\Http\Controllers\Api\ActionController;
use App\Http\Controllers\Api\AdsController;
use App\Http\Controllers\Api\AiController;
use App\Http\Controllers\Api\ApiTokenController;
use App\Http\Controllers\Api\AutomationController;
use App\Http\Controllers\Api\AutomationRunController;
use App\Http\Controllers\Api\BillingController;
use App\Http\Controllers\Api\BrandingController;
use App\Http\Controllers\Api\CatalogController;
use App\Http\Controllers\Api\Connect\CustomerController as ConnectCustomerController;
use App\Http\Controllers\Api\Connect\HostedSessionController;
use App\Http\Controllers\Api\Connect\MerchantController as ConnectMerchantController;
use App\Http\Controllers\Api\ConnectionController;
use App\Http\Controllers\Api\ContactController;
use App\Http\Controllers\Api\CustomMetricController;
use App\Http\Controllers\Api\GoalController;
use App\Http\Controllers\Api\ImportController;
use App\Http\Controllers\Api\InboxController;
use App\Http\Controllers\Api\InvitationController;
use App\Http\Controllers\Api\ManualMetricController;
use App\Http\Controllers\Api\MeController;
use App\Http\Controllers\Api\MediaController;
use App\Http\Controllers\Api\OverviewController;
use App\Http\Controllers\Api\PasskeyController;
use App\Http\Controllers\Api\PlatformAppController;
use App\Http\Controllers\Api\PostController;
use App\Http\Controllers\Api\PresentationController;
use App\Http\Controllers\Api\ProjectAccountController;
use App\Http\Controllers\Api\ProjectAttentionController;
use App\Http\Controllers\Api\ProjectController;
use App\Http\Controllers\Api\ProjectHealthController;
use App\Http\Controllers\Api\ProjectMetricsController;
use App\Http\Controllers\Api\PublicApprovalController;
use App\Http\Controllers\Api\PublicReportController;
use App\Http\Controllers\Api\ReportController;
use App\Http\Controllers\Api\ReportSnapshotController;
use App\Http\Controllers\Api\ReportTemplateController;
use App\Http\Controllers\Api\ShareLinkController;
use App\Http\Controllers\Api\SheetSyncController;
use App\Http\Controllers\Api\TeamController;
use App\Http\Controllers\Api\TeamInvitationController;
use App\Http\Controllers\Api\TimelineController;
use App\Http\Controllers\Api\UnsubscribeController;
use App\Http\Controllers\Api\V1\MetricCatalogController;
use App\Http\Controllers\Api\WebhookController;
use App\Http\Controllers\Api\WhatsAppSettingsController;
use App\Http\Controllers\Api\WhatsAppWebhookController;
use App\Http\Controllers\HealthController;
use Illuminate\Support\Facades\Route;

/*
| API interna da SPA (sessão via Sanctum, cookies same-origin).
| Rotas de dados de agência exigem o header X-Tenant-Id (middleware "tenant").
*/

// Convite para a equipe: página pública (quem abre ainda não é membro). Ver ADR 0010.
Route::middleware('throttle:30,1')->group(function (): void {
    Route::get('/invitations/{token}', [InvitationController::class, 'show'])->where('token', '[A-Za-z0-9]{48}')->name('invitations.show');
    Route::post('/invitations/{token}/accept', [InvitationController::class, 'accept'])->where('token', '[A-Za-z0-9]{48}')->name('invitations.accept');
});

/*
| API pública v1 (ADR 0020): "Authorization: Bearer dlt_…". O token define a agência e os escopos;
| os controllers são os mesmos do app (tudo sob RLS). Documentação: docs/api-v1.md.
*/
Route::prefix('v1')->middleware(['api.token', 'plan.feature:api', 'throttle:api-v1'])->name('v1.')->group(function (): void {
    Route::get('/projects', [ProjectController::class, 'index'])->middleware('api.scope:projects:read')->name('projects.index');
    Route::get('/projects/{project}', [ProjectController::class, 'show'])->middleware('api.scope:projects:read')->name('projects.show');
    Route::get('/metrics', MetricCatalogController::class)->middleware('api.scope:metrics:read')->name('metrics');
    Route::post('/projects/{project}/metrics/query', ProjectMetricsController::class)->middleware('api.scope:metrics:read')->name('projects.metrics.query');
    Route::get('/reports', [ReportController::class, 'index'])->middleware('api.scope:reports:read')->name('reports.index');
    Route::post('/reports/{report}/snapshots', [ReportSnapshotController::class, 'store'])->middleware(['api.scope:reports:write', 'throttle:20,1'])->name('reports.publish');
    Route::get('/projects/{project}/snapshots', [ReportSnapshotController::class, 'forProject'])->middleware('api.scope:reports:read')->name('projects.snapshots');
    Route::get('/snapshots/{snapshot}', [ReportSnapshotController::class, 'show'])->middleware('api.scope:reports:read')->name('snapshots.show');
    Route::get('/snapshots/{snapshot}/pdf', [ReportSnapshotController::class, 'pdf'])->middleware('api.scope:reports:read')->name('snapshots.pdf');
    Route::middleware('api.scope:webhooks:manage')->group(function (): void {
        Route::get('/webhooks', [WebhookController::class, 'index'])->name('webhooks.index');
        Route::post('/webhooks', [WebhookController::class, 'store'])->name('webhooks.store');
        Route::delete('/webhooks/{webhook}', [WebhookController::class, 'destroy'])->name('webhooks.destroy');
    });
});

// Saúde das dependências (monitoramento).
Route::get('/health', HealthController::class)->middleware('throttle:60,1')->name('health');

// Logo da agência para páginas públicas (link assinado). Ver ADR 0019.
Route::get('/public/branding/{tenant}/logo', [BrandingController::class, 'publicLogo'])->whereUuid('tenant')->middleware(['signed:relative', 'throttle:120,1'])->name('public.branding.logo');

// Relatório aberto por link público (sem login). Ver ADR 0011.
Route::middleware('throttle:60,1')->prefix('public/reports/{token}')->where(['token' => '[A-Za-z0-9]{40}'])->group(function (): void {
    Route::get('/', [PublicReportController::class, 'show'])->name('public-reports.show');
    Route::post('/unlock', [PublicReportController::class, 'unlock'])->middleware('throttle:10,1')->name('public-reports.unlock');
    Route::get('/pdf', [PublicReportController::class, 'pdf'])->middleware('signed:relative')->name('public-reports.pdf');
});

// Publishing (ADR 0028): aprovação do cliente por link e mídia por link assinado (app e redes).
Route::middleware('throttle:60,1')->prefix('public/approvals/{token}')->where(['token' => '[A-Za-z0-9]{48}'])->group(function (): void {
    Route::get('/', [PublicApprovalController::class, 'show'])->name('public-approvals.show');
    Route::post('/', [PublicApprovalController::class, 'decide'])->middleware('throttle:10,1')->name('public-approvals.decide');
});
Route::get('/public/media/{tenant}/{asset}', [MediaController::class, 'file'])->whereUuid(['tenant', 'asset'])->middleware(['signed:relative', 'throttle:600,1'])->name('media.public');

/*
| Delta Connect (ADR 0032): o merchant usa o token da API com o escopo "connect"; as rotas de
| customer exigem também "X-Customer-Token" e ficam restritas ao projeto dele pelo banco.
*/
Route::prefix('connect/v1')->middleware(['api.token', 'api.scope:connect', 'plan.feature:api', 'throttle:api-v1'])->name('connect.')->group(function (): void {
    Route::get('/customers', [ConnectMerchantController::class, 'index'])->name('customers.index');
    Route::post('/customers', [ConnectMerchantController::class, 'store'])->name('customers.store');
    Route::get('/customers/{customer}', [ConnectMerchantController::class, 'show'])->name('customers.show');
    Route::patch('/customers/{customer}', [ConnectMerchantController::class, 'update'])->name('customers.update');
    Route::delete('/customers/{customer}', [ConnectMerchantController::class, 'destroy'])->name('customers.destroy');
    Route::post('/customers/{customer}/token', [ConnectMerchantController::class, 'rotate'])->name('customers.rotate');
    Route::get('/integrations', [ConnectMerchantController::class, 'integrations'])->name('integrations');
    Route::post('/customer-integrations/session', [ConnectMerchantController::class, 'session'])->name('session');

    Route::middleware('connect.customer')->group(function (): void {
        Route::get('/customer', [ConnectCustomerController::class, 'show'])->name('customer');
        Route::get('/metrics', [ConnectCustomerController::class, 'metrics'])->name('metrics');
        Route::post('/metrics/get-data', [ConnectCustomerController::class, 'getData'])->name('metrics.get-data');
        Route::post('/metrics/get-data-async', [ConnectCustomerController::class, 'getDataAsync'])->name('metrics.get-data-async');
    });
});
Route::get('/public/connect/{token}', [HostedSessionController::class, 'show'])->where('token', '[A-Za-z0-9]{48}')->middleware('throttle:60,1')->name('public-connect.show');

// Descadastro em um clique (link assinado nos e-mails). Ver ADR 0012.
Route::middleware(['throttle:30,1', 'signed:relative'])->group(function (): void {
    Route::get('/public/unsubscribe', [UnsubscribeController::class, 'show'])->name('public.unsubscribe');
    Route::post('/public/unsubscribe', [UnsubscribeController::class, 'confirm'])->name('public.unsubscribe.confirm');
});

// Webhook da Cloud API do WhatsApp (Meta). Assinatura conferida por agência. Ver ADR 0013.
Route::middleware('throttle:600,1')->group(function (): void {
    Route::get('/webhooks/whatsapp', [WhatsAppWebhookController::class, 'verify'])->name('webhooks.whatsapp.verify');
    Route::post('/webhooks/whatsapp', [WhatsAppWebhookController::class, 'receive'])->name('webhooks.whatsapp.receive');
});

Route::middleware(['auth:sanctum', 'context.user'])->group(function (): void {
    Route::get('/me', MeController::class)->name('me');
    Route::get('/me/passkeys', [PasskeyController::class, 'index'])->name('me.passkeys');

    // Catálogo de métricas: igual para todas as agências.
    Route::get('/metrics/catalog', [CatalogController::class, 'metrics'])->name('metrics.catalog');

    Route::middleware('tenant')->group(function (): void {
        // Visão geral da agência (o cliente vê só os próprios projetos, pelo RLS).
        Route::get('/overview', OverviewController::class)->middleware('throttle:30,1')->name('overview');

        // Plataformas: o login real disponível depende do app cadastrado pela agência.
        Route::get('/providers', [CatalogController::class, 'providers'])->name('providers.index');

        Route::apiResource('projects', ProjectController::class)->only(['index', 'store', 'show', 'update']);
        Route::get('/projects/{project}/accounts', [ProjectAccountController::class, 'index'])->name('projects.accounts.index');
        Route::put('/projects/{project}/accounts', [ProjectAccountController::class, 'update'])->name('projects.accounts.update');
        Route::post('/projects/{project}/metrics/query', ProjectMetricsController::class)->name('projects.metrics.query');
        Route::post('/projects/{project}/attention', ProjectAttentionController::class)->name('projects.attention');

        Route::get('/connections', [ConnectionController::class, 'index'])->name('connections.index');
        Route::post('/connections', [ConnectionController::class, 'store'])->name('connections.store');
        Route::post('/connections/{connection}/sync', [ConnectionController::class, 'sync'])->name('connections.sync');

        Route::get('/custom-metrics', [CustomMetricController::class, 'index'])->name('custom-metrics.index');
        Route::get('/custom-metrics/templates', [CustomMetricController::class, 'templates'])->name('custom-metrics.templates');
        Route::post('/custom-metrics/preview', [CustomMetricController::class, 'preview'])->name('custom-metrics.preview');
        Route::post('/custom-metrics', [CustomMetricController::class, 'store'])->name('custom-metrics.store');
        Route::put('/custom-metrics/{customMetric}', [CustomMetricController::class, 'update'])->name('custom-metrics.update');
        Route::delete('/custom-metrics/{customMetric}', [CustomMetricController::class, 'destroy'])->middleware('staff')->name('custom-metrics.destroy');

        // Relatórios: o montador é da equipe; as versões publicadas, de quem enxerga o projeto.
        Route::get('/report-templates', ReportTemplateController::class)->name('report-templates.index');
        Route::middleware('staff')->group(function (): void {
            Route::get('/reports', [ReportController::class, 'index'])->name('reports.index');
            Route::post('/reports', [ReportController::class, 'store'])->name('reports.store');
            Route::get('/reports/{report}', [ReportController::class, 'show'])->name('reports.show');
            Route::put('/reports/{report}', [ReportController::class, 'update'])->name('reports.update');
            Route::delete('/reports/{report}', [ReportController::class, 'destroy'])->name('reports.destroy');
            Route::post('/reports/{report}/render', [ReportController::class, 'render'])->middleware('throttle:60,1')->name('reports.render');
            Route::get('/reports/{report}/snapshots', [ReportSnapshotController::class, 'index'])->name('reports.snapshots.index');
            Route::post('/reports/{report}/snapshots', [ReportSnapshotController::class, 'store'])->middleware('throttle:20,1')->name('reports.snapshots.store');
            Route::post('/snapshots/{snapshot}/pdf', [ReportSnapshotController::class, 'retryPdf'])->name('snapshots.pdf.retry');
            Route::delete('/snapshots/{snapshot}', [ReportSnapshotController::class, 'destroy'])->name('snapshots.destroy');
            Route::get('/snapshots/{snapshot}/links', [ShareLinkController::class, 'index'])->name('snapshots.links.index');
            Route::post('/snapshots/{snapshot}/links', [ShareLinkController::class, 'store'])->middleware('throttle:30,1')->name('snapshots.links.store');
            Route::delete('/links/{shareLink}', [ShareLinkController::class, 'destroy'])->name('links.destroy');
            Route::get('/reports/{report}/links', [ShareLinkController::class, 'indexLive'])->name('reports.links.index');
            Route::post('/reports/{report}/links', [ShareLinkController::class, 'storeLive'])->middleware('throttle:30,1')->name('reports.links.store');
        });
        Route::get('/projects/{project}/snapshots', [ReportSnapshotController::class, 'forProject'])->name('projects.snapshots.index');
        Route::get('/snapshots/{snapshot}', [ReportSnapshotController::class, 'show'])->name('snapshots.show');
        Route::get('/snapshots/{snapshot}/pdf', [ReportSnapshotController::class, 'pdf'])->name('snapshots.pdf');

        // Saúde da conta e plano de ação (ADR 0018): leitura de quem enxerga o projeto; escrita da equipe.
        Route::get('/projects/{project}/health', ProjectHealthController::class)->middleware('throttle:60,1')->name('projects.health');
        Route::get('/actions', [ActionController::class, 'index'])->name('actions.index');
        Route::get('/projects/{project}/actions', [ActionController::class, 'forProject'])->name('projects.actions.index');
        Route::middleware('staff')->group(function (): void {
            Route::get('/staff-members', [TeamController::class, 'staff'])->name('staff-members');
            Route::post('/projects/{project}/actions', [ActionController::class, 'store'])->name('projects.actions.store');
            Route::patch('/actions/{action}', [ActionController::class, 'update'])->name('actions.update');
            Route::delete('/actions/{action}', [ActionController::class, 'destroy'])->name('actions.destroy');
        });

        // Metas e linha do tempo (ADR 0017): leitura de quem enxerga o projeto; escrita da equipe.
        Route::get('/goals', [GoalController::class, 'index'])->name('goals.index');
        Route::get('/projects/{project}/goals', [GoalController::class, 'forProject'])->name('projects.goals.index');
        Route::get('/projects/{project}/timeline', [TimelineController::class, 'index'])->name('projects.timeline.index');
        Route::middleware('staff')->group(function (): void {
            Route::post('/projects/{project}/goals', [GoalController::class, 'store'])->name('projects.goals.store');
            Route::put('/goals/{goal}', [GoalController::class, 'update'])->name('goals.update');
            Route::delete('/goals/{goal}', [GoalController::class, 'destroy'])->name('goals.destroy');
            Route::post('/projects/{project}/timeline', [TimelineController::class, 'store'])->name('projects.timeline.store');
            Route::delete('/timeline/{event}', [TimelineController::class, 'destroy'])->name('timeline.destroy');
        });

        // Fonte manual de dados (ADR 0015): leitura de quem enxerga o projeto; escrita da equipe.
        Route::get('/manual-metrics', [ManualMetricController::class, 'index'])->name('manual-metrics.index');
        Route::get('/projects/{project}/manual-values', [ManualMetricController::class, 'values'])->name('manual-values.index');
        Route::middleware('staff')->group(function (): void {
            Route::post('/manual-metrics', [ManualMetricController::class, 'store'])->name('manual-metrics.store');
            Route::put('/manual-metrics/{manualMetric}', [ManualMetricController::class, 'update'])->name('manual-metrics.update');
            Route::delete('/manual-metrics/{manualMetric}', [ManualMetricController::class, 'destroy'])->name('manual-metrics.destroy');
            Route::put('/projects/{project}/manual-values', [ManualMetricController::class, 'save'])->name('manual-values.save');
            Route::post('/projects/{project}/manual-values/import', [ManualMetricController::class, 'import'])->middleware('throttle:20,1')->name('manual-values.import');
        });

        // Contatos e envios automáticos (e-mail e WhatsApp): equipe da agência.
        Route::middleware('staff')->group(function (): void {
            Route::get('/projects/{project}/contacts', [ContactController::class, 'index'])->name('contacts.index');
            Route::post('/projects/{project}/contacts', [ContactController::class, 'store'])->name('contacts.store');
            Route::put('/contacts/{contact}', [ContactController::class, 'update'])->name('contacts.update');
            Route::delete('/contacts/{contact}', [ContactController::class, 'destroy'])->name('contacts.destroy');
            Route::get('/contacts/{contact}/consents', [ContactController::class, 'consents'])->name('contacts.consents');

            Route::get('/automations', [AutomationController::class, 'index'])->name('automations.index');
            Route::post('/automations', [AutomationController::class, 'store'])->name('automations.store');
            Route::post('/automations/preview', [AutomationController::class, 'preview'])->middleware('throttle:30,1')->name('automations.preview');
            Route::get('/automations/{automation}', [AutomationController::class, 'show'])->name('automations.show');
            Route::put('/automations/{automation}', [AutomationController::class, 'update'])->name('automations.update');
            Route::delete('/automations/{automation}', [AutomationController::class, 'destroy'])->name('automations.destroy');
            Route::post('/automations/{automation}/run', [AutomationController::class, 'runNow'])->middleware('throttle:10,1')->name('automations.run');

            Route::get('/whatsapp/conversations', [InboxController::class, 'index'])->name('inbox.index');
            Route::get('/whatsapp/conversations/{phone}', [InboxController::class, 'show'])->where('phone', '\\+?\\d{10,15}')->name('inbox.show');
            Route::post('/whatsapp/conversations/{phone}/reply', [InboxController::class, 'reply'])->where('phone', '\\+?\\d{10,15}')->middleware('throttle:60,1')->name('inbox.reply');
            Route::post('/whatsapp/simulate-inbound', [InboxController::class, 'simulate'])->middleware('throttle:30,1')->name('inbox.simulate');

            Route::get('/automation-runs', [AutomationRunController::class, 'index'])->name('automation-runs.index');
            Route::get('/automation-runs/{run}', [AutomationRunController::class, 'show'])->name('automation-runs.show');
            Route::post('/automation-runs/{run}/approve', [AutomationRunController::class, 'approve'])->name('automation-runs.approve');
            Route::post('/automation-runs/{run}/cancel', [AutomationRunController::class, 'cancel'])->name('automation-runs.cancel');
        });

        // WhatsApp da agência (número oficial ou demonstração): só dono e administrador.
        Route::middleware('tenant.admin')->group(function (): void {
            Route::get('/whatsapp', [WhatsAppSettingsController::class, 'show'])->name('whatsapp.show');
            Route::put('/whatsapp', [WhatsAppSettingsController::class, 'update'])->middleware('throttle:10,1')->name('whatsapp.update');
            Route::post('/whatsapp/verify', [WhatsAppSettingsController::class, 'verify'])->middleware('throttle:10,1')->name('whatsapp.verify');
            Route::delete('/whatsapp', [WhatsAppSettingsController::class, 'destroy'])->name('whatsapp.destroy');
        });

        // Copiloto de IA (ADR 0021): equipe usa; dono/admin configuram a chave e o orçamento.
        Route::middleware('staff')->group(function (): void {
            Route::get('/ai', [AiController::class, 'status'])->name('ai.status');
            Route::post('/reports/{report}/ai/analysis', [AiController::class, 'reportAnalysis'])->middleware('throttle:10,1')->name('reports.ai.analysis');
            Route::post('/projects/{project}/ai/ask', [AiController::class, 'ask'])->middleware('throttle:20,1')->name('projects.ai.ask');
        });
        Route::middleware('tenant.admin')->group(function (): void {
            Route::put('/ai', [AiController::class, 'update'])->name('ai.update');
            Route::delete('/ai/key', [AiController::class, 'deleteKey'])->name('ai.key.delete');
        });

        // Marca da agência (white label): todos leem; dono/admin gravam.
        Route::get('/branding', [BrandingController::class, 'show'])->name('branding.show');
        Route::middleware('tenant.admin')->group(function (): void {
            Route::put('/branding', [BrandingController::class, 'update'])->name('branding.update');
            Route::post('/branding/logo', [BrandingController::class, 'uploadLogo'])->middleware('throttle:20,1')->name('branding.logo');
            Route::delete('/branding/logo', [BrandingController::class, 'deleteLogo'])->name('branding.logo.delete');
            Route::post('/branding/domain/verify', [BrandingController::class, 'verifyDomain'])->middleware('throttle:10,1')->name('branding.domain.verify');
        });

        // Publishing (ADR 0028): todos leem (cliente só os projetos dele, pelo RLS); a equipe grava.
        Route::get('/publishing/networks', [PostController::class, 'networks'])->name('publishing.networks');
        Route::get('/media', [MediaController::class, 'index'])->name('media.index');
        Route::get('/posts', [PostController::class, 'index'])->name('posts.index');
        Route::get('/posts/{post}', [PostController::class, 'show'])->name('posts.show');
        Route::middleware('staff')->group(function (): void {
            Route::post('/media', [MediaController::class, 'store'])->middleware('throttle:60,1')->name('media.store');
            Route::delete('/media/{media}', [MediaController::class, 'destroy'])->name('media.destroy');
            Route::post('/posts', [PostController::class, 'store'])->name('posts.store');
            Route::patch('/posts/{post}', [PostController::class, 'update'])->name('posts.update');
            Route::delete('/posts/{post}', [PostController::class, 'destroy'])->name('posts.destroy');
            Route::post('/posts/{post}/approval', [PostController::class, 'requestApproval'])->middleware('throttle:20,1')->name('posts.approval');
            Route::post('/posts/{post}/schedule', [PostController::class, 'schedule'])->name('posts.schedule');
            Route::post('/posts/{post}/unschedule', [PostController::class, 'unschedule'])->name('posts.unschedule');
            Route::post('/posts/{post}/publish', [PostController::class, 'publish'])->middleware('throttle:20,1')->name('posts.publish');
            Route::post('/posts/{post}/cancel', [PostController::class, 'cancel'])->name('posts.cancel');
        });

        // Studio (ADR 0029): apresentações geradas por IA. Equipe.
        Route::middleware('staff')->group(function (): void {
            Route::get('/presentations', [PresentationController::class, 'index'])->name('presentations.index');
            Route::post('/presentations', [PresentationController::class, 'store'])->middleware('throttle:10,1')->name('presentations.store');
            Route::get('/presentations/{presentation}', [PresentationController::class, 'show'])->name('presentations.show');
            Route::patch('/presentations/{presentation}', [PresentationController::class, 'update'])->name('presentations.update');
            Route::delete('/presentations/{presentation}', [PresentationController::class, 'destroy'])->name('presentations.destroy');
            Route::get('/presentations/{presentation}/versions/{number}', [PresentationController::class, 'version'])->whereNumber('number')->name('presentations.version');
            Route::post('/presentations/{presentation}/revise', [PresentationController::class, 'revise'])->middleware('throttle:20,1')->name('presentations.revise');
            Route::post('/presentations/{presentation}/restore', [PresentationController::class, 'restore'])->name('presentations.restore');
            Route::post('/presentations/{presentation}/retry', [PresentationController::class, 'retry'])->middleware('throttle:10,1')->name('presentations.retry');
            Route::get('/presentations/{presentation}/pdf', [PresentationController::class, 'pdf'])->middleware('throttle:20,1')->name('presentations.pdf');
        });

        // Gestão de Meta Ads (ADR 0030): equipe.
        Route::middleware('staff')->prefix('ads')->group(function (): void {
            Route::get('/accounts', [AdsController::class, 'accounts'])->name('ads.accounts');
            Route::get('/accounts/{account}/campaigns', [AdsController::class, 'campaigns'])->middleware('throttle:60,1')->name('ads.campaigns');
            Route::post('/accounts/{account}/changes', [AdsController::class, 'change'])->middleware('throttle:30,1')->name('ads.change');
            Route::get('/changes', [AdsController::class, 'changes'])->name('ads.changes');
        });

        // Plano e uso da agência (ADR 0031): dono e administrador.
        Route::get('/billing', [BillingController::class, 'show'])->middleware('tenant.admin')->name('billing.show');

        // Sync para Google Sheets (ADR 0027): equipe da agência.
        Route::middleware('staff')->group(function (): void {
            Route::get('/sync/destinations', [SheetSyncController::class, 'destinations'])->name('sync.destinations');
            Route::delete('/sync/destinations/{connection}', [SheetSyncController::class, 'destroyDestination'])->name('sync.destinations.destroy');
            Route::get('/sheet-syncs', [SheetSyncController::class, 'index'])->name('sheet-syncs.index');
            Route::post('/sheet-syncs', [SheetSyncController::class, 'store'])->middleware('throttle:20,1')->name('sheet-syncs.store');
            Route::get('/sheet-syncs/{sheetSync}', [SheetSyncController::class, 'show'])->name('sheet-syncs.show');
            Route::patch('/sheet-syncs/{sheetSync}', [SheetSyncController::class, 'update'])->name('sheet-syncs.update');
            Route::delete('/sheet-syncs/{sheetSync}', [SheetSyncController::class, 'destroy'])->name('sheet-syncs.destroy');
            Route::post('/sheet-syncs/{sheetSync}/run', [SheetSyncController::class, 'run'])->middleware('throttle:6,1')->name('sheet-syncs.run');
        });

        // Importador do Reportei (ADR 0022): só dono e administrador.
        Route::middleware('tenant.admin')->group(function (): void {
            Route::get('/imports', [ImportController::class, 'index'])->name('imports.index');
            Route::get('/imports/{import}', [ImportController::class, 'show'])->name('imports.show');
            Route::post('/imports/reportei', [ImportController::class, 'store'])->middleware('throttle:5,1')->name('imports.reportei');
        });

        // API pública e webhooks: só dono e administrador (ADR 0020).
        Route::middleware('tenant.admin')->group(function (): void {
            Route::get('/api-tokens', [ApiTokenController::class, 'index'])->name('api-tokens.index');
            Route::post('/api-tokens', [ApiTokenController::class, 'store'])->middleware('throttle:20,1')->name('api-tokens.store');
            Route::delete('/api-tokens/{apiToken}', [ApiTokenController::class, 'destroy'])->name('api-tokens.destroy');
            Route::get('/webhooks', [WebhookController::class, 'index'])->name('webhooks.index');
            Route::post('/webhooks', [WebhookController::class, 'store'])->middleware('throttle:20,1')->name('webhooks.store');
            Route::put('/webhooks/{webhook}', [WebhookController::class, 'update'])->name('webhooks.update');
            Route::delete('/webhooks/{webhook}', [WebhookController::class, 'destroy'])->name('webhooks.destroy');
            Route::post('/webhooks/{webhook}/rotate', [WebhookController::class, 'rotate'])->name('webhooks.rotate');
            Route::post('/webhooks/{webhook}/test', [WebhookController::class, 'test'])->middleware('throttle:20,1')->name('webhooks.test');
            Route::get('/webhooks/{webhook}/deliveries', [WebhookController::class, 'deliveries'])->name('webhooks.deliveries');
        });

        // Equipe e convites: só dono e administrador (regras de dono no TeamMembers).
        Route::middleware('tenant.admin')->prefix('team')->group(function (): void {
            Route::get('/', [TeamController::class, 'index'])->name('team.index');
            Route::patch('/members/{userId}', [TeamController::class, 'update'])->whereUuid('userId')->name('team.members.update');
            Route::delete('/members/{userId}', [TeamController::class, 'destroy'])->whereUuid('userId')->name('team.members.destroy');
            Route::post('/invitations', [TeamInvitationController::class, 'store'])->middleware('throttle:30,1')->name('team.invitations.store');
            Route::post('/invitations/{invitation}/resend', [TeamInvitationController::class, 'resend'])->whereUuid('invitation')->middleware('throttle:30,1')->name('team.invitations.resend');
            Route::delete('/invitations/{invitation}', [TeamInvitationController::class, 'destroy'])->whereUuid('invitation')->name('team.invitations.destroy');
        });

        // Apps das plataformas (credenciais OAuth da agência): só dono e administrador.
        Route::middleware('tenant.admin')->prefix('platform-apps')->group(function (): void {
            Route::get('/', [PlatformAppController::class, 'index'])->name('platform-apps.index');
            // Salvar e testar falam com a plataforma: limite próprio.
            Route::put('/{vendor}', [PlatformAppController::class, 'update'])->middleware('throttle:10,1')->name('platform-apps.update');
            Route::post('/{vendor}/verify', [PlatformAppController::class, 'check'])->middleware('throttle:10,1')->name('platform-apps.verify');
            Route::delete('/{vendor}', [PlatformAppController::class, 'destroy'])->name('platform-apps.destroy');
        });
    });
});
