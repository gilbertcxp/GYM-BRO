// Cardio: etiquetas, unidades y cálculos derivados de sesiones registradas.
import { parseISO } from 'date-fns'
import { inRange, weekKey, type DateRange } from './dates'
import type { WeightUnit } from './types'

export type CardioActivity =
  | 'running' | 'treadmill' | 'walking' | 'cycling' | 'stationary_bike' | 'elliptical'
  | 'rowing' | 'stairs' | 'swimming' | 'jump_rope' | 'hiit' | 'other'

export interface CardioSession {
  id: string
  user_id: string
  activity: CardioActivity
  started_at: string
  duration_seconds: number
  distance_km: number | null
  calories: number | null
  avg_heart_rate: number | null
  max_heart_rate: number | null
  rpe: number | null
  incline_pct: number | null
  notes: string | null
  created_at: string
  tracking_mode: 'manual' | 'gps'
  ended_at: string | null
}

export const CARDIO_LABELS: Record<CardioActivity, string> = {
  running: 'Correr (exterior)', treadmill: 'Cinta / caminadora', walking: 'Caminar', cycling: 'Bicicleta (exterior)',
  stationary_bike: 'Bicicleta estática', elliptical: 'Elíptica', rowing: 'Remo', stairs: 'Escaladora',
  swimming: 'Natación', jump_rope: 'Saltar la cuerda', hiit: 'HIIT / intervalos', other: 'Otro',
}
export const CARDIO_ACTIVITIES = Object.keys(CARDIO_LABELS) as CardioActivity[]

/** Actividades donde el ritmo (min/km) es la métrica habitual; en el resto se usa velocidad. */
const PACE_ACTIVITIES = new Set<CardioActivity>(['running', 'treadmill', 'walking', 'swimming', 'rowing'])
export const usesPace = (a: CardioActivity) => PACE_ACTIVITIES.has(a)
/** Actividades donde normalmente se registra distancia. */
export const DISTANCE_ACTIVITIES = new Set<CardioActivity>(['running', 'treadmill', 'walking', 'cycling', 'stationary_bike', 'elliptical', 'rowing', 'swimming'])
export const supportsIncline = (a: CardioActivity) => a === 'treadmill' || a === 'walking'

export const KM_PER_MI = 1.609344
/** Distancia: km si el usuario usa kg, millas si usa libras. */
export const distUnit = (u: WeightUnit) => (u === 'kg' ? 'km' : 'mi')
export const kmTo = (km: number, u: WeightUnit) => (u === 'kg' ? km : km / KM_PER_MI)
export const toKm = (v: number, u: WeightUnit) => (u === 'kg' ? v : v * KM_PER_MI)

/** Segundos por unidad de distancia (null si no hay distancia). */
export function paceSecondsPer(s: Pick<CardioSession, 'duration_seconds' | 'distance_km'>, u: WeightUnit) {
  if (!s.distance_km || s.distance_km <= 0) return null
  return s.duration_seconds / kmTo(Number(s.distance_km), u)
}

/** Velocidad media en km/h o mi/h. */
export function speedPerHour(s: Pick<CardioSession, 'duration_seconds' | 'distance_km'>, u: WeightUnit) {
  if (!s.distance_km || s.duration_seconds <= 0) return null
  return kmTo(Number(s.distance_km), u) / (s.duration_seconds / 3600)
}

