// Estado del entrenamiento activo.
// - Cada cambio se guarda al instante en localStorage (sobrevive a cerrar el navegador o perder Internet).
// - Se sincroniza con Supabase mediante upserts por id generado en el cliente: reintentar nunca duplica.
// - Una sola sesión activa por usuario (índice único en la BD) evita sesiones duplicadas entre dispositivos.
// - Al finalizar sin conexión, la finalización queda pendiente y se completa al reconectar.
import { useSyncExternalStore } from 'react'
import { SESSION_SELECT, sortSession } from '@/data/queries'
import { isNetworkError, errorMessage } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import type { MuscleGroup, SetType, WorkoutSession } from '@/lib/types'
import { uuid } from '@/lib/utils'

export interface LocalSet {
  id: string
  set_number: number
  weight_kg: number
  reps: number
  set_type: SetType
  completed: boolean
  completed_at: string | null
  rpe: number | null
  rir: number | null
  notes: string | null
}

export interface LocalExercise {
  id: string
  exercise_id: string
  name: string
  primary_muscle: MuscleGroup
  position: number
  rest_seconds: number | null
  notes: string | null
  target?: { sets: number; repsMin: number | null; repsMax: number | null; weightKg: number | null } | null
  sets: LocalSet[]
}

export interface ActiveWorkout {
  userId: string
  session: {
    id: string
    name: string
    routine_id: string | null
    routine_day_id: string | null
    started_at: string
    notes: string | null
  }
  exercises: LocalExercise[]
  deleted: { exercises: string[]; sets: string[] }
  rev: number
  syncedRev: number
  everSynced: boolean
  finishRequestedAt: string | null
}

export type SyncState = { status: 'idle' | 'syncing' | 'pending' | 'error'; message?: string; lastSyncedAt?: string }

const storageKey = (userId: string) => `gymbro.active.${userId}`

let currentUser: string | null = null
let state: ActiveWorkout | null = null
let sync: SyncState = { status: 'idle' }
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | null = null
let retryTimer: ReturnType<typeof setInterval> | null = null
let syncing: Promise<void> | null = null
let onFinished: ((sessionId: string) => void) | null = null

function emit() {
  listeners.forEach((l) => l())
}

function persist() {
  if (!currentUser) return
  try {
    if (state) localStorage.setItem(storageKey(currentUser), JSON.stringify(state))
    else localStorage.removeItem(storageKey(currentUser))
  } catch {
    // Almacenamiento lleno o bloqueado: la sincronización con el servidor sigue funcionando.
  }
}

function setSync(s: SyncState) {
  sync = { ...sync, ...s }
  emit()
}

/** Aplica un cambio, lo guarda localmente y programa la sincronización. */
function update(fn: (s: ActiveWorkout) => void) {
  if (!state) return
  const next = structuredClone(state)
  fn(next)
  next.rev += 1
  state = next
  persist()
  setSync({ status: 'pending' })
  scheduleSync()
}

function scheduleSync(delay = 1200) {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void syncNow(), delay)
}

// ---------- Inicialización ----------
export function initWorkoutStore(userId: string, finished: (sessionId: string) => void) {
  onFinished = finished
  if (currentUser === userId) return
  currentUser = userId
  try {
    const raw = localStorage.getItem(storageKey(userId))
    state = raw ? (JSON.parse(raw) as ActiveWorkout) : null
  } catch {
    state = null
  }
  sync = { status: state && state.rev !== state.syncedRev ? 'pending' : 'idle' }
  emit()
  window.addEventListener('online', () => void syncNow())
  if (retryTimer) clearInterval(retryTimer)
  retryTimer = setInterval(() => {
    if (state && (state.rev !== state.syncedRev || state.finishRequestedAt)) void syncNow()
  }, 15000)
  if (state) void syncNow()
  else void recoverFromServer()
}

export function resetWorkoutStore() {
  currentUser = null
  state = null
  sync = { status: 'idle' }
  emit()
}

/** Si no hay sesión local pero el servidor tiene una en curso (otro dispositivo o almacenamiento borrado), la recupera. */
export async function recoverFromServer() {
  if (!currentUser || state) return
  const { data, error } = await supabase.from('workout_sessions').select(SESSION_SELECT)
    .eq('user_id', currentUser).eq('status', 'in_progress').maybeSingle()
  if (error || !data || state) return
  state = fromServer(currentUser, sortSession(data as WorkoutSession))
  persist()
  setSync({ status: 'idle' })
}

