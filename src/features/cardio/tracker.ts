// Seguimiento de cardio en vivo (con o sin GPS).
// - El tiempo se calcula con marcas de tiempo (Date.now), no sumando intervalos, así no se desincroniza.
// - Cada cambio se guarda en localStorage: si se recarga o se cierra la pestaña, la sesión se recupera
//   y el GPS se reanuda. Mientras la página está cerrada o en segundo plano el navegador NO entrega
//   posiciones, así que ese tramo se une en línea recta solo si la velocidad resultante es plausible.
// - Al pausar se detiene el GPS y se abre un segmento nuevo: la distancia de la pausa no cuenta.
import { useSyncExternalStore } from 'react'
import type { CardioActivity } from '@/lib/cardio'
import { judgeFix, type Fix, type RoutePoint } from '@/lib/geo'

export type GpsStatus = 'off' | 'waiting' | 'ok' | 'denied' | 'unavailable' | 'unsupported'

export interface TrackerState {
  userId: string
  activity: CardioActivity
  useGps: boolean
  startedAt: string
  status: 'running' | 'paused' | 'finished'
  activeMs: number // tiempo activo acumulado antes del tramo actual
  runningSince: number | null // epoch ms del inicio del tramo actual
  endedAt: string | null
  segment: number
  points: RoutePoint[]
  distanceM: number
  anchor: Fix | null // última lectura aceptada del tramo actual
  gps: GpsStatus
  lastFixAt: number | null
  accuracy: number | null
  rejected: number
}

const KEY = 'gymbro.cardioTracker'
const subs = new Set<() => void>()
let state: TrackerState | null = load()
let watchId: number | null = null
let wakeLock: { release: () => Promise<void> } | null = null

function load(): TrackerState | null {
  try { return JSON.parse(localStorage.getItem(KEY) ?? 'null') as TrackerState | null } catch { return null }
}
function persist() {
  try { state ? localStorage.setItem(KEY, JSON.stringify(state)) : localStorage.removeItem(KEY) } catch { /* almacenamiento lleno o bloqueado */ }
}
function set(next: TrackerState | null) {
  state = next
  persist()
  subs.forEach((f) => f())
}
const patch = (p: Partial<TrackerState>) => state && set({ ...state, ...p })

export const elapsedMs = (s: TrackerState, now = Date.now()) => s.activeMs + (s.runningSince ? now - s.runningSince : 0)

// ---------- GPS ----------
function onPosition(pos: GeolocationPosition) {
  const s = state
  if (!s || s.status !== 'running' || !s.runningSince) return
  const fix: Fix = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, time: pos.timestamp || Date.now() }
  const verdict = judgeFix(s.anchor, fix, s.activity)
  const base = { gps: 'ok' as GpsStatus, lastFixAt: Date.now(), accuracy: Math.round(fix.accuracy) }
  if (!verdict.accept) return set({ ...s, ...base, rejected: s.rejected + 1 })
  const t = Math.max(0, Math.round((s.activeMs + (fix.time - s.runningSince)) / 1000))
  set({
    ...s, ...base,
    anchor: fix,
    distanceM: s.distanceM + verdict.meters,
    points: [...s.points, [Number(fix.lat.toFixed(6)), Number(fix.lng.toFixed(6)), t, s.segment]],
  })
}

function onPositionError(err: GeolocationPositionError) {
  if (!state) return
  if (err.code === err.PERMISSION_DENIED) { stopWatch(); patch({ gps: 'denied' }) }
  else if (err.code === err.POSITION_UNAVAILABLE) patch({ gps: 'unavailable' })
  // TIMEOUT: se sigue esperando; la interfaz muestra "señal débil" por la antigüedad de la última lectura.
}

function startWatch() {
  if (!state?.useGps || watchId !== null) return
  if (!('geolocation' in navigator) || !window.isSecureContext) return patch({ gps: 'unsupported' })
  patch({ gps: state.gps === 'ok' ? 'ok' : 'waiting' })
  watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 })
}
function stopWatch() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId)
  watchId = null
}

// ---------- Mantener la pantalla encendida (si el navegador lo permite) ----------
async function lockScreen() {
  try {
    const wl = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock
    if (wl && !wakeLock) wakeLock = await wl.request('screen')
  } catch { /* no soportado o denegado: el seguimiento sigue igual */ }
}
function unlockScreen() {
  void wakeLock?.release().catch(() => undefined)
  wakeLock = null
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state?.status === 'running') {
      wakeLock = null // el navegador lo libera al ocultarse la página
      void lockScreen()
      startWatch()
    }
  })
}

// ---------- Acciones ----------
export const tracker = {
  start(userId: string, activity: CardioActivity, useGps: boolean) {
    set({
      userId, activity, useGps, startedAt: new Date().toISOString(), status: 'running', activeMs: 0, runningSince: Date.now(),
      endedAt: null, segment: 0, points: [], distanceM: 0, anchor: null, gps: useGps ? 'waiting' : 'off', lastFixAt: null, accuracy: null, rejected: 0,
    })
    startWatch()
    void lockScreen()
  },
  pause() {
    if (!state || state.status !== 'running') return
    stopWatch()
    unlockScreen()
    set({ ...state, status: 'paused', activeMs: elapsedMs(state), runningSince: null, anchor: null, segment: state.segment + 1 })
  },
  resume() {
    if (!state || state.status !== 'paused') return
    set({ ...state, status: 'running', runningSince: Date.now() })
    startWatch()
    void lockScreen()
  },
  finish() {
    if (!state || state.status === 'finished') return
    stopWatch()
    unlockScreen()
    set({ ...state, status: 'finished', activeMs: elapsedMs(state), runningSince: null, endedAt: new Date().toISOString(), anchor: null })
  },
  /** Reintenta el GPS (p. ej. tras conceder el permiso en el navegador). */
  retryGps() {
    stopWatch()
    if (state) { patch({ gps: 'waiting' }); startWatch() }
  },
  discard() {
    stopWatch()
    unlockScreen()
    set(null)
  },
  /** Recupera una sesión en curso tras recargar la página (solo para su dueño). */
  resumeAfterReload(userId: string) {
    if (!state) return
    if (state.userId !== userId) return
    if (state.status === 'running') { startWatch(); void lockScreen() }
  },
}

export function useTracker() {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb) }, () => state, () => null)
}
