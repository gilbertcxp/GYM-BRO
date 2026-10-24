import { ChartLine, Trophy } from 'lucide-react'
import { useMemo, useState } from 'react'
import { BarChartCard, LineChartCard } from '@/components/charts'
import { RangeFilter, useRange } from '@/components/RangeFilter'
import { Badge, Card, CardTitle, EmptyState, Input, LoadingBlock, PageHeader, Select, Tabs } from '@/components/ui'
import { bestRecords, useCompletedSessions, useExercises, useRecords, useUnit } from '@/data/queries'
import { completedIn, exerciseHistory, groupByPeriod, sessionStats, volumeByMuscle } from '@/lib/calc'
import { fmtDate, fmtShort, inRange, type DateRange } from '@/lib/dates'
import { MUSCLE_LABELS, PR_LABELS } from '@/lib/labels'
import type { WorkoutSession } from '@/lib/types'
import { fmtVolume, fmtWeight, kgTo } from '@/lib/units'
import { formatNumber, pctChange } from '@/lib/utils'
import { format, parseISO, subMonths } from 'date-fns'

const r1 = (n: number) => Math.round(n * 10) / 10

export default function ProgressPage() {
  const [tab, setTab] = useState<'strength' | 'volume' | 'records' | 'compare'>('strength')
  const { data: sessions, isLoading } = useCompletedSessions()
  if (isLoading) return <LoadingBlock />
  const list = sessions ?? []
  return (
    <div className="animate-fade-up">
      <PageHeader title="Progreso y estadísticas" subtitle="Todo se calcula a partir de tus series registradas." />
      <Tabs className="mb-5" value={tab} onChange={setTab} options={[
        { value: 'strength', label: 'Fuerza' }, { value: 'volume', label: 'Volumen' },
        { value: 'records', label: 'Récords' }, { value: 'compare', label: 'Comparar períodos' },
      ]} />
      {!list.length ? (
        <EmptyState icon={<ChartLine className="h-8 w-8" />} title="Todavía no hay entrenamientos completados" description="Cuando completes sesiones verás aquí tu evolución." />
      ) : tab === 'strength' ? <StrengthTab sessions={list} />
        : tab === 'volume' ? <VolumeTab sessions={list} />
        : tab === 'records' ? <RecordsTab />
        : <CompareTab sessions={list} />}
    </div>
  )
}

