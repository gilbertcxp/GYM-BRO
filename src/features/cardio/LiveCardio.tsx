import { AlertTriangle, Flag, LocateFixed, Pause, Play, Satellite, Trash2 } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button, Card, ConfirmDialog, Field, Input, LoadingBlock, Select, Textarea } from '@/components/ui'
import { keys, unwrap, useMeasurements, useMut, useProfile, useUnit } from '@/data/queries'
import { useUserId } from '@/features/auth/AuthProvider'
import {
  CARDIO_ACTIVITIES, CARDIO_LABELS, distUnit, estimateCalories, fmtPace, kmTo, toKm, usesPace, type CardioActivity,
} from '@/lib/cardio'
import { haversineMeters } from '@/lib/geo'
import { supabase } from '@/lib/supabase'
import { cn, formatClock, formatNumber, numOrNull, uuid } from '@/lib/utils'
import { elapsedMs, tracker, type TrackerState } from './tracker'

const RouteMap = lazy(() => import('./RouteMap').then((m) => ({ default: m.RouteMap })))

/** Ritmo/velocidad de los últimos ~45 s (más representativo que el promedio total). */
function recentSpeedMs(s: TrackerState) {
  const pts = s.points.filter((p) => p[3] === s.segment)
  if (pts.length < 2) return null
  const last = pts[pts.length - 1]
  const from = pts.find((p) => last[2] - p[2] <= 45) ?? pts[0]
  if (last[2] - from[2] < 10) return null
  let d = 0
  for (let i = pts.indexOf(from) + 1; i <= pts.indexOf(last); i++) d += haversineMeters({ lat: pts[i - 1][0], lng: pts[i - 1][1] }, { lat: pts[i][0], lng: pts[i][1] })
  return d / (last[2] - from[2])
}

function GpsBadge({ s, now }: { s: TrackerState; now: number }) {
  if (!s.useGps) return <Badge>Sin GPS (manual)</Badge>
  if (s.status !== 'running') return <Badge>GPS en pausa</Badge>
  if (s.gps === 'denied') return <Badge tone="danger">Ubicación denegada</Badge>
  if (s.gps === 'unsupported') return <Badge tone="danger">GPS no disponible</Badge>
  if (s.gps === 'unavailable') return <Badge tone="warning">Sin señal GPS</Badge>
  if (s.gps === 'waiting' || !s.lastFixAt) return <Badge tone="warning"><Satellite className="h-3 w-3" /> Buscando señal…</Badge>
  if (now - s.lastFixAt > 20_000) return <Badge tone="warning"><Satellite className="h-3 w-3" /> Señal débil</Badge>
  return <Badge tone="accent"><Satellite className="h-3 w-3" /> GPS ±{s.accuracy} m</Badge>
}

