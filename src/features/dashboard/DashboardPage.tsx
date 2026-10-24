import { CalendarClock, Clock, Dumbbell, Flame, Scale, Swords, Target, Trophy, Weight } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { LineChartCard } from '@/components/charts'
import { RangeFilter, useRange } from '@/components/RangeFilter'
import { Badge, Button, Card, CardTitle, EmptyState, LoadingBlock, PageHeader, ProgressBar, StatCard } from '@/components/ui'
import {
  useCompletedSessions, useMeasurements, usePartnership, usePrefs, useProfile, useRecords, useSchedule, useUnit,
} from '@/data/queries'
import { completedIn, exerciseHistory, goalProgress, isWorkingSet, sessionStats, weeklyStreak } from '@/lib/calc'
import { fmtDate, fmtShort, inRange, presetRange, previousRange, sessionAxisLabels, todayKey } from '@/lib/dates'
import { PR_LABELS } from '@/lib/labels'
import { fmtVolume, fmtWeight, kgTo } from '@/lib/units'
import { formatDuration, formatNumber, pctChange } from '@/lib/utils'
import type { WorkoutSession } from '@/lib/types'

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches'
}

function totals(sessions: WorkoutSession[]) {
  return sessions.reduce((acc, s) => {
    const st = sessionStats(s)
    acc.volume += st.volume
    acc.duration += st.durationSec ?? 0
    return acc
  }, { volume: 0, duration: 0, count: sessions.length })
}

