import { format, subWeeks } from 'date-fns'
import { Check, Plus, ShieldAlert, Swords, Trash2, UserPlus, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { BarChartCard, LineChartCard } from '@/components/charts'
import { Avatar } from '@/components/Avatar'
import {
  Badge, Button, Card, CardTitle, ConfirmDialog, EmptyState, Field, Input, LoadingBlock, Modal, PageHeader, ProgressBar, Select, Tabs, Textarea,
} from '@/components/ui'
import {
  keys, unwrap, useChallengeProgress, useChallenges, useCompletedSessions, useGoals, useMut, usePartnership, usePrefs,
  useProfile, useRecords, useRoutines, useUnit, useExercises,
} from '@/data/queries'
import { useUserId } from '@/features/auth/AuthProvider'
import { completedIn, exerciseHistory, groupByPeriod, sessionStats, weeklyStreak } from '@/lib/calc'
import { fmtDate, fmtShort, presetRange, todayKey, weekKey } from '@/lib/dates'
import { CHALLENGE_TYPE_LABELS } from '@/lib/labels'
import { supabase } from '@/lib/supabase'
import type { Challenge, ChallengeType, Profile, WorkoutSession } from '@/lib/types'
import { fmtVolume, fmtWeight } from '@/lib/units'
import { formatNumber } from '@/lib/utils'

export default function GymBroPage() {
  const { data: p, isLoading } = usePartnership()
  const [tab, setTab] = useState<'compare' | 'challenges'>('compare')
  if (isLoading) return <LoadingBlock />
  return (
    <div className="animate-fade-up">
      <PageHeader title="Gym Bro" subtitle="Competencia sana: cada uno se compara también consigo mismo." />
      <PartnerPanel />
      {p?.partnerId && (
        <>
          <Tabs className="my-5" value={tab} onChange={setTab} options={[{ value: 'compare', label: 'Comparación' }, { value: 'challenges', label: 'Retos' }]} />
          {tab === 'compare' ? <Comparison partnerId={p.partnerId} /> : <Challenges partnerId={p.partnerId} />}
        </>
      )}
    </div>
  )
}

function PartnerPanel() {
  const me = useUserId()
  const { data: p } = usePartnership()
  const partner = useProfile(p?.partnerId ?? undefined)
  const [email, setEmail] = useState('')
  const [unlink, setUnlink] = useState(false)
  const inv = [keys.partnership(me)]
  const send = useMut(async () => unwrap(supabase.rpc('send_partner_request', { p_email: email })), { invalidate: inv, success: 'Solicitud enviada', onSuccess: () => setEmail('') })
  const respond = useMut(async ({ id, accept }: { id: string; accept: boolean }) => unwrap(supabase.rpc('respond_partner_request', { p_id: id, p_accept: accept })), { invalidate: inv })
  const remove = useMut(async (id: string) => unwrap(supabase.from('partnerships').delete().eq('id', id)), { invalidate: inv, onSuccess: () => setUnlink(false) })

  if (p?.accepted) {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Avatar path={partner.data?.avatar_path} name={partner.data?.full_name || partner.data?.email || ''} size={48} />
          <div>
            <p className="font-bold">{partner.data?.full_name || partner.data?.email}</p>
            <p className="text-xs text-muted">Vinculados desde {fmtDate(p.accepted.responded_at ?? p.accepted.created_at)}</p>
          </div>
        </div>
        <Button variant="ghost" className="text-danger" onClick={() => setUnlink(true)}>Desvincular</Button>
        <ConfirmDialog open={unlink} onOpenChange={setUnlink} danger title="¿Desvincular Gym Bro?" confirmLabel="Desvincular" loading={remove.isPending}
          description="Dejarán de ver los datos del otro. Los registros de cada uno no se borran." onConfirm={() => remove.mutate(p.accepted!.id)} />
      </Card>
    )
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardTitle>Vincular a tu Gym Bro</CardTitle>
        <p className="mb-3 text-sm text-muted">Tu compañero debe tener una cuenta creada. Al aceptar, cada uno podrá ver lo que el otro autorice en Configuración → Privacidad.</p>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); send.mutate(undefined) }}>
          <Input type="email" placeholder="correo@ejemplo.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Correo del Gym Bro" />
          <Button type="submit" loading={send.isPending} disabled={!email.includes('@')}><UserPlus className="h-4 w-4" /> Invitar</Button>
        </form>
      </Card>
      <Card>
        <CardTitle>Solicitudes</CardTitle>
        {!p?.incoming.length && !p?.outgoing.length && <p className="text-sm text-muted">No hay solicitudes pendientes.</p>}
        {p?.incoming.map((r) => <IncomingRow key={r.id} userId={r.requester_id} onAccept={() => respond.mutate({ id: r.id, accept: true })} onReject={() => respond.mutate({ id: r.id, accept: false })} />)}
        {p?.outgoing.map((r) => (
          <div key={r.id} className="flex items-center justify-between rounded-xl bg-surface-2 p-3 text-sm">
            <span className="text-muted">Solicitud enviada · esperando respuesta</span>
            <Button size="sm" variant="ghost" onClick={() => remove.mutate(r.id)}>Cancelar</Button>
          </div>
        ))}
      </Card>
    </div>
  )
}

