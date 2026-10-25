import { useQuery } from '@tanstack/react-query'
import { format, parseISO, startOfMonth, subMonths } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  Activity, Clock, Flag, Gauge, Map as MapIcon, Pencil, Play, Plus, Route, Satellite, Swords, Target, Trash2, Trophy,
} from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { BarChartCard } from '@/components/charts'
import { RangeFilter, useRange } from '@/components/RangeFilter'
import {
  Badge, Button, Card, CardTitle, ConfirmDialog, EmptyState, ErrorBlock, Field, Input, LoadingBlock, Modal, PageHeader,
  ProgressBar, Select, StatCard, Switch, Tabs, Textarea,
} from '@/components/ui'
import { keys, unwrap, useCardio, useMut, usePartnership, useProfile, useUnit } from '@/data/queries'
import { useUserId } from '@/features/auth/AuthProvider'
import {
  CARDIO_ACTIVITIES, CARDIO_LABELS, DISTANCE_ACTIVITIES, GPS_ACTIVITIES, cardioBests, cardioIn, cardioTotals, distUnit,
  estimateCalories, fmtPace, kmTo, paceSecondsPer, speedPerHour, supportsIncline, toKm, usesPace, type CardioActivity, type CardioSession,
} from '@/lib/cardio'
import { fmtDate, fmtDateTime, fmtShort, presetRange, weekKey } from '@/lib/dates'
import { errorMessage } from '@/lib/errors'
import { kmSplits, type RoutePoint } from '@/lib/geo'
import { supabase } from '@/lib/supabase'
import type { WeightUnit } from '@/lib/types'
import { formatClock, formatDuration, formatNumber, numOrNull } from '@/lib/utils'
import { LiveCardio, useLatestWeight } from './LiveCardio'
import { tracker, useTracker } from './tracker'

const RouteMap = lazy(() => import('./RouteMap').then((m) => ({ default: m.RouteMap })))

export default function CardioPage() {
  const me = useUserId()
  const live = useTracker()
  useEffect(() => { tracker.resumeAfterReload(me) }, [me])

  if (live && live.userId === me) {
    return (
      <div>
        <PageHeader title="Cardio en curso" />
        <LiveCardio s={live} />
      </div>
    )
  }
  return <CardioDashboard />
}

