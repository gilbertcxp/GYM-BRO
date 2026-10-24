import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const uuid = () => crypto.randomUUID()

export function formatNumber(n: number | null | undefined, digits = 0) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return n.toLocaleString('es-DO', { minimumFractionDigits: 0, maximumFractionDigits: digits })
}

export function formatDuration(totalSeconds: number) {
  const s = Math.max(0, Math.round(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}m`
  if (m > 0) return `${m}m ${sec.toString().padStart(2, '0')}s`
  return `${sec}s`
}

export function formatClock(totalSeconds: number) {
  const s = Math.max(0, Math.round(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = m.toString().padStart(2, '0')
  const ss = sec.toString().padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export function pctChange(from: number | null | undefined, to: number | null | undefined) {
  if (from === null || from === undefined || to === null || to === undefined || from === 0) return null
  return ((to - from) / Math.abs(from)) * 100
}

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?'
}

/** Convierte '' / undefined a null y strings numéricos a número. */
export function numOrNull(v: unknown): number | null {
  if (v === '' || v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}