function StrengthTab({ sessions }: { sessions: WorkoutSession[] }) {
  const unit = useUnit()
  const rangeState = useRange('quarter')
  const { data: records } = useRecords()
  const trained = useMemo(() => {
    const m = new Map<string, { name: string; n: number }>()
    for (const s of sessions) for (const we of s.workout_exercises ?? []) {
      const c = m.get(we.exercise_id) ?? { name: we.exercise?.name ?? '', n: 0 }
      c.n++
      m.set(we.exercise_id, c)
    }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n)
  }, [sessions])
  const [exerciseId, setExerciseId] = useState(trained[0]?.[0] ?? '')
  const inPeriod = useMemo(() => completedIn(sessions, rangeState.range), [sessions, rangeState.range])
  const points = useMemo(() => exerciseHistory(inPeriod, exerciseId), [inPeriod, exerciseId])
  const allPoints = useMemo(() => exerciseHistory(sessions, exerciseId), [sessions, exerciseId])
  const best = bestRecords(records)
  const bestSet = allPoints.reduce<{ weight: number; reps: number; date: string } | null>((acc, p) =>
    p.bestSet && (!acc || p.bestSet.weight > acc.weight || (p.bestSet.weight === acc.weight && p.bestSet.reps > acc.reps)) ? { ...p.bestSet, date: p.date } : acc, null)
  const data = points.map((p) => ({
    date: fmtShort(p.date), max: r1(kgTo(p.maxWeight, unit)), e1rm: p.bestE1rm === null ? null : r1(kgTo(p.bestE1rm, unit)),
    reps: p.totalReps, volume: Math.round(kgTo(p.volume, unit)),
  }))
  const weeks = Math.max(1, (rangeState.range.to.getTime() - rangeState.range.from.getTime()) / (7 * 86400000))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={exerciseId} onChange={(e) => setExerciseId(e.target.value)} className="w-auto min-w-64" aria-label="Ejercicio">
          {trained.map(([id, v]) => <option key={id} value={id}>{v.name} ({v.n})</option>)}
        </Select>
        <RangeFilter state={rangeState} />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card><p className="text-xs uppercase text-muted">Récord de peso</p><p className="mt-1 text-xl font-bold">{fmtWeight(best.get(`${exerciseId}:max_weight`)?.value, unit)}</p></Card>
        <Card><p className="text-xs uppercase text-muted">Mejor serie</p><p className="mt-1 text-xl font-bold">{bestSet ? `${fmtWeight(bestSet.weight, unit)} × ${bestSet.reps}` : '—'}</p>{bestSet && <p className="text-xs text-muted">{fmtDate(bestSet.date)}</p>}</Card>
        <Card><p className="text-xs uppercase text-muted">1RM estimado</p><p className="mt-1 text-xl font-bold">{fmtWeight(best.get(`${exerciseId}:est_1rm`)?.value, unit)}</p><p className="text-xs text-muted">Estimación (Epley)</p></Card>
        <Card><p className="text-xs uppercase text-muted">Frecuencia</p><p className="mt-1 text-xl font-bold">{formatNumber(points.length / weeks, 1)}/sem</p><p className="text-xs text-muted">{points.length} sesiones en el período</p></Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardTitle>Peso ({unit})</CardTitle>
          <LineChartCard data={data} xKey="date" series={[{ key: 'max', label: 'Peso máximo' }, { key: 'e1rm', label: '1RM estimado', dashed: true }]} />
        </Card>
        <Card><CardTitle>Repeticiones totales (series de trabajo)</CardTitle>
          <BarChartCard data={data} xKey="date" series={[{ key: 'reps', label: 'Reps' }]} />
        </Card>
        <Card className="lg:col-span-2"><CardTitle>Volumen por sesión ({unit})</CardTitle>
          <BarChartCard data={data} xKey="date" series={[{ key: 'volume', label: 'Volumen' }]} yFormatter={(v) => formatNumber(v)} />
        </Card>
      </div>
    </div>
  )
}

function VolumeTab({ sessions }: { sessions: WorkoutSession[] }) {
  const unit = useUnit()
  const rangeState = useRange('quarter')
  const [period, setPeriod] = useState<'week' | 'month'>('week')
  const { data: exercises } = useExercises()
  const muscleOf = useMemo(() => { const m = new Map(exercises?.map((e) => [e.id, e.primary_muscle])); return (id: string) => m.get(id) }, [exercises])
  const inPeriod = useMemo(() => completedIn(sessions, rangeState.range), [sessions, rangeState.range])
  const byPeriod = [...groupByPeriod(inPeriod, period).entries()].map(([k, v]) => ({
    period: period === 'week' ? fmtShort(k) : format(parseISO(`${k}-01`), 'MMM yy'), volume: Math.round(kgTo(v.volume, unit)), sesiones: v.sessions,
  }))
  const byMuscle = [...volumeByMuscle(inPeriod, muscleOf).entries()].sort((a, b) => b[1].volume - a[1].volume)
    .map(([m, v]) => ({ muscle: MUSCLE_LABELS[m], volume: Math.round(kgTo(v.volume, unit)), series: v.sets }))
  const warmup = inPeriod.reduce((a, s) => a + sessionStats(s).warmupVolume, 0)
  const working = inPeriod.reduce((a, s) => a + sessionStats(s).volume, 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <RangeFilter state={rangeState} />
        <Tabs value={period} onChange={setPeriod} options={[{ value: 'week', label: 'Por semana' }, { value: 'month', label: 'Por mes' }]} />
      </div>
      <Card className="text-sm text-muted">
        Volumen = Σ (peso × repeticiones) de series completadas. Series de trabajo: <b className="text-text">{fmtVolume(working, unit)}</b> ·
        calentamiento (excluido de totales): <b className="text-text">{fmtVolume(warmup, unit)}</b>.
        Un mayor volumen no es por sí solo prueba de crecimiento muscular.
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardTitle>Volumen {period === 'week' ? 'semanal' : 'mensual'} ({unit})</CardTitle>
          <BarChartCard data={byPeriod} xKey="period" series={[{ key: 'volume', label: 'Volumen' }]} yFormatter={(v) => formatNumber(v)} />
        </Card>
        <Card><CardTitle>Volumen por grupo muscular ({unit})</CardTitle>
          <BarChartCard data={byMuscle} xKey="muscle" series={[{ key: 'volume', label: 'Volumen' }]} yFormatter={(v) => formatNumber(v)} />
        </Card>
      </div>
      <Card>
        <CardTitle>Series de trabajo por grupo muscular</CardTitle>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {byMuscle.map((m) => <div key={m.muscle} className="rounded-xl bg-surface-2 p-3"><p className="text-xs text-muted">{m.muscle}</p><p className="font-bold">{m.series} series</p></div>)}
        </div>
      </Card>
    </div>
  )
}

