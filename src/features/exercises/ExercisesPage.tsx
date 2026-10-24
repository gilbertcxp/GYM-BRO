import { zodResolver } from '@hookform/resolvers/zod'
import { Dumbbell, ExternalLink, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, ErrorBlock, Field, Input, LoadingBlock, Modal, PageHeader, Select, Textarea,
} from '@/components/ui'
import { keys, unwrap, useExercises, useMut } from '@/data/queries'
import { useUserId } from '@/features/auth/AuthProvider'
import { errorMessage } from '@/lib/errors'
import { MECHANICS_LABELS, MODALITY_LABELS, MUSCLE_LABELS, MUSCLES } from '@/lib/labels'
import { supabase } from '@/lib/supabase'
import type { Exercise, Mechanics, Modality, MuscleGroup } from '@/lib/types'
import { cn } from '@/lib/utils'
import { filterExercises } from './ExercisePicker'

const url = z.string().trim().url('URL no válida').startsWith('https://', 'Debe empezar con https://').or(z.literal(''))
const schema = z.object({
  name: z.string().trim().min(2, 'Mínimo 2 caracteres').max(120),
  primary_muscle: z.enum(MUSCLES as [MuscleGroup, ...MuscleGroup[]]),
  mechanics: z.enum(['compound', 'isolation']),
  modality: z.enum(['free_weight', 'machine', 'cable', 'bodyweight']),
  equipment: z.string().trim().max(120),
  instructions: z.string().trim().max(4000),
  common_mistakes: z.string().trim().max(4000),
  video_url: url,
  image_url: url,
})
type FormValues = z.infer<typeof schema>