function fromServer(userId: string, s: WorkoutSession): ActiveWorkout {
  return {
    userId,
    session: { id: s.id, name: s.name, routine_id: s.routine_id, routine_day_id: s.routine_day_id, started_at: s.started_at, notes: s.notes },
    exercises: (s.workout_exercises ?? []).map((we) => ({
      id: we.id, exercise_id: we.exercise_id, name: we.exercise?.name ?? 'Ejercicio',
      primary_muscle: we.exercise?.primary_muscle ?? 'chest', position: we.position,
      rest_seconds: we.rest_seconds, notes: we.notes, target: null,
      sets: (we.workout_sets ?? []).map((x) => ({
        id: x.id, set_number: x.set_number, weight_kg: Number(x.weight_kg), reps: x.reps, set_type: x.set_type,
        completed: x.completed, completed_at: x.completed_at, rpe: x.rpe, rir: x.rir, notes: x.notes,
      })),
    })),
    deleted: { exercises: [], sets: [] },
    rev: 0,
    syncedRev: 0,
    everSynced: true,
    finishRequestedAt: null,
  }
}

// ---------- Sincronización ----------
export function syncNow(): Promise<void> {
  if (syncing) return syncing.then(() => (state && state.rev !== state.syncedRev ? syncNow() : undefined))
  syncing = doSync().finally(() => { syncing = null })
  return syncing
}

async function doSync() {
  const snap = state
  if (!snap || !currentUser) return
  if (snap.rev === snap.syncedRev && !snap.finishRequestedAt) return
  if (!navigator.onLine) return setSync({ status: 'pending', message: 'Sin conexión: guardado en este dispositivo' })
  setSync({ status: 'syncing' })
  try {
    if (snap.rev !== snap.syncedRev) {
      const s = snap.session
      const { error: e1 } = await supabase.from('workout_sessions').upsert({
        id: s.id, user_id: snap.userId, name: s.name, routine_id: s.routine_id, routine_day_id: s.routine_day_id,
        started_at: s.started_at, notes: s.notes, status: 'in_progress',
      })
      if (e1) throw e1
      if (snap.deleted.sets.length) {
        const { error } = await supabase.from('workout_sets').delete().in('id', snap.deleted.sets)
        if (error) throw error
      }
      if (snap.deleted.exercises.length) {
        const { error } = await supabase.from('workout_exercises').delete().in('id', snap.deleted.exercises)
        if (error) throw error
      }
      if (snap.exercises.length) {
        const { error } = await supabase.from('workout_exercises').upsert(snap.exercises.map((e) => ({
          id: e.id, session_id: s.id, exercise_id: e.exercise_id, position: e.position, rest_seconds: e.rest_seconds, notes: e.notes,
        })))
        if (error) throw error
      }
      const sets = snap.exercises.flatMap((e) => e.sets.map((x) => ({ ...x, workout_exercise_id: e.id })))
      if (sets.length) {
        const { error } = await supabase.from('workout_sets').upsert(sets)
        if (error) throw error
      }
      // Marca como sincronizado solo lo que se envió; cambios posteriores siguen pendientes.
      if (state && state.session.id === s.id) {
        state = {
          ...state,
          syncedRev: snap.rev,
          everSynced: true,
          deleted: {
            sets: state.deleted.sets.filter((id) => !snap.deleted.sets.includes(id)),
            exercises: state.deleted.exercises.filter((id) => !snap.deleted.exercises.includes(id)),
          },
        }
        persist()
      }
    }
    if (state && state.finishRequestedAt && state.rev === state.syncedRev) {
      const id = state.session.id
      const { error } = await supabase.rpc('finish_workout_session', { p_session: id, p_ended_at: state.finishRequestedAt })
      if (error) throw error
      state = null
      persist()
      onFinished?.(id)
    }
    setSync({ status: state && state.rev !== state.syncedRev ? 'pending' : 'idle', message: undefined, lastSyncedAt: new Date().toISOString() })
  } catch (e) {
    if (isNetworkError(e)) setSync({ status: 'pending', message: 'Sin conexión: guardado en este dispositivo' })
    else setSync({ status: 'error', message: errorMessage(e) })
  }
}

// ---------- Acciones ----------
export interface StartInput {
  userId: string
  name: string
  routine_id?: string | null
  routine_day_id?: string | null
  exercises: { exercise_id: string; name: string; primary_muscle: MuscleGroup; rest_seconds: number | null; notes: string | null; target: LocalExercise['target']; initialSets: Partial<LocalSet>[] }[]
}

export function startWorkout(input: StartInput) {
  if (state) throw new Error('Ya hay un entrenamiento en curso')
  state = {
    userId: input.userId,
    session: { id: uuid(), name: input.name, routine_id: input.routine_id ?? null, routine_day_id: input.routine_day_id ?? null, started_at: new Date().toISOString(), notes: null },
    exercises: input.exercises.map((e, i) => ({
      id: uuid(), exercise_id: e.exercise_id, name: e.name, primary_muscle: e.primary_muscle, position: i,
      rest_seconds: e.rest_seconds, notes: e.notes, target: e.target,
      sets: e.initialSets.map((s, j) => newSet(j + 1, s)),
    })),
    deleted: { exercises: [], sets: [] },
    rev: 1,
    syncedRev: 0,
    everSynced: false,
    finishRequestedAt: null,
  }
  persist()
  setSync({ status: 'pending' })
  void syncNow()
}

