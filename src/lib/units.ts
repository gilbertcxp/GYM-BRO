import type { WeightUnit } from './types'
import { formatNumber } from './utils'

export const LB_PER_KG = 2.2046226218

export const kgTo = (kg: number, unit: WeightUnit) => (unit === 'kg' ? kg : kg * LB_PER_KG)
export const toKg = (value: number, unit: WeightUnit) => (unit === 'kg' ? value : value / LB_PER_KG)

/** Redondea al incremento típico de discos (0.25 kg / 0.5 lb) para mostrar. */
export function displayWeight(kg: number, unit: WeightUnit) {
  const v = kgTo(kg, unit)
  return Math.round(v * (unit === 'kg' ? 4 : 2)) / (unit === 'kg' ? 4 : 2)
}

export function fmtWeight(kg: number | null | undefined, unit: WeightUnit, digits = 1) {
  if (kg === null || kg === undefined) return '—'
  return `${formatNumber(kgTo(kg, unit), digits)} ${unit}`
}

/** Volumen grande: sin decimales. */
export function fmtVolume(kg: number | null | undefined, unit: WeightUnit) {
  if (kg === null || kg === undefined) return '—'
  return `${formatNumber(kgTo(kg, unit), 0)} ${unit}`
}

export const weightStep = (unit: WeightUnit) => (unit === 'kg' ? 2.5 : 5)
