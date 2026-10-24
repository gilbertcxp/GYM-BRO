import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { groupByPeriod, sessionStats } from './calc'
import { localDay } from './dates'
import { MUSCLE_LABELS, PR_LABELS, SET_TYPE_LABELS } from './labels'
import type { BodyMeasurement, PersonalRecord, WeightUnit, WorkoutSession } from './types'
import { kgTo } from './units'

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v)
  // Neutraliza fórmulas al abrir en Excel (inyección CSV).
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}
export function toCsv(rows: unknown[][]) {
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n')
}

/** CSV con una fila por serie. Las columnas derivadas se marcan como (calculado). */
export function exportSessionsCsv(sessions: WorkoutSession[], unit: WeightUnit) {
  const rows: unknown[][] = [[
    'Fecha', 'Inicio', 'Fin', 'Sesión', 'Estado', 'Ejercicio', 'Grupo muscular', 'Serie', 'Tipo de serie',
    `Peso (${unit})`, 'Repeticiones', 'Completada', 'RPE', 'RIR', 'Notas serie', `Volumen serie (${unit}) (calculado)`,
  ]]
  for (const s of sessions) for (const we of s.workout_exercises ?? []) for (const set of we.workout_sets ?? []) {
    const w = Math.round(kgTo(Number(set.weight_kg), unit) * 100) / 100
    rows.push([
      localDay(s.started_at), format(parseISO(s.started_at), 'HH:mm'), s.ended_at ? format(parseISO(s.ended_at), 'HH:mm') : '',
      s.name, s.status, we.exercise?.name ?? '', we.exercise ? MUSCLE_LABELS[we.exercise.primary_muscle] : '', set.set_number,
      SET_TYPE_LABELS[set.set_type], w, set.reps, set.completed ? 'sí' : 'no', set.rpe ?? '', set.rir ?? '', set.notes ?? '',
      set.completed ? Math.round(w * set.reps * 100) / 100 : 0,
    ])
  }
  download(`gymbro-entrenamientos-${localDay(new Date())}.csv`, new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }))
}

export function exportMeasurementsCsv(list: BodyMeasurement[]) {
  const keys = ['measured_on', 'weight_kg', 'height_cm', 'waist_cm', 'chest_cm', 'hips_cm', 'arm_left_cm', 'arm_right_cm', 'forearm_left_cm',
    'forearm_right_cm', 'thigh_left_cm', 'thigh_right_cm', 'calf_left_cm', 'calf_right_cm', 'body_fat_pct', 'method', 'notes'] as const
  const rows: unknown[][] = [[...keys], ...list.map((m) => keys.map((k) => m[k]))]
  download(`gymbro-medidas-${localDay(new Date())}.csv`, new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }))
}

