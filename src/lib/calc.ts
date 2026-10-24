// Cálculos derivados. Todo se calcula a partir de registros reales; nada se inventa.
import { parseISO, startOfWeek, subWeeks } from 'date-fns'
import { WEEK_OPTS, inRange, localDay, monthKey, weekKey, type DateRange } from './dates'
import type { MuscleGroup, SetType, WorkoutSession, WorkoutSet } from './types'

/**
 * 1RM ESTIMADO con la fórmula de Epley: peso × (1 + reps / 30).
 * Es una estimación, no una medición. Con 1 rep devuelve el peso; con más de 15 reps no estima.
 * Debe coincidir con public.epley_1rm() en la base de datos.
 */
export function epley1rm(weightKg: number, reps: number): number | null {
  if (!(weightKg > 0) || !(reps >= 1) || reps > 15) return null
  if (reps === 1) return weightKg
  return Math.round(weightKg * (1 + reps / 30) * 100) / 100
}

type SetLike = Pick<WorkoutSet, 'weight_kg' | 'reps' | 'completed'> & { set_type: SetType }

export const setVolume = (s: Pick<WorkoutSet, 'weight_kg' | 'reps'>) => (s.weight_kg || 0) * (s.reps || 0)
export const isWorkingSet = (s: SetLike) => s.completed && s.set_type !== 'warmup' && s.reps > 0

/** Volumen = Σ (peso × repeticiones). Por defecto solo series de trabajo completadas. */
export function volumeOf(sets: SetLike[], opts: { includeWarmups?: boolean } = {}) {
  return sets
    .filter((s) => s.completed && s.reps > 0 && (opts.includeWarmups || s.set_type !== 'warmup'))
    .reduce((acc, s) => acc + setVolume(s), 0)
}

export interface SessionStats {
  volume: number
  warmupVolume: number
  workingSets: number
  completedSets: number
  totalSets: number
  totalReps: number
  durationSec: number | null
}

export function sessionStats(session: WorkoutSession): SessionStats {
  const sets = (session.workout_exercises ?? []).flatMap((e) => e.workout_sets ?? [])
  const completed = sets.filter((s) => s.completed)
  return {
    volume: volumeOf(sets),
    warmupVolume: volumeOf(sets.filter((s) => s.set_type === 'warmup'), { includeWarmups: true }),
    workingSets: sets.filter(isWorkingSet).length,
    completedSets: completed.length,
    totalSets: sets.length,
    totalReps: completed.filter((s) => s.set_type !== 'warmup').reduce((a, s) => a + s.reps, 0),
    durationSec: session.ended_at
      ? (parseISO(session.ended_at).getTime() - parseISO(session.started_at).getTime()) / 1000
      : null,
  }
}

export interface ExercisePoint {
  sessionId: string
  date: string // yyyy-MM-dd local
  startedAt: string
  maxWeight: number
  bestE1rm: number | null
  bestSet: { weight: number; reps: number } | null
  totalReps: number
  volume: number
  sets: number
}

/** Evolución de un ejercicio sesión a sesión (orden cronológico). */
export function exerciseHistory(sessions: WorkoutSession[], exerciseId: string): ExercisePoint[] {
  const points: ExercisePoint[] = []
  for (const s of sessions) {
    if (s.status !== 'completed') continue
    const sets = (s.workout_exercises ?? [])
      .filter((e) => e.exercise_id === exerciseId)
      .flatMap((e) => e.workout_sets ?? [])
      .filter(isWorkingSet)
    if (!sets.length) continue
    let best: { weight: number; reps: number } | null = null
    let bestE1rm: number | null = null
    for (const set of sets) {
      const e = epley1rm(set.weight_kg, set.reps)
      if (e !== null && (bestE1rm === null || e > bestE1rm)) bestE1rm = e
      if (!best || set.weight_kg > best.weight || (set.weight_kg === best.weight && set.reps > best.reps)) {
        best = { weight: set.weight_kg, reps: set.reps }
      }
    }
    points.push({
      sessionId: s.id,
      date: localDay(s.started_at),
      startedAt: s.started_at,
      maxWeight: Math.max(...sets.map((x) => x.weight_kg)),
      bestE1rm,
      bestSet: best,
      totalReps: sets.reduce((a, x) => a + x.reps, 0),
      volume: volumeOf(sets),
      sets: sets.length,
    })
  }
  return points.sort((a, b) => a.startedAt.localeCompare(b.startedAt))
}