function newSet(n: number, s: Partial<LocalSet> = {}): LocalSet {
  return {
    id: uuid(), set_number: n, weight_kg: s.weight_kg ?? 0, reps: s.reps ?? 0, set_type: s.set_type ?? 'normal',
    completed: false, completed_at: null, rpe: null, rir: null, notes: null,
  }
}

const renumber = (e: LocalExercise) => e.sets.forEach((s, i) => { s.set_number = i + 1 })

export const workoutActions = {
  updateSet(exId: string, setId: string, patch: Partial<LocalSet>) {
    update((s) => {
      const set = s.exercises.find((e) => e.id === exId)?.sets.find((x) => x.id === setId)
      if (!set) return
      Object.assign(set, patch)
      if ('completed' in patch) set.completed_at = patch.completed ? new Date().toISOString() : null
    })
  },
  /** Agrega una serie copiando peso/reps/tipo de la anterior (o de `from`). */
  addSet(exId: string, fromSetId?: string) {
    update((s) => {
      const ex = s.exercises.find((e) => e.id === exId)
      if (!ex) return
      const src = fromSetId ? ex.sets.find((x) => x.id === fromSetId) : ex.sets[ex.sets.length - 1]
      const set = newSet(ex.sets.length + 1, src ? { weight_kg: src.weight_kg, reps: src.reps, set_type: src.set_type === 'warmup' ? 'normal' : src.set_type } : {})
      if (fromSetId) {
        const idx = ex.sets.findIndex((x) => x.id === fromSetId)
        ex.sets.splice(idx + 1, 0, set)
      } else ex.sets.push(set)
      renumber(ex)
    })
  },
  /** Copia peso y reps de la serie anterior en esta serie. */
  repeatPrevious(exId: string, setId: string) {
    update((s) => {
      const ex = s.exercises.find((e) => e.id === exId)
      const idx = ex?.sets.findIndex((x) => x.id === setId) ?? -1
      if (!ex || idx < 1) return
      const prev = ex.sets[idx - 1]
      Object.assign(ex.sets[idx], { weight_kg: prev.weight_kg, reps: prev.reps })
    })
  },
  removeSet(exId: string, setId: string) {
    update((s) => {
      const ex = s.exercises.find((e) => e.id === exId)
      if (!ex) return
      ex.sets = ex.sets.filter((x) => x.id !== setId)
      renumber(ex)
      s.deleted.sets.push(setId)
    })
  },
  addExercise(e: { exercise_id: string; name: string; primary_muscle: MuscleGroup; rest_seconds: number | null }) {
    update((s) => {
      s.exercises.push({ id: uuid(), ...e, position: s.exercises.length, notes: null, target: null, sets: [newSet(1)] })
    })
  },
  removeExercise(exId: string) {
    update((s) => {
      const ex = s.exercises.find((e) => e.id === exId)
      if (!ex) return
      s.exercises = s.exercises.filter((e) => e.id !== exId)
      s.exercises.forEach((e, i) => { e.position = i })
      s.deleted.exercises.push(exId)
    })
  },
  moveExercise(exId: string, dir: -1 | 1) {
    update((s) => {
      const i = s.exercises.findIndex((e) => e.id === exId)
      const j = i + dir
      if (i < 0 || j < 0 || j >= s.exercises.length) return
      ;[s.exercises[i], s.exercises[j]] = [s.exercises[j], s.exercises[i]]
      s.exercises.forEach((e, k) => { e.position = k })
    })
  },
  updateExercise(exId: string, patch: Partial<Pick<LocalExercise, 'notes' | 'rest_seconds'>>) {
    update((s) => {
      const ex = s.exercises.find((e) => e.id === exId)
      if (ex) Object.assign(ex, patch)
    })
  },
  updateSession(patch: Partial<Pick<ActiveWorkout['session'], 'name' | 'notes'>>) {
    update((s) => Object.assign(s.session, patch))
  },
  /** Finaliza: si no hay conexión queda pendiente y se completa al reconectar. */
  async finish() {
    update((s) => { s.finishRequestedAt = new Date().toISOString() })
    await syncNow()
    return state === null
  },
  /** Descarta la sesión en curso (y la borra del servidor si llegó a sincronizarse). */
  async discard() {
    if (!state) return
    if (state.everSynced || state.syncedRev > 0) {
      const { error } = await supabase.from('workout_sessions').delete().eq('id', state.session.id)
      if (error) throw error
    }
    state = null
    persist()
    setSync({ status: 'idle', message: undefined })
  },
}

// ---------- Hooks ----------
function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function useActiveWorkout() {
  return useSyncExternalStore(subscribe, () => state, () => null)
}

export function useSyncState() {
  return useSyncExternalStore(subscribe, () => sync, () => sync)
}