// ======================= Panel =======================
function CardioDashboard() {
  const me = useUserId()
  const unit = useUnit()
  const { data: partner } = usePartnership()
  const partnerId = partner?.partnerId ?? null
  const [who, setWho] = useState<string>(me)
  const mine = who === me
  const { data, isLoading, error, refetch } = useCardio(who)
  const { data: myProfile } = useProfile()
  const { data: partnerProfile } = useProfile(partnerId ?? undefined)
  const viewedProfile = mine ? myProfile : partnerProfile
  const rangeState = useRange('month')
  const [activity, setActivity] = useState<CardioActivity | ''>('')
  const [editing, setEditing] = useState<CardioSession | 'new' | null>(null)
  const [detail, setDetail] = useState<CardioSession | null>(null)
  const [starting, setStarting] = useState(false)
  const [goalOpen, setGoalOpen] = useState(false)

  const all = useMemo(() => (data ?? []).filter((s) => !activity || s.activity === activity), [data, activity])
  const inPeriod = useMemo(() => cardioIn(all, rangeState.range), [all, rangeState.range])
  const km = (list: CardioSession[]) => cardioTotals(list).km
  const today = km(cardioIn(all, { from: new Date(new Date().setHours(0, 0, 0, 0)), to: new Date() }))
  const week = km(cardioIn(all, presetRange('week')))
  const month = km(cardioIn(all, presetRange('month')))
  const totals = cardioTotals(inPeriod)
  const paceList = inPeriod.filter((s) => usesPace(s.activity) && Number(s.distance_km ?? 0) > 0)
  const paceTotals = cardioTotals(paceList)
  const avgPace = paceTotals.km > 0 ? paceTotals.seconds / kmTo(paceTotals.km, unit) : null
  const best = all.reduce<CardioSession | null>((b, s) => (Number(s.distance_km ?? 0) > Number(b?.distance_km ?? 0) ? s : b), null)
  const goal = viewedProfile?.cardio_weekly_goal_km ? Number(viewedProfile.cardio_weekly_goal_km) : null

  const weekly = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of inPeriod) { const k = weekKey(s.started_at); m.set(k, (m.get(k) ?? 0) + Number(s.distance_km ?? 0)) }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => ({ semana: fmtShort(k), distancia: Math.round(kmTo(v, unit) * 10) / 10 }))
  }, [inPeriod, unit])
  const monthly = useMemo(() => Array.from({ length: 6 }, (_, i) => {
    const start = startOfMonth(subMonths(new Date(), 5 - i))
    const end = startOfMonth(subMonths(new Date(), 4 - i))
    const v = all.filter((s) => { const d = parseISO(s.started_at); return d >= start && d < end }).reduce((a, s) => a + Number(s.distance_km ?? 0), 0)
    return { mes: format(start, 'MMM yy', { locale: es }), distancia: Math.round(kmTo(v, unit) * 10) / 10 }
  }), [all, unit])
  const focus: CardioActivity | undefined = activity || (inPeriod[0]?.activity)
  const bests = focus ? cardioBests(data ?? [], focus) : {}
  const d = distUnit(unit)

  return (
    <div className="animate-fade-up">
      <PageHeader title="Cardio" subtitle="Seguimiento GPS en vivo o registro manual para caminadora y máquinas."
        actions={mine && <>
          <Button variant="outline" onClick={() => setEditing('new')}><Plus className="h-4 w-4" /> Registro manual</Button>
          <Button size="lg" onClick={() => setStarting(true)}><Play className="h-5 w-5" /> INICIAR CARDIO</Button>
        </>} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        {partnerId && <Tabs value={who} onChange={setWho} options={[
          { value: me, label: 'Yo' }, { value: partnerId, label: partnerProfile?.full_name?.split(' ')[0] || 'Gym Bro' },
        ]} />}
        <RangeFilter state={rangeState} />
        <Select value={activity} onChange={(e) => setActivity(e.target.value as CardioActivity | '')} className="w-auto min-w-48" aria-label="Tipo de cardio">
          <option value="">Todas las actividades</option>
          {CARDIO_ACTIVITIES.map((a) => <option key={a} value={a}>{CARDIO_LABELS[a]}</option>)}
        </Select>
      </div>

      {isLoading ? <LoadingBlock /> : error ? <ErrorBlock error={errorMessage(error)} onRetry={refetch} /> : !(data ?? []).length ? (
        <EmptyState icon={<Activity className="h-8 w-8" />} title={mine ? 'Aún no registras cardio' : 'Tu Gym Bro no tiene cardio visible'}
          description={mine ? 'Pulsa INICIAR CARDIO para medir tu recorrido con GPS, o registra una sesión de caminadora o máquina.' : 'Solo verás sus sesiones si comparte sus entrenamientos.'}
          action={mine ? <Button size="lg" onClick={() => setStarting(true)}><Play className="h-5 w-5" /> INICIAR CARDIO</Button> : undefined} />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Distancia hoy" value={`${formatNumber(kmTo(today, unit), 2)} ${d}`} icon={<Route className="h-4 w-4" />} accent />
            <StatCard label="Esta semana" value={`${formatNumber(kmTo(week, unit), 1)} ${d}`} sub={goal ? `Meta ${formatNumber(kmTo(goal, unit), 1)} ${d}` : undefined} />
            <StatCard label="Este mes" value={`${formatNumber(kmTo(month, unit), 1)} ${d}`} />
            <StatCard label={`Acumulado (${activity ? CARDIO_LABELS[activity] : 'todo'})`} value={`${formatNumber(kmTo(km(all), unit), 1)} ${d}`} />
            <StatCard label="Tiempo en el período" value={formatDuration(totals.seconds)} icon={<Clock className="h-4 w-4" />} />
            <StatCard label={`Ritmo promedio /${d}`} value={fmtPace(avgPace)} sub="Correr, caminar, nadar y remo" icon={<Gauge className="h-4 w-4" />} />
            <StatCard label="Mejor distancia" value={best ? `${formatNumber(kmTo(Number(best.distance_km), unit), 2)} ${d}` : '—'} sub={best ? fmtDate(best.started_at) : undefined} icon={<Trophy className="h-4 w-4" />} />
            <StatCard label="Sesiones en el período" value={totals.sessions} sub={`${inPeriod.filter((s) => s.tracking_mode === 'gps').length} con GPS · ${inPeriod.filter((s) => s.tracking_mode !== 'gps').length} manuales`} />
          </div>

          <Card>
            <CardTitle action={mine && <Button size="sm" variant="ghost" onClick={() => setGoalOpen(true)}><Target className="h-4 w-4" /> {goal ? 'Cambiar meta' : 'Definir meta'}</Button>}>
              Meta semanal {goal ? `· ${formatNumber(kmTo(week, unit), 1)} / ${formatNumber(kmTo(goal, unit), 1)} ${d}` : ''}
            </CardTitle>
            {goal ? <ProgressBar value={(week / goal) * 100} /> : <p className="text-sm text-muted">{mine ? 'Define cuántos km quieres recorrer por semana.' : 'Tu Gym Bro no definió meta semanal.'}</p>}
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card><CardTitle>Distancia por semana ({d})</CardTitle>
              <BarChartCard data={weekly} xKey="semana" series={[{ key: 'distancia', label: 'Distancia' }]} />
            </Card>
            <Card><CardTitle>Distancia por mes ({d}) · últimos 6 meses</CardTitle>
              <BarChartCard data={monthly} xKey="mes" series={[{ key: 'distancia', label: 'Distancia' }]} />
            </Card>
          </div>

          {partnerId && <Comparison partnerId={partnerId} />}

          {focus && (
            <Card>
              <CardTitle>Mejores marcas — {CARDIO_LABELS[focus]}</CardTitle>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                <Best label="Mayor distancia" s={bests.longestDistance} value={(s) => `${formatNumber(kmTo(Number(s.distance_km), unit), 2)} ${d}`} />
                <Best label="Mayor duración" s={bests.longestDuration} value={(s) => formatDuration(s.duration_seconds)} />
                {usesPace(focus)
                  ? <Best label="Mejor ritmo (≥1 km)" s={bests.bestPace} value={(s) => `${fmtPace(paceSecondsPer(s, unit))} /${d}`} />
                  : <Best label="Mayor velocidad (≥1 km)" s={bests.bestSpeed} value={(s) => `${formatNumber(speedPerHour(s, unit), 1)} ${d}/h`} />}
              </div>
            </Card>
          )}

          <Card>
            <CardTitle>Historial</CardTitle>
            {!inPeriod.length ? <p className="text-sm text-muted">Sin sesiones en el período.</p> : (
              <ul className="divide-y divide-border">
                {inPeriod.map((s) => (
                  <li key={s.id}>
                    <button type="button" onClick={() => setDetail(s)} className="flex w-full items-start justify-between gap-3 py-3 text-left">
                      <div className="min-w-0">
                        <p className="font-semibold">{CARDIO_LABELS[s.activity]} <span className="text-xs font-normal text-muted">· {fmtDateTime(s.started_at)}</span></p>
                        <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                          <Badge>{formatDuration(s.duration_seconds)}</Badge>
                          {s.distance_km !== null && <Badge>{formatNumber(kmTo(Number(s.distance_km), unit), 2)} {d}</Badge>}
                          {s.distance_km !== null && <Badge tone="accent">{usesPace(s.activity) ? `${fmtPace(paceSecondsPer(s, unit))} /${d}` : `${formatNumber(speedPerHour(s, unit), 1)} ${d}/h`}</Badge>}
                          {s.tracking_mode === 'gps' ? <Badge tone="info"><Satellite className="h-3 w-3" /> GPS</Badge> : <Badge>Manual</Badge>}
                        </div>
                      </div>
                      {s.tracking_mode === 'gps' && <MapIcon className="mt-1 h-5 w-5 shrink-0 text-muted" aria-label="Tiene mapa" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {starting && <StartModal onClose={() => setStarting(false)} />}
      {editing && <CardioForm session={editing === 'new' ? null : editing} unit={unit} onClose={() => setEditing(null)} />}
      {detail && <SessionDetail s={detail} mine={detail.user_id === me} onClose={() => setDetail(null)} onEdit={() => { setEditing(detail); setDetail(null) }} />}
      {goalOpen && <GoalModal current={myProfile?.cardio_weekly_goal_km ?? null} unit={unit} onClose={() => setGoalOpen(false)} />}
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

// ======================= Inicio de sesión en vivo =======================
function StartModal({ onClose }: { onClose: () => void }) {
  const me = useUserId()
  const [activity, setActivity] = useState<CardioActivity>('running')
  const [useGps, setUseGps] = useState(true)
  useEffect(() => setUseGps(GPS_ACTIVITIES.has(activity)), [activity])
  const secure = typeof window !== 'undefined' && window.isSecureContext && 'geolocation' in navigator
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Iniciar cardio">
      <div className="space-y-4">
        <Field label="Actividad">{(id) => (
          <Select id={id} value={activity} onChange={(e) => setActivity(e.target.value as CardioActivity)}>
            {CARDIO_ACTIVITIES.map((a) => <option key={a} value={a}>{CARDIO_LABELS[a]}</option>)}
          </Select>
        )}</Field>
        <Switch checked={useGps && secure} onChange={setUseGps} disabled={!secure} label="Medir recorrido con GPS"
          description={!secure ? 'El GPS requiere HTTPS (la app publicada) o localhost.' : GPS_ACTIVITIES.has(activity)
            ? 'El navegador te pedirá permiso de ubicación. Tus mapas son privados salvo que los compartas en Configuración.'
            : 'En máquinas no hay recorrido: solo se mide el tiempo y al final escribes la distancia.'} />
        <p className="text-xs text-muted">Consejo: espera unos segundos a que el GPS marque buena precisión antes de arrancar y mantén la app abierta.</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button size="lg" onClick={() => { tracker.start(me, activity, useGps && secure); onClose() }}><Play className="h-5 w-5" /> Empezar</Button>
        </div>
      </div>
    </Modal>
  )
}

// ======================= Detalle =======================
function useRoute(s: CardioSession) {
  return useQuery({
    queryKey: ['cardioRoute', s.id],
    enabled: s.tracking_mode === 'gps',
    queryFn: async () => (await unwrap<{ points: RoutePoint[] } | null>(supabase.from('cardio_routes').select('points').eq('session_id', s.id).maybeSingle()))?.points ?? null,
  })
}

function SessionDetail({ s, mine, onClose, onEdit }: { s: CardioSession; mine: boolean; onClose: () => void; onEdit: () => void }) {
  const me = useUserId()
  const unit = useUnit()
  const d = distUnit(unit)
  const route = useRoute(s)
  const weight = useLatestWeight()
  const [confirm, setConfirm] = useState(false)
  const del = useMut(async () => unwrap(supabase.from('cardio_sessions').delete().eq('id', s.id)), {
    invalidate: [keys.cardio(me)], success: 'Sesión eliminada', onSuccess: onClose,
  })
  const splits = route.data ? kmSplits(route.data) : []
  const est = mine ? estimateCalories(s, weight) : null

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={CARDIO_LABELS[s.activity]} description={fmtDateTime(s.started_at)} className="sm:max-w-3xl">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Distancia" value={s.distance_km !== null ? `${formatNumber(kmTo(Number(s.distance_km), unit), 2)} ${d}` : '—'} />
          <Stat label="Duración" value={formatClock(s.duration_seconds)} />
          <Stat label={`Ritmo /${d}`} value={fmtPace(paceSecondsPer(s, unit))} />
          <Stat label={`Velocidad ${d}/h`} value={formatNumber(speedPerHour(s, unit), 1)} />
          <Stat label="FC media / máx" value={s.avg_heart_rate ? `${s.avg_heart_rate}${s.max_heart_rate ? ` / ${s.max_heart_rate}` : ''} ppm` : '—'} />
          <Stat label={s.calories ? 'Calorías (registradas)' : 'Calorías (estimación)'} value={s.calories ? String(s.calories) : est ? `≈ ${est}` : '—'} />
          <Stat label="Esfuerzo" value={s.rpe ? `RPE ${s.rpe}` : '—'} />
          <Stat label="Modo" value={s.tracking_mode === 'gps' ? 'GPS' : 'Manual'} />
        </div>
        {!s.calories && est !== null && <p className="text-xs text-muted">Estimación aproximada con MET según actividad y velocidad, y tu último peso registrado. No es una medición.</p>}

        {s.tracking_mode === 'gps' && (route.isLoading ? <LoadingBlock label="Cargando mapa…" /> : route.data ? (
          <Suspense fallback={<LoadingBlock label="Cargando mapa…" />}>
            <RouteMap points={route.data} unitLabel={d} className="h-72 sm:h-96" />
          </Suspense>
        ) : <p className="rounded-xl bg-surface-2 p-3 text-sm text-muted">{mine ? 'Esta sesión no tiene recorrido guardado.' : 'El mapa de este recorrido es privado.'}</p>)}

        {splits.length > 0 && (
          <div>
            <CardTitle>Parciales por {d === 'km' ? 'kilómetro' : 'km'}</CardTitle>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs uppercase text-muted"><th className="py-1 font-medium">Km</th><th className="font-medium">Tiempo</th><th className="font-medium">Ritmo /km</th></tr></thead>
              <tbody className="divide-y divide-border">
                {splits.map((sp) => (
                  <tr key={sp.km}>
                    <td className="py-1.5">{sp.partialMeters ? `${formatNumber(sp.km, 2)} (parcial)` : sp.km}</td>
                    <td>{formatClock(sp.seconds)}</td>
                    <td>{fmtPace(sp.partialMeters ? sp.seconds / (sp.partialMeters / 1000) : sp.seconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {s.notes && <p className="whitespace-pre-line text-sm text-muted">{s.notes}</p>}
        {mine && (
          <div className="flex justify-end gap-2">
            <Button variant="danger" onClick={() => setConfirm(true)}><Trash2 className="h-4 w-4" /> Eliminar</Button>
            <Button variant="outline" onClick={onEdit}><Pencil className="h-4 w-4" /> Editar</Button>
          </div>
        )}
      </div>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} danger title="¿Eliminar sesión de cardio?" description="Se borrarán la sesión y su recorrido de forma permanente."
        confirmLabel="Eliminar" loading={del.isPending} onConfirm={() => del.mutate(undefined)} />
    </Modal>
  )
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-xl bg-surface-2 p-3"><p className="text-xs text-muted">{label}</p><p className="mt-0.5 font-bold">{value}</p></div>
)

// ======================= Comparación =======================
function Comparison({ partnerId }: { partnerId: string }) {
  const unit = useUnit()
  const d = distUnit(unit)
  const { data: mine } = useCardio()
  const { data: theirs } = useCardio(partnerId)
  const { data: myP } = useProfile()
  const { data: broP } = useProfile(partnerId)
  const week = presetRange('week')
  const month = presetRange('month')
  const row = (list: CardioSession[] | undefined, goal: number | null | undefined) => {
    const w = cardioTotals(cardioIn(list ?? [], week))
    const m = cardioIn(list ?? [], month)
    const mt = cardioTotals(m)
    return {
      week: w.km, month: mt.km, time: mt.seconds, sessions: mt.sessions,
      gps: m.filter((s) => s.tracking_mode === 'gps').length, manual: m.filter((s) => s.tracking_mode !== 'gps').length,
      goalPct: goal ? Math.round((w.km / Number(goal)) * 100) : null,
    }
  }
  const a = row(mine, myP?.cardio_weekly_goal_km)
  const b = row(theirs, broP?.cardio_weekly_goal_km)
  const fmtKm = (v: number) => `${formatNumber(kmTo(v, unit), 1)} ${d}`
  const rows: [string, string, string][] = [
    ['Distancia esta semana', fmtKm(a.week), fmtKm(b.week)],
    ['Meta semanal personal', a.goalPct === null ? 'Sin meta' : `${a.goalPct}%`, b.goalPct === null ? 'Sin meta' : `${b.goalPct}%`],
    ['Distancia este mes', fmtKm(a.month), fmtKm(b.month)],
    ['Tiempo este mes', formatDuration(a.time), formatDuration(b.time)],
    ['Sesiones este mes (GPS / manual)', `${a.sessions} (${a.gps} / ${a.manual})`, `${b.sessions} (${b.gps} / ${b.manual})`],
  ]
  return (
    <Card>
      <CardTitle><span className="inline-flex items-center gap-1.5"><Swords className="h-4 w-4" /> Gym Bros: cardio</span></CardTitle>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs uppercase text-muted"><th className="py-2 font-medium">Métrica</th><th className="font-medium">{myP?.full_name?.split(' ')[0] || 'Yo'}</th><th className="font-medium">{broP?.full_name?.split(' ')[0] || 'Gym Bro'}</th></tr></thead>
        <tbody className="divide-y divide-border">{rows.map(([l, x, y]) => <tr key={l}><td className="py-2 text-muted">{l}</td><td className="font-semibold">{x}</td><td className="font-semibold">{y}</td></tr>)}</tbody>
      </table>
      <p className="mt-2 text-xs text-muted">Mismos períodos para ambos (semana y mes en curso). El % de meta compara a cada uno con su propia meta; las sesiones manuales no tienen recorrido verificado por GPS.</p>
    </Card>
  )
}

// ======================= Meta semanal =======================
function GoalModal({ current, unit, onClose }: { current: number | null; unit: WeightUnit; onClose: () => void }) {
  const me = useUserId()
  const [v, setV] = useState(current ? String(Math.round(kmTo(Number(current), unit) * 10) / 10) : '')
  const save = useMut(async () => {
    const n = numOrNull(v)
    const kmv = n === null ? null : Math.round(toKm(n, unit) * 100) / 100
    if (kmv !== null && (kmv < 0.5 || kmv > 1000)) throw new Error('La meta debe estar entre 0.5 y 1000 km')
    return unwrap(supabase.from('profiles').update({ cardio_weekly_goal_km: kmv }).eq('id', me))
  }, { invalidate: [keys.profile(me)], success: 'Meta actualizada', onSuccess: onClose })
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Meta semanal de cardio">
      <Field label={`Distancia por semana (${distUnit(unit)})`} hint="Déjalo vacío para quitar la meta. Tu Gym Bro verá tu % de avance.">
        {(id) => <Input id={id} type="number" inputMode="decimal" step="any" value={v} onChange={(e) => setV(e.target.value)} />}
      </Field>
      <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={() => save.mutate(undefined)} loading={save.isPending}>Guardar</Button></div>
    </Modal>
  )
}

// ======================= Registro / edición manual =======================
function CardioForm({ session, unit, onClose }: { session: CardioSession | null; unit: WeightUnit; onClose: () => void }) {
  const me = useUserId()
  const gps = session?.tracking_mode === 'gps' // en sesiones GPS la distancia y la duración vienen del recorrido
  const [activity, setActivity] = useState<CardioActivity>(session?.activity ?? 'treadmill')
  const [when, setWhen] = useState(format(session ? parseISO(session.started_at) : new Date(), "yyyy-MM-dd'T'HH:mm"))
  const d0 = session?.duration_seconds ?? 1800
  const [h, setH] = useState(String(Math.floor(d0 / 3600)))
  const [m, setM] = useState(String(Math.floor((d0 % 3600) / 60)))
  const [sec, setSec] = useState(String(d0 % 60))
  const [distance, setDistance] = useState(session?.distance_km ? String(Math.round(kmTo(Number(session.distance_km), unit) * 100) / 100) : '')
  const [calories, setCalories] = useState(session?.calories?.toString() ?? '')
  const [avgHr, setAvgHr] = useState(session?.avg_heart_rate?.toString() ?? '')
  const [maxHr, setMaxHr] = useState(session?.max_heart_rate?.toString() ?? '')
  const [rpe, setRpe] = useState(session?.rpe?.toString() ?? '')
  const [incline, setIncline] = useState(session?.incline_pct?.toString() ?? '')
  const [notes, setNotes] = useState(session?.notes ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const weight = useLatestWeight()

  const duration = (numOrNull(h) ?? 0) * 3600 + (numOrNull(m) ?? 0) * 60 + (numOrNull(sec) ?? 0)
  const distKm = (() => { const n = numOrNull(distance); return n && n > 0 ? toKm(n, unit) : null })()
  const preview = { duration_seconds: duration, distance_km: distKm }
  const est = estimateCalories({ activity, ...preview }, weight)

  const save = useMut(async () => {
    const errs: Record<string, string> = {}
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
    const row: Record<string, unknown> = {
      user_id: me, activity, started_at: started.toISOString(),
      calories: cal === null ? null : Math.round(cal), avg_heart_rate: a === null ? null : Math.round(a), max_heart_rate: x === null ? null : Math.round(x),
      rpe: r, incline_pct: supportsIncline(activity) ? inc : null, notes: notes.trim() || null,
    }
    if (!gps) {
      row.duration_seconds = Math.round(duration)
      row.distance_km = dist === null ? null : Math.round(toKm(dist, unit) * 1000) / 1000
      row.ended_at = new Date(started.getTime() + duration * 1000).toISOString()
      row.tracking_mode = 'manual'
    }
    return unwrap(session ? supabase.from('cardio_sessions').update(row).eq('id', session.id) : supabase.from('cardio_sessions').insert(row))
  }, { invalidate: [keys.cardio(me)], success: 'Sesión de cardio guardada', onSuccess: onClose })

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={session ? 'Editar cardio' : 'Registro manual'} description={gps ? 'La distancia y la duración vienen del GPS y no se editan.' : 'Para caminadora, máquinas o sesiones sin GPS.'} className="sm:max-w-xl">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined) }} noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Actividad">{(id) => (
            <Select id={id} value={activity} onChange={(e) => setActivity(e.target.value as CardioActivity)}>
              {CARDIO_ACTIVITIES.map((a) => <option key={a} value={a}>{CARDIO_LABELS[a]}</option>)}
            </Select>
          )}</Field>
          <Field label="Fecha y hora de inicio" error={errors.when}>{(id) => <Input id={id} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />}</Field>
        </div>
        <fieldset disabled={gps}>
          <legend className="mb-1.5 text-sm font-medium text-muted">Duración</legend>
          <div className="grid grid-cols-3 gap-2">
            <Input type="number" inputMode="numeric" min={0} max={24} value={h} onChange={(e) => setH(e.target.value)} aria-label="Horas" />
            <Input type="number" inputMode="numeric" min={0} max={59} value={m} onChange={(e) => setM(e.target.value)} aria-label="Minutos" />
            <Input type="number" inputMode="numeric" min={0} max={59} value={sec} onChange={(e) => setSec(e.target.value)} aria-label="Segundos" />
          </div>
          <p className="mt-1 text-xs text-muted">horas · minutos · segundos</p>
          {errors.duration && <p role="alert" className="text-xs text-danger">{errors.duration}</p>}
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Distancia (${distUnit(unit)})`} error={errors.distance} hint={DISTANCE_ACTIVITIES.has(activity) ? undefined : 'Opcional'}>
            {(id) => <Input id={id} type="number" inputMode="decimal" step="any" value={distance} disabled={gps} onChange={(e) => setDistance(e.target.value)} />}
          </Field>
          <div className="rounded-xl bg-surface-2 p-3 text-sm">
            <p className="text-xs text-muted">Cálculo automático</p>
            <p className="font-semibold">{distKm ? (usesPace(activity) ? `${fmtPace(paceSecondsPer(preview, unit))} /${distUnit(unit)}` : `${formatNumber(speedPerHour(preview, unit), 1)} ${distUnit(unit)}/h`) : '—'}</p>
            <p className="text-xs text-muted">{est ? `≈ ${est} kcal (estimación)` : 'Registra tu peso para estimar calorías'}</p>
          </div>
          <Field label="Calorías de tu reloj o máquina" error={errors.calories} hint="Opcional">
            {(id) => <Input id={id} type="number" inputMode="numeric" value={calories} onChange={(e) => setCalories(e.target.value)} />}
          </Field>
          <Field label="Esfuerzo (RPE 1-10)" error={errors.rpe}>{(id) => <Input id={id} type="number" inputMode="decimal" step={0.5} value={rpe} onChange={(e) => setRpe(e.target.value)} />}</Field>
          <Field label="FC media (ppm)" error={errors.avgHr}>{(id) => <Input id={id} type="number" inputMode="numeric" value={avgHr} onChange={(e) => setAvgHr(e.target.value)} />}</Field>
          <Field label="FC máxima (ppm)" error={errors.maxHr}>{(id) => <Input id={id} type="number" inputMode="numeric" value={maxHr} onChange={(e) => setMaxHr(e.target.value)} />}</Field>
          {supportsIncline(activity) && <Field label="Inclinación (%)" error={errors.incline}>{(id) => <Input id={id} type="number" inputMode="decimal" step={0.5} value={incline} onChange={(e) => setIncline(e.target.value)} />}</Field>}
        </div>
        <Field label="Notas">{(id) => <Textarea id={id} rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" loading={save.isPending}><Flag className="h-4 w-4" /> Guardar</Button></div>
      </form>
    </Modal>
  )
}