export function completedIn(sessions: WorkoutSession[], range: DateRange) {
  return sessions.filter((s) => s.status === 'completed' && inRange(s.started_at, range))
}

/** Volumen por grupo muscular principal del ejercicio. */
export function volumeByMuscle(sessions: WorkoutSession[], muscleOf: (exerciseId: string) => MuscleGroup | undefined) {
  const out = new Map<MuscleGroup, { volume: number; sets: number }>()
  for (const s of sessions) {
    if (s.status !== 'completed') continue
    for (const we of s.workout_exercises ?? []) {
      const m = we.exercise?.primary_muscle ?? muscleOf(we.exercise_id)
      if (!m) continue
      const working = (we.workout_sets ?? []).filter(isWorkingSet)
      const cur = out.get(m) ?? { volume: 0, sets: 0 }
      cur.volume += volumeOf(working)
      cur.sets += working.length
      out.set(m, cur)
    }
  }
  return out
}

/** Agrupa sesiones completadas por semana (lunes) o mes. */
export function groupByPeriod(sessions: WorkoutSession[], period: 'week' | 'month') {
  const out = new Map<string, { sessions: number; volume: number; durationSec: number }>()
  for (const s of sessions) {
    if (s.status !== 'completed') continue
    const key = period === 'week' ? weekKey(s.started_at) : monthKey(s.started_at)
    const st = sessionStats(s)
    const cur = out.get(key) ?? { sessions: 0, volume: 0, durationSec: 0 }
    cur.sessions += 1
    cur.volume += st.volume
    cur.durationSec += st.durationSec ?? 0
    out.set(key, cur)
  }
  return new Map([...out.entries()].sort(([a], [b]) => a.localeCompare(b)))
}

/**
 * Racha semanal: semanas consecutivas cumpliendo el objetivo de entrenamientos.
 * La semana en curso cuenta solo si ya se cumplió; si no, la racha se mide desde la anterior.
 */
export function weeklyStreak(sessionStarts: string[], weeklyTarget: number, now = new Date()) {
  const counts = new Map<string, number>()
  for (const iso of sessionStarts) {
    const k = weekKey(iso)
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  let cursor = startOfWeek(now, WEEK_OPTS)
  let streak = 0
  if ((counts.get(localDay(cursor)) ?? 0) >= weeklyTarget) streak++
  cursor = subWeeks(cursor, 1)
  while ((counts.get(localDay(cursor)) ?? 0) >= weeklyTarget) {
    streak++
    cursor = subWeeks(cursor, 1)
  }
  return streak
}

/** Racha diaria: días consecutivos con entrenamiento hasta hoy (o ayer, si hoy aún no entrenó). */
export function dailyStreak(sessionStarts: string[], now = new Date()) {
  const days = new Set(sessionStarts.map((s) => localDay(s)))
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (!days.has(localDay(d))) d.setDate(d.getDate() - 1)
  let n = 0
  while (days.has(localDay(d))) {
    n++
    d.setDate(d.getDate() - 1)
  }
  return n
}

/**
 * Porcentaje de avance hacia una meta desde un valor inicial. Funciona para metas que suben
 * o bajan (p. ej. perder peso). Devuelve null cuando el cálculo no tiene sentido.
 */
export function goalProgress(start: number | null | undefined, current: number | null | undefined, target: number) {
  if (start === null || start === undefined || current === null || current === undefined) return null
  if (start === target) return current === target ? 100 : null
  const pct = ((current - start) / (target - start)) * 100
  return Math.max(0, Math.min(100, Math.round(pct)))
}

/** IMC = kg / m². Orientativo: no distingue masa muscular de grasa. */
export function bmi(weightKg: number | null | undefined, heightCm: number | null | undefined) {
  if (!weightKg || !heightCm) return null
  const m = heightCm / 100
  return Math.round((weightKg / (m * m)) * 10) / 10
}

export function ageFrom(birthDate: string | null | undefined, now = new Date()) {
  if (!birthDate) return null
  const b = parseISO(birthDate)
  let age = now.getFullYear() - b.getFullYear()
  const m = now.getMonth() - b.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--
  return age
}
