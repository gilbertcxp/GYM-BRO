import { Archive, ArchiveRestore, Pencil, Plus, Target, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, LoadingBlock, Modal, PageHeader, ProgressBar, Select, Tabs, Textarea,
} from '@/components/ui'
import { keys, unwrap, useCompletedSessions, useExercises, useGoals, useMeasurements, useMut, useProfile, useUnit } from '@/data/queries'
import { useUserId } from '@/features/auth/AuthProvider'
import { completedIn, exerciseHistory, goalProgress, volumeOf } from '@/lib/calc'
import { fmtDate, presetRange } from '@/lib/dates'
import { GOAL_STATUS_LABELS, GOAL_TYPE_LABELS, MEASUREMENT_FIELDS } from '@/lib/labels'
import { supabase } from '@/lib/supabase'
import type { Goal, GoalStatus, GoalType, WeightUnit } from '@/lib/types'
import { kgTo, toKg } from '@/lib/units'
import { formatNumber, numOrNull } from '@/lib/utils'

const BODY_FIELDS = MEASUREMENT_FIELDS.filter((f) => !['weight_kg', 'height_cm'].includes(f.key))
const isWeightLike = (t: GoalType) => t === 'body_weight' || t === 'strength' || t === 'volume'

function goalUnit(g: Pick<Goal, 'goal_type' | 'measurement_field'>, unit: WeightUnit) {
  if (isWeightLike(g.goal_type)) return unit
  if (g.goal_type === 'attendance') return 'sesiones/sem'
  return MEASUREMENT_FIELDS.find((f) => f.key === g.measurement_field)?.unit ?? ''
}

/** Valor actual de un objetivo, calculado a partir de registros reales (en kg/cm/sesiones). */
function useCurrentValues() {
  const { data: sessions } = useCompletedSessions()
  const { data: measurements } = useMeasurements()
  const { data: profile } = useProfile()
  return useMemo(() => (g: Goal): number | null => {
    switch (g.goal_type) {
      case 'body_weight': return measurements?.find((m) => m.weight_kg !== null)?.weight_kg ?? profile?.initial_weight_kg ?? null
      case 'measurement': {
        const m = measurements?.find((x) => x[g.measurement_field as keyof typeof x] !== null)
        return m ? Number(m[g.measurement_field as keyof typeof m]) : null
      }
      case 'strength': {
        const h = exerciseHistory(sessions ?? [], g.exercise_id!)
        return h.length ? Math.max(...h.map((p) => p.maxWeight)) : null
      }
      case 'attendance': return completedIn(sessions ?? [], presetRange('week')).length
      case 'volume': return completedIn(sessions ?? [], presetRange('week'))
        .reduce((a, s) => a + volumeOf((s.workout_exercises ?? []).flatMap((e) => e.workout_sets ?? [])), 0)
    }
  }, [sessions, measurements, profile])
}