/** Pantalla de la sesión en curso: prioriza distancia, cronómetro y botones grandes. */
export function LiveCardio({ s }: { s: TrackerState }) {
  const unit = useUnit()
  const [now, setNow] = useState(Date.now())
  const [confirmFinish, setConfirmFinish] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(i)
  }, [])

  if (s.status === 'finished') return <FinishSummary s={s} />

  const secs = elapsedMs(s, now) / 1000
  const km = s.distanceM / 1000
  const avgPace = km > 0.05 ? secs / kmTo(km, unit) : null
  const recent = recentSpeedMs(s)
  const pace = usesPace(s.activity)

  return (
    <div className="animate-fade-up space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-bold">{CARDIO_LABELS[s.activity]} <span className="text-sm font-normal text-muted">{s.status === 'paused' ? '· En pausa' : '· En curso'}</span></p>
        <GpsBadge s={s} now={now} />
      </div>

      {s.useGps && s.gps === 'denied' && (
        <Card className="border-danger/40 text-sm">
          <p className="flex items-center gap-2 font-semibold text-danger"><AlertTriangle className="h-4 w-4" /> No hay permiso de ubicación</p>
          <p className="mt-1 text-muted">Permite la ubicación para este sitio en los ajustes del navegador (icono del candado junto a la dirección) y pulsa Reintentar. El cronómetro sigue funcionando; si no activas el GPS, podrás escribir la distancia al terminar.</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={tracker.retryGps}><LocateFixed className="h-4 w-4" /> Reintentar GPS</Button>
        </Card>
      )}
      {s.useGps && s.gps === 'unsupported' && (
        <Card className="border-danger/40 text-sm text-muted">Este navegador no permite la ubicación aquí. El GPS requiere HTTPS (la app publicada) o localhost. Podrás escribir la distancia al terminar.</Card>
      )}

      <Card className="text-center">
        <p className="text-xs uppercase tracking-wide text-muted">Distancia</p>
        <p className="font-mono text-6xl font-extrabold tabular text-accent sm:text-7xl">{formatNumber(kmTo(km, unit), 2)}<span className="ml-1 text-2xl text-muted">{distUnit(unit)}</span></p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <div><p className="text-[11px] uppercase text-muted">Tiempo</p><p className="font-mono text-2xl font-bold tabular" role="timer">{formatClock(secs)}</p></div>
          <div><p className="text-[11px] uppercase text-muted">{pace ? `Ritmo medio /${distUnit(unit)}` : `Vel. media ${distUnit(unit)}/h`}</p>
            <p className="font-mono text-2xl font-bold tabular">{pace ? fmtPace(avgPace) : (secs > 0 && km > 0 ? formatNumber(kmTo(km, unit) / (secs / 3600), 1) : '—')}</p></div>
          <div><p className="text-[11px] uppercase text-muted">{pace ? 'Ritmo actual' : 'Vel. actual'}</p>
            <p className="font-mono text-2xl font-bold tabular">{recent ? (pace ? fmtPace(1000 / recent * (unit === 'kg' ? 1 : 1.609344)) : formatNumber(recent * 3.6 / (unit === 'kg' ? 1 : 1.609344), 1)) : '—'}</p></div>
        </div>
      </Card>

      {s.useGps && (
        <Suspense fallback={<LoadingBlock label="Cargando mapa…" />}>
          <RouteMap points={s.points} live unitLabel={distUnit(unit)} className="h-64 sm:h-80" />
        </Suspense>
      )}

      <div className="grid grid-cols-2 gap-3">
        {s.status === 'running'
          ? <Button size="xl" variant="secondary" onClick={tracker.pause}><Pause className="h-6 w-6" /> PAUSAR</Button>
          : <Button size="xl" onClick={tracker.resume}><Play className="h-6 w-6" /> REANUDAR</Button>}
        <Button size="xl" className="bg-danger text-white hover:brightness-110" onClick={() => setConfirmFinish(true)}><Flag className="h-6 w-6" /> FINALIZAR</Button>
      </div>
      <div className="flex justify-center">
        <Button variant="ghost" size="sm" className="text-muted" onClick={() => setConfirmDiscard(true)}><Trash2 className="h-4 w-4" /> Descartar sesión</Button>
      </div>
      {s.useGps && (
        <p className="text-center text-xs text-muted">
          Mantén la app abierta y la pantalla encendida: los navegadores móviles pausan el GPS cuando la app queda en segundo plano o con la pantalla bloqueada.
          Si eso pasa, al volver se reanuda y el tramo perdido se une en línea recta solo si es plausible.
        </p>
      )}

      <ConfirmDialog open={confirmFinish} onOpenChange={setConfirmFinish} title="¿Finalizar el cardio?" description="Se detendrá el cronómetro y el GPS. Podrás revisar el resumen antes de guardar."
        confirmLabel="Finalizar" onConfirm={() => { tracker.finish(); setConfirmFinish(false) }} />
      <ConfirmDialog open={confirmDiscard} onOpenChange={setConfirmDiscard} danger title="¿Descartar la sesión?" description="Se perderán el tiempo y el recorrido registrados."
        confirmLabel="Descartar" onConfirm={() => { tracker.discard(); setConfirmDiscard(false) }} />
    </div>
  )
}

