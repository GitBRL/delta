/** Nichos usados para calibrar modelos e o semáforo de atenção (ver §7 do planejamento). */
export const NICHES = [
  { value: 'ecommerce', label: 'E-commerce' },
  { value: 'infoproduto', label: 'Infoproduto' },
  { value: 'negocio_local', label: 'Negócio local' },
  { value: 'b2b', label: 'B2B' },
  { value: 'restaurante_delivery', label: 'Restaurante / delivery' },
  { value: 'outro', label: 'Outro' },
] as const;

export function nicheLabel(value: string | null | undefined): string {
  if (!value) return 'Sem nicho';
  return NICHES.find((n) => n.value === value)?.label ?? value;
}