export default function GoalsPage() {
  const me = useUserId()
  const unit = useUnit()
  const { data: goals, isLoading } = useGoals()
  const current = useCurrentValues()
  const [tab, setTab] = useState<'open' | 'completed' | 'archived'>('open')
  const [editing, setEditing] = useState<Goal | 'new' | null>(null)
  const [toDelete, setToDelete] = useState<Goal | null>(null)
  const inv = [keys.goals(me)]
  const patch = useMut(async ({ id, p }: { id: string; p: Partial<Goal> }) => unwrap(supabase.from('goals').update(p).eq('id', id)), { invalidate: inv })
  const del = useMut(async (g: Goal) => unwrap(supabase.from('goals').delete().eq('id', g.id)), { invalidate: inv, success: 'Objetivo eliminado', onSuccess: () => setToDelete(null) })

  // Marca como completados los objetivos que ya alcanzaron la meta (genera la notificación en el servidor).
  useEffect(() => {
    for (const g of goals ?? []) {
      if (g.archived || g.status === 'completed' || g.status === 'paused') continue
      const pct = goalProgress(g.start_value, current(g), g.target_value)
      const reachedAttendance = (g.goal_type === 'attendance' || g.goal_type === 'volume') && (current(g) ?? 0) >= g.target_value
      if (pct === 100 || reachedAttendance) patch.mutate({ id: g.id, p: { status: 'completed' } })
      else if (g.status === 'pending' && pct !== null && pct > 0) patch.mutate({ id: g.id, p: { status: 'in_progress' } })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goals, current])

  if (isLoading) return <LoadingBlock />
  const list = (goals ?? []).filter((g) => tab === 'archived' ? g.archived : !g.archived && (tab === 'completed' ? g.status === 'completed' : g.status !== 'completed'))
  const show = (g: Goal, v: number | null) => v === null ? '—' : `${formatNumber(isWeightLike(g.goal_type) ? kgTo(v, unit) : v, 1)} ${goalUnit(g, unit)}`

  return (
    <div className="animate-fade-up">
      <PageHeader title="Objetivos" subtitle="El valor actual se calcula a partir de tus registros." actions={<Button onClick={() => setEditing('new')}><Plus className="h-4 w-4" /> Nuevo objetivo</Button>} />
      <Tabs className="mb-4" value={tab} onChange={setTab} options={[{ value: 'open', label: 'Activos' }, { value: 'completed', label: 'Completados' }, { value: 'archived', label: 'Archivados' }]} />
      {!list.length ? <EmptyState icon={<Target className="h-8 w-8" />} title="Sin objetivos aquí" description="Define metas de peso, fuerza, asistencia, volumen o medidas." /> : (
        <div className="grid gap-4 md:grid-cols-2">
          {list.map((g) => {
            const cur = current(g)
            const periodic = g.goal_type === 'attendance' || g.goal_type === 'volume'
            const pct = periodic ? (cur === null ? null : Math.min(100, Math.round((cur / g.target_value) * 100))) : goalProgress(g.start_value, cur, g.target_value)
            return (
              <Card key={g.id}>
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div>
                    <p className="font-bold">{g.title}</p>
                    <p className="text-xs text-muted">{GOAL_TYPE_LABELS[g.goal_type]}{g.exercise ? ` · ${g.exercise.name}` : ''}{g.measurement_field ? ` · ${MEASUREMENT_FIELDS.find((f) => f.key === g.measurement_field)?.label}` : ''}</p>
                  </div>
                  <Badge tone={g.status === 'completed' ? 'accent' : g.status === 'paused' ? 'warning' : 'info'}>{GOAL_STATUS_LABELS[g.status]}</Badge>
                </div>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div><p className="text-xs text-muted">{periodic ? 'Período' : 'Inicial'}</p><p className="font-semibold">{periodic ? 'Semana actual' : show(g, g.start_value)}</p></div>
                  <div><p className="text-xs text-muted">Actual</p><p className="font-semibold">{show(g, cur)}</p></div>
                  <div><p className="text-xs text-muted">Meta</p><p className="font-semibold text-accent">{show(g, g.target_value)}</p></div>
                </div>
                {pct !== null ? <div className="mt-3"><ProgressBar value={pct} /><p className="mt-1 text-xs text-muted">{pct}% de avance</p></div>
                  : <p className="mt-3 text-xs text-muted">Avance no calculable hasta tener valor inicial y registros.</p>}
                <p className="mt-2 text-xs text-muted">Creado {fmtDate(g.created_at)}{g.target_date ? ` · Fecha objetivo ${fmtDate(g.target_date)}` : ''}{g.completed_at ? ` · Logrado ${fmtDate(g.completed_at)}` : ''}</p>
                <div className="mt-3 flex flex-wrap justify-end gap-1">
                  {!g.archived && g.status !== 'completed' && <Button size="sm" variant="ghost" onClick={() => patch.mutate({ id: g.id, p: { status: g.status === 'paused' ? 'in_progress' : 'paused' } })}>{g.status === 'paused' ? 'Reanudar' : 'Pausar'}</Button>}
                  <Button size="sm" variant="ghost" onClick={() => setEditing(g)}><Pencil className="h-4 w-4" /></Button>
                  <Button size="sm" variant="ghost" aria-label={g.archived ? 'Restaurar' : 'Archivar'} onClick={() => patch.mutate({ id: g.id, p: { archived: !g.archived } })}>{g.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}</Button>
                  <Button size="sm" variant="ghost" className="text-danger" aria-label="Eliminar" onClick={() => setToDelete(g)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}
      {editing && <GoalForm goal={editing === 'new' ? null : editing} current={current} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)} danger title="¿Eliminar objetivo?" description="Si solo quieres ocultarlo, archívalo." confirmLabel="Eliminar" onConfirm={() => toDelete && del.mutate(toDelete)} />
    </div>
  )
}

function GoalForm({ goal, current, onClose }: { goal: Goal | null; current: (g: Goal) => number | null; onClose: () => void }) {
  const me = useUserId()
  const unit = useUnit()
  const { data: exercises } = useExercises()
  const [type, setType] = useState<GoalType>(goal?.goal_type ?? 'body_weight')
  const [title, setTitle] = useState(goal?.title ?? '')
  const [exerciseId, setExerciseId] = useState(goal?.exercise_id ?? '')
  const [field, setField] = useState(goal?.measurement_field ?? 'waist_cm')
  const conv = (v: number | null, t: GoalType) => (v === null ? '' : String(Math.round((isWeightLike(t) ? kgTo(v, unit) : v) * 10) / 10))
  const [start, setStart] = useState(conv(goal?.start_value ?? null, goal?.goal_type ?? 'body_weight'))
  const [target, setTarget] = useState(conv(goal?.target_value ?? null, goal?.goal_type ?? 'body_weight'))
  const [date, setDate] = useState(goal?.target_date ?? '')
  const [status, setStatus] = useState<GoalStatus>(goal?.status ?? 'pending')
  const [notes, setNotes] = useState(goal?.notes ?? '')
  const periodic = type === 'attendance' || type === 'volume'

  // Sugerir valor inicial a partir del valor actual registrado.
  const suggest = () => {
    const v = current({ goal_type: type, exercise_id: exerciseId || null, measurement_field: field } as Goal)
    if (v !== null) setStart(conv(v, type))
  }
  const toStored = (s: string) => { const n = numOrNull(s); return n === null ? null : isWeightLike(type) ? Math.round(toKg(n, unit) * 100) / 100 : n }
  const t = toStored(target)
  const valid = title.trim() && t !== null && t > 0 && (type !== 'strength' || exerciseId) && (type !== 'attendance' || (t >= 1 && t <= 7))

  const save = useMut(async () => {
    const row = {
      user_id: me, goal_type: type, title: title.trim(), exercise_id: type === 'strength' ? exerciseId : null,
      measurement_field: type === 'measurement' ? field : null, start_value: periodic ? null : toStored(start), target_value: t,
      target_date: date || null, status, notes: notes.trim() || null,
    }
    return unwrap(goal ? supabase.from('goals').update(row).eq('id', goal.id) : supabase.from('goals').insert(row))
  }, { invalidate: [keys.goals(me)], success: 'Objetivo guardado', onSuccess: onClose })

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={goal ? 'Editar objetivo' : 'Nuevo objetivo'}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (valid) save.mutate(undefined) }}>
        <Field label="Tipo">{(id) => (
          <Select id={id} value={type} disabled={!!goal} onChange={(e) => setType(e.target.value as GoalType)}>
            {Object.entries(GOAL_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        )}</Field>
        <Field label="Título">{(id) => <Input id={id} value={title} maxLength={120} placeholder="Ej.: Llegar a 80 kg" onChange={(e) => setTitle(e.target.value)} />}</Field>
        {type === 'strength' && <Field label="Ejercicio (meta = peso máximo en una serie)">{(id) => (
          <Select id={id} value={exerciseId} onChange={(e) => setExerciseId(e.target.value)}><option value="">Selecciona…</option>{exercises?.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</Select>
        )}</Field>}
        {type === 'measurement' && <Field label="Medida">{(id) => (
          <Select id={id} value={field} onChange={(e) => setField(e.target.value)}>{BODY_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</Select>
        )}</Field>}
        <div className="grid grid-cols-2 gap-3">
          {!periodic && <Field label={`Valor inicial (${goalUnit({ goal_type: type, measurement_field: field }, unit)})`} hint="Opcional">
            {(id) => <div className="flex gap-1"><Input id={id} type="number" step="any" value={start} onChange={(e) => setStart(e.target.value)} /><Button size="sm" variant="ghost" onClick={suggest} className="h-11">Actual</Button></div>}
          </Field>}
          <Field label={`Meta (${goalUnit({ goal_type: type, measurement_field: field }, unit)})`} hint={type === 'volume' ? 'Volumen semanal' : type === 'attendance' ? 'Entre 1 y 7' : undefined}>
            {(id) => <Input id={id} type="number" step="any" value={target} onChange={(e) => setTarget(e.target.value)} />}
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Fecha objetivo (opcional)">{(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
          <Field label="Estado">{(id) => (
            <Select id={id} value={status} onChange={(e) => setStatus(e.target.value as GoalStatus)}>{Object.entries(GOAL_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          )}</Field>
        </div>
        <Field label="Notas">{(id) => <Textarea id={id} rows={2} value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />}</Field>
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={!valid} loading={save.isPending}>Guardar</Button></div>
      </form>
    </Modal>
  )
}