function FinishSummary({ s }: { s: TrackerState }) {
  const me = useUserId()
  const unit = useUnit()
  const sessionId = useRef(uuid()) // id fijo: reintentar el guardado no duplica la sesión
  const hasRoute = s.points.length >= 2 && s.distanceM > 0
  const durationS = Math.max(0, Math.round(s.activeMs / 1000))
  const [activity, setActivity] = useState<CardioActivity>(s.activity)
  const [manualDistance, setManualDistance] = useState('')
  const [avgHr, setAvgHr] = useState('')
  const [maxHr, setMaxHr] = useState('')
  const [calories, setCalories] = useState('')
  const [rpe, setRpe] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const distanceKm = hasRoute ? s.distanceM / 1000 : (() => { const n = numOrNull(manualDistance); return n && n > 0 ? toKm(n, unit) : null })()
  const weight = useLatestWeight()
  const est = useMemo(() => estimateCalories({ activity, duration_seconds: durationS, distance_km: distanceKm }, weight), [activity, durationS, distanceKm, weight])

  const save = useMut(async () => {
    setError(null)
    if (durationS < 60) throw new Error('La sesión debe durar al menos 1 minuto para guardarse.')
    const n = (v: string) => { const x = numOrNull(v); return x === null ? null : Math.round(x) }
    const a = n(avgHr), x = n(maxHr)
    if (a !== null && x !== null && x < a) throw new Error('La FC máxima debe ser mayor o igual a la media.')
    await unwrap(supabase.from('cardio_sessions').upsert({
      id: sessionId.current, user_id: me, activity, started_at: s.startedAt, ended_at: s.endedAt, duration_seconds: durationS,
      distance_km: distanceKm === null ? null : Math.round(distanceKm * 1000) / 1000, tracking_mode: hasRoute ? 'gps' : 'manual',
      avg_heart_rate: a, max_heart_rate: x, calories: n(calories), rpe: numOrNull(rpe), notes: notes.trim() || null,
    }))
    if (hasRoute) await unwrap(supabase.from('cardio_routes').upsert({ session_id: sessionId.current, user_id: me, points: s.points }))
    tracker.discard()
  }, { invalidate: [keys.cardio(me), ['cardioRoute']], success: 'Cardio guardado' })

  return (
    <div className="animate-fade-up space-y-3">
      <Card>
        <p className="mb-3 text-lg font-bold">Resumen</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div><p className="text-xs text-muted">Distancia</p><p className="text-2xl font-extrabold text-accent">{distanceKm === null ? '—' : `${formatNumber(kmTo(distanceKm, unit), 2)} ${distUnit(unit)}`}</p></div>
          <div><p className="text-xs text-muted">Tiempo activo</p><p className="text-2xl font-extrabold">{formatClock(durationS)}</p></div>
          <div><p className="text-xs text-muted">{usesPace(activity) ? `Ritmo /${distUnit(unit)}` : `Velocidad ${distUnit(unit)}/h`}</p>
            <p className="text-2xl font-extrabold">{distanceKm ? (usesPace(activity) ? fmtPace(durationS / kmTo(distanceKm, unit)) : formatNumber(kmTo(distanceKm, unit) / (durationS / 3600), 1)) : '—'}</p></div>
          <div><p className="text-xs text-muted">Calorías (estimación)</p><p className="text-2xl font-extrabold">{est ?? '—'}</p>
            {!weight && <p className="text-[11px] text-muted">Registra tu peso para estimar</p>}</div>
        </div>
        <p className="mt-2 text-xs text-muted">Iniciado {new Date(s.startedAt).toLocaleString('es-DO')} · {hasRoute ? `Recorrido GPS con ${s.points.length} puntos (${s.rejected} lecturas descartadas por precisión o saltos)` : 'Sin recorrido GPS'}</p>
      </Card>

      {hasRoute && (
        <Suspense fallback={<LoadingBlock label="Cargando mapa…" />}>
          <RouteMap points={s.points} unitLabel={distUnit(unit)} className="h-64 sm:h-80" />
        </Suspense>
      )}

      <Card>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined, { onError: (er) => setError((er as Error).message) }) }}>
          <Field label="Actividad">{(id) => (
            <Select id={id} value={activity} onChange={(e) => setActivity(e.target.value as CardioActivity)}>
              {CARDIO_ACTIVITIES.map((a) => <option key={a} value={a}>{CARDIO_LABELS[a]}</option>)}
            </Select>
          )}</Field>
          {!hasRoute && <Field label={`Distancia (${distUnit(unit)})`} hint="Sin GPS: escríbela si la conoces (p. ej. de la máquina)">{(id) => (
            <Input id={id} type="number" inputMode="decimal" step="any" value={manualDistance} onChange={(e) => setManualDistance(e.target.value)} />
          )}</Field>}
          <Field label="FC media (ppm)">{(id) => <Input id={id} type="number" inputMode="numeric" value={avgHr} onChange={(e) => setAvgHr(e.target.value)} />}</Field>
          <Field label="FC máxima (ppm)">{(id) => <Input id={id} type="number" inputMode="numeric" value={maxHr} onChange={(e) => setMaxHr(e.target.value)} />}</Field>
          <Field label="Calorías de tu reloj (opcional)" hint="Si las dejas vacías se muestra la estimación">{(id) => <Input id={id} type="number" inputMode="numeric" value={calories} onChange={(e) => setCalories(e.target.value)} />}</Field>
          <Field label="Esfuerzo (RPE 1-10)">{(id) => <Input id={id} type="number" inputMode="decimal" step={0.5} value={rpe} onChange={(e) => setRpe(e.target.value)} />}</Field>
          <Field label="Notas" className="sm:col-span-2">{(id) => <Textarea id={id} rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
          {error && <p role="alert" className="text-sm text-danger sm:col-span-2">{error}</p>}
          <div className={cn('flex flex-wrap justify-end gap-2 sm:col-span-2')}>
            <Button variant="ghost" className="text-danger" onClick={tracker.discard}>Descartar</Button>
            <Button type="submit" size="lg" loading={save.isPending}>Guardar cardio</Button>
          </div>
        </form>
      </Card>
    </div>
  )
}

/** Último peso registrado (kg) para estimar calorías. */
export function useLatestWeight() {
  const { data: measurements } = useMeasurements()
  const { data: profile } = useProfile()
  return measurements?.find((m) => m.weight_kg !== null)?.weight_kg ?? profile?.initial_weight_kg ?? null
}
