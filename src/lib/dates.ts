import {
  addDays, endOfMonth, endOfQuarter, endOfWeek, endOfYear, format, parseISO,
  startOfMonth, startOfQuarter, startOfWeek, startOfYear, subDays,
} from 'date-fns'
import { es } from 'date-fns/locale'

// Semanas de lunes a domingo, igual que date_trunc('week') en Postgres.
export const WEEK_OPTS = { weekStartsOn: 1 as const }

export type RangePreset = 'week' | 'month' | 'quarter' | 'year' | 'custom'
export interface DateRange { from: Date; to: Date }

export const RANGE_LABELS: Record<RangePreset, string> = {
  week: 'Semana', month: 'Mes', quarter: 'Trimestre', year: 'Año', custom: 'Personalizado',
}

export function presetRange(preset: Exclude<RangePreset, 'custom'>, now = new Date()): DateRange {
  switch (preset) {
    case 'week': return { from: startOfWeek(now, WEEK_OPTS), to: endOfWeek(now, WEEK_OPTS) }
    case 'month': return { from: startOfMonth(now), to: endOfMonth(now) }
    case 'quarter': return { from: startOfQuarter(now), to: endOfQuarter(now) }
    case 'year': return { from: startOfYear(now), to: endOfYear(now) }
  }
}

/** Período inmediatamente anterior de igual duración (para comparar). */
export function previousRange(r: DateRange): DateRange {
  const days = Math.round((r.to.getTime() - r.from.getTime()) / 86400000)
  const to = subDays(r.from, 1)
  return { from: subDays(to, days), to }
}

/** Fecha local 'yyyy-MM-dd' de un instante ISO (zona horaria del dispositivo). */
export const localDay = (iso: string | Date) => format(typeof iso === 'string' ? parseISO(iso) : iso, 'yyyy-MM-dd')
export const todayKey = () => localDay(new Date())
export const parseDay = (day: string) => parseISO(day)

export const inRange = (iso: string, r: DateRange) => {
  const t = parseISO(iso).getTime()
  return t >= r.from.getTime() && t <= endOfDayMs(r.to)
}
const endOfDayMs = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime()

export const fmtDate = (d: string | Date, pattern = "d 'de' MMM yyyy") =>
  format(typeof d === 'string' ? parseISO(d) : d, pattern, { locale: es })
export const fmtShort = (d: string | Date) => fmtDate(d, 'd MMM')
export const fmtDateTime = (d: string | Date) => fmtDate(d, "d MMM yyyy, HH:mm")

export function weekKey(iso: string | Date) {
  return localDay(startOfWeek(typeof iso === 'string' ? parseISO(iso) : iso, WEEK_OPTS))
}
export function monthKey(iso: string | Date) {
  return format(typeof iso === 'string' ? parseISO(iso) : iso, 'yyyy-MM')
}

export function daysBetween(fromDay: string, toDay: string) {
  return Math.round((parseISO(toDay).getTime() - parseISO(fromDay).getTime()) / 86400000)
}

export { addDays }
