import {
  ArrowDown, ArrowUp, Check, ChevronDown, CloudOff, Copy, Flag, History, Loader2, MoreHorizontal, Play, Plus,
  Repeat, Timer, Trash2, Trophy,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  Badge, Button, Card, CardTitle, ConfirmDialog, EmptyState, Input, LoadingBlock, PageHeader, Select, Textarea,
} from '@/components/ui'
import { bestRecords, useCompletedSessions, usePrefs, useRecords, useRoutines, useSharedRoutines, useUnit } from '@/data/queries'
import { useUserId } from '@/features/auth/AuthProvider'
import { ExercisePicker } from '@/features/exercises/ExercisePicker'
import { epley1rm } from '@/lib/calc'
import { errorMessage } from '@/lib/errors'
import { MUSCLE_LABELS, SET_TYPE_LABELS, SET_TYPE_SHORT } from '@/lib/labels'
import type { Routine, RoutineDay, SetType, WeightUnit, WorkoutSession } from '@/lib/types'
import { displayWeight, fmtWeight, toKg, weightStep } from '@/lib/units'
import { cn, formatClock, numOrNull } from '@/lib/utils'
import { fmtShort } from '@/lib/dates'
import { restTimer, RestTimerBar } from './RestTimer'
import {
  startWorkout, useActiveWorkout, useSyncState, workoutActions, type LocalExercise, type LocalSet,
} from './store'

/** Series de la última sesión completada que incluyó el ejercicio. */
function lastPerformance(sessions: WorkoutSession[] | undefined, exerciseId: string) {
  for (const s of sessions ?? []) {
    const sets = (s.workout_exercises ?? []).filter((e) => e.exercise_id === exerciseId).flatMap((e) => e.workout_sets ?? []).filter((x) => x.completed)
    if (sets.length) return { date: s.started_at, sets }
  }
  return null
}

export function WorkoutPage() {
  const active = useActiveWorkout()
  return (
    <>
      {active ? <ActiveWorkoutView /> : <StartWorkoutView />}
      <RestTimerBar />
    </>
  )
}