function IncomingRow({ userId, onAccept, onReject }: { userId: string; onAccept: () => void; onReject: () => void }) {
  // El perfil del solicitante no es visible hasta aceptar (RLS); se muestra un texto genérico.
  void userId
  return (
    <div className="mb-2 flex items-center justify-between gap-2 rounded-xl bg-surface-2 p-3 text-sm">
      <span>Tienes una solicitud de Gym Bro (ver detalle en Notificaciones)</span>
      <span className="flex gap-1">
        <Button size="sm" onClick={onAccept}><Check className="h-4 w-4" /> Aceptar</Button>
        <Button size="sm" variant="ghost" onClick={onReject}><X className="h-4 w-4" /></Button>
      </span>
    </div>
  )
}

function useUserSummary(userId: string, sessions: WorkoutSession[] | undefined) {
  const { data: goals } = useGoals(userId)
  const { data: records } = useRecords(userId)
  const month = presetRange('month')
  const list = sessions ?? []
  const monthSessions = completedIn(list, month)
  const weekly = groupByPeriod(list, 'week')
  return {
    monthSessions: monthSessions.length,
    monthVolume: monthSessions.reduce((a, s) => a + sessionStats(s).volume, 0),
    weekly,
    goalsDone: (goals ?? []).filter((g) => g.status === 'completed').length,
    goalsTotal: (goals ?? []).filter((g) => !g.archived).length,
    prsMonth: (records ?? []).filter((r) => r.previous_value !== null && r.achieved_at >= month.from.toISOString()).length,
  }
}