export default function ExercisesPage() {
  const { data, isLoading, error, refetch } = useExercises()
  const me = useUserId()
  const [q, setQ] = useState('')
  const [muscle, setMuscle] = useState<MuscleGroup | ''>('')
  const [mechanics, setMechanics] = useState<Mechanics | ''>('')
  const [modality, setModality] = useState<Modality | ''>('')
  const [onlyMine, setOnlyMine] = useState(false)
  const [detail, setDetail] = useState<Exercise | null>(null)
  const [editing, setEditing] = useState<Exercise | 'new' | null>(null)

  const list = useMemo(() => filterExercises(data ?? [], q, muscle)
    .filter((e) => (!mechanics || e.mechanics === mechanics) && (!modality || e.modality === modality) && (!onlyMine || e.owner_id === me)),
  [data, q, muscle, mechanics, modality, onlyMine, me])

  return (
    <div className="animate-fade-up">
      <PageHeader title="Ejercicios" subtitle={`${data?.length ?? 0} ejercicios en la biblioteca`}
        actions={<Button onClick={() => setEditing('new')}><Plus className="h-4 w-4" /> Ejercicio personalizado</Button>} />
      <Card className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input placeholder="Buscar ejercicio…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" aria-label="Buscar" />
        </div>
        <Select value={muscle} onChange={(e) => setMuscle(e.target.value as MuscleGroup | '')} aria-label="Grupo muscular">
          <option value="">Todos los músculos</option>
          {MUSCLES.map((m) => <option key={m} value={m}>{MUSCLE_LABELS[m]}</option>)}
        </Select>
        <Select value={mechanics} onChange={(e) => setMechanics(e.target.value as Mechanics | '')} aria-label="Mecánica">
          <option value="">Compuesto y aislamiento</option>
          {Object.entries(MECHANICS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select value={modality} onChange={(e) => setModality(e.target.value as Modality | '')} aria-label="Modalidad">
          <option value="">Todo el equipamiento</option>
          {Object.entries(MODALITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" /> Solo mis ejercicios
        </label>
      </Card>

      {isLoading ? <LoadingBlock /> : error ? <ErrorBlock error={errorMessage(error)} onRetry={refetch} /> : !list.length ? (
        <EmptyState icon={<Dumbbell className="h-8 w-8" />} title="Sin resultados" description="Cambia los filtros o crea un ejercicio personalizado." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((e) => (
            <button key={e.id} type="button" onClick={() => setDetail(e)} className="text-left">
              <Card className="h-full transition hover:border-accent/40">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold">{e.name}</p>
                  {e.owner_id === me ? <Badge tone="info">Propio</Badge> : e.owner_id ? <Badge>Gym Bro</Badge> : null}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  <Badge tone="accent">{MUSCLE_LABELS[e.primary_muscle]}</Badge>
                  <Badge>{MECHANICS_LABELS[e.mechanics]}</Badge>
                  <Badge>{MODALITY_LABELS[e.modality]}</Badge>
                </div>
                {!!e.exercise_muscles?.length && <p className="mt-2 text-xs text-muted">Secundarios: {e.exercise_muscles.map((m) => MUSCLE_LABELS[m.muscle]).join(', ')}</p>}
              </Card>
            </button>
          ))}
        </div>
      )}

      {detail && <ExerciseDetail exercise={detail} onClose={() => setDetail(null)} onEdit={() => { setEditing(detail); setDetail(null) }} />}
      {editing && <ExerciseForm exercise={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function ExerciseDetail({ exercise: e, onClose, onEdit }: { exercise: Exercise; onClose: () => void; onEdit: () => void }) {
  const me = useUserId()
  const [confirm, setConfirm] = useState(false)
  const del = useMut(async () => unwrap(supabase.from('exercises').delete().eq('id', e.id)), {
    invalidate: [keys.exercises], success: 'Ejercicio eliminado', onSuccess: onClose,
  })
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={e.name} description={`${MUSCLE_LABELS[e.primary_muscle]} · ${MECHANICS_LABELS[e.mechanics]} · ${MODALITY_LABELS[e.modality]}`}>
      <div className="space-y-4 text-sm">
        {e.image_url && <img src={e.image_url} alt={e.name} className="max-h-64 w-full rounded-xl object-cover" loading="lazy" referrerPolicy="no-referrer" />}
        {e.equipment && <p><span className="text-muted">Equipamiento:</span> {e.equipment}</p>}
        {!!e.exercise_muscles?.length && <p><span className="text-muted">Músculos secundarios:</span> {e.exercise_muscles.map((m) => MUSCLE_LABELS[m.muscle]).join(', ')}</p>}
        {e.instructions && <div><p className="mb-1 font-semibold">Ejecución</p><p className="whitespace-pre-line text-muted">{e.instructions}</p></div>}
        {e.common_mistakes && <div><p className="mb-1 font-semibold">Errores comunes</p><p className="whitespace-pre-line text-muted">{e.common_mistakes}</p></div>}
        {e.video_url && <a href={e.video_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent">Ver video demostrativo <ExternalLink className="h-3.5 w-3.5" /></a>}
      </div>
      {e.owner_id === me && (
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="danger" onClick={() => setConfirm(true)}><Trash2 className="h-4 w-4" /> Eliminar</Button>
          <Button variant="outline" onClick={onEdit}><Pencil className="h-4 w-4" /> Editar</Button>
        </div>
      )}
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} danger title="¿Eliminar ejercicio?" confirmLabel="Eliminar" loading={del.isPending}
        description="Si el ejercicio está en rutinas o en tu historial no se podrá eliminar, para no perder registros." onConfirm={() => del.mutate(undefined)} />
    </Modal>
  )
}

function ExerciseForm({ exercise, onClose }: { exercise: Exercise | null; onClose: () => void }) {
  const me = useUserId()
  const [secondary, setSecondary] = useState<MuscleGroup[]>(exercise?.exercise_muscles?.map((m) => m.muscle) ?? [])
  const { register, handleSubmit, formState, watch } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: exercise?.name ?? '', primary_muscle: exercise?.primary_muscle ?? 'chest', mechanics: exercise?.mechanics ?? 'compound',
      modality: exercise?.modality ?? 'free_weight', equipment: exercise?.equipment ?? '', instructions: exercise?.instructions ?? '',
      common_mistakes: exercise?.common_mistakes ?? '', video_url: exercise?.video_url ?? '', image_url: exercise?.image_url ?? '',
    },
  })
  const primary = watch('primary_muscle')
  const save = useMut(async (v: FormValues) => {
    const row = {
      ...v, owner_id: me, equipment: v.equipment || null, instructions: v.instructions || null,
      common_mistakes: v.common_mistakes || null, video_url: v.video_url || null, image_url: v.image_url || null,
    }
    const saved = exercise
      ? await unwrap<Exercise>(supabase.from('exercises').update(row).eq('id', exercise.id).select().single())
      : await unwrap<Exercise>(supabase.from('exercises').insert(row).select().single())
    await unwrap(supabase.from('exercise_muscles').delete().eq('exercise_id', saved.id))
    const sec = secondary.filter((m) => m !== v.primary_muscle)
    if (sec.length) await unwrap(supabase.from('exercise_muscles').insert(sec.map((muscle) => ({ exercise_id: saved.id, muscle }))))
    return saved
  }, { invalidate: [keys.exercises], success: exercise ? 'Ejercicio actualizado' : 'Ejercicio creado', onSuccess: onClose })

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={exercise ? 'Editar ejercicio' : 'Nuevo ejercicio personalizado'}>
      <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-3" noValidate>
        <Field label="Nombre" error={formState.errors.name?.message}>{(id) => <Input id={id} {...register('name')} />}</Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Músculo principal">{(id) => (
            <Select id={id} {...register('primary_muscle')}>{MUSCLES.map((m) => <option key={m} value={m}>{MUSCLE_LABELS[m]}</option>)}</Select>
          )}</Field>
          <Field label="Mecánica">{(id) => (
            <Select id={id} {...register('mechanics')}>{Object.entries(MECHANICS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          )}</Field>
          <Field label="Tipo">{(id) => (
            <Select id={id} {...register('modality')}>{Object.entries(MODALITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          )}</Field>
        </div>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-muted">Músculos secundarios</legend>
          <div className="flex flex-wrap gap-1.5">
            {MUSCLES.filter((m) => m !== primary).map((m) => {
              const on = secondary.includes(m)
              return (
                <button key={m} type="button" aria-pressed={on} onClick={() => setSecondary(on ? secondary.filter((x) => x !== m) : [...secondary, m])}
                  className={cn('rounded-full border px-3 py-1 text-xs', on ? 'border-accent bg-accent/15 text-accent' : 'border-border text-muted')}>
                  {MUSCLE_LABELS[m]}
                </button>
              )
            })}
          </div>
        </fieldset>
        <Field label="Equipamiento">{(id) => <Input id={id} {...register('equipment')} />}</Field>
        <Field label="Instrucciones de ejecución">{(id) => <Textarea id={id} rows={3} {...register('instructions')} />}</Field>
        <Field label="Errores comunes">{(id) => <Textarea id={id} rows={2} {...register('common_mistakes')} />}</Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Video (opcional)" error={formState.errors.video_url?.message}>{(id) => <Input id={id} placeholder="https://…" {...register('video_url')} />}</Field>
          <Field label="Imagen (opcional)" error={formState.errors.image_url?.message}>{(id) => <Input id={id} placeholder="https://…" {...register('image_url')} />}</Field>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={save.isPending}>Guardar</Button>
        </div>
      </form>
    </Modal>
  )
}