export function downloadJson(name: string, data: unknown) {
  download(name, new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
}

/** Reporte PDF mensual. Separa datos registrados de cálculos derivados. */
export async function exportMonthlyPdf(opts: {
  month: Date; name: string; unit: WeightUnit; sessions: WorkoutSession[]; records: PersonalRecord[]; measurements: BodyMeasurement[]
}) {
  const { jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  const { month, unit } = opts
  const key = format(month, 'yyyy-MM')
  const sessions = opts.sessions.filter((s) => s.status === 'completed' && format(parseISO(s.started_at), 'yyyy-MM') === key)
  const records = opts.records.filter((r) => format(parseISO(r.achieved_at), 'yyyy-MM') === key)
  const measures = opts.measurements.filter((m) => m.measured_on.startsWith(key))
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const green: [number, number, number] = [101, 163, 13]
  const W = doc.internal.pageSize.getWidth()
  const conv = (kg: number) => Math.round(kgTo(kg, unit))

  doc.setFillColor(10, 10, 10); doc.rect(0, 0, W, 70, 'F')
  doc.setTextColor(163, 255, 18); doc.setFontSize(20); doc.text('GYM BRO', 40, 42)
  doc.setTextColor(255); doc.setFontSize(11)
  doc.text(`Reporte mensual · ${format(month, 'MMMM yyyy', { locale: es })} · ${opts.name}`, 150, 42)
  doc.setTextColor(0)

  const totals = sessions.reduce((a, s) => { const st = sessionStats(s); a.v += st.volume; a.d += st.durationSec ?? 0; a.sets += st.workingSets; return a }, { v: 0, d: 0, sets: 0 })
  autoTable(doc, {
    startY: 90, head: [['Resumen (cálculos derivados de los registros)', 'Valor']], theme: 'grid', headStyles: { fillColor: green },
    body: [
      ['Entrenamientos completados', String(sessions.length)],
      ['Tiempo total entrenado', `${Math.round(totals.d / 60)} min`],
      ['Series de trabajo', String(totals.sets)],
      [`Volumen total (Σ peso × reps, sin calentamiento)`, `${conv(totals.v).toLocaleString('es')} ${unit}`],
      ['Récords superados', String(records.filter((r) => r.previous_value !== null).length)],
    ],
  })

  // Gráfica: volumen por semana.
  const weekly = [...groupByPeriod(sessions, 'week').entries()]
  let y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 30
  doc.setFontSize(12); doc.text(`Volumen por semana (${unit}) — calculado`, 40, y)
  y += 10
  const chartH = 120, chartW = W - 80
  const max = Math.max(1, ...weekly.map(([, v]) => v.volume))
  doc.setDrawColor(200); doc.line(40, y + chartH, 40 + chartW, y + chartH)
  const bw = weekly.length ? Math.min(60, chartW / weekly.length - 10) : 0
  weekly.forEach(([wk, v], i) => {
    const h = (v.volume / max) * (chartH - 15)
    const x = 50 + i * (bw + 10)
    doc.setFillColor(...green); doc.rect(x, y + chartH - h, bw, h, 'F')
    doc.setFontSize(8); doc.text(format(parseISO(wk), 'd MMM', { locale: es }), x, y + chartH + 12)
    doc.text(conv(v.volume).toLocaleString('es'), x, y + chartH - h - 3)
  })
  if (!weekly.length) { doc.setFontSize(10); doc.text('Sin entrenamientos en el mes.', 50, y + 60) }
  y += chartH + 30

  autoTable(doc, {
    startY: y, head: [['Fecha', 'Sesión (registrado)', 'Duración', 'Series', `Volumen (${unit}) calc.`]], headStyles: { fillColor: green },
    body: sessions.slice().reverse().map((s) => { const st = sessionStats(s); return [
      format(parseISO(s.started_at), 'dd/MM HH:mm'), s.name, st.durationSec ? `${Math.round(st.durationSec / 60)} min` : '—', String(st.workingSets), conv(st.volume).toLocaleString('es'),
    ] }),
  })
  autoTable(doc, {
    head: [['Récords del mes', 'Tipo', 'Valor', 'Anterior']], headStyles: { fillColor: green },
    body: records.map((r) => [r.exercise?.name ?? '', PR_LABELS[r.record_type],
      r.record_type === 'max_reps_at_weight' ? `${r.value} reps` : `${conv(r.value)} ${unit}`,
      r.previous_value === null ? 'Primera marca' : r.record_type === 'max_reps_at_weight' ? `${r.previous_value} reps` : `${conv(r.previous_value)} ${unit}`]),
  })
  if (measures.length) {
    autoTable(doc, {
      head: [['Fecha', `Peso (${unit})`, 'Cintura (cm)', 'Pecho (cm)', '% grasa']], headStyles: { fillColor: green },
      body: measures.map((m) => [m.measured_on, m.weight_kg ? (Math.round(kgTo(m.weight_kg, unit) * 10) / 10).toString() : '—', m.waist_cm ?? '—', m.chest_cm ?? '—', m.body_fat_pct ?? '—']),
    })
  }
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFontSize(8); doc.setTextColor(120)
    doc.text('Datos registrados por el usuario. Volúmenes, totales y 1RM son cálculos derivados; el 1RM (Epley) es una estimación.', 40, doc.internal.pageSize.getHeight() - 20)
  }
  doc.save(`gymbro-reporte-${key}.pdf`)
}
