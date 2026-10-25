import {
  addMonths, addWeeks, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, startOfMonth, startOfWeek, subMonths, subWeeks,
} from 'date-fns'
import { es } from 'date-fns/locale'
import { Check, ChevronLeft, ChevronRight, Flame, HeartPulse, Moon, Plus, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Card, CardTitle, ConfirmDialog, Field, Input, LoadingBlock, Modal, PageHeader, Select, StatCard, Tabs } from '@/components/ui'
import { keys, unwrap, useCardio, useCompletedSessions, useMut, usePrefs, useRoutines, useSchedule } from '@/data/queries'
import { useUserId } from '@/features/auth/AuthProvider'
import { dailyStreak, weeklyStreak } from '@/lib/calc'
import { CARDIO_LABELS, type CardioSession } from '@/lib/cardio'
import { fmtDate, localDay, todayKey, WEEK_OPTS } from '@/lib/dates'
import { SCHEDULE_STATUS_LABELS } from '@/lib/labels'
import { supabase } from '@/lib/supabase'
import type { ScheduleStatus, ScheduledWorkout, WorkoutSession } from '@/lib/types'
import { cn, formatDuration } from '@/lib/utils'

export default function CalendarPage() {
  const me = useUserId()
  const [view, setView] = useState<'month' | 'week'>('month')
  const [cursor, setCursor] = useState(new Date())
  const [dayOpen, setDayOpen] = useState<string | null>(null)
  const { data: schedule, isLoading } = useSchedule()
  const { data: sessions } = useCompletedSessions()
  const { data: prefs } = usePrefs()
  const { data: cardio } = useCardio()
  const [goalOpen, setGoalOpen] = useState(false)

  const days = useMemo(() => view === 'month'
    ? eachDayOfInterval({ start: startOfWeek(startOfMonth(cursor), WEEK_OPTS), end: endOfWeek(endOfMonth(cursor), WEEK_OPTS) })
    : eachDayOfInterval({ start: startOfWeek(cursor, WEEK_OPTS), end: endOfWeek(cursor, WEEK_OPTS) }), [view, cursor])

  const sessionsByDay = useMemo(() => {
    const m = new Map<string, WorkoutSession[]>()
    for (const s of sessions ?? []) { const k = localDay(s.started_at); m.set(k, [...(m.get(k) ?? []), s]) }
    return m
  }, [sessions])
  const cardioByDay = useMemo(() => {
    const m = new Map<string, CardioSession[]>()
    for (const c of cardio ?? []) { const k = localDay(c.started_at); m.set(k, [...(m.get(k) ?? []), c]) }
    return m
  }, [cardio])
  const scheduleByDay = useMemo(() => {
    const m = new Map<string, ScheduledWorkout[]>()
    for (const s of schedule ?? []) m.set(s.scheduled_on, [...(m.get(s.scheduled_on) ?? []), s])
    return m
  }, [schedule])

  const starts = (sessions ?? []).map((s) => s.started_at)
  const target = prefs?.weekly_workout_target ?? 4
  const monthDays = eachDayOfInterval({ start: startOfMonth(cursor), end: endOfMonth(cursor) }).map((d) => format(d, 'yyyy-MM-dd'))
  const monthCompleted = monthDays.filter((d) => sessionsByDay.has(d)).length
  const monthSkipped = monthDays.reduce((a, d) => a + (scheduleByDay.get(d)?.filter((s) => s.status === 'skipped').length ?? 0), 0)
  const monthPlanned = monthDays.reduce((a, d) => a + (scheduleByDay.get(d)?.filter((s) => s.status !== 'rest').length ?? 0), 0)

  const move = (dir: 1 | -1) => setCursor(view === 'month' ? (dir > 0 ? addMonths(cursor, 1) : subMonths(cursor, 1)) : (dir > 0 ? addWeeks(cursor, 1) : subWeeks(cursor, 1)))
  if (isLoading) return <LoadingBlock />

  return (
    <div className="animate-fade-up">
      <PageHeader title="Calendario y asistencia" subtitle="Lo programado (contorno) frente a lo realmente completado (verde). Las rachas cuentan entrenamientos de fuerza; el cardio se muestra aparte."
        actions={<Button variant="outline" onClick={() => setGoalOpen(true)}>Objetivo semanal: {target}</Button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Racha semanal" icon={<Flame className="h-4 w-4" />} value={`${weeklyStreak(starts, target)} sem.`} sub={`Semanas con ${target}+ sesiones`} />
        <StatCard label="Racha diaria" value={`${dailyStreak(starts)} días`} sub="Días seguidos entrenando" />
        <StatCard label="Completados en el mes" value={monthCompleted} sub={monthPlanned ? `${monthPlanned} programados` : 'Sin programación'} accent />
        <StatCard label="Omitidos en el mes" value={monthSkipped} />
      </div>
      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" aria-label="Anterior" onClick={() => move(-1)}><ChevronLeft className="h-5 w-5" /></Button>
            <p className="min-w-44 text-center font-bold capitalize">{view === 'month' ? format(cursor, 'MMMM yyyy', { locale: es }) : `Semana del ${fmtDate(days[0], 'd MMM')}`}</p>
            <Button variant="ghost" size="icon" aria-label="Siguiente" onClick={() => move(1)}><ChevronRight className="h-5 w-5" /></Button>
            <Button variant="ghost" size="sm" onClick={() => setCursor(new Date())}>Hoy</Button>
          </div>
          <Tabs value={view} onChange={setView} options={[{ value: 'month', label: 'Mes' }, { value: 'week', label: 'Semana' }]} />
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] uppercase text-muted">
          {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d) => <div key={d} className="py-1">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {days.map((d) => {
            const key = format(d, 'yyyy-MM-dd')
            const done = sessionsByDay.get(key) ?? []
            const cardioDone = cardioByDay.get(key) ?? []
            const sched = scheduleByDay.get(key) ?? []
            const rest = sched.some((s) => s.status === 'rest')
            const skipped = sched.some((s) => s.status === 'skipped')
            const planned = sched.filter((s) => s.status === 'scheduled')
            return (
              <button key={key} type="button" onClick={() => setDayOpen(key)}
                className={cn('flex flex-col items-start gap-1 rounded-xl border p-1.5 text-left transition hover:border-accent/50',
                  view === 'month' ? 'min-h-16 sm:min-h-20' : 'min-h-32',
                  !isSameMonth(d, cursor) && view === 'month' ? 'opacity-40' : '',
                  key === todayKey() ? 'border-accent' : 'border-border',
                  done.length ? 'bg-accent/10' : 'bg-surface-2')}
                aria-label={`${fmtDate(d)}: ${done.length} completados, ${planned.length} programados`}>
                <span className={cn('text-xs font-semibold', key === todayKey() && 'text-accent')}>{format(d, 'd')}</span>
                {done.length > 0 && <span className="flex items-center gap-0.5 text-[10px] font-semibold text-accent"><Check className="h-3 w-3" />{view === 'week' ? done.map((s) => s.name).join(', ') : done.length}</span>}
                {cardioDone.length > 0 && <span className="flex items-center gap-0.5 text-[10px] font-semibold text-pink-400"><HeartPulse className="h-3 w-3" />{view === 'week' ? cardioDone.map((c) => `${CARDIO_LABELS[c.activity]} ${Math.round(c.duration_seconds / 60)}′`).join(', ') : cardioDone.length}</span>}
                {planned.length > 0 && <span className="rounded border border-info/60 px-1 text-[10px] text-info">{view === 'week' ? planned.map((p) => p.routine_day?.name ?? p.routine?.name ?? 'Programado').join(', ') : 'Prog.'}</span>}
                {skipped && <span className="flex items-center text-[10px] text-danger"><X className="h-3 w-3" />Omitido</span>}
                {rest && <span className="flex items-center gap-0.5 text-[10px] text-muted"><Moon className="h-3 w-3" />Descanso</span>}
              </button>
            )
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted">
          <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-accent/30" /> Completado</span>
          <span className="flex items-center gap-1"><HeartPulse className="h-3 w-3 text-pink-400" /> Cardio</span>
          <span className="flex items-center gap-1"><span className="h-3 w-3 rounded border border-info" /> Programado</span>
          <span className="flex items-center gap-1"><X className="h-3 w-3 text-danger" /> Omitido</span>
          <span className="flex items-center gap-1"><Moon className="h-3 w-3" /> Descanso</span>
        </div>
      </Card>
      {dayOpen && <DayModal day={dayOpen} sessions={sessionsByDay.get(dayOpen) ?? []} cardio={cardioByDay.get(dayOpen) ?? []} schedule={scheduleByDay.get(dayOpen) ?? []} onClose={() => setDayOpen(null)} />}
      {goalOpen && <WeeklyGoalModal current={target} onClose={() => setGoalOpen(false)} userId={me} />}
    </div>
  )
}

function DayModal({ day, sessions, cardio, schedule, onClose }: { day: string; sessions: WorkoutSession[]; cardio: CardioSession[]; schedule: ScheduledWorkout[]; onClose: () => void }) {
  const me = useUserId()
  const { data: routines } = useRoutines()
  const [routineDay, setRoutineDay] = useState('')
  const [toDelete, setToDelete] = useState<ScheduledWorkout | null>(null)
  const inv = [keys.schedule(me)]
  const add = useMut(async (status: ScheduleStatus) => {
    const [routine_id, routine_day_id] = routineDay ? routineDay.split(':') : [null, null]
    return unwrap(supabase.from('scheduled_workouts').insert({ user_id: me, scheduled_on: day, status, routine_id, routine_day_id }))
  }, { invalidate: inv, success: 'Calendario actualizado' })
  const setStatus = useMut(async ({ s, status }: { s: ScheduledWorkout; status: ScheduleStatus }) =>
    unwrap(supabase.from('scheduled_workouts').update({ status }).eq('id', s.id)), { invalidate: inv })
  const del = useMut(async (s: ScheduledWorkout) => unwrap(supabase.from('scheduled_workouts').delete().eq('id', s.id)), { invalidate: inv, onSuccess: () => setToDelete(null) })
  const past = day < todayKey()

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={fmtDate(day, "EEEE d 'de' MMMM yyyy")}>
      <div className="space-y-4">
        <div>
          <CardTitle>Completados</CardTitle>
          {sessions.length ? sessions.map((s) => (
            <Link key={s.id} to={`/historial/${s.id}`} className="mb-1 flex items-center justify-between rounded-xl bg-accent/10 p-3 text-sm">
              <span className="font-semibold text-accent">{s.name}</span><span className="text-muted">{fmtDate(s.started_at, 'HH:mm')}</span>
            </Link>
          )) : <p className="text-sm text-muted">Sin entrenamientos completados este día.</p>}
          {cardio.map((c) => (
            <Link key={c.id} to="/cardio" className="mb-1 flex items-center justify-between rounded-xl bg-pink-500/10 p-3 text-sm">
              <span className="flex items-center gap-1.5 font-semibold text-pink-400"><HeartPulse className="h-4 w-4" />{CARDIO_LABELS[c.activity]} · {formatDuration(c.duration_seconds)}</span>
              <span className="text-muted">{fmtDate(c.started_at, 'HH:mm')}</span>
            </Link>
          ))}
        </div>
        <div>
          <CardTitle>Programación</CardTitle>
          {schedule.map((s) => (
            <div key={s.id} className="mb-1 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-2 p-3 text-sm">
              <span>{s.status === 'rest' ? 'Día de descanso' : `${s.routine?.name ?? 'Sesión'}${s.routine_day ? ` — ${s.routine_day.name}` : ''}`}</span>
              <span className="flex items-center gap-1">
                <Badge tone={s.status === 'completed' ? 'accent' : s.status === 'skipped' ? 'danger' : 'info'}>{SCHEDULE_STATUS_LABELS[s.status]}</Badge>
                {s.status === 'scheduled' && past && <Button size="sm" variant="ghost" onClick={() => setStatus.mutate({ s, status: 'skipped' })}>Marcar omitido</Button>}
                {s.status === 'skipped' && <Button size="sm" variant="ghost" onClick={() => setStatus.mutate({ s, status: 'scheduled' })}>Deshacer</Button>}
                <Button size="icon" variant="ghost" className="text-danger" aria-label="Quitar" onClick={() => setToDelete(s)}><Trash2 className="h-4 w-4" /></Button>
              </span>
            </div>
          ))}
          <div className="mt-3 flex flex-wrap gap-2">
            <Select value={routineDay} onChange={(e) => setRoutineDay(e.target.value)} className="min-w-0 flex-1" aria-label="Rutina a programar">
              <option value="">Sesión sin rutina</option>
              {(routines ?? []).filter((r) => r.status === 'active').flatMap((r) => (r.routine_days ?? []).map((d) => (
                <option key={d.id} value={`${r.id}:${d.id}`}>{r.name} — {d.name}</option>
              )))}
            </Select>
            <Button onClick={() => add.mutate('scheduled')} loading={add.isPending}><Plus className="h-4 w-4" /> Programar</Button>
            <Button variant="secondary" onClick={() => add.mutate('rest')}><Moon className="h-4 w-4" /> Descanso</Button>
          </div>
          <p className="mt-2 text-xs text-muted">Al completar un entrenamiento ese día, la sesión programada se marca como completada automáticamente.</p>
        </div>
      </div>
      <ConfirmDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)} title="¿Quitar de la programación?" description="Esto no borra entrenamientos completados."
        confirmLabel="Quitar" danger onConfirm={() => toDelete && del.mutate(toDelete)} />
    </Modal>
  )
}

function WeeklyGoalModal({ current, onClose, userId }: { current: number; onClose: () => void; userId: string }) {
  const [v, setV] = useState(current)
  const save = useMut(async () => unwrap(supabase.from('user_preferences').update({ weekly_workout_target: v }).eq('user_id', userId)),
    { invalidate: [keys.prefs(userId)], success: 'Objetivo actualizado', onSuccess: onClose })
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Objetivo semanal de entrenamientos">
      <Field label="Entrenamientos por semana (1 a 7)">{(id) => <Input id={id} type="number" min={1} max={7} value={v} onChange={(e) => setV(Math.min(7, Math.max(1, Number(e.target.value) || 1)))} />}</Field>
      <p className="mt-2 text-xs text-muted">Se recomienda dejar al menos un día de descanso a la semana.</p>
      <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={() => save.mutate(undefined)} loading={save.isPending}>Guardar</Button></div>
    </Modal>
  )
}