/** "5:30" (min:seg). */
export function fmtPace(secPer: number | null) {
  if (secPer === null || !Number.isFinite(secPer)) return '—'
  const total = Math.round(secPer)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export interface CardioTotals { sessions: number; seconds: number; km: number; calories: number; caloriesSessions: number }

export function cardioTotals(list: CardioSession[]): CardioTotals {
  return list.reduce<CardioTotals>((t, s) => {
    t.sessions++
    t.seconds += s.duration_seconds
    t.km += Number(s.distance_km ?? 0)
    if (s.calories) { t.calories += s.calories; t.caloriesSessions++ }
    return t
  }, { sessions: 0, seconds: 0, km: 0, calories: 0, caloriesSessions: 0 })
}

export const cardioIn = (list: CardioSession[], r: DateRange) => list.filter((s) => inRange(s.started_at, r))

/** Minutos y distancia por semana (lunes), en orden cronológico. */
export function cardioByWeek(list: CardioSession[]) {
  const out = new Map<string, { minutes: number; km: number; sessions: number }>()
  for (const s of list) {
    const k = weekKey(s.started_at)
    const cur = out.get(k) ?? { minutes: 0, km: 0, sessions: 0 }
    cur.minutes += s.duration_seconds / 60
    cur.km += Number(s.distance_km ?? 0)
    cur.sessions++
    out.set(k, cur)
  }
  return new Map([...out.entries()].sort(([a], [b]) => a.localeCompare(b)))
}

export interface CardioBests { longestDistance?: CardioSession; longestDuration?: CardioSession; bestPace?: CardioSession; bestSpeed?: CardioSession }

/** Mejores marcas de una actividad (ritmo solo cuenta sesiones de al menos 1 km para evitar valores engañosos). */
export function cardioBests(list: CardioSession[], activity: CardioActivity): CardioBests {
  const b: CardioBests = {}
  for (const s of list) {
    if (s.activity !== activity) continue
    const km = Number(s.distance_km ?? 0)
    if (km > 0 && (!b.longestDistance || km > Number(b.longestDistance.distance_km))) b.longestDistance = s
    if (!b.longestDuration || s.duration_seconds > b.longestDuration.duration_seconds) b.longestDuration = s
    if (km >= 1) {
      const pace = s.duration_seconds / km
      if (!b.bestPace || pace < b.bestPace.duration_seconds / Number(b.bestPace.distance_km)) b.bestPace = s
      if (!b.bestSpeed || km / s.duration_seconds > Number(b.bestSpeed.distance_km) / b.bestSpeed.duration_seconds) b.bestSpeed = s
    }
  }
  return b
}

/** Ordena de más reciente a más antigua. */
export const sortCardio = (list: CardioSession[]) => [...list].sort((a, b) => parseISO(b.started_at).getTime() - parseISO(a.started_at).getTime())

/**
 * MET aproximados (Compendium of Physical Activities). La velocidad ajusta caminar, correr y bicicleta.
 * Sirven solo para una ESTIMACIÓN de calorías: kcal ≈ MET × peso (kg) × horas.
 */
export function metFor(activity: CardioActivity, speedKmh: number | null): number {
  const v = speedKmh ?? 0
  switch (activity) {
    case 'walking': return v >= 6 ? 5 : v >= 4.8 ? 3.8 : 3
    case 'running':
    case 'treadmill':
      if (v > 0 && v < 6.5) return v >= 4.8 ? 3.8 : 3 // a ese ritmo es caminar
      return v ? Math.max(6, Math.min(16, v)) : 9.8 // correr ≈ 1 MET por km/h
    case 'cycling': return v >= 25 ? 10 : v >= 22 ? 8 : v >= 19 ? 6.8 : v >= 16 ? 5.8 : 4
    case 'stationary_bike': return 6.8
    case 'elliptical': return 5
    case 'rowing': return 7
    case 'stairs': return 9
    case 'swimming': return 7
    case 'jump_rope': return 11
    case 'hiit': return 8
    default: return 5
  }
}

/** Calorías ESTIMADAS (null sin peso corporal registrado). */
export function estimateCalories(s: Pick<CardioSession, 'activity' | 'duration_seconds' | 'distance_km'>, weightKg: number | null | undefined) {
  if (!weightKg || s.duration_seconds <= 0) return null
  const speed = s.distance_km ? Number(s.distance_km) / (s.duration_seconds / 3600) : null
  return Math.round(metFor(s.activity, speed) * weightKg * (s.duration_seconds / 3600))
}

/** Actividades al aire libre donde tiene sentido el GPS. */
export const GPS_ACTIVITIES = new Set<CardioActivity>(['running', 'walking', 'cycling', 'swimming', 'rowing', 'other'])
