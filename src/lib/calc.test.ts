import { describe, expect, it } from 'vitest'
import {
  bmi, dailyStreak, epley1rm, exerciseHistory, goalProgress, sessionStats, volumeOf, weeklyStreak,
} from './calc'
import { displayWeight, kgTo, toKg } from './units'
import type { WorkoutSession } from './types'

const set = (weight_kg: number, reps: number, set_type: 'normal' | 'warmup' = 'normal', completed = true) =>
  ({ id: crypto.randomUUID(), workout_exercise_id: 'we', set_number: 1, weight_kg, reps, set_type, completed, completed_at: null, rpe: null, rir: null, notes: null })

const session = (id: string, started_at: string, sets: ReturnType<typeof set>[], exercise_id = 'bench'): WorkoutSession => ({
  id, user_id: 'u', routine_id: null, routine_day_id: null, name: 'Push', started_at,
  ended_at: new Date(new Date(started_at).getTime() + 3600_000).toISOString(), status: 'completed', notes: null,
  workout_exercises: [{ id: 'we', session_id: id, exercise_id, position: 0, rest_seconds: null, notes: null, workout_sets: sets }],
})

describe('epley1rm', () => {
  it('coincide con la función SQL', () => {
    expect(epley1rm(80, 8)).toBe(101.33)
    expect(epley1rm(100, 1)).toBe(100)
    expect(epley1rm(80, 16)).toBeNull()
    expect(epley1rm(0, 5)).toBeNull()
  })
})

describe('volumen', () => {
  it('suma peso × reps de series completadas sin calentamientos', () => {
    const sets = [set(40, 10, 'warmup'), set(80, 8), set(80, 6), set(90, 5, 'normal', false)]
    expect(volumeOf(sets)).toBe(1120)
    expect(volumeOf(sets, { includeWarmups: true })).toBe(1520)
  })
  it('estadísticas de sesión', () => {
    const st = sessionStats(session('s', '2026-10-01T10:00:00Z', [set(40, 10, 'warmup'), set(80, 8), set(80, 6)]))
    expect(st).toMatchObject({ volume: 1120, warmupVolume: 400, workingSets: 2, completedSets: 3, totalReps: 14, durationSec: 3600 })
  })
})

describe('historial por ejercicio', () => {
  it('ordena cronológicamente y calcula la mejor serie', () => {
    const h = exerciseHistory([
      session('b', '2026-10-03T10:00:00Z', [set(85, 5), set(80, 9)]),
      session('a', '2026-10-01T10:00:00Z', [set(80, 8)]),
    ], 'bench')
    expect(h.map((p) => p.sessionId)).toEqual(['a', 'b'])
    expect(h[1]).toMatchObject({ maxWeight: 85, bestE1rm: 104, bestSet: { weight: 85, reps: 5 }, volume: 1145 })
  })
})

describe('rachas', () => {
  const now = new Date(2026, 9, 21) // miércoles 21-oct-2026
  it('semanal: semanas consecutivas cumpliendo el objetivo', () => {
    const starts = ['2026-10-05T12:00', '2026-10-07T12:00', '2026-10-12T12:00', '2026-10-14T12:00', '2026-10-19T12:00']
    expect(weeklyStreak(starts, 2, now)).toBe(2) // semana actual (1 sesión) aún no cuenta
    expect(weeklyStreak(starts, 1, now)).toBe(3)
  })
  it('diaria', () => {
    expect(dailyStreak(['2026-10-19T12:00', '2026-10-20T12:00'], now)).toBe(2)
    expect(dailyStreak(['2026-10-18T12:00'], now)).toBe(0)
  })
})

describe('objetivos e IMC', () => {
  it('avance en metas ascendentes y descendentes', () => {
    expect(goalProgress(90, 85, 80)).toBe(50)
    expect(goalProgress(100, 110, 120)).toBe(50)
    expect(goalProgress(90, 95, 80)).toBe(0)
    expect(goalProgress(null, 85, 80)).toBeNull()
  })
  it('IMC', () => {
    expect(bmi(80, 180)).toBe(24.7)
    expect(bmi(null, 180)).toBeNull()
  })
})

describe('unidades', () => {
  it('convierte kg/lb sin perder precisión al ir y volver', () => {
    expect(toKg(kgTo(100, 'lb'), 'lb')).toBeCloseTo(100, 6)
    expect(displayWeight(100, 'lb')).toBe(220.5)
    expect(displayWeight(81.3, 'kg')).toBe(81.25)
  })
})
