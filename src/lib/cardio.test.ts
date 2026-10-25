import { describe, expect, it } from 'vitest'
import { cardioBests, cardioByWeek, cardioTotals, fmtPace, paceSecondsPer, speedPerHour, toKm, type CardioSession } from './cardio'

const s = (over: Partial<CardioSession>): CardioSession => ({
  id: crypto.randomUUID(), user_id: 'u', activity: 'running', started_at: '2026-10-20T12:00:00', duration_seconds: 1800,
  distance_km: 5, calories: null, avg_heart_rate: null, max_heart_rate: null, rpe: null, incline_pct: null, notes: null, created_at: '', tracking_mode: 'manual', ended_at: null, ...over,
})

describe('ritmo y velocidad', () => {
  it('calcula ritmo en min/km y min/mi', () => {
    expect(fmtPace(paceSecondsPer(s({}), 'kg'))).toBe('6:00')
    expect(fmtPace(paceSecondsPer(s({}), 'lb'))).toBe('9:39') // 30 min / 3.107 mi
    expect(paceSecondsPer(s({ distance_km: null }), 'kg')).toBeNull()
  })
  it('calcula velocidad media', () => {
    expect(speedPerHour(s({}), 'kg')).toBe(10)
    expect(toKm(1, 'lb')).toBeCloseTo(1.609, 3)
  })
})

describe('totales y semanas', () => {
  it('suma solo las calorías registradas', () => {
    const t = cardioTotals([s({ calories: 300 }), s({ distance_km: null })])
    expect(t).toEqual({ sessions: 2, seconds: 3600, km: 5, calories: 300, caloriesSessions: 1 })
  })
  it('agrupa por semana de lunes a domingo', () => {
    const w = cardioByWeek([s({ started_at: '2026-10-19T08:00:00' }), s({ started_at: '2026-10-25T20:00:00' }), s({ started_at: '2026-10-26T08:00:00' })])
    expect([...w.entries()].map(([k, v]) => [k, v.sessions, v.minutes])).toEqual([['2026-10-19', 2, 60], ['2026-10-26', 1, 30]])
  })
})

describe('mejores marcas', () => {
  it('ignora sesiones de menos de 1 km para el ritmo', () => {
    const fast = s({ duration_seconds: 1500, distance_km: 5 })
    const sprint = s({ duration_seconds: 120, distance_km: 0.5 })
    const long = s({ duration_seconds: 4200, distance_km: 10 })
    const b = cardioBests([fast, sprint, long, s({ activity: 'cycling', distance_km: 40 })], 'running')
    expect(b.bestPace?.id).toBe(fast.id)
    expect(b.longestDistance?.id).toBe(long.id)
    expect(b.longestDuration?.id).toBe(long.id)
  })
})
