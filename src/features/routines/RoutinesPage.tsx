import { ArrowDown, ArrowUp, Copy, LayoutTemplate, ListChecks, Pencil, Plus, Share2, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  Badge, Button, Card, CardTitle, ConfirmDialog, EmptyState, ErrorBlock, Field, Input, LoadingBlock, Modal, PageHeader,
  Select, Switch, Tabs, Textarea,
} from '@/components/ui'
import { keys, unwrap, useExercises, useMut, usePartnership, useRoutines, useSharedRoutines, useUnit } from '@/data/queries'
import { useUserId } from '@/features/auth/AuthProvider'
import { ExercisePicker } from '@/features/exercises/ExercisePicker'
import { errorMessage } from '@/lib/errors'
import { MUSCLE_LABELS, MUSCLES, ROUTINE_STATUS_LABELS, WEEKDAYS } from '@/lib/labels'
import { supabase } from '@/lib/supabase'
import { ROUTINE_TEMPLATES, type RoutineTemplate } from '@/lib/templates'
import type { Exercise, MuscleGroup, Routine, RoutineStatus } from '@/lib/types'
import { displayWeight, toKg } from '@/lib/units'
import { cn, numOrNull, uuid } from '@/lib/utils'

// ---------- Borrador editable ----------
interface DraftExercise {
  id: string; exercise_id: string; name: string; primary_muscle: MuscleGroup
  target_sets: number; target_reps_min: number | null; target_reps_max: number | null
  target_weight_kg: number | null; rest_seconds: number | null; notes: string
}
interface DraftDay { id: string; name: string; day_of_week: number | null; muscle_groups: MuscleGroup[]; notes: string; exercises: DraftExercise[] }
interface Draft { id: string; name: string; description: string; status: RoutineStatus; shared_with_partner: boolean; template_key: string | null; days: DraftDay[] }

function toDraft(r: Routine, fresh = false): Draft {
  const id = () => (fresh ? uuid() : undefined)
  return {
    id: id() ?? r.id, name: fresh ? `${r.name} (copia)` : r.name, description: r.description ?? '', status: fresh ? 'active' : r.status,
    shared_with_partner: fresh ? false : r.shared_with_partner, template_key: r.template_key,
    days: (r.routine_days ?? []).map((d) => ({
      id: id() ?? d.id, name: d.name, day_of_week: d.day_of_week, muscle_groups: d.muscle_groups, notes: d.notes ?? '',
      exercises: (d.routine_exercises ?? []).map((e) => ({
        id: id() ?? e.id, exercise_id: e.exercise_id, name: e.exercise?.name ?? '', primary_muscle: e.exercise?.primary_muscle ?? 'chest',
        target_sets: e.target_sets, target_reps_min: e.target_reps_min, target_reps_max: e.target_reps_max,
        target_weight_kg: e.target_weight_kg, rest_seconds: e.rest_seconds, notes: e.notes ?? '',
      })),
    })),
  }
}

function fromTemplate(t: RoutineTemplate, library: Exercise[]): { draft: Draft; missing: string[] } {
  const byName = new Map(library.filter((e) => !e.owner_id).map((e) => [e.name.toLowerCase(), e]))
  const missing: string[] = []
  const draft: Draft = {
    id: uuid(), name: t.name, description: t.description, status: 'active', shared_with_partner: false, template_key: t.key,
    days: t.days.map((d) => ({
      id: uuid(), name: d.name, day_of_week: d.dayOfWeek, muscle_groups: d.muscles, notes: '',
      exercises: d.exercises.flatMap((te) => {
        const e = byName.get(te.name.toLowerCase())
        if (!e) { missing.push(te.name); return [] }
        return [{ id: uuid(), exercise_id: e.id, name: e.name, primary_muscle: e.primary_muscle, target_sets: te.sets,
          target_reps_min: te.repsMin, target_reps_max: te.repsMax, target_weight_kg: null, rest_seconds: te.rest, notes: '' }]
      }),
    })),
  }
  return { draft, missing }
}

