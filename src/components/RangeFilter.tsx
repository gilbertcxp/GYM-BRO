import { format, parseISO } from 'date-fns'
import { useMemo, useState } from 'react'
import { presetRange, RANGE_LABELS, type DateRange, type RangePreset } from '@/lib/dates'
import { Input, Tabs } from './ui'

export function useRange(initial: Exclude<RangePreset, 'custom'> = 'month') {
  const [preset, setPreset] = useState<RangePreset>(initial)
  const [custom, setCustom] = useState<{ from: string; to: string }>(() => {
    const r = presetRange('month')
    return { from: format(r.from, 'yyyy-MM-dd'), to: format(r.to, 'yyyy-MM-dd') }
  })
  const range: DateRange = useMemo(() => {
    if (preset !== 'custom') return presetRange(preset)
    const from = parseISO(custom.from)
    const to = parseISO(custom.to)
    return from <= to ? { from, to } : { from: to, to: from }
  }, [preset, custom])
  return { preset, setPreset, custom, setCustom, range }
}

export function RangeFilter({ state }: { state: ReturnType<typeof useRange> }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Tabs value={state.preset} onChange={state.setPreset}
        options={(Object.keys(RANGE_LABELS) as RangePreset[]).map((k) => ({ value: k, label: RANGE_LABELS[k] }))} />
      {state.preset === 'custom' && (
        <div className="flex items-center gap-2">
          <Input type="date" className="h-9 w-40 text-sm" aria-label="Desde" value={state.custom.from}
            onChange={(e) => e.target.value && state.setCustom({ ...state.custom, from: e.target.value })} />
          <span className="text-muted">—</span>
          <Input type="date" className="h-9 w-40 text-sm" aria-label="Hasta" value={state.custom.to}
            onChange={(e) => e.target.value && state.setCustom({ ...state.custom, to: e.target.value })} />
        </div>
      )}
    </div>
  )
}
