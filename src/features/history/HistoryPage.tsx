import { format, subMonths } from 'date-fns'
import { Download, FileText, History } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { RangeFilter, useRange } from '@/components/RangeFilter'
import { Badge, Button, Card, EmptyState, ErrorBlock, Input, LoadingBlock, PageHeader, Select } from '@/components/ui'
import { useExercises, useMeasurements, usePartnership, useProfile, useRecords, useRoutines, useSessions, useUnit } from '@/data/queries'
import { useUserId } from '@/features/auth/AuthProvider'
import { sessionStats } from '@/lib/calc'
import { fmtDate, inRange } from '@/lib/dates'
import { errorMessage } from '@/lib/errors'
import { exportMonthlyPdf, exportSessionsCsv } from '@/lib/exporters'
import { MUSCLE_LABELS, MUSCLES, SESSION_STATUS_LABELS } from '@/lib/labels'
import type { MuscleGroup, SessionStatus } from '@/lib/types'
import { fmtVolume } from '@/lib/units'
import { formatDuration } from '@/lib/utils'

export default function HistoryPage() {
  const me = useUserId()
  const unit = useUnit()
  const { data: partner } = usePartnership()
  const [who, setWho] = useState<string>(me)
  const sessionsQ = useSessions(who)
  const { data: routines } = useRoutines()
  const { data: exercises } = useExercises()
  const { data: records } = useRecords()
  const { data: measurements } = useMeasurements()
  const { data: profile } = useProfile()
  const { data: partnerProfile } = useProfile(partner?.partnerId ?? undefined)
  const rangeState = useRange('year')
  const [routineId, setRoutineId] = useState('')
  const [exerciseId, setExerciseId] = useState('')
  const [muscle, setMuscle] = useState<MuscleGroup | ''>('')
  const [status, setStatus] = useState<SessionStatus | ''>('')
  const [month, setMonth] = useState(format(new Date(), 'yyyy-MM'))
  const [pdfBusy, setPdfBusy] = useState(false)

  const list = useMemo(() => (sessionsQ.data ?? []).filter((s) => {
    if (!inRange(s.started_at, rangeState.range)) return false
    if (status && s.status !== status) return false
    if (routineId && s.routine_id !== routineId) return false
    const exs = s.workout_exercises ?? []
    if (exerciseId && !exs.some((e) => e.exercise_id === exerciseId)) return false
    if (muscle && !exs.some((e) => e.exercise?.primary_muscle === muscle)) return false
    return true
  }), [sessionsQ.data, rangeState.range, status, routineId, exerciseId, muscle])

  const pdf = async () => {
    setPdfBusy(true)
    try {
      await exportMonthlyPdf({ month: new Date(`${month}-15T12:00:00`), name: profile?.full_name || profile?.email || '', unit,
        sessions: sessionsQ.data ?? [], records: records ?? [], measurements: measurements ?? [] })
    } catch (e) { toast.error(errorMessage(e)) } finally { setPdfBusy(false) }
  }

  return (
    <div className="animate-fade-up">
      <PageHeader title="Historial y reportes" subtitle={`${list.length} sesiones con los filtros actuales`}
        actions={<>
          <Button variant="outline" disabled={!list.length} onClick={() => exportSessionsCsv(list, unit)}><Download className="h-4 w-4" /> CSV</Button>
          {who === me && <div className="flex gap-1">
            <Input type="month" value={month} max={format(new Date(), 'yyyy-MM')} min={format(subMonths(new Date(), 60), 'yyyy-MM')} onChange={(e) => setMonth(e.target.value)} className="h-10 w-40" aria-label="Mes del reporte" />
            <Button variant="outline" loading={pdfBusy} onClick={pdf}><FileText className="h-4 w-4" /> PDF mensual</Button>
          </div>}
        </>} />
      <Card className="mb-4 space-y-3">
        <RangeFilter state={rangeState} />
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <Select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Usuario">
            <option value={me}>Yo</option>
            {partner?.partnerId && <option value={partner.partnerId}>{partnerProfile?.full_name || 'Gym Bro'}</option>}
          </Select>
          <Select value={routineId} onChange={(e) => setRoutineId(e.target.value)} aria-label="Rutina" disabled={who !== me}>
            <option value="">Todas las rutinas</option>{routines?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
          <Select value={exerciseId} onChange={(e) => setExerciseId(e.target.value)} aria-label="Ejercicio">
            <option value="">Todos los ejercicios</option>{exercises?.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </Select>
          <Select value={muscle} onChange={(e) => setMuscle(e.target.value as MuscleGroup | '')} aria-label="Grupo muscular">
            <option value="">Todos los grupos</option>{MUSCLES.map((m) => <option key={m} value={m}>{MUSCLE_LABELS[m]}</option>)}
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value as SessionStatus | '')} aria-label="Estado">
            <option value="">Todos los estados</option>{Object.entries(SESSION_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </div>
      </Card>
      {sessionsQ.isLoading ? <LoadingBlock /> : sessionsQ.error ? <ErrorBlock error={errorMessage(sessionsQ.error)} onRetry={sessionsQ.refetch} /> : !list.length ? (
        <EmptyState icon={<History className="h-8 w-8" />} title="Sin sesiones" description="No hay entrenamientos con estos filtros." />
      ) : (
        <ul className="space-y-2">
          {list.map((s) => {
            const st = sessionStats(s)
            return (
              <li key={s.id}>
                <Link to={`/historial/${s.id}`} className="block">
                  <Card className="flex flex-wrap items-center justify-between gap-3 transition hover:border-accent/40">
                    <div className="min-w-0">
                      <p className="font-semibold">{s.name}</p>
                      <p className="text-xs text-muted">{fmtDate(s.started_at, "EEE d MMM yyyy, HH:mm")} · {(s.workout_exercises ?? []).map((e) => e.exercise?.name).join(', ')}</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-xs">
                      {s.status !== 'completed' && <Badge tone="warning">{SESSION_STATUS_LABELS[s.status]}</Badge>}
                      <Badge>{st.workingSets} series</Badge>
                      <Badge>{fmtVolume(st.volume, unit)}</Badge>
                      {st.durationSec !== null && <Badge>{formatDuration(st.durationSec)}</Badge>}
                    </div>
                  </Card>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
