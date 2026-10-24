import { Info, Pencil, Plus, Ruler, Target, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { z } from 'zod'
import { LineChartCard } from '@/components/charts'
import {
  Badge, Button, Card, CardTitle, ConfirmDialog, EmptyState, ErrorBlock, Field, Input, LoadingBlock, Modal, PageHeader, Select, Textarea,
} from '@/components/ui'
import { keys, unwrap, useMeasurements, useMut, useProfile, useUnit } from '@/data/queries'
import { useUserId } from '@/features/auth/AuthProvider'
import { bmi } from '@/lib/calc'
import { fmtDate, fmtShort, todayKey } from '@/lib/dates'
import { errorMessage } from '@/lib/errors'
import { MEASUREMENT_FIELDS, type MeasurementKey } from '@/lib/labels'
import { supabase } from '@/lib/supabase'
import type { BodyMeasurement, WeightUnit } from '@/lib/types'
import { kgTo, toKg } from '@/lib/units'
import { formatNumber, numOrNull, pctChange } from '@/lib/utils'

const fieldUnit = (key: MeasurementKey, unit: WeightUnit) => (key === 'weight_kg' ? unit : MEASUREMENT_FIELDS.find((f) => f.key === key)!.unit)
const shown = (m: BodyMeasurement, key: MeasurementKey, unit: WeightUnit) => {
  const v = m[key]
  if (v === null || v === undefined) return null
  return key === 'weight_kg' ? Math.round(kgTo(Number(v), unit) * 10) / 10 : Number(v)
}

export default function MeasurementsPage() {
  const unit = useUnit()
  const { data, isLoading, error, refetch } = useMeasurements()
  const { data: profile } = useProfile()
  const [editing, setEditing] = useState<BodyMeasurement | 'new' | null>(null)
  const [toDelete, setToDelete] = useState<BodyMeasurement | null>(null)
  const [chartKey, setChartKey] = useState<MeasurementKey>('weight_kg')
  const me = useUserId()
  const list = useMemo(() => data ?? [], [data])
  const [cmpA, setCmpA] = useState('')
  const [cmpB, setCmpB] = useState('')

  const del = useMut(async (m: BodyMeasurement) => unwrap(supabase.from('body_measurements').delete().eq('id', m.id)), {
    invalidate: [keys.measurements(me)], success: 'Registro eliminado', onSuccess: () => setToDelete(null),
  })

  const chart = useMemo(() => [...list].reverse().filter((m) => m[chartKey] !== null)
    .map((m) => ({ date: fmtShort(m.measured_on), valor: shown(m, chartKey, unit) })), [list, chartKey, unit])

  const latestWeight = list.find((m) => m.weight_kg !== null)?.weight_kg ?? null
  const latestHeight = list.find((m) => m.height_cm !== null)?.height_cm ?? profile?.height_cm ?? null
  const imc = bmi(latestWeight, latestHeight)

  const A = list.find((m) => m.id === cmpA) ?? list[list.length - 1]
  const B = list.find((m) => m.id === cmpB) ?? list[0]

  if (isLoading) return <LoadingBlock />
  if (error) return <ErrorBlock error={errorMessage(error)} onRetry={refetch} />

  return (
    <div className="animate-fade-up">
      <PageHeader title="Peso y medidas" subtitle="Registro cronológico. Solo se muestran valores que registraste."
        actions={<>
          <Link to="/objetivos"><Button variant="outline"><Target className="h-4 w-4" /> Objetivos físicos</Button></Link>
          <Button onClick={() => setEditing('new')}><Plus className="h-4 w-4" /> Nueva medición</Button>
        </>} />

      {!list.length ? (
        <EmptyState icon={<Ruler className="h-8 w-8" />} title="Sin mediciones" description="Registra tu peso y medidas para seguir tu evolución."
          action={<Button onClick={() => setEditing('new')}>Registrar ahora</Button>} />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardTitle action={
                <Select value={chartKey} onChange={(e) => setChartKey(e.target.value as MeasurementKey)} className="h-8 w-48 text-sm" aria-label="Medida a graficar">
                  {MEASUREMENT_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                </Select>}>Evolución ({fieldUnit(chartKey, unit)})</CardTitle>
              <LineChartCard data={chart} xKey="date" series={[{ key: 'valor', label: MEASUREMENT_FIELDS.find((f) => f.key === chartKey)!.label }]} empty="Sin registros de esta medida" />
            </Card>
            <Card>
              <CardTitle>IMC</CardTitle>
              <p className="text-3xl font-extrabold">{imc ?? '—'}</p>
              <p className="mt-2 flex gap-2 text-xs text-muted"><Info className="h-4 w-4 shrink-0" />
                El IMC solo relaciona peso y estatura. No distingue músculo de grasa, por lo que en personas con mucha masa muscular puede indicar
                "sobrepeso" sin que exista exceso de grasa. Úsalo solo como referencia.</p>
              {!latestHeight && <p className="mt-2 text-xs text-warning">Registra tu estatura para calcularlo.</p>}
            </Card>
          </div>

          {list.length >= 2 && A && B && (
            <Card>
              <CardTitle>Comparar fechas</CardTitle>
              <div className="mb-3 grid gap-2 sm:grid-cols-2">
                <Select value={A.id} onChange={(e) => setCmpA(e.target.value)} aria-label="Fecha inicial">{list.map((m) => <option key={m.id} value={m.id}>{fmtDate(m.measured_on)}</option>)}</Select>
                <Select value={B.id} onChange={(e) => setCmpB(e.target.value)} aria-label="Fecha final">{list.map((m) => <option key={m.id} value={m.id}>{fmtDate(m.measured_on)}</option>)}</Select>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs uppercase text-muted"><th className="py-2 font-medium">Medida</th><th className="font-medium">{fmtShort(A.measured_on)}</th><th className="font-medium">{fmtShort(B.measured_on)}</th><th className="font-medium">Diferencia</th><th className="font-medium">%</th></tr></thead>
                  <tbody className="divide-y divide-border">
                    {MEASUREMENT_FIELDS.map((f) => {
                      const a = shown(A, f.key, unit), b = shown(B, f.key, unit)
                      if (a === null && b === null) return null
                      const diff = a !== null && b !== null ? b - a : null
                      const p = pctChange(a, b)
                      return (
                        <tr key={f.key}>
                          <td className="py-2 text-muted">{f.label}</td><td>{a ?? '—'}</td><td>{b ?? '—'}</td>
                          <td>{diff === null ? 'Sin dato' : `${diff > 0 ? '+' : ''}${formatNumber(diff, 1)} ${fieldUnit(f.key, unit)}`}</td>
                          <td>{p === null ? '—' : `${p > 0 ? '+' : ''}${formatNumber(p, 1)}%`}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <Card>
            <CardTitle>Historial</CardTitle>
            <ul className="divide-y divide-border">
              {list.map((m) => (
                <li key={m.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{fmtDate(m.measured_on)} {m.method && <Badge>{m.method}</Badge>}</p>
                    <p className="text-xs text-muted">
                      {MEASUREMENT_FIELDS.filter((f) => m[f.key] !== null).map((f) => `${f.label}: ${shown(m, f.key, unit)} ${fieldUnit(f.key, unit)}`).join(' · ')}
                    </p>
                    {m.notes && <p className="mt-1 text-xs text-muted">{m.notes}</p>}
                  </div>
                  <div className="flex shrink-0">
                    <Button size="icon" variant="ghost" aria-label="Editar" onClick={() => setEditing(m)}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" aria-label="Eliminar" className="text-danger" onClick={() => setToDelete(m)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      {editing && <MeasurementForm m={editing === 'new' ? null : editing} unit={unit} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)} danger title="¿Eliminar medición?" confirmLabel="Eliminar"
        description="Se borrará este registro de forma permanente." loading={del.isPending} onConfirm={() => toDelete && del.mutate(toDelete)} />
    </div>
  )
}

const RANGES: Record<MeasurementKey, [number, number]> = {
  weight_kg: [20, 400], height_cm: [50, 260], body_fat_pct: [2, 70],
  waist_cm: [5, 300], chest_cm: [5, 300], hips_cm: [5, 300], arm_left_cm: [5, 300], arm_right_cm: [5, 300],
  forearm_left_cm: [5, 300], forearm_right_cm: [5, 300], thigh_left_cm: [5, 300], thigh_right_cm: [5, 300], calf_left_cm: [5, 300], calf_right_cm: [5, 300],
}

function MeasurementForm({ m, unit, onClose }: { m: BodyMeasurement | null; unit: WeightUnit; onClose: () => void }) {
  const me = useUserId()
  const [date, setDate] = useState(m?.measured_on ?? todayKey())
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(
    MEASUREMENT_FIELDS.map((f) => [f.key, m && m[f.key] !== null ? String(shown(m, f.key, unit)) : '']),
  ))
  const [method, setMethod] = useState(m?.method ?? '')
  const [notes, setNotes] = useState(m?.notes ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const save = useMut(async () => {
    const errs: Record<string, string> = {}
    const row: Record<string, unknown> = { user_id: me, measured_on: date, method: method.trim() || null, notes: notes.trim() || null }
    for (const f of MEASUREMENT_FIELDS) {
      const n = numOrNull(values[f.key])
      const kg = n !== null && f.key === 'weight_kg' ? toKg(n, unit) : n
      const [lo, hi] = RANGES[f.key]
      if (kg !== null && (kg < lo || kg > hi)) errs[f.key] = `Fuera de rango`
      row[f.key] = kg === null ? null : Math.round(kg * 100) / 100
    }
    if (!z.string().date().safeParse(date).success) errs.date = 'Fecha no válida'
    if (MEASUREMENT_FIELDS.every((f) => row[f.key] === null)) errs.form = 'Registra al menos una medida'
    setErrors(errs)
    if (Object.keys(errs).length) throw new Error('Revisa los campos marcados')
    return unwrap(m ? supabase.from('body_measurements').update(row).eq('id', m.id) : supabase.from('body_measurements').insert(row))
  }, { invalidate: [keys.measurements(me)], success: 'Medición guardada', onSuccess: onClose })

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={m ? 'Editar medición' : 'Nueva medición'} description="Deja vacío lo que no midas: no se estima nada." className="sm:max-w-2xl">
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(undefined) }} className="space-y-3" noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Fecha" error={errors.date}>{(id) => <Input id={id} type="date" value={date} max={todayKey()} onChange={(e) => setDate(e.target.value)} />}</Field>
          <Field label="Método de medición">{(id) => <Input id={id} placeholder="Cinta, báscula, bioimpedancia…" value={method} maxLength={80} onChange={(e) => setMethod(e.target.value)} />}</Field>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {MEASUREMENT_FIELDS.map((f) => (
            <Field key={f.key} label={`${f.label} (${fieldUnit(f.key, unit)})`} error={errors[f.key]}>
              {(id) => <Input id={id} type="number" inputMode="decimal" step="any" value={values[f.key]} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />}
            </Field>
          ))}
        </div>
        <Field label="Notas">{(id) => <Textarea id={id} rows={2} value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />}</Field>
        {errors.form && <p className="text-sm text-danger">{errors.form}</p>}
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" loading={save.isPending}>Guardar</Button></div>
      </form>
    </Modal>
  )
}