function RecordsTab() {
  const unit = useUnit()
  const { data: records, isLoading } = useRecords()
  const [q, setQ] = useState('')
  if (isLoading) return <LoadingBlock />
  const best = [...bestRecords(records).values()].filter((r) => !q || r.exercise?.name.toLowerCase().includes(q.toLowerCase()))
  const byExercise = new Map<string, typeof best>()
  for (const r of best) byExercise.set(r.exercise_id, [...(byExercise.get(r.exercise_id) ?? []), r])
  const recent = (records ?? []).filter((r) => r.previous_value !== null).slice(0, 15)
  const fmt = (type: string, v: number) => (type === 'max_reps_at_weight' ? `${v} reps` : type === 'max_session_volume' ? fmtVolume(v, unit) : fmtWeight(v, unit))

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardTitle action={<Input placeholder="Filtrar…" value={q} onChange={(e) => setQ(e.target.value)} className="h-8 w-40 text-sm" aria-label="Filtrar ejercicios" />}>Récords vigentes</CardTitle>
        {!byExercise.size ? <p className="text-sm text-muted">Sin récords todavía.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs uppercase text-muted"><th className="py-2 font-medium">Ejercicio</th><th className="font-medium">Mayor peso</th><th className="font-medium">1RM est.*</th><th className="font-medium">Mayor volumen</th></tr></thead>
              <tbody className="divide-y divide-border">
                {[...byExercise.entries()].map(([id, rs]) => {
                  const get = (t: string) => rs.find((r) => r.record_type === t)
                  const mw = get('max_weight')
                  return (
                    <tr key={id}>
                      <td className="py-2 font-medium">{rs[0].exercise?.name}</td>
                      <td>{mw ? `${fmtWeight(mw.value, unit)} × ${mw.reps}` : '—'}</td>
                      <td>{fmtWeight(get('est_1rm')?.value, unit)}</td>
                      <td>{fmtVolume(get('max_session_volume')?.value, unit)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted">* 1RM estimado con la fórmula de Epley a partir de series de 1 a 15 repeticiones. No es una medición real.</p>
          </div>
        )}
      </Card>
      <Card>
        <CardTitle>Nuevos récords</CardTitle>
        {!recent.length ? <p className="text-sm text-muted">Cuando superes una marca anterior aparecerá aquí.</p> : (
          <ul className="space-y-2">
            {recent.map((r) => (
              <li key={r.id} className="flex items-start gap-2 rounded-xl bg-surface-2 p-3 text-sm">
                <Trophy className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <div>
                  <p className="font-semibold">{r.exercise?.name}</p>
                  <p className="text-xs text-muted">{PR_LABELS[r.record_type]}{r.record_type === 'max_reps_at_weight' && r.weight_kg ? ` con ${fmtWeight(r.weight_kg, unit)}` : ''}: {fmt(r.record_type, r.previous_value!)} → <span className="text-accent">{fmt(r.record_type, r.value)}</span></p>
                  <p className="text-xs text-muted">{fmtDate(r.achieved_at)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

function periodSummary(sessions: WorkoutSession[], range: DateRange, recordsInRange: number) {
  const s = completedIn(sessions, range)
  const sets = s.flatMap((x) => (x.workout_exercises ?? []).flatMap((e) => e.workout_sets ?? [])).filter((x) => x.completed && x.set_type !== 'warmup')
  const weeks = Math.max(1, (range.to.getTime() - range.from.getTime() + 86400000) / (7 * 86400000))
  return {
    sessions: s.length,
    frequency: s.length / weeks,
    volume: s.reduce((a, x) => a + sessionStats(x).volume, 0),
    reps: sets.reduce((a, x) => a + x.reps, 0),
    avgWeight: sets.length ? sets.reduce((a, x) => a + Number(x.weight_kg), 0) / sets.length : null,
    records: recordsInRange,
  }
}

function CompareTab({ sessions }: { sessions: WorkoutSession[] }) {
  const unit = useUnit()
  const { data: records } = useRecords()
  const now = new Date()
  const iso = (d: Date) => format(d, 'yyyy-MM-dd')
  const [a, setA] = useState({ from: iso(subMonths(now, 2)), to: iso(subMonths(now, 1)) })
  const [b, setB] = useState({ from: iso(subMonths(now, 1)), to: iso(now) })
  const toRange = (r: { from: string; to: string }): DateRange => ({ from: parseISO(r.from), to: parseISO(r.to) })
  const prs = (r: DateRange) => (records ?? []).filter((x) => x.previous_value !== null && inRange(x.achieved_at, r)).length
  const A = periodSummary(sessions, toRange(a), prs(toRange(a)))
  const B = periodSummary(sessions, toRange(b), prs(toRange(b)))
  const rows: { label: string; a: number | null; b: number | null; fmt: (v: number | null) => string }[] = [
    { label: 'Entrenamientos', a: A.sessions, b: B.sessions, fmt: (v) => formatNumber(v) },
    { label: 'Frecuencia semanal', a: A.frequency, b: B.frequency, fmt: (v) => formatNumber(v, 1) },
    { label: 'Volumen', a: A.volume, b: B.volume, fmt: (v) => fmtVolume(v, unit) },
    { label: 'Repeticiones', a: A.reps, b: B.reps, fmt: (v) => formatNumber(v) },
    { label: 'Peso medio por serie', a: A.avgWeight, b: B.avgWeight, fmt: (v) => fmtWeight(v, unit) },
    { label: 'Récords superados', a: A.records, b: B.records, fmt: (v) => formatNumber(v) },
  ]
  const DateInputs = ({ v, set, label }: { v: { from: string; to: string }; set: (x: { from: string; to: string }) => void; label: string }) => (
    <Card>
      <p className="mb-2 text-sm font-semibold">{label}</p>
      <div className="flex items-center gap-2">
        <Input type="date" className="h-9 text-sm" aria-label={`${label} desde`} value={v.from} onChange={(e) => e.target.value && set({ ...v, from: e.target.value })} />
        <span className="text-muted">—</span>
        <Input type="date" className="h-9 text-sm" aria-label={`${label} hasta`} value={v.to} onChange={(e) => e.target.value && set({ ...v, to: e.target.value })} />
      </div>
    </Card>
  )
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2"><DateInputs v={a} set={setA} label="Período A" /><DateInputs v={b} set={setB} label="Período B" /></div>
      <Card>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs uppercase text-muted"><th className="py-2 font-medium">Métrica</th><th className="font-medium">A</th><th className="font-medium">B</th><th className="font-medium">Cambio</th></tr></thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => {
              const p = pctChange(r.a, r.b)
              return (
                <tr key={r.label}>
                  <td className="py-2.5 text-muted">{r.label}</td><td>{r.fmt(r.a)}</td><td className="font-semibold">{r.fmt(r.b)}</td>
                  <td>{p === null ? <Badge>—</Badge> : <Badge tone={p >= 0 ? 'accent' : 'danger'}>{p >= 0 ? '+' : ''}{formatNumber(p, 0)}%</Badge>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-muted">Los aumentos de volumen o frecuencia describen tu entrenamiento; no son por sí solos prueba de crecimiento muscular.</p>
      </Card>
    </div>
  )
}
