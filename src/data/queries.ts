// Capa de datos: hooks de React Query sobre Supabase. RLS en el servidor decide qué se ve;
// estos hooks solo filtran por usuario para no mezclar datos propios y del compañero.
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useUserId } from '@/features/auth/AuthProvider'
import { errorMessage } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import type {
  AppNotification, BodyMeasurement, Challenge, ChallengeProgress, Exercise, Goal, Partnership,
  PersonalRecord, Profile, ProgressPhoto, Routine, ScheduledWorkout, UserPreferences, WorkoutSession,
} from '@/lib/types'

export async function unwrap<T>(p: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  const { data, error } = await p
  if (error) throw error
  return data as T
}

export const keys = {
  profile: (id: string) => ['profile', id] as const,
  prefs: (id: string) => ['prefs', id] as const,
  partnership: (id: string) => ['partnership', id] as const,
  exercises: ['exercises'] as const,
  routines: (owner: string) => ['routines', owner] as const,
  sharedRoutines: ['routines', 'shared'] as const,
  sessions: (user: string) => ['sessions', user] as const,
  session: (id: string) => ['session', id] as const,
  measurements: (user: string) => ['measurements', user] as const,
  photos: (user: string) => ['photos', user] as const,
  records: (user: string) => ['records', user] as const,
  goals: (user: string) => ['goals', user] as const,
  schedule: (user: string) => ['schedule', user] as const,
  challenges: ['challenges'] as const,
  challengeProgress: (id: string) => ['challengeProgress', id] as const,
  notifications: (user: string) => ['notifications', user] as const,
}

