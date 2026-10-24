import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Input, LoadingBlock, Modal, Select } from '@/components/ui'
import { useExercises } from '@/data/queries'
import { MUSCLE_LABELS, MUSCLES } from '@/lib/labels'
import type { Exercise, MuscleGroup } from '@/lib/types'

export function filterExercises(list: Exercise[], q: string, muscle: MuscleGroup | '') {
  const term = q.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
  return list.filter((e) => {
    if (muscle && e.primary_muscle !== muscle && !e.exercise_muscles?.some((m) => m.muscle === muscle)) return false
    if (!term) return true
    return e.name.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').includes(term)
  })
}

export function ExercisePicker({ open, onOpenChange, onPick, title = 'Agregar ejercicio' }: {
  open: boolean; onOpenChange: (o: boolean) => void; onPick: (e: Exercise) => void; title?: string
}) {
  const { data, isLoading } = useExercises()
  const [q, setQ] = useState('')
  const [muscle, setMuscle] = useState<MuscleGroup | ''>('')
  const list = useMemo(() => filterExercises(data ?? [], q, muscle), [data, q, muscle])

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title}>
      <div className="mb-3 flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input autoFocus placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" aria-label="Buscar ejercicio" />
        </div>
        <Select value={muscle} onChange={(e) => setMuscle(e.target.value as MuscleGroup | '')} className="w-36" aria-label="Grupo muscular">
          <option value="">Todos</option>
          {MUSCLES.map((m) => <option key={m} value={m}>{MUSCLE_LABELS[m]}</option>)}
        </Select>
      </div>
      {isLoading ? <LoadingBlock /> : (
        <ul className="max-h-[55dvh] space-y-1 overflow-y-auto">
          {list.map((e) => (
            <li key={e.id}>
              <button type="button" onClick={() => { onPick(e); onOpenChange(false) }}
                className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-3 text-left hover:bg-surface-2">
                <span className="font-medium">{e.name}</span>
                <span className="flex shrink-0 gap-1">
                  {e.owner_id && <Badge tone="info">Propio</Badge>}
                  <Badge>{MUSCLE_LABELS[e.primary_muscle]}</Badge>
                </span>
              </button>
            </li>
          ))}
          {!list.length && <li className="py-8 text-center text-sm text-muted">Sin resultados. <Link to="/ejercicios" className="text-accent">Crea un ejercicio personalizado</Link>.</li>}
        </ul>
      )}
    </Modal>
  )
}