function Comparison({ partnerId }: { partnerId: string }) {
  const unit = useUnit()
  const me = useUserId()
  const { data: myProfile } = useProfile()
  const { data: bro } = useProfile(partnerId)
  const { data: myPrefs } = usePrefs()
  const mine = useCompletedSessions()
  const theirs = useCompletedSessions(partnerId)
  const my = useUserSummary(me, mine.data)
  const their = useUserSummary(partnerId, theirs.data)
  const myName = myProfile?.full_name?.split(' ')[0] || 'Tú'
  const broName = bro?.full_name?.split(' ')[0] || 'Gym Bro'

  const common = useMemo(() => {
    const a = new Map<string, string>()
    for (const s of mine.data ?? []) for (const we of s.workout_exercises ?? []) a.set(we.exercise_id, we.exercise?.name ?? '')
    const b = new Set((theirs.data ?? []).flatMap((s) => (s.workout_exercises ?? []).map((we) => we.exercise_id)))
    return [...a.entries()].filter(([id]) => b.has(id))
  }, [mine.data, theirs.data])
  const [exerciseId, setExerciseId] = useState('')
  const exId = exerciseId || common[0]?.[0] || ''

  if (mine.isLoading || theirs.isLoading) return <LoadingBlock />
  const shared = theirs.data !== undefined

  const weeks = Array.from({ length: 8 }, (_, i) => weekKey(subWeeks(new Date(), 7 - i)))
  const weeklyData = weeks.map((w) => ({ week: fmtShort(w), [myName]: my.weekly.get(w)?.sessions ?? 0, [broName]: their.weekly.get(w)?.sessions ?? 0 }))

  const hA = exerciseHistory(mine.data ?? [], exId)
  const hB = exerciseHistory(theirs.data ?? [], exId)
  const baseA = hA.find((p) => p.bestE1rm)?.bestE1rm, baseB = hB.find((p) => p.bestE1rm)?.bestE1rm
  const byDate = new Map<string, Record<string, unknown>>()
  for (const p of hA) if (baseA && p.bestE1rm) byDate.set(p.date, { ...byDate.get(p.date), date: p.date, [myName]: Math.round(((p.bestE1rm - baseA) / baseA) * 1000) / 10 })
  for (const p of hB) if (baseB && p.bestE1rm) byDate.set(p.date, { ...byDate.get(p.date), date: p.date, [broName]: Math.round(((p.bestE1rm - baseB) / baseB) * 1000) / 10 })
  const strength = [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date))).map((r) => ({ ...r, date: fmtShort(String(r.date)) }))
  const lastA = hA.at(-1), lastB = hB.at(-1)

  const rows = [
    { label: 'Entrenamientos este mes', a: my.monthSessions, b: their.monthSessions, fmt: (v: number) => formatNumber(v) },
    { label: 'Volumen este mes', a: my.monthVolume, b: their.monthVolume, fmt: (v: number) => fmtVolume(v, unit) },
    { label: 'Racha semanal', a: weeklyStreak((mine.data ?? []).map((s) => s.started_at), myPrefs?.weekly_workout_target ?? 4), b: weeklyStreak((theirs.data ?? []).map((s) => s.started_at), 4), fmt: (v: number) => `${v} sem.` },
    { label: 'Récords superados este mes', a: my.prsMonth, b: their.prsMonth, fmt: (v: number) => formatNumber(v) },
    { label: 'Objetivos completados', a: my.goalsDone, b: their.goalsDone, fmt: (v: number) => formatNumber(v) },
  ]

  return (
    <div className="space-y-4">
      {!shared && <Card className="text-sm text-muted">Tu Gym Bro no comparte sus entrenamientos.</Card>}
      <Card>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs uppercase text-muted"><th className="py-2 font-medium">Métrica</th><th className="font-medium">{myName}</th><th className="font-medium">{broName}</th></tr></thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => <tr key={r.label}><td className="py-2.5 text-muted">{r.label}</td><td className="font-semibold">{r.fmt(r.a)}</td><td className="font-semibold">{r.fmt(r.b)}</td></tr>)}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-muted">La racha del Gym Bro se calcula con un objetivo de 4 sesiones/semana porque su objetivo personal es privado.</p>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardTitle>Entrenamientos por semana</CardTitle>
          <BarChartCard data={weeklyData} xKey="week" series={[{ key: myName, label: myName }, { key: broName, label: broName }]} />
        </Card>
        <Card>
          <CardTitle action={common.length > 0 && (
            <Select value={exId} onChange={(e) => setExerciseId(e.target.value)} className="h-8 w-48 text-sm" aria-label="Ejercicio en común">
              {common.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </Select>)}>Progreso de fuerza (% individual)</CardTitle>
          <LineChartCard data={strength} xKey="date" series={[{ key: myName, label: myName }, { key: broName, label: broName }]}
            yFormatter={(v) => `${v}%`} empty={common.length ? 'Sin datos suficientes' : 'No tienen ejercicios en común todavía'} />
          {exId && (
            <p className="mt-2 text-xs text-muted">
              Cambio del 1RM estimado respecto a la primera sesión de cada uno (comparación justa).
              Valores absolutos actuales: {myName} {fmtWeight(lastA?.bestE1rm, unit)} · {broName} {fmtWeight(lastB?.bestE1rm, unit)}.
            </p>
          )}
        </Card>
      </div>
    </div>
  )
}

// ---------------- Retos ----------------
function Challenges({ partnerId }: { partnerId: string }) {
  const { data, isLoading } = useChallenges()
  const [creating, setCreating] = useState(false)
  if (isLoading) return <LoadingBlock />
  const active = (data ?? []).filter((c) => c.status === 'active' && c.end_date >= todayKey())
  const past = (data ?? []).filter((c) => !(c.status === 'active' && c.end_date >= todayKey()))
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-xs text-muted"><ShieldAlert className="h-4 w-4" /> Los retos no incluyen intentos máximos ni más de 6 sesiones por semana. La mejora de fuerza se mide con el 1RM estimado.</p>
        <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Nuevo reto</Button>
      </div>
      {!data?.length && <EmptyState icon={<Swords className="h-8 w-8" />} title="Sin retos" description="Crea un reto para motivarse mutuamente." />}
      {active.length > 0 && <div className="grid gap-4 lg:grid-cols-2">{active.map((c) => <ChallengeCard key={c.id} c={c} partnerId={partnerId} />)}</div>}
      {past.length > 0 && <><h2 className="pt-2 text-sm font-semibold uppercase text-muted">Finalizados</h2><div className="grid gap-4 lg:grid-cols-2">{past.map((c) => <ChallengeCard key={c.id} c={c} partnerId={partnerId} />)}</div></>}
      {creating && <ChallengeForm partnerId={partnerId} onClose={() => setCreating(false)} />}
    </div>
  )
}

