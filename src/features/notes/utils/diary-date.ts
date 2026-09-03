/**
 * Utilitários para Datas e Fuso Horário do DIÁRIO no ANOTADO!
 *
 * Garante que a data real de cada dia seja determinada e preservada de forma consistente
 * usando a data local do usuário, sem sofrer desvios UTC (evita que 02/09 vire 01/09).
 */

export const MONTH_NAMES: readonly string[] = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
] as const;

export const MONTH_SHORT_NAMES: readonly string[] = [
  'Jan',
  'Fev',
  'Mar',
  'Abr',
  'Mai',
  'Jun',
  'Jul',
  'Ago',
  'Set',
  'Out',
  'Nov',
  'Dez',
] as const;

/**
 * Retorna a data local formatada no padrão canônico YYYY-MM-DD.
 * Nunca utiliza toISOString() diretamente para evitar recuo de fuso horário UTC.
 */
export function getLocalDateString(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Converte uma data string YYYY-MM-DD em partes numéricas seguras.
 */
export function parseDiaryDate(dateStr: string): { year: number; month: number; day: number } {
  if (!dateStr || typeof dateStr !== 'string') {
    const today = new Date();
    return {
      year: today.getFullYear(),
      month: today.getMonth() + 1,
      day: today.getDate(),
    };
  }

  const parts = dateStr.trim().split('-');
  if (parts.length === 3) {
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const day = parseInt(parts[2], 10);
    if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
      return { year, month, day };
    }
  }

  const fallback = new Date(dateStr);
  if (!isNaN(fallback.getTime())) {
    return {
      year: fallback.getFullYear(),
      month: fallback.getMonth() + 1,
      day: fallback.getDate(),
    };
  }

  const today = new Date();
  return {
    year: today.getFullYear(),
    month: today.getMonth() + 1,
    day: today.getDate(),
  };
}

/**
 * Cria uma string YYYY-MM-DD a partir de componentes numéricos.
 */
export function buildDiaryDateString(year: number, month: number, day: number): string {
  const y = String(year);
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Formata o título canônico da entrada diária.
 * Exemplo:
 * - "Dia 01" (se não houver título personalizado)
 * - "Dia 01 — Viagem para Brasília" (se houver título personalizado)
 */
export function formatDiaryTitle(day: number, customTitle?: string | null): string {
  const dayStr = `Dia ${String(day).padStart(2, '0')}`;
  const trimmed = customTitle ? customTitle.trim() : '';

  if (!trimmed || trimmed === dayStr) {
    return dayStr;
  }

  // Se já começa com "Dia XX", preserva como o usuário digitou
  if (/^dia\s+\d{1,2}/i.test(trimmed)) {
    return trimmed;
  }

  return `${dayStr} — ${trimmed}`;
}

/**
 * Retorna o título exibível para a lista ou título principal.
 * Se o título já for "Dia 01 — ...", extrai apenas a parte personalizada para edição se desejado.
 */
export function extractCustomTitle(title: string): string {
  if (!title) return '';
  const match = title.match(/^dia\s+\d{1,2}\s*(?:—|-|:)?\s*(.*)$/i);
  if (match && match[1]) {
    return match[1].trim();
  }
  return title.trim();
}

/**
 * Formata a data completa por extenso em português.
 * Exemplo: "03 de Setembro de 2026"
 */
export function formatFullDateDisplay(dateStr: string): string {
  const { year, month, day } = parseDiaryDate(dateStr);
  const monthName = MONTH_NAMES[month - 1] || `Mês ${month}`;
  const dayStr = String(day).padStart(2, '0');
  return `${dayStr} de ${monthName} de ${year}`;
}

/**
 * Retorna formato legível curto/médio para badges e títulos.
 * Exemplo: "03 de Setembro de 2026"
 */
export function formatDateReadable(dateStr: string): string {
  return formatFullDateDisplay(dateStr);
}

/**
 * Retorna o nome do dia da semana (ex: "Quinta-feira").
 */
export function getWeekdayName(dateStr: string): string {
  const { year, month, day } = parseDiaryDate(dateStr);
  // Usa construtor local seguro
  const date = new Date(year, month - 1, day);
  const weekdays = [
    'Domingo',
    'Segunda-feira',
    'Terça-feira',
    'Quarta-feira',
    'Quinta-feira',
    'Sexta-feira',
    'Sábado',
  ];
  return weekdays[date.getDay()] || '';
}

/**
 * Retorna o número de dias de um determinado mês em um determinado ano.
 */
export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}