/** Mutación con toast de error y de éxito, e invalidación de claves. */
export function useMut<TVars, TRes = unknown>(
  fn: (v: TVars) => Promise<TRes>,
  opts: { invalidate?: QueryKey[]; success?: string; onSuccess?: (r: TRes, v: TVars) => void } = {},
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: (r, v) => {
      opts.invalidate?.forEach((k) => qc.invalidateQueries({ queryKey: k }))
      if (opts.success) toast.success(opts.success)
      opts.onSuccess?.(r, v)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
}

// ---------- Perfil, preferencias y compañero ----------
export function useProfile(userId?: string) {
  const me = useUserId()
  const id = userId ?? me
  return useQuery({
    queryKey: keys.profile(id),
    queryFn: () => unwrap<Profile>(supabase.from('profiles').select('*').eq('id', id).single()),
  })
}

export function usePrefs() {
  const id = useUserId()
  return useQuery({
    queryKey: keys.prefs(id),
    queryFn: () => unwrap<UserPreferences>(supabase.from('user_preferences').select('*').eq('user_id', id).single()),
  })
}

/** Unidad de peso preferida (kg por defecto mientras carga). */
export function useUnit() {
  return usePrefs().data?.weight_unit ?? 'kg'
}

export interface PartnerInfo {
  partnerships: Partnership[]
  accepted: Partnership | null
  partnerId: string | null
  incoming: Partnership[]
  outgoing: Partnership[]
}

export function usePartnership() {
  const me = useUserId()
  return useQuery({
    queryKey: keys.partnership(me),
    queryFn: async (): Promise<PartnerInfo> => {
      const rows = await unwrap<Partnership[]>(supabase.from('partnerships').select('*').order('created_at'))
      const accepted = rows.find((r) => r.status === 'accepted') ?? null
      return {
        partnerships: rows,
        accepted,
        partnerId: accepted ? (accepted.requester_id === me ? accepted.addressee_id : accepted.requester_id) : null,
        incoming: rows.filter((r) => r.status === 'pending' && r.addressee_id === me),
        outgoing: rows.filter((r) => r.status === 'pending' && r.requester_id === me),
      }
    },
  })
}

// ---------- Ejercicios ----------
export function useExercises() {
  return useQuery({
    queryKey: keys.exercises,
    queryFn: () => unwrap<Exercise[]>(supabase.from('exercises').select('*, exercise_muscles(muscle)').order('name')),
    staleTime: 5 * 60_000,
  })
}

// ---------- Rutinas ----------
const ROUTINE_SELECT = '*, routine_days(*, routine_exercises(*, exercise:exercises(id, name, primary_muscle)))'

function sortRoutine(r: Routine): Routine {
  r.routine_days?.sort((a, b) => a.position - b.position)
  r.routine_days?.forEach((d) => d.routine_exercises?.sort((a, b) => a.position - b.position))
  return r
}

export function useRoutines(ownerId?: string) {
  const me = useUserId()
  const owner = ownerId ?? me
  return useQuery({
    queryKey: keys.routines(owner),
    queryFn: async () =>
      (await unwrap<Routine[]>(supabase.from('routines').select(ROUTINE_SELECT).eq('owner_id', owner).order('created_at'))).map(sortRoutine),
  })
}

/** Rutinas que el compañero compartió conmigo. */
export function useSharedRoutines() {
  const me = useUserId()
  return useQuery({
    queryKey: keys.sharedRoutines,
    queryFn: async () =>
      (await unwrap<Routine[]>(supabase.from('routines').select(ROUTINE_SELECT).neq('owner_id', me).order('created_at'))).map(sortRoutine),
  })
}

// ---------- Sesiones ----------
export const SESSION_SELECT = '*, workout_exercises(*, exercise:exercises(id, name, primary_muscle), workout_sets(*))'

export function sortSession(s: WorkoutSession): WorkoutSession {
  s.workout_exercises?.sort((a, b) => a.position - b.position)
  s.workout_exercises?.forEach((e) => e.workout_sets?.sort((a, b) => a.set_number - b.set_number))
  return s
}

/** Todas las sesiones de un usuario (más recientes primero). Para dos usuarios el volumen es manejable. */
export function useSessions(userId?: string, opts: { enabled?: boolean } = {}) {
  const me = useUserId()
  const id = userId ?? me
  return useQuery({
    queryKey: keys.sessions(id),
    enabled: opts.enabled ?? true,
    queryFn: async () =>
      (await unwrap<WorkoutSession[]>(
        supabase.from('workout_sessions').select(SESSION_SELECT).eq('user_id', id).order('started_at', { ascending: false }).limit(1000),
      )).map(sortSession),
  })
}

export function useCompletedSessions(userId?: string, opts: { enabled?: boolean } = {}) {
  const q = useSessions(userId, opts)
  return { ...q, data: q.data?.filter((s) => s.status === 'completed') }
}

// ---------- Medidas y fotos ----------
export function useMeasurements(userId?: string, opts: { enabled?: boolean } = {}) {
  const me = useUserId()
  const id = userId ?? me
  return useQuery({
    queryKey: keys.measurements(id),
    enabled: opts.enabled ?? true,
    queryFn: () => unwrap<BodyMeasurement[]>(
      supabase.from('body_measurements').select('*').eq('user_id', id).order('measured_on', { ascending: false }).order('created_at', { ascending: false }),
    ),
  })
}

export function usePhotos(userId?: string, opts: { enabled?: boolean } = {}) {
  const me = useUserId()
  const id = userId ?? me
  return useQuery({
    queryKey: keys.photos(id),
    enabled: opts.enabled ?? true,
    queryFn: () => unwrap<ProgressPhoto[]>(
      supabase.from('progress_photos').select('*').eq('user_id', id).order('taken_on', { ascending: false }),
    ),
  })
}

// ---------- Récords ----------
export function useRecords(userId?: string, opts: { enabled?: boolean } = {}) {
  const me = useUserId()
  const id = userId ?? me
  return useQuery({
    queryKey: keys.records(id),
    enabled: opts.enabled ?? true,
    queryFn: () => unwrap<PersonalRecord[]>(
      supabase.from('personal_records').select('*, exercise:exercises(id, name, primary_muscle)').eq('user_id', id).order('achieved_at', { ascending: false }),
    ),
  })
}

/** Mejor marca vigente por ejercicio y tipo. */
export function bestRecords(records: PersonalRecord[] | undefined) {
  const best = new Map<string, PersonalRecord>()
  for (const r of records ?? []) {
    if (r.record_type === 'max_reps_at_weight') continue
    const k = `${r.exercise_id}:${r.record_type}`
    const cur = best.get(k)
    if (!cur || r.value > cur.value) best.set(k, r)
  }
  return best
}

// ---------- Objetivos, calendario, retos, notificaciones ----------
export function useGoals(userId?: string, opts: { enabled?: boolean } = {}) {
  const me = useUserId()
  const id = userId ?? me
  return useQuery({
    queryKey: keys.goals(id),
    enabled: opts.enabled ?? true,
    queryFn: () => unwrap<Goal[]>(
      supabase.from('goals').select('*, exercise:exercises(id, name)').eq('user_id', id).order('created_at', { ascending: false }),
    ),
  })
}

export function useSchedule(userId?: string) {
  const me = useUserId()
  const id = userId ?? me
  return useQuery({
    queryKey: keys.schedule(id),
    queryFn: () => unwrap<ScheduledWorkout[]>(
      supabase.from('scheduled_workouts')
        .select('*, routine:routines(id, name), routine_day:routine_days(id, name)')
        .eq('user_id', id).order('scheduled_on'),
    ),
  })
}

export function useChallenges() {
  return useQuery({
    queryKey: keys.challenges,
    queryFn: () => unwrap<Challenge[]>(
      supabase.from('challenges')
        .select('*, challenge_participants(user_id, is_owner), exercise:exercises(id, name), routine:routines(id, name)')
        .order('start_date', { ascending: false }),
    ),
  })
}

export function useChallengeProgress(id: string) {
  return useQuery({
    queryKey: keys.challengeProgress(id),
    queryFn: () => unwrap<ChallengeProgress[]>(supabase.rpc('challenge_progress', { p_challenge: id })),
  })
}

export function useNotifications() {
  const me = useUserId()
  return useQuery({
    queryKey: keys.notifications(me),
    queryFn: () => unwrap<AppNotification[]>(
      supabase.from('notifications').select('*').eq('user_id', me).order('created_at', { ascending: false }).limit(100),
    ),
    refetchInterval: 5 * 60_000,
  })
}
