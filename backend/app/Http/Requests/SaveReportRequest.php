<?php

declare(strict_types=1);

namespace App\Http\Requests;

use App\Domain\Metrics\Query\Comparison;
use App\Domain\Reports\ReportPeriod;
use App\Domain\Reports\ReportTemplates;
use App\Http\Requests\Concerns\RequiresStaff;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Criação (POST, com project_id e modelo opcional), edição (PUT, com layout) e prévia
 * (render, tudo opcional: o que vier sobrepõe o salvo). O layout é validado no ReportLayout.
 */
final class SaveReportRequest extends FormRequest
{
    use RequiresStaff;

    /** @return array<string, mixed> */
    public function rules(): array
    {
        $creating = $this->isMethod('post') && $this->route('report') === null;
        $updating = $this->isMethod('put');
        $required = $creating || $updating ? 'required' : 'sometimes';

        return [
            'project_id' => [$creating ? 'required' : 'prohibited', 'uuid'],
            'template' => [$creating ? 'nullable' : 'prohibited', Rule::in(array_column(ReportTemplates::all(), 'key'))],
            'title' => [$required, 'string', 'min:2', 'max:120'],
            'period_preset' => [$creating ? 'sometimes' : $required, Rule::in(array_keys(ReportPeriod::PRESETS))],
            'period_start' => ['nullable', 'required_if:period_preset,custom', 'date_format:Y-m-d'],
            'period_end' => ['nullable', 'required_if:period_preset,custom', 'date_format:Y-m-d'],
            'compare' => [$creating ? 'sometimes' : $required, Rule::enum(Comparison::class)],
            'layout' => [$updating ? 'required' : 'sometimes', 'array'],
        ];
    }

    /** @return array<string, string> */
    public function messages(): array
    {
        return [
            'title.required' => 'Dê um título ao relatório.',
            'title.min' => 'O título precisa de pelo menos 2 caracteres.',
            'project_id.required' => 'Escolha o projeto do relatório.',
            'period_start.required_if' => 'Informe a data de início.',
            'period_end.required_if' => 'Informe a data de fim.',
            'template.in' => 'Modelo de relatório desconhecido.',
        ];
    }
}
