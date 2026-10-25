import { format, parseISO } from 'date-fns'
import { Activity, Flag, HeartPulse, Pause, Pencil, Play, Plus, Timer, Trash2, Trophy, X } from 'lucide-react'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { BarChartCard, LineChartCard } from '@/components/charts'
import { RangeFilter, useRange } from '@/components/RangeFilter'
import {
  Badge, Button, Card, CardTitle, ConfirmDialog, EmptyState, ErrorBlock, Field, Input, LoadingBlock, Modal, PageHeader,
  ProgressBar, Select, StatCard, Textarea,
} from '@/components/ui'
import { keys, unwrap, useCardio, useMut, useUnit } from '@/data/queries'
import { useUserId } from '@/features/auth/AuthProvider'
import {
  CARDIO_ACTIVITIES, CARDIO_LABELS, DISTANCE_ACTIVITIES, cardioBests, cardioByWeek, cardioIn, cardioTotals, distUnit,
  fmtPace, kmTo, paceSecondsPer, speedPerHour, supportsIncline, toKm, usesPace, type CardioActivity, type CardioSession,
} from '@/lib/cardio'
import { fmtDate, fmtDateTime, fmtShort, presetRange, sessionAxisLabels } from '@/lib/dates'
import { errorMessage } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import type { WeightUnit } from '@/lib/types'
import { formatClock, formatDuration, formatNumber, numOrNull } from '@/lib/utils'

// Referencia de la OMS para adultos: 150-300 min/semana de actividad aeróbica moderada.
const WEEKLY_REFERENCE_MIN = 150

// ---------- Cronómetro persistente (sobrevive a recargas) ----------
interface Stopwatch { activity: CardioActivity; startedAt: string; runningSince: number | null; accumulatedMs: number }
const SW_KEY = 'gymbro.cardioStopwatch'
const swSubs = new Set<() => void>()
let swState: Stopwatch | null = (() => {
  try { return JSON.parse(localStorage.getItem(SW_KEY) ?? 'null') as Stopwatch | null } catch { return null }
})()
function setSw(next: Stopwatch | null) {
  swState = next
  try { next ? localStorage.setItem(SW_KEY, JSON.stringify(next)) : localStorage.removeItem(SW_KEY) } catch { /* sin almacenamiento */ }
  swSubs.forEach((f) => f())
}
const useStopwatch = () => useSyncExternalStore((cb) => { swSubs.add(cb); return () => swSubs.delete(cb) }, () => swState)
const elapsedMs = (sw: Stopwatch, now: number) => sw.accumulatedMs + (sw.runningSince ? now - sw.runningSince : 0)

type Draft = Partial<CardioSession> & { activity: CardioActivity; started_at: string; duration_seconds: number }

