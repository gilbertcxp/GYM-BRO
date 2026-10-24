import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Pencil, Save, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Badge, Button, Card, CardTitle, ConfirmDialog, ErrorBlock, Input, LoadingBlock, PageHeader, StatCard, Textarea } from '@/components/ui'
import { SESSION_SELECT, sortSession, unwrap, useUnit } from '@/data/queries'
import { useUserId } from '@/features/auth/AuthProvider'
import { epley1rm, sessionStats } from '@/lib/calc'
import { fmtDateTime } from '@/lib/dates'
import { errorMessage } from '@/lib/errors'
import { MUSCLE_LABELS, SESSION_STATUS_LABELS, SET_TYPE_LABELS } from '@/lib/labels'
import { supabase } from '@/lib/supabase'
import type { WorkoutSession, WorkoutSet } from '@/lib/types'
import { displayWeight, fmtVolume, fmtWeight, toKg } from '@/lib/units'
import { formatDuration, numOrNull } from '@/lib/utils'

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const me = useUserId()
  const unit = useUnit()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { data: s, isLoading, error, refetch } = useQuery({
    queryKey: ['session', id],
    queryFn: async () => sortSession(await unwrap<WorkoutSession>(supabase.from('workout_sessions').select(SESSION_SELECT).eq('id', id!).single())),
  })
  const [editing, setEditing] = useState(false)
  const [edits, setEdits] = useState<Record<string, Partial<WorkoutSet>>>({})
  const [notes, setNotes] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  if (isLoading) return <LoadingBlock />
  if (error || !s) return <ErrorBlock error={errorMessage(error ?? 'Sesión no encontrada')} onRetry={refetch} />
  const mine = s.user_id === me
  const st = sessionStats(s)

  const save = async () => {
    setBusy(true)
    try {
      for (const [setId, patch] of Object.entries(edits)) await unwrap(supabase.from('workout_sets').update(patch).eq('id', setId))
      if (notes !== null) await unwrap(supabase.from('workout_sessions').update({ notes: notes || null }).eq('id', s.id))
      // Recalcula los récords de esta sesión tras la edición.
      if (s.status === 'completed') await unwrap(supabase.rpc('recompute_session_records', { p_session: s.id }))
      await qc.invalidateQueries()
      setEdits({}); setNotes(null); setEditing(false)
      toast.success('Sesión actualizada y récords recalculados')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  const remove = async () => {
    setBusy(true)
    try {
      await unwrap(supabase.from('workout_sessions').delete().eq('id', s.id))
      await qc.invalidateQueries()
      toast.success('Sesión eliminada')
      navigate('/historial', { replace: true })
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  const val = (x: WorkoutSet, k: 'weight_kg' | 'reps') => (edits[x.id]?.[k] ?? x[k]) as number

  return (
    <div className="animate-fade-up">
      <Link to="/historial" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-text"><ArrowLeft className="h-4 w-4" /> Historial</Link>
      <PageHeader title={s.name} subtitle={<>{fmtDateTime(s.started_at)}{s.ended_at && ` → ${fmtDateTime(s.ended_at)}`} <Badge>{SESSION_STATUS_LABELS[s.status]}</Badge></>}
        actions={mine && (editing
          ? <><Button variant="ghost" onClick={() => { setEditing(false); setEdits({}); setNotes(null) }}>Cancelar</Button><Button loading={busy} onClick={save}><Save className="h-4 w-4" /> Guardar</Button></>
          : <><Button variant="outline" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" /> Editar</Button><Button variant="danger" onClick={() => setConfirmDelete(true)}><Trash2 className="h-4 w-4" /></Button></>)} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Duración" value={st.durationSec !== null ? formatDuration(st.durationSec) : '—'} />
        <StatCard label="Series de trabajo" value={st.workingSets} sub={`${st.totalSets} registradas`} />
        <StatCard label="Repeticiones" value={st.totalReps} />
        <StatCard label="Volumen (calculado)" value={fmtVolume(st.volume, unit)} sub={`+ ${fmtVolume(st.warmupVolume, unit)} calentamiento`} accent />
      </div>
      <div className="space-y-3">
        {(s.workout_exercises ?? []).map((we) => (
          <Card key={we.id}>
            <CardTitle>{we.exercise?.name} · {we.exercise ? MUSCLE_LABELS[we.exercise.primary_muscle] : ''}</CardTitle>
            {we.notes && <p className="-mt-2 mb-2 text-sm text-muted">{we.notes}</p>}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs uppercase text-muted"><th className="py-1.5 font-medium">#</th><th className="font-medium">Tipo</th><th className="font-medium">Peso</th><th className="font-medium">Reps</th><th className="font-medium">RPE/RIR</th><th className="font-medium">1RM est.</th><th className="font-medium">Estado</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {(we.workout_sets ?? []).map((x) => {
                    const e1 = x.set_type !== 'warmup' ? epley1rm(val(x, 'weight_kg'), val(x, 'reps')) : null
                    return (
                      <tr key={x.id} className={x.completed ? '' : 'text-muted'}>
                        <td className="py-2">{x.set_number}</td>
                        <td>{SET_TYPE_LABELS[x.set_type]}</td>
                        <td>{editing ? <Input type="number" step="any" className="h-8 w-20 text-sm" aria-label="Peso" defaultValue={displayWeight(Number(x.weight_kg), unit)}
                          onChange={(e) => { const n = numOrNull(e.target.value); if (n !== null && n >= 0) setEdits({ ...edits, [x.id]: { ...edits[x.id], weight_kg: Math.round(toKg(n, unit) * 100) / 100 } }) }} /> : fmtWeight(Number(x.weight_kg), unit)}</td>
                        <td>{editing ? <Input type="number" className="h-8 w-16 text-sm" aria-label="Repeticiones" defaultValue={x.reps}
                          onChange={(e) => { const n = numOrNull(e.target.value); if (n !== null && n >= 0) setEdits({ ...edits, [x.id]: { ...edits[x.id], reps: Math.round(n) } }) }} /> : x.reps}</td>
                        <td>{x.rpe ?? '—'} / {x.rir ?? '—'}</td>
                        <td>{e1 ? fmtWeight(e1, unit) : '—'}</td>
                        <td>{editing ? <input type="checkbox" aria-label="Completada" defaultChecked={x.completed} className="h-4 w-4 accent-[var(--accent)]"
                          onChange={(e) => setEdits({ ...edits, [x.id]: { ...edits[x.id], completed: e.target.checked } })} /> : x.completed ? 'Completada' : 'Pendiente'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        ))}
        <Card>
          <CardTitle>Notas</CardTitle>
          {editing ? <Textarea defaultValue={s.notes ?? ''} onChange={(e) => setNotes(e.target.value)} maxLength={2000} aria-label="Notas de la sesión" />
            : <p className="whitespace-pre-line text-sm text-muted">{s.notes || 'Sin notas.'}</p>}
        </Card>
      </div>
      <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} danger title="¿Eliminar sesión?" confirmLabel="Eliminar" loading={busy}
        description="Se borrarán la sesión, sus series y los récords obtenidos en ella. No se puede deshacer." onConfirm={remove} />
    </div>
  )
}