const OUTCOME: Record<string, { label: string; tone: 'accent' | 'danger' | 'info' | 'default' }> = {
  completed: { label: 'Cumplido', tone: 'accent' }, failed: { label: 'No cumplido', tone: 'danger' }, active: { label: 'En curso', tone: 'info' }, cancelled: { label: 'Cancelado', tone: 'default' },
}

function ChallengeCard({ c, partnerId }: { c: Challenge; partnerId: string }) {
  const me = useUserId()
  const unit = useUnit()
  const { data: progress } = useChallengeProgress(c.id)
  const { data: myP } = useProfile()
  const { data: broP } = useProfile(partnerId)
  const [confirm, setConfirm] = useState(false)
  const names: Record<string, Profile | undefined> = { [me]: myP, [partnerId]: broP }
  const owner = c.challenge_participants?.find((p) => p.is_owner)?.user_id ?? c.created_by
  const cancel = useMut(async () => unwrap(supabase.from('challenges').update({ status: 'cancelled' }).eq('id', c.id)), { invalidate: [keys.challenges] })
  const del = useMut(async () => unwrap(supabase.from('challenges').delete().eq('id', c.id)), { invalidate: [keys.challenges], onSuccess: () => setConfirm(false) })
  const unitLabel = c.challenge_type === 'exercise_improvement' ? '%' : c.challenge_type === 'weekly_workouts' ? 'semanas' : 'sesiones'
  void unit

  return (
    <Card>
      <div className="mb-1 flex items-start justify-between gap-2">
        <p className="font-bold">{c.title}</p>
        {c.status === 'cancelled' && <Badge>Cancelado</Badge>}
      </div>
      <p className="text-xs text-muted">{CHALLENGE_TYPE_LABELS[c.challenge_type]}{c.exercise ? ` · ${c.exercise.name}` : ''}{c.routine ? ` · ${c.routine.name}` : ''}</p>
      <p className="text-xs text-muted">{fmtDate(c.start_date)} → {fmtDate(c.end_date)} · Responsable: {names[owner]?.full_name || 'Gym Bro'}</p>
      <p className="mt-1 text-xs text-muted">Criterio: {criterion(c)}</p>
      {c.description && <p className="mt-2 text-sm">{c.description}</p>}
      <div className="mt-3 space-y-3">
        {(progress ?? []).map((p) => (
          <div key={p.user_id}>
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="font-medium">{names[p.user_id]?.full_name?.split(' ')[0] || 'Participante'}</span>
              <span className="flex items-center gap-2">
                <span className="tabular text-muted">{formatNumber(p.progress, 1)} / {formatNumber(p.goal, 1)} {unitLabel}</span>
                <Badge tone={OUTCOME[p.outcome].tone}>{OUTCOME[p.outcome].label}</Badge>
              </span>
            </div>
            <ProgressBar value={p.goal > 0 ? (p.progress / p.goal) * 100 : 0} />
          </div>
        ))}
      </div>
      {c.created_by === me && (
        <div className="mt-3 flex justify-end gap-1">
          {c.status === 'active' && <Button size="sm" variant="ghost" onClick={() => cancel.mutate(undefined)}>Cancelar reto</Button>}
          <Button size="sm" variant="ghost" className="text-danger" onClick={() => setConfirm(true)}><Trash2 className="h-4 w-4" /></Button>
        </div>
      )}
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} danger title="¿Eliminar reto?" description="Se borrará el reto para ambos participantes." confirmLabel="Eliminar" onConfirm={() => del.mutate(undefined)} />
    </Card>
  )
}

function criterion(c: Challenge) {
  switch (c.challenge_type) {
    case 'weekly_workouts': return `al menos ${c.target_value} entrenamientos en cada semana del período`
    case 'monthly_attendance': return `${c.target_value} entrenamientos completados en el período`
    case 'routine_consistency': return `${c.target_value} sesiones con la rutina indicada en el período`
    case 'exercise_improvement': return `mejorar ${c.target_value}% el 1RM estimado frente a la mejor marca previa`
  }
}