export default function DashboardPage() {
  const rangeState = useRange('month')
  const { range } = rangeState
  const unit = useUnit()
  const { data: profile } = useProfile()
  const { data: prefs } = usePrefs()
  const sessionsQ = useCompletedSessions()
  const { data: measurements } = useMeasurements()
  const { data: records } = useRecords()
  const { data: schedule } = useSchedule()
  const { data: partner } = usePartnership()
  const partnerId = partner?.partnerId ?? undefined
  const partnerSessions = useCompletedSessions(partnerId, { enabled: !!partnerId })
  const partnerProfile = useProfile(partnerId)

  const sessions = useMemo(() => sessionsQ.data ?? [], [sessionsQ.data])
  const inPeriod = useMemo(() => completedIn(sessions, range), [sessions, range])
  const prevPeriod = useMemo(() => completedIn(sessions, previousRange(range)), [sessions, range])
  const week = useMemo(() => completedIn(sessions, presetRange('week')), [sessions])
  const t = totals(inPeriod)
  const tPrev = totals(prevPeriod)
  const target = prefs?.weekly_workout_target ?? 4
  const streak = weeklyStreak(sessions.map((s) => s.started_at), target)

  const latestWeight = measurements?.find((m) => m.weight_kg !== null)?.weight_kg ?? null
  const currentWeight = latestWeight ?? profile?.initial_weight_kg ?? null
  const initialWeight = profile?.initial_weight_kg ?? null
  const weightDelta = currentWeight !== null && initialWeight !== null ? currentWeight - initialWeight : null
  const weightGoalPct = profile?.target_weight_kg ? goalProgress(initialWeight, currentWeight, profile.target_weight_kg) : null

  const newRecords = (records ?? []).filter((r) => r.previous_value !== null && inRange(r.achieved_at, range))
  const nextScheduled = (schedule ?? []).find((s) => s.status === 'scheduled' && s.scheduled_on >= todayKey())
  const last = sessions[0]
  const lastStats = last ? sessionStats(last) : null

  const weightSeries = useMemo(() => (measurements ?? [])
    .filter((m) => m.weight_kg !== null && inRange(`${m.measured_on}T12:00:00`, range))
    .map((m) => ({ date: fmtShort(m.measured_on), peso: Math.round(kgTo(m.weight_kg!, unit) * 10) / 10 }))
    .reverse(), [measurements, range, unit])

  // Ejercicio más entrenado del período para la gráfica de fuerza.
  const topExercise = useMemo(() => {
    const count = new Map<string, { n: number; name: string }>()
    for (const s of inPeriod) for (const we of s.workout_exercises ?? []) {
      if (!(we.workout_sets ?? []).some(isWorkingSet)) continue
      const c = count.get(we.exercise_id) ?? { n: 0, name: we.exercise?.name ?? '' }
      c.n++
      count.set(we.exercise_id, c)
    }
    return [...count.entries()].sort((a, b) => b[1].n - a[1].n)[0]
  }, [inPeriod])
  const strengthSeries = useMemo(() => {
    if (!topExercise) return []
    const points = exerciseHistory(inPeriod, topExercise[0])
    const labels = sessionAxisLabels(points.map((p) => p.startedAt))
    return points.map((p, i) => ({
      date: labels[i],
      e1rm: p.bestE1rm === null ? null : Math.round(kgTo(p.bestE1rm, unit) * 10) / 10,
      max: Math.round(kgTo(p.maxWeight, unit) * 10) / 10,
    }))
  }, [inPeriod, topExercise, unit])

  const pt = partnerId ? totals(completedIn(partnerSessions.data ?? [], range)) : null
  const ptPrev = partnerId ? totals(completedIn(partnerSessions.data ?? [], previousRange(range))) : null

  if (sessionsQ.isLoading) return <LoadingBlock />
  const name = profile?.full_name?.split(' ')[0] || 'atleta'

  return (
    <div className="animate-fade-up">
      <PageHeader title={`${greeting()}, ${name}`} subtitle={fmtDate(new Date(), "EEEE d 'de' MMMM")}
        actions={<Link to="/entrenamiento"><Button size="lg"><Dumbbell className="h-5 w-5" /> Entrenar</Button></Link>} />
      <div className="mb-5"><RangeFilter state={rangeState} /></div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Peso actual" icon={<Scale className="h-4 w-4" />} value={fmtWeight(currentWeight, unit)}
          sub={latestWeight === null && currentWeight !== null ? 'Peso inicial del perfil' : weightDelta !== null
            ? <span>{weightDelta > 0 ? '+' : ''}{fmtWeight(weightDelta, unit)} desde el inicio</span> : <Link to="/medidas" className="text-accent">Registrar peso</Link>} />
        <StatCard label="Objetivo de peso" icon={<Target className="h-4 w-4" />} value={fmtWeight(profile?.target_weight_kg, unit)}
          sub={weightGoalPct !== null ? <div className="space-y-1"><ProgressBar value={weightGoalPct} /><span>{weightGoalPct}% de avance</span></div>
            : <Link to="/configuracion" className="text-accent">Definir en el perfil</Link>} />
        <StatCard accent label="Esta semana" icon={<CalendarClock className="h-4 w-4" />} value={`${week.length} / ${target}`}
          sub={<ProgressBar value={(week.length / target) * 100} />} />
        <StatCard label="Racha semanal" icon={<Flame className="h-4 w-4" />} value={`${streak} sem.`} sub={`Semanas seguidas con ${target}+ sesiones`} />
        <StatCard label="Entrenamientos" icon={<Dumbbell className="h-4 w-4" />} value={t.count}
          sub={<Delta from={tPrev.count} to={t.count} />} />
        <StatCard label="Tiempo entrenado" icon={<Clock className="h-4 w-4" />} value={formatDuration(t.duration)} sub={<Delta from={tPrev.duration} to={t.duration} />} />
        <StatCard label="Volumen total" icon={<Weight className="h-4 w-4" />} value={fmtVolume(t.volume, unit)} sub={<Delta from={tPrev.volume} to={t.volume} />} />
        <StatCard label="Récords nuevos" icon={<Trophy className="h-4 w-4" />} value={newRecords.length}
          sub={newRecords[0] ? `${newRecords[0].exercise?.name}: ${PR_LABELS[newRecords[0].record_type]}` : 'En el período'} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle>Evolución del peso corporal ({unit})</CardTitle>
          <LineChartCard data={weightSeries} xKey="date" series={[{ key: 'peso', label: 'Peso' }]} empty="Registra tu peso en Peso y medidas para ver la evolución" />
        </Card>
        <div className="space-y-4">
          <Card>
            <CardTitle>Próximo entrenamiento</CardTitle>
            {nextScheduled ? (
              <div>
                <p className="font-semibold">{nextScheduled.routine?.name ?? 'Sesión programada'}{nextScheduled.routine_day && ` — ${nextScheduled.routine_day.name}`}</p>
                <p className="text-sm text-muted">{fmtDate(nextScheduled.scheduled_on, "EEEE d 'de' MMMM")}</p>
              </div>
            ) : <p className="text-sm text-muted">Nada programado. <Link to="/calendario" className="text-accent">Planificar</Link></p>}
          </Card>
          <Card>
            <CardTitle>Última sesión</CardTitle>
            {last && lastStats ? (
              <Link to={`/historial/${last.id}`} className="block">
                <p className="font-semibold">{last.name}</p>
                <p className="text-sm text-muted">{fmtDate(last.started_at, "EEEE d MMM, HH:mm")}</p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  <Badge>{lastStats.workingSets} series</Badge>
                  <Badge>{fmtVolume(lastStats.volume, unit)}</Badge>
                  {lastStats.durationSec !== null && <Badge>{formatDuration(lastStats.durationSec)}</Badge>}
                </div>
              </Link>
            ) : <p className="text-sm text-muted">Aún no has completado entrenamientos.</p>}
          </Card>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Evolución de fuerza{topExercise ? ` — ${topExercise[1].name}` : ''}</CardTitle>
          <LineChartCard data={strengthSeries} xKey="date"
            series={[{ key: 'e1rm', label: '1RM estimado (Epley)' }, { key: 'max', label: 'Peso máximo', dashed: true }]}
            empty="Completa entrenamientos para ver tu evolución" />
          <p className="mt-2 text-xs text-muted">El 1RM es una estimación con la fórmula de Epley, no una medición real.</p>
        </Card>
        <Card>
          <CardTitle action={<Link to="/gym-bro" className="text-xs text-accent">Ver todo</Link>}>Comparación con tu Gym Bro</CardTitle>
          {!partnerId ? (
            <EmptyState icon={<Swords className="h-7 w-7" />} title="Sin Gym Bro vinculado" action={<Link to="/gym-bro"><Button variant="outline" size="sm">Vincular</Button></Link>} />
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs uppercase text-muted"><th className="py-2 font-medium">Período</th><th className="font-medium">Tú</th><th className="font-medium">{partnerProfile.data?.full_name?.split(' ')[0] || 'Gym Bro'}</th></tr></thead>
              <tbody className="divide-y divide-border">
                <tr><td className="py-2 text-muted">Entrenamientos</td><td className="font-semibold">{t.count}</td><td className="font-semibold">{pt?.count ?? '—'}</td></tr>
                <tr><td className="py-2 text-muted">Volumen</td><td>{fmtVolume(t.volume, unit)}</td><td>{fmtVolume(pt?.volume, unit)}</td></tr>
                <tr><td className="py-2 text-muted">Cambio de volumen vs. período anterior</td><td><Delta from={tPrev.volume} to={t.volume} /></td><td><Delta from={ptPrev?.volume} to={pt?.volume} /></td></tr>
              </tbody>
            </table>
          )}
          {partnerId && <p className="mt-2 text-xs text-muted">El progreso porcentual compara a cada uno consigo mismo; no se espera que ambos levanten lo mismo.</p>}
        </Card>
      </div>
    </div>
  )
}

export function Delta({ from, to, suffix = 'vs. período anterior' }: { from?: number | null; to?: number | null; suffix?: string }) {
  const p = pctChange(from, to)
  if (p === null) return <span className="text-muted">Sin datos previos</span>
  return <span className={p >= 0 ? 'text-accent' : 'text-danger'}>{p >= 0 ? '+' : ''}{formatNumber(p, 0)}% <span className="text-muted">{suffix}</span></span>
}
