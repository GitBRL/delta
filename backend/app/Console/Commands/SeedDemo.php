<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Actions\Fortify\CreateNewUser;
use App\Domain\Automations\MessageComposer;
use App\Domain\Automations\Schedule;
use App\Domain\Contacts\Contacts;
use App\Domain\Integrations\ConnectionManager;
use App\Domain\Metrics\Catalog\Catalog;
use App\Domain\Metrics\Catalog\MetricSet;
use App\Domain\Metrics\Query\Comparison;
use App\Domain\Reports\ReportLayout;
use App\Domain\Reports\ReportPublisher;
use App\Domain\Reports\ReportTemplates;
use App\Domain\Reports\SharedReports;
use App\Models\Automation;
use App\Models\IntegrationConnection;
use App\Models\Project;
use App\Models\Report;
use App\Support\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Agência de demonstração pronta para explorar (só ambiente local): projetos de nichos
 * diferentes, contas de demonstração sincronizadas, contatos com consentimento, relatórios
 * publicados com link público e um envio automático semanal. Idempotente: se a conta já
 * existir, só mostra os acessos.
 */
#[Signature('delta:demo {--email=demo@delta.local} {--password=Delta-demo-2026}')]
#[Description('Cria a agência de demonstração para usar o Delta localmente')]
final class SeedDemo extends Command
{
    /** Projeto => [nicho, metas, canais]. Cada canal vira uma conexão de demonstração própria. */
    private const PROJECTS = [
        'Padaria Aurora' => ['restaurante_delivery', ['gross_margin_pct' => 35.0, 'target_cpa' => 45.0], ['meta_ads', 'instagram']],
        'Loja Vértice' => ['ecommerce', ['gross_margin_pct' => 40.0, 'target_roas' => 4.0], ['meta_ads', 'google_ads', 'ga4']],
        'Clínica Sorriso Pleno' => ['negocio_local', ['target_cpa' => 60.0], ['google_ads', 'facebook', 'instagram']],
        'Curso Alfa' => ['infoproduto', ['gross_margin_pct' => 70.0], ['meta_ads', 'ga4']],
    ];

    public function handle(CreateNewUser $creator, TenantContext $context, ConnectionManager $connections, Contacts $contacts, ReportPublisher $publisher, SharedReports $shared, Catalog $catalog): int
    {
        if (app()->environment('production')) {
            $this->error('A demonstração é só para ambiente local.');

            return self::FAILURE;
        }

        $email = (string) $this->option('email');
        $password = (string) $this->option('password');

        if (DB::scalar('select app.email_taken(?)', [$email]) === true) {
            $this->info("A conta de demonstração já existe: {$email} / {$password}");

            return self::SUCCESS;
        }

        $this->info('Criando a agência de demonstração…');
        $user = $creator->create(['name' => 'Ana Demonstração', 'email' => $email, 'password' => $password, 'password_confirmation' => $password, 'company_name' => 'Agência Delta Demo']);
        $tenantId = $context->run(null, $user->id, fn (): mixed => DB::table('tenant_user')->where('user_id', $user->id)->value('tenant_id'));
        if (! is_string($tenantId)) {
            $this->error('Não foi possível encontrar a agência criada.');

            return self::FAILURE;
        }

        // A demonstração mostra tudo: plano Agência ativo (ADR 0031).
        $this->callSilently('billing:plan', ['tenant' => $tenantId, 'plan' => 'agencia', '--status' => 'active', '--days' => 3650]);

        $links = $context->run($tenantId, $user->id, function () use ($user, $connections, $contacts, $publisher, $shared, $catalog): array {
            $projects = [];
            foreach (self::PROJECTS as $name => [$niche, $goals, $channels]) {
                $project = Project::query()->create(['name' => $name, 'niche' => $niche, 'settings' => $goals]);
                $accountIds = [];
                foreach ($channels as $channel) {
                    $connection = $connections->connectSandbox($channel, $user->id);
                    $accountIds = [...$accountIds, ...$connection->accounts()->pluck('id')->all()];
                }
                $project->accounts()->sync($accountIds);
                $projects[$name] = $project;
                $this->line("  • {$name}: ".implode(', ', $channels));
            }

            $this->waitForSync();

            $set = MetricSet::forCurrentTenant($catalog);
            $links = [];
            foreach ($projects as $name => $project) {
                $providers = array_values(array_filter($project->accounts()->pluck('provider')->unique()->all(), 'is_string'));
                $report = Report::query()->create([
                    'project_id' => $project->id,
                    'title' => 'Relatório mensal · '.$name,
                    'template' => ReportTemplates::forNiche($project->niche),
                    'period_preset' => 'last_month',
                    'compare' => Comparison::PreviousPeriod,
                    'layout' => ReportLayout::normalize(ReportTemplates::build(ReportTemplates::forNiche($project->niche), $providers), $set),
                    'created_by' => $user->id,
                    'updated_by' => $user->id,
                ]);

                $snapshot = $publisher->publish($report);
                [, $token] = $shared->create($snapshot, null, null);
                $links[$name] = SharedReports::url($token);

                $marina = $contacts->save(null, [
                    'project_id' => $project->id, 'name' => 'Contato '.explode(' ', $name)[0], 'email' => 'contato@'.Str::slug($name).'.test',
                    'phone' => '11999990000', 'role' => 'Sócio(a)', 'email_opt_in' => true, 'whatsapp_opt_in' => true,
                ], '127.0.0.1');

                if ($name === 'Padaria Aurora') {
                    $automation = new Automation([
                        'project_id' => $project->id, 'report_id' => $report->id, 'name' => 'Resumo semanal da padaria',
                        'channels' => ['email', 'whatsapp'], 'frequency' => 'weekly', 'weekday' => 1, 'send_time' => '09:00',
                        'period_preset' => 'last_7', 'message' => MessageComposer::DEFAULT_MESSAGE, 'attach_pdf' => true,
                        'requires_approval' => true, 'active' => true, 'created_by' => $user->id,
                    ]);
                    $automation->next_run_at = Schedule::next($automation, CarbonImmutable::now());
                    $automation->save();
                    $automation->recipients()->sync([$marina->id]);
                }
            }

            return $links;
        });

        $this->newLine();
        $this->info('Pronto! Acesse http://localhost:4300');
        $this->line("  E-mail: {$email}");
        $this->line("  Senha:  {$password}");
        $this->newLine();
        $this->line('Relatórios publicados (link público, sem login):');
        foreach ($links as $name => $url) {
            $this->line("  {$name}: {$url}");
        }
        $this->line('E-mails enviados pelo Delta chegam no Mailpit: http://localhost:58025');

        return self::SUCCESS;
    }

    /** O histórico de 400 dias sincroniza na fila (Horizon); espera até 3 minutos. */
    private function waitForSync(): void
    {
        $this->line('Sincronizando o histórico das contas de demonstração (fila)…');
        $deadline = time() + 180;
        do {
            $pending = IntegrationConnection::query()->where('status', 'syncing')->count();
            if ($pending === 0) {
                return;
            }
            usleep(1_500_000);
        } while (time() < $deadline);

        $this->warn("Ainda há {$pending} conexão(ões) sincronizando; os relatórios podem sair parciais. Rode \"make restart-workers\" se a fila estiver parada.");
    }
}