export default function CardioPage() {
  const unit = useUnit()
  const { data, isLoading, error, refetch } = useCardio()
  const rangeState = useRange('month')
  const [activity, setActivity] = useState<CardioActivity | ''>('')
  const [editing, setEditing] = useState<Draft | null>(null)
  const [toDelete, setToDelete] = useState<CardioSession | null>(null)
  const me = useUserId()
  const sw = useStopwatch()

  const all = useMemo(() => data ?? [], [data])
  const filtered = useMemo(() => (activity ? all.filter((s) => s.activity === activity) : all), [all, activity])
  const inPeriod = useMemo(() => cardioIn(filtered, rangeState.range), [filtered, rangeState.range])
  const totals = cardioTotals(inPeriod)
  const thisWeekMin = cardioTotals(cardioIn(all, presetRange('week'))).seconds / 60

  const weekly = [...cardioByWeek(inPeriod).entries()].map(([k, v]) => ({ semana: fmtShort(k), minutos: Math.round(v.minutes), distancia: Math.round(kmTo(v.km, unit) * 10) / 10 }))
  // Activity used for pace/bests: the filter, or the most frequent activity in the period.
  const focus: CardioActivity | undefined = activity || ([...inPeriod.reduce((m, s) => m.set(s.activity, (m.get(s.activity) ?? 0) + 1), new Map<CardioActivity, number>())]
    .sort((a, b) => b[1] - a[1])[0]?.[0])
  const paceSeries = useMemo(() => {
    if (!focus) return []
    const pts = inPeriod.filter((s) => s.activity === focus && Number(s.distance_km ?? 0) > 0).reverse()
    const labels = sessionAxisLabels(pts.map((s) => s.started_at))
    return pts.map((s, i) => usesPace(focus)
      ? { fecha: labels[i], valor: Math.round((paceSecondsPer(s, unit) ?? 0) / 6) / 10 }
      : { fecha: labels[i], valor: Math.round((speedPerHour(s, unit) ?? 0) * 10) / 10 })
  }, [inPeriod, focus, unit])
  const bests = focus ? cardioBests(all, focus) : {}

  const del = useMut(async (s: CardioSession) => unwrap(supabase.from('cardio_sessions').delete().eq('id', s.id)), {
    invalidate: [keys.cardio(me)], success: 'Sesión eliminada', onSuccess: () => setToDelete(null),
  })

  const newDraft = (over: Partial<Draft> = {}): Draft => ({ activity: activity || 'running', started_at: new Date().toISOString(), duration_seconds: 1800, ...over })

  if (isLoading) return <LoadingBlock />
  if (error) return <ErrorBlock error={errorMessage(error)} onRetry={refetch} />

  return (
    <div className="animate-fade-up">
      <PageHeader title="Cardio" subtitle="Registra carrera, bicicleta, elíptica, remo y más. Las calorías solo se muestran si las registras."
        actions={<>
          {!sw && <Button variant="outline" onClick={() => setSw({ activity: activity || 'running', startedAt: new Date().toISOString(), runningSince: Date.now(), accumulatedMs: 0 })}>
            <Timer className="h-4 w-4" /> Iniciar cronómetro</Button>}
          <Button onClick={() => setEditing(newDraft())}><Plus className="h-4 w-4" /> Registrar sesión</Button>
        </>} />

      {sw && <StopwatchCard sw={sw} onFinish={(d) => setEditing(newDraft(d))} />}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <RangeFilter state={rangeState} />
        <Select value={activity} onChange={(e) => setActivity(e.target.value as CardioActivity | '')} className="w-auto min-w-48" aria-label="Actividad">
          <option value="">Todas las actividades</option>
          {CARDIO_ACTIVITIES.map((a) => <option key={a} value={a}>{CARDIO_LABELS[a]}</option>)}
        </Select>
      </div>

      {!all.length ? (
        <EmptyState icon={<Activity className="h-8 w-8" />} title="Aún no registras cardio"
          description="Usa el cronómetro durante tu sesión o registra una sesión ya hecha."
          action={<Button onClick={() => setEditing(newDraft())}>Registrar sesión</Button>} />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Sesiones" value={totals.sessions} icon={<Activity className="h-4 w-4" />} />
            <StatCard label="Tiempo total" value={formatDuration(totals.seconds)} icon={<Timer className="h-4 w-4" />} />
            <StatCard label="Distancia" value={`${formatNumber(kmTo(totals.km, unit), 1)} ${distUnit(unit)}`} />
            <StatCard label="Calorías registradas" value={totals.caloriesSessions ? formatNumber(totals.calories) : '—'}
              sub={totals.sessions ? `En ${totals.caloriesSessions} de ${totals.sessions} sesiones` : undefined} icon={<HeartPulse className="h-4 w-4" />} />
          </div>

          <Card>
            <CardTitle>Esta semana: {Math.round(thisWeekMin)} min</CardTitle>
            <ProgressBar value={(thisWeekMin / WEEKLY_REFERENCE_MIN) * 100} />
            <p className="mt-2 text-xs text-muted">Referencia orientativa de la OMS para adultos: 150–300 min semanales de actividad aeróbica moderada (o 75–150 min vigorosa). Ajústalo a tu objetivo y condición.</p>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card><CardTitle>Minutos por semana</CardTitle>
              <BarChartCard data={weekly} xKey="semana" series={[{ key: 'minutos', label: 'Minutos' }]} />
            </Card>
            <Card>
              <CardTitle>{focus ? `${usesPace(focus) ? `Ritmo (min/${distUnit(unit)})` : `Velocidad (${distUnit(unit)}/h)`} — ${CARDIO_LABELS[focus]}` : 'Ritmo'}</CardTitle>
              <LineChartCard data={paceSeries} xKey="fecha" series={[{ key: 'valor', label: focus && usesPace(focus) ? 'Ritmo' : 'Velocidad' }]}
                empty="Registra la distancia para ver tu ritmo" />
              {focus && usesPace(focus) && <p className="mt-2 text-xs text-muted">En ritmo, un valor menor es más rápido.</p>}
            </Card>
          </div>

          {focus && (
            <Card>
              <CardTitle>Mejores marcas — {CARDIO_LABELS[focus]}</CardTitle>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                <Best label="Mayor distancia" s={bests.longestDistance} value={(s) => `${formatNumber(kmTo(Number(s.distance_km), unit), 2)} ${distUnit(unit)}`} />
                <Best label="Mayor duración" s={bests.longestDuration} value={(s) => formatDuration(s.duration_seconds)} />
                {usesPace(focus)
                  ? <Best label="Mejor ritmo (≥1 km)" s={bests.bestPace} value={(s) => `${fmtPace(paceSecondsPer(s, unit))} /${distUnit(unit)}`} />
                  : <Best label="Mayor velocidad (≥1 km)" s={bests.bestSpeed} value={(s) => `${formatNumber(speedPerHour(s, unit), 1)} ${distUnit(unit)}/h`} />}
              </div>
            </Card>
          )}

          <Card>
            <CardTitle>Historial</CardTitle>
            {!inPeriod.length ? <p className="text-sm text-muted">Sin sesiones en el período.</p> : (
              <ul className="divide-y divide-border">
                {inPeriod.map((s) => (
                  <li key={s.id} className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="font-semibold">{CARDIO_LABELS[s.activity]} <span className="text-xs font-normal text-muted">· {fmtDateTime(s.started_at)}</span></p>
                      <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                        <Badge>{formatDuration(s.duration_seconds)}</Badge>
                        {s.distance_km !== null && <Badge>{formatNumber(kmTo(Number(s.distance_km), unit), 2)} {distUnit(unit)}</Badge>}
                        {s.distance_km !== null && (usesPace(s.activity)
                          ? <Badge tone="accent">{fmtPace(paceSecondsPer(s, unit))} /{distUnit(unit)}</Badge>
                          : <Badge tone="accent">{formatNumber(speedPerHour(s, unit), 1)} {distUnit(unit)}/h</Badge>)}
                        {s.avg_heart_rate && <Badge>FC {s.avg_heart_rate}{s.max_heart_rate ? `/${s.max_heart_rate}` : ''} ppm</Badge>}
                        {s.calories && <Badge>{s.calories} kcal</Badge>}
                        {s.rpe && <Badge>RPE {s.rpe}</Badge>}
                        {s.incline_pct !== null && <Badge>Inclinación {s.incline_pct}%</Badge>}
                      </div>
                      {s.notes && <p className="mt-1 text-xs text-muted">{s.notes}</p>}
                    </div>
                    <div className="flex shrink-0">
                      <Button size="icon" variant="ghost" aria-label="Editar" onClick={() => setEditing({ ...s })}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" className="text-danger" aria-label="Eliminar" onClick={() => setToDelete(s)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {editing && <CardioForm draft={editing} unit={unit} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)} danger title="¿Eliminar sesión de cardio?"
        description="Se borrará de forma permanente." confirmLabel="Eliminar" loading={del.isPending} onConfirm={() => toDelete && del.mutate(toDelete)} />
    </div>
  )
}

function Best({ label, s, value }: { label: string; s?: CardioSession; value: (s: CardioSession) => string }) {
  return (
    <div className="rounded-xl bg-surface-2 p-3">
      <p className="flex items-center gap-1 text-xs text-muted"><Trophy className="h-3.5 w-3.5 text-accent" /> {label}</p>
      <p className="mt-1 text-lg font-bold">{s ? value(s) : '—'}</p>
      {s && <p className="text-xs text-muted">{fmtDate(s.started_at)}</p>}
    </div>
  )
}

function StopwatchCard({ sw, onFinish }: { sw: Stopwatch; onFinish: (d: Partial<Draft>) => void }) {
  const [now, setNow] = useState(Date.now())
  const [confirmCancel, setConfirmCancel] = useState(false)
  useEffect(() => {
    if (!sw.runningSince) return
    const i = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(i)
  }, [sw.runningSince])
  const ms = elapsedMs(sw, now)
  return (
    <Card className="mb-4 border-accent/40">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Select value={sw.activity} onChange={(e) => setSw({ ...sw, activity: e.target.value as CardioActivity })} className="h-9 w-auto text-sm" aria-label="Actividad del cronómetro">
            {CARDIO_ACTIVITIES.map((a) => <option key={a} value={a}>{CARDIO_LABELS[a]}</option>)}
          </Select>
          <p className="mt-2 font-mono text-4xl font-bold tabular text-accent" role="timer">{formatClock(ms / 1000)}</p>
          <p className="text-xs text-muted">{sw.runningSince ? 'En curso' : 'En pausa'} · iniciado {format(parseISO(sw.startedAt), 'HH:mm')}</p>
        </div>
        <div className="flex gap-2">
          {sw.runningSince
            ? <Button size="lg" variant="secondary" onClick={() => setSw({ ...sw, runningSince: null, accumulatedMs: ms })}><Pause className="h-5 w-5" /> Pausar</Button>
            : <Button size="lg" variant="secondary" onClick={() => setSw({ ...sw, runningSince: Date.now() })}><Play className="h-5 w-5" /> Reanudar</Button>}
          <Button size="lg" disabled={ms < 60_000} title={ms < 60_000 ? 'Mínimo 1 minuto' : undefined}
            onClick={() => { onFinish({ activity: sw.activity, started_at: sw.startedAt, duration_seconds: Math.round(ms / 1000) }); setSw(null) }}>
            <Flag className="h-5 w-5" /> Terminar
          </Button>
          <Button size="lg" variant="ghost" aria-label="Cancelar cronómetro" onClick={() => setConfirmCancel(true)}><X className="h-5 w-5" /></Button>
        </div>
      </div>
      <ConfirmDialog open={confirmCancel} onOpenChange={setConfirmCancel} danger title="¿Descartar el cronómetro?" description="No se guardará esta sesión."
        confirmLabel="Descartar" onConfirm={() => { setSw(null); setConfirmCancel(false) }} />
    </Card>
  )
}

function CardioForm({ draft, unit, onClose }: { draft: Draft; unit: WeightUnit; onClose: () => void }) {
  const me = useUserId()
  const [activity, setActivity] = useState<CardioActivity>(draft.activity)
  const [when, setWhen] = useState(format(parseISO(draft.started_at), "yyyy-MM-dd'T'HH:mm"))
  const d0 = draft.duration_seconds
  const [h, setH] = useState(String(Math.floor(d0 / 3600)))
  const [m, setM] = useState(String(Math.floor((d0 % 3600) / 60)))
  const [sec, setSec] = useState(String(d0 % 60))
  const [distance, setDistance] = useState(draft.distance_km ? String(Math.round(kmTo(Number(draft.distance_km), unit) * 100) / 100) : '')
  const [calories, setCalories] = useState(draft.calories?.toString() ?? '')
  const [avgHr, setAvgHr] = useState(draft.avg_heart_rate?.toString() ?? '')
  const [maxHr, setMaxHr] = useState(draft.max_heart_rate?.toString() ?? '')
  const [rpe, setRpe] = useState(draft.rpe?.toString() ?? '')
  const [incline, setIncline] = useState(draft.incline_pct?.toString() ?? '')
  const [notes, setNotes] = useState(draft.notes ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const save = useMut(async () => {
    const errs: Record<string, string> = {}
    const duration = (numOrNull(h) ?? 0) * 3600 + (numOrNull(m) ?? 0) * 60 + (numOrNull(sec) ?? 0)
    if (duration < 60 || duration > 86400) errs.duration = 'Entre 1 minuto y 24 horas'
    const dist = numOrNull(distance)
    if (dist !== null && (dist <= 0 || toKm(dist, unit) > 1000)) errs.distance = 'Distancia no válida'
    const cal = numOrNull(calories), a = numOrNull(avgHr), x = numOrNull(maxHr), r = numOrNull(rpe), inc = numOrNull(incline)
    if (cal !== null && (cal < 1 || cal > 10000)) errs.calories = 'Entre 1 y 10000'
    if (a !== null && (a < 30 || a > 230)) errs.avgHr = 'Entre 30 y 230'
    if (x !== null && (x < 30 || x > 240)) errs.maxHr = 'Entre 30 y 240'
    if (a !== null && x !== null && x < a) errs.maxHr = 'Debe ser ≥ a la media'
    if (r !== null && (r < 1 || r > 10)) errs.rpe = 'Entre 1 y 10'
    if (inc !== null && (inc < -10 || inc > 40)) errs.incline = 'Entre -10 y 40'
    const started = new Date(when)
    if (Number.isNaN(started.getTime())) errs.when = 'Fecha no válida'
    else if (started.getTime() > Date.now() + 5 * 60_000) errs.when = 'No puede ser futura'
    setErrors(errs)
    if (Object.keys(errs).length) throw new Error('Revisa los campos marcados')
    const row = {
      user_id: me, activity, started_at: started.toISOString(), duration_seconds: Math.round(duration),
      distance_km: dist === null ? null : Math.round(toKm(dist, unit) * 1000) / 1000, calories: cal === null ? null : Math.round(cal),
      avg_heart_rate: a === null ? null : Math.round(a), max_heart_rate: x === null ? null : Math.round(x), rpe: r,
      incline_pct: supportsIncline(activity) ? inc : null, notes: notes.trim() || null,
    }
    return unwrap(draft.id ? supabase.from('cardio_sessions').update(row).eq('id', draft.id) : supabase.from('cardio_sessions').insert(row))
  }, { invalidate: [keys.cardio(me)], success: 'Sesión de cardio guardada', onSuccess: onClose })

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={draft.id ? 'Editar cardio' : 'Registrar cardio'} className="sm:max-w-xl">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined) }} noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Actividad">{(id) => (
            <Select id={id} value={activity} onChange={(e) => setActivity(e.target.value as CardioActivity)}>
              {CARDIO_ACTIVITIES.map((a) => <option key={a} value={a}>{CARDIO_LABELS[a]}</option>)}
            </Select>
          )}</Field>
          <Field label="Fecha y hora de inicio" error={errors.when}>{(id) => <Input id={id} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />}</Field>
        </div>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-muted">Duración</legend>
          <div className="grid grid-cols-3 gap-2">
            <Input type="number" inputMode="numeric" min={0} max={24} value={h} onChange={(e) => setH(e.target.value)} aria-label="Horas" placeholder="h" />
            <Input type="number" inputMode="numeric" min={0} max={59} value={m} onChange={(e) => setM(e.target.value)} aria-label="Minutos" placeholder="min" />
            <Input type="number" inputMode="numeric" min={0} max={59} value={sec} onChange={(e) => setSec(e.target.value)} aria-label="Segundos" placeholder="s" />
          </div>
          <p className="mt-1 text-xs text-muted">horas · minutos · segundos</p>
          {errors.duration && <p role="alert" className="text-xs text-danger">{errors.duration}</p>}
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Distancia (${distUnit(unit)})`} error={errors.distance} hint={DISTANCE_ACTIVITIES.has(activity) ? undefined : 'Opcional'}>
            {(id) => <Input id={id} type="number" inputMode="decimal" step="any" value={distance} onChange={(e) => setDistance(e.target.value)} />}
          </Field>
          <Field label="Calorías (de tu reloj o máquina)" error={errors.calories} hint="Opcional; la app no las estima">
            {(id) => <Input id={id} type="number" inputMode="numeric" value={calories} onChange={(e) => setCalories(e.target.value)} />}
          </Field>
          <Field label="FC media (ppm)" error={errors.avgHr}>{(id) => <Input id={id} type="number" inputMode="numeric" value={avgHr} onChange={(e) => setAvgHr(e.target.value)} />}</Field>
          <Field label="FC máxima (ppm)" error={errors.maxHr}>{(id) => <Input id={id} type="number" inputMode="numeric" value={maxHr} onChange={(e) => setMaxHr(e.target.value)} />}</Field>
          <Field label="Esfuerzo percibido (RPE 1-10)" error={errors.rpe}>{(id) => <Input id={id} type="number" inputMode="decimal" step={0.5} value={rpe} onChange={(e) => setRpe(e.target.value)} />}</Field>
          {supportsIncline(activity) && <Field label="Inclinación (%)" error={errors.incline}>{(id) => <Input id={id} type="number" inputMode="decimal" step={0.5} value={incline} onChange={(e) => setIncline(e.target.value)} />}</Field>}
        </div>
        <Field label="Notas">{(id) => <Textarea id={id} rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Intervalos, sensaciones, ruta…" />}</Field>
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" loading={save.isPending}>Guardar</Button></div>
      </form>
    </Modal>
  )
}
