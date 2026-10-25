import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// GPS y navegador simulados (las pruebas corren en Node).
let onPos: ((p: GeolocationPosition) => void) | null = null
const cleared: number[] = []
const store = new Map<string, string>()

beforeAll(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-25T07:00:00Z'))
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k),
  })
  vi.stubGlobal('document', { addEventListener: () => undefined, visibilityState: 'visible' })
  vi.stubGlobal('window', { isSecureContext: true })
  vi.stubGlobal('navigator', {
    geolocation: {
      watchPosition: (ok: (p: GeolocationPosition) => void) => { onPos = ok; return 7 },
      clearWatch: (id: number) => { cleared.push(id); onPos = null },
    },
  })
})
afterAll(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

const fixAt = (lat: number) => ({ coords: { latitude: lat, longitude: -69.93, accuracy: 6 }, timestamp: Date.now() }) as unknown as GeolocationPosition

describe('rastreador de cardio', () => {
  it('suma distancia en movimiento, ignora las pausas y recupera el estado', async () => {
    const { tracker, elapsedMs } = await import('./tracker')
    const read = () => JSON.parse(store.get('gymbro.cardioTracker')!)

    tracker.start('user-1', 'running', true)
    expect(read().gps).toBe('waiting')
    // 10 lecturas, cada 5 s avanzando 0.0001° (~11.1 m → 2.2 m/s)
    let lat = 18.45
    for (let i = 0; i < 10; i++) {
      onPos!(fixAt(lat))
      lat += 0.0001
      vi.advanceTimersByTime(5000)
    }
    let s = read()
    expect(s.gps).toBe('ok')
    expect(s.points).toHaveLength(10)
    expect(s.distanceM).toBeCloseTo(100.1, 0) // 9 tramos de ~11.12 m

    // Pausa: el GPS se detiene y el tiempo no avanza.
    tracker.pause()
    expect(cleared).toContain(7)
    const pausedAt = elapsedMs(read())
    vi.advanceTimersByTime(120_000)
    expect(elapsedMs(read())).toBe(pausedAt)

    // Reanuda lejos (otro lugar): no se suma la distancia entre la pausa y la reanudación.
    tracker.resume()
    lat = 18.5
    for (let i = 0; i < 3; i++) {
      onPos!(fixAt(lat))
      lat += 0.0001
      vi.advanceTimersByTime(5000)
    }
    s = read()
    expect(s.segment).toBe(1)
    expect(s.distanceM).toBeCloseTo(100.1 + 22.2, 0)

    // Una lectura con salto imposible se descarta.
    onPos!(fixAt(18.6))
    expect(read().rejected).toBe(1)

    tracker.finish()
    s = read()
    expect(s.status).toBe('finished')
    expect(Math.round(s.activeMs / 1000)).toBe(65) // 50 s + 15 s, sin los 120 s de pausa
    expect(s.points.at(-1)[3]).toBe(1)

    tracker.discard()
    expect(store.has('gymbro.cardioTracker')).toBe(false)
  })
})