/** Guarda el borrador: upsert de rutina y días (ids estables) y reemplazo de los ejercicios de cada día. */
async function saveDraft(d: Draft, ownerId: string, isNew: boolean, previousDayIds: string[]) {
  const routine = { id: d.id, owner_id: ownerId, name: d.name.trim(), description: d.description.trim() || null, status: d.status,
    shared_with_partner: d.shared_with_partner, template_key: d.template_key }
  await unwrap(isNew ? supabase.from('routines').insert(routine) : supabase.from('routines').update(routine).eq('id', d.id))
  const removed = previousDayIds.filter((id) => !d.days.some((x) => x.id === id))
  if (removed.length) await unwrap(supabase.from('routine_days').delete().in('id', removed))
  if (d.days.length) {
    await unwrap(supabase.from('routine_days').upsert(d.days.map((day, i) => ({
      id: day.id, routine_id: d.id, name: day.name.trim() || `Día ${i + 1}`, position: i, day_of_week: day.day_of_week,
      muscle_groups: day.muscle_groups, notes: day.notes.trim() || null,
    }))))
    await unwrap(supabase.from('routine_exercises').delete().in('routine_day_id', d.days.map((x) => x.id)))
    const rows = d.days.flatMap((day) => day.exercises.map((e, i) => ({
      id: uuid(), routine_day_id: day.id, exercise_id: e.exercise_id, position: i, target_sets: e.target_sets,
      target_reps_min: e.target_reps_min, target_reps_max: e.target_reps_max, target_weight_kg: e.target_weight_kg,
      rest_seconds: e.rest_seconds, notes: e.notes.trim() || null,
    })))
    if (rows.length) await unwrap(supabase.from('routine_exercises').insert(rows))
  }
}