// ---------------- Inicio ----------------
function StartWorkoutView() {
  const userId = useUserId()
  const own = useRoutines()
  const shared = useSharedRoutines()
  const { data: sessions } = useCompletedSessions()
  const { data: prefs } = usePrefs()
  const navigate = useNavigate()
  const sync = useSyncState()

  const begin = (routine: Routine | null, day: RoutineDay | null) => {
    try {
      startWorkout({
        userId,
        name: routine && day ? `${routine.name} — ${day.name}` : 'Sesión libre',
        routine_id: routine?.owner_id === userId ? routine.id : null,
        routine_day_id: routine?.owner_id === userId ? day?.id ?? null : null,
        exercises: (day?.routine_exercises ?? []).map((re) => {
          const last = lastPerformance(sessions, re.exercise_id)
          const working = last?.sets.filter((x) => x.set_type !== 'warmup') ?? []
          return {
            exercise_id: re.exercise_id,
            name: re.exercise?.name ?? 'Ejercicio',
            primary_muscle: re.exercise?.primary_muscle ?? 'chest',
            rest_seconds: re.rest_seconds ?? prefs?.default_rest_seconds ?? 90,
            notes: re.notes,
            target: { sets: re.target_sets, repsMin: re.target_reps_min, repsMax: re.target_reps_max, weightKg: re.target_weight_kg },
            // Prellenado: lo que hiciste la última vez en esa serie; si no hay historial, el objetivo de la rutina.
            initialSets: Array.from({ length: re.target_sets }, (_, i) => ({
              weight_kg: Number(working[i]?.weight_kg ?? working[working.length - 1]?.weight_kg ?? re.target_weight_kg ?? 0),
              reps: working[i]?.reps ?? re.target_reps_max ?? re.target_reps_min ?? 0,
            })),
          }
        }),
      })
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const routines = [...(own.data ?? []).filter((r) => r.status === 'active'), ...(shared.data ?? []).filter((r) => r.status === 'active')]
  const today = new Date().getDay()

  return (
    <div className="animate-fade-up">
      <PageHeader title="Mi entrenamiento" subtitle="Elige la rutina del día o empieza una sesión libre." />
      {sync.status === 'error' && <Card className="mb-4 border-danger/40 text-sm text-danger">{sync.message}</Card>}
      <Button size="xl" className="mb-6 w-full sm:w-auto" onClick={() => begin(null, null)}><Play className="h-5 w-5" /> Sesión libre</Button>
      {own.isLoading || shared.isLoading ? <LoadingBlock /> : !routines.length ? (
        <EmptyState icon={<Timer className="h-8 w-8" />} title="No tienes rutinas activas"
          description="Crea una rutina o usa una plantilla para entrenar con ejercicios ya ordenados."
          action={<Link to="/rutinas"><Button variant="outline">Ir a Rutinas</Button></Link>} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {routines.map((r) => (
            <Card key={r.id}>
              <CardTitle action={r.owner_id !== userId ? <Badge tone="info">Compartida</Badge> : undefined}>{r.name}</CardTitle>
              <div className="space-y-2">
                {(r.routine_days ?? []).map((d) => (
                  <div key={d.id} className={cn('flex items-center justify-between gap-3 rounded-xl bg-surface-2 p-3', d.day_of_week === today && 'ring-1 ring-accent/50')}>
                    <div className="min-w-0">
                      <p className="font-semibold">{d.name} {d.day_of_week === today && <Badge tone="accent">Hoy</Badge>}</p>
                      <p className="truncate text-xs text-muted">{(d.routine_exercises ?? []).length} ejercicios · {d.muscle_groups.map((m) => MUSCLE_LABELS[m]).join(', ') || 'Sin grupos'}</p>
                    </div>
                    <Button size="lg" onClick={() => begin(r, d)} disabled={!d.routine_exercises?.length} aria-label={`Iniciar ${d.name}`}><Play className="h-4 w-4" /> Iniciar</Button>
                  </div>
                ))}
                {!r.routine_days?.length && <p className="text-sm text-muted">Esta rutina no tiene días. <button className="text-accent" onClick={() => navigate('/rutinas')}>Editar</button></p>}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------- Sesión activa ----------------
function ActiveWorkoutView() {
  const w = useActiveWorkout()!
  const sync = useSyncState()
  const unit = useUnit()
  const { data: prefs } = usePrefs()
  const { data: sessions } = useCompletedSessions()
  const { data: records } = useRecords()
  const best = useMemo(() => bestRecords(records), [records])
  const navigate = useNavigate()
  const [now, setNow] = useState(Date.now())
  const [picker, setPicker] = useState(false)
  const [confirmFinish, setConfirmFinish] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(i)
  }, [])

  const elapsed = (now - new Date(w.session.started_at).getTime()) / 1000
  const allSets = w.exercises.flatMap((e) => e.sets)
  const done = allSets.filter((s) => s.completed).length

  const finish = async () => {
    setBusy(true)
    const ok = await workoutActions.finish()
    setBusy(false)
    setConfirmFinish(false)
    if (ok) navigate('/historial')
    else toast.info('Sesión finalizada en este dispositivo. Se guardará en el servidor al recuperar la conexión.')
  }

  if (w.finishRequestedAt) {
    return (
      <Card className="mx-auto max-w-lg text-center">
        <CloudOff className="mx-auto mb-3 h-8 w-8 text-warning" />
        <p className="font-semibold">Sesión finalizada, pendiente de sincronizar</p>
        <p className="mt-1 text-sm text-muted">{sync.message ?? 'Se enviará automáticamente al recuperar la conexión.'}</p>
        <Button className="mt-4" variant="outline" onClick={() => void workoutActions.finish()}>Reintentar ahora</Button>
      </Card>
    )
  }

  return (
    <div className="animate-fade-up">
      <div className="sticky top-[57px] z-20 -mx-4 mb-4 border-b border-border bg-bg/90 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:top-0 lg:-mx-8 lg:px-8">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-bold">{w.session.name}</p>
            <p className="flex items-center gap-2 text-xs text-muted">
              <span className="font-mono tabular text-accent">{formatClock(elapsed)}</span>
              <span>· {done}/{allSets.length} series</span>
              <SyncBadge status={sync.status} message={sync.message} />
            </p>
          </div>
          <Button size="lg" onClick={() => setConfirmFinish(true)}><Flag className="h-4 w-4" /> Finalizar</Button>
        </div>
      </div>

      <div className="space-y-4">
        {w.exercises.map((ex, i) => (
          <ExerciseCard
            key={ex.id} ex={ex} index={i} total={w.exercises.length} unit={unit}
            defaultRest={prefs?.default_rest_seconds ?? 90}
            last={lastPerformance(sessions, ex.exercise_id)}
            prWeight={best.get(`${ex.exercise_id}:max_weight`)?.value}
            prE1rm={best.get(`${ex.exercise_id}:est_1rm`)?.value}
          />
        ))}
      </div>

      <Button variant="outline" size="lg" className="mt-4 w-full" onClick={() => setPicker(true)}><Plus className="h-5 w-5" /> Agregar ejercicio</Button>

      <Card className="mt-4">
        <label className="mb-1.5 block text-sm text-muted" htmlFor="session-notes">Notas de la sesión</label>
        <Textarea id="session-notes" defaultValue={w.session.notes ?? ''} onBlur={(e) => workoutActions.updateSession({ notes: e.target.value || null })} placeholder="Sensaciones, energía, molestias…" />
      </Card>

      <div className="mt-6 flex justify-center">
        <Button variant="ghost" className="text-danger" onClick={() => setConfirmDiscard(true)}><Trash2 className="h-4 w-4" /> Descartar sesión</Button>
      </div>

      <ExercisePicker open={picker} onOpenChange={setPicker} onPick={(e) => workoutActions.addExercise({
        exercise_id: e.id, name: e.name, primary_muscle: e.primary_muscle, rest_seconds: prefs?.default_rest_seconds ?? 90,
      })} />
      <ConfirmDialog open={confirmFinish} onOpenChange={setConfirmFinish} title="¿Finalizar entrenamiento?"
        description={`Se guardarán ${done} series completadas. Las series sin marcar como completadas se guardan pero no cuentan para volumen ni récords.`}
        confirmLabel="Finalizar y guardar" loading={busy} onConfirm={finish} />
      <ConfirmDialog open={confirmDiscard} onOpenChange={setConfirmDiscard} title="¿Descartar la sesión?" danger
        description="Se eliminarán todas las series registradas en esta sesión. Esta acción no se puede deshacer."
        confirmLabel="Descartar" loading={busy}
        onConfirm={async () => {
          setBusy(true)
          try { await workoutActions.discard(); setConfirmDiscard(false) } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
        }} />
    </div>
  )
}

function SyncBadge({ status, message }: { status: string; message?: string }) {
  if (status === 'syncing') return <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Guardando</span>
  if (status === 'pending') return <span className="inline-flex items-center gap-1 text-warning" title={message}><CloudOff className="h-3 w-3" /> {message ? 'Sin conexión' : 'Pendiente'}</span>
  if (status === 'error') return <span className="text-danger" title={message}>Error al guardar</span>
  return <span className="inline-flex items-center gap-1 text-accent"><Check className="h-3 w-3" /> Guardado</span>
}

function ExerciseCard({ ex, index, total, unit, last, prWeight, prE1rm, defaultRest }: {
  ex: LocalExercise; index: number; total: number; unit: WeightUnit; defaultRest: number
  last: ReturnType<typeof lastPerformance>; prWeight?: number; prE1rm?: number
}) {
  const [menu, setMenu] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const rest = ex.rest_seconds ?? defaultRest
  const allDone = ex.sets.length > 0 && ex.sets.every((s) => s.completed)
  const t = ex.target

  return (
    <Card className={cn('p-3 sm:p-4', allDone && 'border-accent/40')}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-bold">{allDone && <Check className="h-4 w-4 text-accent" />}{ex.name}</p>
          <p className="text-xs text-muted">
            {MUSCLE_LABELS[ex.primary_muscle]}
            {t && <> · Objetivo {t.sets}×{t.repsMin && t.repsMax && t.repsMin !== t.repsMax ? `${t.repsMin}-${t.repsMax}` : t.repsMax ?? t.repsMin ?? '?'}{t.weightKg ? ` @ ${fmtWeight(t.weightKg, unit)}` : ''}</>}
            {' '}· Descanso {formatClock(rest)}
          </p>
        </div>
        <Button variant="ghost" size="icon" aria-label="Opciones del ejercicio" aria-expanded={menu} onClick={() => setMenu(!menu)}><MoreHorizontal className="h-5 w-5" /></Button>
      </div>

      {menu && (
        <div className="mb-3 grid grid-cols-2 gap-2 rounded-xl bg-surface-2 p-2 sm:grid-cols-4">
          <Button size="sm" variant="secondary" disabled={index === 0} onClick={() => workoutActions.moveExercise(ex.id, -1)}><ArrowUp className="h-4 w-4" /> Subir</Button>
          <Button size="sm" variant="secondary" disabled={index === total - 1} onClick={() => workoutActions.moveExercise(ex.id, 1)}><ArrowDown className="h-4 w-4" /> Bajar</Button>
          <label className="flex items-center gap-1 text-xs text-muted">
            Descanso
            <Input type="number" inputMode="numeric" min={0} max={900} className="h-8 w-16 px-2 text-sm" defaultValue={rest}
              onBlur={(e) => workoutActions.updateExercise(ex.id, { rest_seconds: numOrNull(e.target.value) })} aria-label="Descanso en segundos" />s
          </label>
          <Button size="sm" variant="danger" onClick={() => setConfirmRemove(true)}><Trash2 className="h-4 w-4" /> Quitar</Button>
        </div>
      )}

      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        {last ? (
          <span className="inline-flex items-center gap-1 rounded-lg bg-surface-2 px-2 py-1 text-muted">
            <History className="h-3.5 w-3.5" /> Última ({fmtShort(last.date)}):{' '}
            {last.sets.filter((s) => s.set_type !== 'warmup').map((s) => `${displayWeight(Number(s.weight_kg), unit)}×${s.reps}`).join(', ') || 'solo calentamiento'}
          </span>
        ) : <span className="rounded-lg bg-surface-2 px-2 py-1 text-muted">Primera vez con este ejercicio</span>}
        {prWeight !== undefined && (
          <span className="inline-flex items-center gap-1 rounded-lg bg-accent/10 px-2 py-1 text-accent">
            <Trophy className="h-3.5 w-3.5" /> PR {fmtWeight(prWeight, unit)}{prE1rm ? ` · 1RM est. ${fmtWeight(prE1rm, unit)}` : ''}
          </span>
        )}
      </div>

      <div className="space-y-2">
        <div className="grid grid-cols-[2.25rem_1fr_1fr_3.5rem] gap-2 px-1 text-[11px] uppercase tracking-wide text-muted">
          <span>Serie</span><span className="text-center">Peso ({unit})</span><span className="text-center">Reps</span><span />
        </div>
        {ex.sets.map((s, i) => (
          <SetRow key={s.id} ex={ex} set={s} index={i} unit={unit} rest={rest} prWeight={prWeight} />
        ))}
      </div>
      <Button variant="secondary" className="mt-3 w-full" onClick={() => workoutActions.addSet(ex.id)}><Plus className="h-4 w-4" /> Agregar serie</Button>

      <ConfirmDialog open={confirmRemove} onOpenChange={setConfirmRemove} title={`¿Quitar ${ex.name}?`} danger
        description="Se eliminarán sus series de esta sesión." confirmLabel="Quitar"
        onConfirm={() => { workoutActions.removeExercise(ex.id); setConfirmRemove(false) }} />
    </Card>
  )
}

function Stepper({ value, onChange, step, label, decimals }: { value: number; onChange: (v: number) => void; step: number; label: string; decimals: boolean }) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const commit = (raw: string) => {
    const n = numOrNull(raw)
    if (n === null || n < 0) return setText(String(value))
    onChange(decimals ? n : Math.round(n))
  }
  return (
    <div className="flex items-center rounded-xl bg-surface-2">
      <button type="button" className="h-12 w-9 shrink-0 rounded-l-xl text-lg text-muted active:bg-surface-3" aria-label={`Bajar ${label}`}
        onClick={() => onChange(Math.max(0, Math.round((value - step) * 100) / 100))}>−</button>
      <input
        className="h-12 w-full min-w-0 bg-transparent text-center font-mono text-lg font-bold tabular focus:outline-none"
        inputMode={decimals ? 'decimal' : 'numeric'} value={text} aria-label={label}
        onChange={(e) => setText(e.target.value)} onBlur={(e) => commit(e.target.value)}
        onFocus={(e) => e.target.select()} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      />
      <button type="button" className="h-12 w-9 shrink-0 rounded-r-xl text-lg text-muted active:bg-surface-3" aria-label={`Subir ${label}`}
        onClick={() => onChange(Math.round((value + step) * 100) / 100)}>+</button>
    </div>
  )
}

function SetRow({ ex, set, index, unit, rest, prWeight }: { ex: LocalExercise; set: LocalSet; index: number; unit: WeightUnit; rest: number; prWeight?: number }) {
  const [open, setOpen] = useState(false)
  const shown = displayWeight(set.weight_kg, unit)
  const isPr = set.completed && set.set_type !== 'warmup' && prWeight !== undefined && set.weight_kg > prWeight
  const e1rm = set.set_type !== 'warmup' ? epley1rm(set.weight_kg, set.reps) : null
  const upd = (patch: Partial<LocalSet>) => workoutActions.updateSet(ex.id, set.id, patch)

  const toggle = () => {
    const completing = !set.completed
    upd({ completed: completing })
    if (completing && rest > 0) restTimer.start(rest)
  }

  return (
    <div className={cn('rounded-xl transition', set.completed ? 'bg-accent/[0.07]' : '')}>
      <div className="grid grid-cols-[2.25rem_1fr_1fr_3.5rem] items-center gap-2 p-1">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`Detalles de la serie ${set.set_number}`}
          className={cn('flex h-12 flex-col items-center justify-center rounded-xl text-sm font-bold', set.set_type === 'warmup' ? 'text-warning' : set.set_type === 'normal' ? 'text-muted' : 'text-info')}>
          {SET_TYPE_SHORT[set.set_type] || set.set_number}
          <ChevronDown className={cn('h-3 w-3 transition', open && 'rotate-180')} />
        </button>
        <Stepper label={`peso serie ${set.set_number}`} value={shown} step={weightStep(unit)} decimals
          onChange={(v) => upd({ weight_kg: Math.round(toKg(v, unit) * 100) / 100 })} />
        <Stepper label={`repeticiones serie ${set.set_number}`} value={set.reps} step={1} decimals={false} onChange={(v) => upd({ reps: v })} />
        <button type="button" onClick={toggle} aria-pressed={set.completed} aria-label={set.completed ? `Desmarcar serie ${set.set_number}` : `Completar serie ${set.set_number}`}
          className={cn('flex h-12 w-full items-center justify-center rounded-xl transition active:scale-95', set.completed ? 'bg-accent text-accent-fg' : 'bg-surface-3 text-muted')}>
          <Check className="h-6 w-6" strokeWidth={3} />
        </button>
      </div>
      {(isPr || (open && e1rm)) && (
        <p className="px-3 pb-1 text-[11px] text-muted">
          {isPr && <span className="mr-2 font-semibold text-accent">¡Nuevo récord de peso!</span>}
          {open && e1rm && <>1RM estimado (Epley): {fmtWeight(e1rm, unit)} — es una estimación, no una medición.</>}
        </p>
      )}
      {open && (
        <div className="grid grid-cols-2 gap-2 p-2 sm:grid-cols-4">
          <Select value={set.set_type} onChange={(e) => upd({ set_type: e.target.value as SetType })} aria-label="Tipo de serie" className="h-10 text-sm">
            {Object.entries(SET_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Input type="number" inputMode="decimal" min={1} max={10} step={0.5} placeholder="RPE (1-10)" aria-label="RPE" className="h-10 text-sm"
            defaultValue={set.rpe ?? ''} onBlur={(e) => { const v = numOrNull(e.target.value); upd({ rpe: v === null ? null : Math.min(10, Math.max(1, v)) }) }} />
          <Input type="number" inputMode="numeric" min={0} max={10} placeholder="RIR (0-10)" aria-label="RIR" className="h-10 text-sm"
            defaultValue={set.rir ?? ''} onBlur={(e) => { const v = numOrNull(e.target.value); upd({ rir: v === null ? null : Math.min(10, Math.max(0, Math.round(v))) }) }} />
          <Input placeholder="Nota" aria-label="Nota de la serie" className="h-10 text-sm" maxLength={500}
            defaultValue={set.notes ?? ''} onBlur={(e) => upd({ notes: e.target.value || null })} />
          <Button size="sm" variant="secondary" disabled={index === 0} onClick={() => workoutActions.repeatPrevious(ex.id, set.id)}><Repeat className="h-4 w-4" /> Repetir anterior</Button>
          <Button size="sm" variant="secondary" onClick={() => workoutActions.addSet(ex.id, set.id)}><Copy className="h-4 w-4" /> Duplicar</Button>
          <Button size="sm" variant="danger" className="col-span-2 sm:col-span-2" onClick={() => workoutActions.removeSet(ex.id, set.id)}><Trash2 className="h-4 w-4" /> Eliminar serie</Button>
        </div>
      )}
    </div>
  )
}
