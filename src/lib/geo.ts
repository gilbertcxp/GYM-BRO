// Cálculos geográficos del seguimiento GPS (funciones puras, con pruebas).
import type { CardioActivity } from './cardio'

/** [lat, lng, segundos activos desde el inicio, segmento]. El segmento cambia tras cada pausa. */
export type RoutePoint = [number, number, number, number]

export interface Fix { lat: number; lng: number; accuracy: number; time: number }

const EARTH_RADIUS_M = 6_371_008.8

/** Distancia de gran círculo (haversine) en metros. */
export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Precisión mínima aceptada (m). Lecturas peores (p. ej. por triangulación de antenas) se descartan. */
export const MAX_ACCURACY_M = 35

/** Velocidad máxima plausible por actividad (m/s); por encima se considera un salto de GPS. */
const MAX_SPEED: Partial<Record<CardioActivity, number>> = {
  walking: 4, running: 10, treadmill: 10, hiit: 10, jump_rope: 10, stairs: 4,
  cycling: 25, stationary_bike: 25, swimming: 3, rowing: 6, elliptical: 10,
}
export const maxSpeedFor = (a: CardioActivity) => MAX_SPEED[a] ?? 15

export type FixVerdict =
  | { accept: true; meters: number }
  | { accept: false; reason: 'low_accuracy' | 'stale' | 'jitter' | 'jump' }

/**
 * Decide si una lectura nueva se usa y cuánta distancia suma respecto al último punto aceptado.
 * - Descarta lecturas imprecisas o repetidas.
 * - Ignora micro-movimientos dentro del margen de error (evita sumar "ruido" estando quieto).
 * - Descarta saltos que implicarían una velocidad imposible para la actividad.
 */
export function judgeFix(prev: Fix | null, fix: Fix, activity: CardioActivity): FixVerdict {
  if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lng) || fix.accuracy > MAX_ACCURACY_M) return { accept: false, reason: 'low_accuracy' }
  if (!prev) return { accept: true, meters: 0 }
  const dt = (fix.time - prev.time) / 1000
  if (dt <= 0) return { accept: false, reason: 'stale' }
  const d = haversineMeters(prev, fix)
  const noise = Math.max(3, (fix.accuracy + prev.accuracy) / 4)
  if (d < noise) return { accept: false, reason: 'jitter' }
  if (d / dt > maxSpeedFor(activity)) return { accept: false, reason: 'jump' }
  return { accept: true, meters: d }
}

/** Distancia total de la ruta en metros, sin unir puntos de segmentos distintos (pausas). */
export function routeDistanceMeters(points: RoutePoint[]) {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const [la, lo, , sa] = points[i - 1]
    const [lb, lob, , sb] = points[i]
    if (sa === sb) total += haversineMeters({ lat: la, lng: lo }, { lat: lb, lng: lob })
  }
  return total
}

/** Separa la ruta en tramos continuos (para dibujar una línea por segmento). */
export function routeSegments(points: RoutePoint[]): [number, number][][] {
  const out: [number, number][][] = []
  let cur: [number, number][] = []
  let seg: number | null = null
  for (const [lat, lng, , s] of points) {
    if (seg !== null && s !== seg) { if (cur.length) out.push(cur); cur = [] }
    seg = s
    cur.push([lat, lng])
  }
  if (cur.length) out.push(cur)
  return out
}

export interface KmSplit { km: number; seconds: number; lat: number; lng: number; partialMeters?: number }

/**
 * Parciales por kilómetro: posición interpolada donde se cruza cada km y el tiempo
 * empleado en ese km. El último tramo incompleto se devuelve con `partialMeters`.
 */
export function kmSplits(points: RoutePoint[]): KmSplit[] {
  const out: KmSplit[] = []
  let dist = 0
  let lastMarkTime = points[0]?.[2] ?? 0
  let nextKm = 1000
  for (let i = 1; i < points.length; i++) {
    const [la, lo, ta, sa] = points[i - 1]
    const [lb, lob, tb, sb] = points[i]
    if (sa !== sb) continue
    const d = haversineMeters({ lat: la, lng: lo }, { lat: lb, lng: lob })
    while (d > 0 && dist + d >= nextKm) {
      const f = (nextKm - dist) / d
      const t = ta + (tb - ta) * f
      out.push({ km: nextKm / 1000, seconds: t - lastMarkTime, lat: la + (lb - la) * f, lng: lo + (lob - lo) * f })
      lastMarkTime = t
      nextKm += 1000
    }
    dist += d
  }
  const rest = dist - (nextKm - 1000)
  const last = points[points.length - 1]
  if (last && rest >= 50) out.push({ km: dist / 1000, seconds: last[2] - lastMarkTime, lat: last[0], lng: last[1], partialMeters: rest })
  return out
}