export default function RoutinesPage() {
  const me = useUserId()
  const own = useRoutines()
  const shared = useSharedRoutines()
  const { data: library } = useExercises()
  const { data: partner } = usePartnership()
  const [tab, setTab] = useState<'active' | 'paused' | 'archived' | 'shared'>('active')
  const [editor, setEditor] = useState<{ draft: Draft; isNew: boolean; prevDays: string[] } | null>(null)
  const [templates, setTemplates] = useState(false)
  const [toDelete, setToDelete] = useState<Routine | null>(null)

  const del = useMut(async (r: Routine) => unwrap(supabase.from('routines').delete().eq('id', r.id)), {
    invalidate: [keys.routines(me)], success: 'Rutina eliminada', onSuccess: () => setToDelete(null),
  })
  const quickStatus = useMut(async ({ r, status }: { r: Routine; status: RoutineStatus }) =>
    unwrap(supabase.from('routines').update({ status }).eq('id', r.id)), { invalidate: [keys.routines(me)] })

  const list = tab === 'shared' ? shared.data ?? [] : (own.data ?? []).filter((r) => r.status === tab)
  const loading = own.isLoading || shared.isLoading

  return (
    <div className="animate-fade-up">
      <PageHeader title="Rutinas" subtitle="Diseña tus planes semanales. Las plantillas son solo un punto de partida."
        actions={<>
          <Button variant="outline" onClick={() => setTemplates(true)}><LayoutTemplate className="h-4 w-4" /> Plantillas</Button>
          <Button onClick={() => setEditor({ draft: fromTemplate(ROUTINE_TEMPLATES.at(-1)!, []).draft, isNew: true, prevDays: [] })}><Plus className="h-4 w-4" /> Nueva rutina</Button>
        </>} />
      <Tabs className="mb-4" value={tab} onChange={setTab} options={[
        { value: 'active', label: 'Activas' }, { value: 'paused', label: 'Pausadas' }, { value: 'archived', label: 'Archivadas' }, { value: 'shared', label: 'Compartidas conmigo' },
      ]} />

      {loading ? <LoadingBlock /> : own.error ? <ErrorBlock error={errorMessage(own.error)} onRetry={own.refetch} /> : !list.length ? (
        <EmptyState icon={<ListChecks className="h-8 w-8" />}
          title={tab === 'shared' ? 'Tu Gym Bro no ha compartido rutinas' : 'No hay rutinas aquí'}
          description={tab === 'shared' ? 'Cuando tu compañero comparta una rutina aparecerá aquí y podrás duplicarla.' : 'Crea una rutina o parte de una plantilla.'}
          action={tab !== 'shared' ? <Button variant="outline" onClick={() => setTemplates(true)}>Ver plantillas</Button> : undefined} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {list.map((r) => {
            const mine = r.owner_id === me
            return (
              <Card key={r.id}>
                <CardTitle action={<div className="flex gap-1">
                  {r.shared_with_partner && mine && <Badge tone="info"><Share2 className="h-3 w-3" /> Compartida</Badge>}
                  <Badge tone={r.status === 'active' ? 'accent' : 'default'}>{ROUTINE_STATUS_LABELS[r.status]}</Badge>
                </div>}>{r.name}</CardTitle>
                {r.description && <p className="-mt-1 mb-3 text-sm text-muted">{r.description}</p>}
                <ul className="mb-4 space-y-2">
                  {(r.routine_days ?? []).map((d) => (
                    <li key={d.id} className="rounded-xl bg-surface-2 p-3">
                      <p className="text-sm font-semibold">{d.name}{d.day_of_week !== null && <span className="ml-2 text-xs font-normal text-muted">{WEEKDAYS[d.day_of_week]}</span>}</p>
                      <p className="mt-0.5 text-xs text-muted">{(d.routine_exercises ?? []).map((e) => `${e.exercise?.name} ${e.target_sets}×${e.target_reps_max ?? e.target_reps_min ?? '?'}`).join(' · ') || 'Sin ejercicios'}</p>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2">
                  {mine && <Button size="sm" variant="secondary" onClick={() => setEditor({ draft: toDraft(r), isNew: false, prevDays: (r.routine_days ?? []).map((d) => d.id) })}><Pencil className="h-4 w-4" /> Editar</Button>}
                  <Button size="sm" variant="secondary" onClick={() => setEditor({ draft: toDraft(r, true), isNew: true, prevDays: [] })}><Copy className="h-4 w-4" /> Duplicar</Button>
                  {mine && r.status !== 'active' && <Button size="sm" variant="ghost" onClick={() => quickStatus.mutate({ r, status: 'active' })}>Activar</Button>}
                  {mine && r.status === 'active' && <Button size="sm" variant="ghost" onClick={() => quickStatus.mutate({ r, status: 'paused' })}>Pausar</Button>}
                  {mine && r.status !== 'archived' && <Button size="sm" variant="ghost" onClick={() => quickStatus.mutate({ r, status: 'archived' })}>Archivar</Button>}
                  {mine && <Button size="sm" variant="ghost" className="text-danger" onClick={() => setToDelete(r)}><Trash2 className="h-4 w-4" /></Button>}
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <Modal open={templates} onOpenChange={setTemplates} title="Plantillas" description="Se creará una rutina tuya que podrás modificar libremente.">
        <div className="space-y-2">
          {ROUTINE_TEMPLATES.map((t) => (
            <button key={t.key} type="button" className="w-full rounded-xl border border-border p-4 text-left hover:border-accent/50"
              onClick={() => {
                const { draft, missing } = fromTemplate(t, library ?? [])
                if (missing.length) toast.warning(`No se encontraron en la biblioteca: ${missing.join(', ')}`)
                setTemplates(false)
                setEditor({ draft, isNew: true, prevDays: [] })
              }}>
              <p className="font-semibold">{t.name}</p>
              <p className="text-sm text-muted">{t.description} {t.key !== 'custom' && `· ${t.days.length} días`}</p>
            </button>
          ))}
        </div>
      </Modal>

      {editor && <RoutineEditor {...editor} canShare={!!partner?.partnerId} onClose={() => setEditor(null)} />}
      <ConfirmDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)} danger title={`¿Eliminar "${toDelete?.name}"?`}
        description="Se borrará la rutina y su planificación. Tu historial de entrenamientos se conserva." confirmLabel="Eliminar"
        loading={del.isPending} onConfirm={() => toDelete && del.mutate(toDelete)} />
    </div>
  )
}

function RoutineEditor({ draft: initial, isNew, prevDays, canShare, onClose }: { draft: Draft; isNew: boolean; prevDays: string[]; canShare: boolean; onClose: () => void }) {
  const me = useUserId()
  const unit = useUnit()
  const [d, setD] = useState<Draft>(initial)
  const [pickFor, setPickFor] = useState<string | null>(null)
  const save = useMut(() => saveDraft(d, me, isNew, prevDays), { invalidate: [keys.routines(me)], success: 'Rutina guardada', onSuccess: onClose })

  const setDay = (id: string, patch: Partial<DraftDay>) => setD({ ...d, days: d.days.map((x) => (x.id === id ? { ...x, ...patch } : x)) })
  const setEx = (dayId: string, exId: string, patch: Partial<DraftExercise>) =>
    setDay(dayId, { exercises: d.days.find((x) => x.id === dayId)!.exercises.map((e) => (e.id === exId ? { ...e, ...patch } : e)) })
  const move = <T,>(arr: T[], i: number, dir: number) => {
    const j = i + dir
    if (j < 0 || j >= arr.length) return arr
    const c = [...arr]; [c[i], c[j]] = [c[j], c[i]]; return c
  }
  const valid = d.name.trim().length > 0 && d.days.every((x) => x.exercises.every((e) =>
    e.target_sets >= 1 && e.target_sets <= 20 && (e.target_reps_min === null || e.target_reps_max === null || e.target_reps_min <= e.target_reps_max)))

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={isNew ? 'Nueva rutina' : 'Editar rutina'} className="sm:max-w-3xl">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
          <Field label="Nombre">{(id) => <Input id={id} value={d.name} maxLength={100} onChange={(e) => setD({ ...d, name: e.target.value })} />}</Field>
          <Field label="Estado">{(id) => (
            <Select id={id} value={d.status} onChange={(e) => setD({ ...d, status: e.target.value as RoutineStatus })}>
              {Object.entries(ROUTINE_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          )}</Field>
        </div>
        <Field label="Descripción">{(id) => <Textarea id={id} rows={2} value={d.description} maxLength={1000} onChange={(e) => setD({ ...d, description: e.target.value })} />}</Field>
        <Switch checked={d.shared_with_partner} onChange={(v) => setD({ ...d, shared_with_partner: v })} disabled={!canShare && !d.shared_with_partner}
          label="Compartir con mi Gym Bro" description={canShare ? 'Podrá verla y duplicarla, pero no modificarla.' : 'Vincula un Gym Bro para compartir.'} />

        {d.days.map((day, di) => (
          <Card key={day.id} className="bg-surface-2 p-3">
            <div className="mb-3 flex flex-wrap items-end gap-2">
              <Field label={`Día ${di + 1}`} className="min-w-40 flex-1">{(id) => <Input id={id} value={day.name} maxLength={80} onChange={(e) => setDay(day.id, { name: e.target.value })} />}</Field>
              <Field label="Día de la semana" className="w-40">{(id) => (
                <Select id={id} value={day.day_of_week ?? ''} onChange={(e) => setDay(day.id, { day_of_week: e.target.value === '' ? null : Number(e.target.value) })}>
                  <option value="">Sin asignar</option>
                  {WEEKDAYS.map((w, i) => <option key={w} value={i}>{w}</option>)}
                </Select>
              )}</Field>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" aria-label="Subir día" onClick={() => setD({ ...d, days: move(d.days, di, -1) })}><ArrowUp className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" aria-label="Bajar día" onClick={() => setD({ ...d, days: move(d.days, di, 1) })}><ArrowDown className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" aria-label="Eliminar día" className="text-danger" onClick={() => setD({ ...d, days: d.days.filter((x) => x.id !== day.id) })}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
            <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Grupos musculares">
              {MUSCLES.map((m) => {
                const on = day.muscle_groups.includes(m)
                return <button key={m} type="button" aria-pressed={on}
                  onClick={() => setDay(day.id, { muscle_groups: on ? day.muscle_groups.filter((x) => x !== m) : [...day.muscle_groups, m] })}
                  className={cn('rounded-full border px-2.5 py-0.5 text-xs', on ? 'border-accent bg-accent/15 text-accent' : 'border-border text-muted')}>{MUSCLE_LABELS[m]}</button>
              })}
            </div>
            <ul className="space-y-2">
              {day.exercises.map((e, ei) => (
                <li key={e.id} className="rounded-xl border border-border bg-surface p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{ei + 1}. {e.name}</p>
                    <div className="flex">
                      <Button size="icon" variant="ghost" aria-label="Subir ejercicio" onClick={() => setDay(day.id, { exercises: move(day.exercises, ei, -1) })}><ArrowUp className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" aria-label="Bajar ejercicio" onClick={() => setDay(day.id, { exercises: move(day.exercises, ei, 1) })}><ArrowDown className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" aria-label="Quitar ejercicio" onClick={() => setDay(day.id, { exercises: day.exercises.filter((x) => x.id !== e.id) })}><X className="h-4 w-4" /></Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    <NumField label="Series" value={e.target_sets} onChange={(v) => setEx(day.id, e.id, { target_sets: v ?? 1 })} />
                    <NumField label="Reps mín." value={e.target_reps_min} onChange={(v) => setEx(day.id, e.id, { target_reps_min: v })} />
                    <NumField label="Reps máx." value={e.target_reps_max} onChange={(v) => setEx(day.id, e.id, { target_reps_max: v })} />
                    <NumField label={`Peso obj. (${unit})`} decimal value={e.target_weight_kg === null ? null : displayWeight(e.target_weight_kg, unit)}
                      onChange={(v) => setEx(day.id, e.id, { target_weight_kg: v === null ? null : Math.round(toKg(v, unit) * 100) / 100 })} />
                    <NumField label="Descanso (s)" value={e.rest_seconds} onChange={(v) => setEx(day.id, e.id, { rest_seconds: v })} />
                  </div>
                  <Input className="mt-2 h-9 text-sm" placeholder="Notas (técnica, tempo…)" value={e.notes} maxLength={1000} onChange={(ev) => setEx(day.id, e.id, { notes: ev.target.value })} aria-label="Notas del ejercicio" />
                </li>
              ))}
            </ul>
            <Button size="sm" variant="outline" className="mt-3" onClick={() => setPickFor(day.id)}><Plus className="h-4 w-4" /> Agregar ejercicio</Button>
          </Card>
        ))}
        <Button variant="outline" className="w-full" onClick={() => setD({ ...d, days: [...d.days, { id: uuid(), name: `Día ${d.days.length + 1}`, day_of_week: null, muscle_groups: [], notes: '', exercises: [] }] })}>
          <Plus className="h-4 w-4" /> Agregar día
        </Button>
        {!valid && <p className="text-sm text-danger">Revisa el nombre y que las reps mínimas no superen las máximas.</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={!valid}>Guardar rutina</Button>
        </div>
      </div>
      <ExercisePicker open={!!pickFor} onOpenChange={(o) => !o && setPickFor(null)} onPick={(ex) => {
        const day = d.days.find((x) => x.id === pickFor)
        if (!day) return
        setDay(day.id, { exercises: [...day.exercises, { id: uuid(), exercise_id: ex.id, name: ex.name, primary_muscle: ex.primary_muscle,
          target_sets: 3, target_reps_min: 8, target_reps_max: 12, target_weight_kg: null, rest_seconds: 90, notes: '' }] })
      }} />
    </Modal>
  )
}

function NumField({ label, value, onChange, decimal }: { label: string; value: number | null; onChange: (v: number | null) => void; decimal?: boolean }) {
  return (
    <label className="text-xs text-muted">
      {label}
      <Input type="number" inputMode={decimal ? 'decimal' : 'numeric'} min={0} step={decimal ? 'any' : 1} className="mt-1 h-9 text-sm"
        value={value ?? ''} onChange={(e) => { const n = numOrNull(e.target.value); onChange(n === null ? null : decimal ? n : Math.round(n)) }} />
    </label>
  )
}