const LIMITS: Record<ChallengeType, { min: number; max: number; def: number; label: string }> = {
  weekly_workouts: { min: 1, max: 6, def: 4, label: 'Entrenamientos por semana (máx. 6)' },
  monthly_attendance: { min: 1, max: 26, def: 12, label: 'Entrenamientos en el período' },
  routine_consistency: { min: 1, max: 90, def: 12, label: 'Sesiones con la rutina' },
  exercise_improvement: { min: 1, max: 15, def: 5, label: 'Mejora del 1RM estimado (%; máx. 15)' },
}

function ChallengeForm({ partnerId, onClose }: { partnerId: string; onClose: () => void }) {
  const me = useUserId()
  const { data: exercises } = useExercises()
  const { data: routines } = useRoutines()
  const [type, setType] = useState<ChallengeType>('weekly_workouts')
  const [title, setTitle] = useState('Completar 4 entrenamientos semanales')
  const [description, setDescription] = useState('')
  const [target, setTarget] = useState(LIMITS.weekly_workouts.def)
  const [start, setStart] = useState(todayKey())
  const [end, setEnd] = useState(format(new Date(Date.now() + 29 * 86400000), 'yyyy-MM-dd'))
  const [exerciseId, setExerciseId] = useState('')
  const [routineId, setRoutineId] = useState('')
  const [responsible, setResponsible] = useState(me)
  const [both, setBoth] = useState(true)
  const lim = LIMITS[type]
  const valid = title.trim() && target >= lim.min && target <= lim.max && end >= start
    && (type !== 'exercise_improvement' || exerciseId) && (type !== 'routine_consistency' || routineId)

  const save = useMut(async () => {
    const c = await unwrap<{ id: string }>(supabase.from('challenges').insert({
      created_by: me, title: title.trim(), description: description.trim() || null, challenge_type: type, target_value: target,
      start_date: start, end_date: end, exercise_id: type === 'exercise_improvement' ? exerciseId : null, routine_id: type === 'routine_consistency' ? routineId : null,
    }).select('id').single())
    const parts = [{ challenge_id: c.id, user_id: me, is_owner: responsible === me }]
    if (both) parts.push({ challenge_id: c.id, user_id: partnerId, is_owner: responsible === partnerId })
    await unwrap(supabase.from('challenge_participants').insert(parts))
  }, { invalidate: [keys.challenges], success: 'Reto creado', onSuccess: onClose })

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Nuevo reto">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (valid) save.mutate(undefined) }}>
        <Field label="Tipo">{(id) => (
          <Select id={id} value={type} onChange={(e) => { const t = e.target.value as ChallengeType; setType(t); setTarget(LIMITS[t].def) }}>
            {Object.entries(CHALLENGE_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        )}</Field>
        <Field label="Título">{(id) => <Input id={id} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />}</Field>
        {type === 'exercise_improvement' && <Field label="Ejercicio">{(id) => (
          <Select id={id} value={exerciseId} onChange={(e) => setExerciseId(e.target.value)}><option value="">Selecciona…</option>{exercises?.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</Select>
        )}</Field>}
        {type === 'routine_consistency' && <Field label="Rutina">{(id) => (
          <Select id={id} value={routineId} onChange={(e) => setRoutineId(e.target.value)}><option value="">Selecciona…</option>{routines?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>
        )}</Field>}
        <Field label={lim.label} error={target > lim.max || target < lim.min ? `Entre ${lim.min} y ${lim.max}` : undefined}>
          {(id) => <Input id={id} type="number" min={lim.min} max={lim.max} value={target} onChange={(e) => setTarget(Number(e.target.value))} />}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Inicio">{(id) => <Input id={id} type="date" value={start} onChange={(e) => setStart(e.target.value)} />}</Field>
          <Field label="Fin" error={end < start ? 'Debe ser posterior al inicio' : undefined}>{(id) => <Input id={id} type="date" value={end} onChange={(e) => setEnd(e.target.value)} />}</Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Responsable">{(id) => (
            <Select id={id} value={responsible} onChange={(e) => setResponsible(e.target.value)}><option value={me}>Yo</option><option value={partnerId}>Mi Gym Bro</option></Select>
          )}</Field>
          <label className="flex items-end gap-2 pb-3 text-sm"><input type="checkbox" checked={both} onChange={(e) => setBoth(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" /> Participamos ambos</label>
        </div>
        <Field label="Descripción (opcional)">{(id) => <Textarea id={id} rows={2} value={description} maxLength={1000} onChange={(e) => setDescription(e.target.value)} />}</Field>
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={!valid} loading={save.isPending}>Crear reto</Button></div>
      </form>
    </Modal>
  )
}
