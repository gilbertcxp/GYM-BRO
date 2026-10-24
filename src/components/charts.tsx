import type { ReactNode } from 'react'
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'

export const CHART_COLORS = ['var(--accent)', 'var(--info)', 'var(--warning)', '#c084fc', '#f472b6']

const axis = { stroke: 'var(--muted)', fontSize: 11, tickLine: false, axisLine: false }
const tooltipStyle = {
  contentStyle: { background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12, color: 'var(--text)' },
  labelStyle: { color: 'var(--muted)' },
  cursor: { stroke: 'var(--border)', fill: 'var(--surface-3)', fillOpacity: 0.4 },
}

export interface Series { key: string; label: string; color?: string; dashed?: boolean }

export function ChartBox({ children, height = 240, empty }: { children: ReactNode; height?: number; empty?: string | false }) {
  if (empty) return <div className="flex items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted" style={{ height }}>{empty}</div>
  return <div style={{ height }} className="w-full">{children}</div>
}

export function LineChartCard({ data, xKey, series, height, empty, yFormatter, connectNulls = true }: {
  data: Record<string, unknown>[]; xKey: string; series: Series[]; height?: number; empty?: string
  yFormatter?: (v: number) => string; connectNulls?: boolean
}) {
  return (
    <ChartBox height={height} empty={!data.length && (empty ?? 'Sin datos registrados en el período')}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey={xKey} {...axis} minTickGap={16} />
          <YAxis {...axis} domain={['auto', 'auto']} tickFormatter={yFormatter} width={52} />
          <Tooltip {...tooltipStyle} formatter={(v) => (yFormatter && typeof v === 'number' ? yFormatter(v) : String(v))} />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {series.map((s, i) => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color ?? CHART_COLORS[i]} strokeWidth={2.5}
              strokeDasharray={s.dashed ? '5 4' : undefined} dot={{ r: 3, strokeWidth: 0, fill: s.color ?? CHART_COLORS[i] }} activeDot={{ r: 5 }} connectNulls={connectNulls} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartBox>
  )
}

export function BarChartCard({ data, xKey, series, height, empty, yFormatter, stacked }: {
  data: Record<string, unknown>[]; xKey: string; series: Series[]; height?: number; empty?: string
  yFormatter?: (v: number) => string; stacked?: boolean
}) {
  return (
    <ChartBox height={height} empty={!data.length && (empty ?? 'Sin datos registrados en el período')}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey={xKey} {...axis} minTickGap={8} />
          <YAxis {...axis} tickFormatter={yFormatter} width={52} />
          <Tooltip {...tooltipStyle} formatter={(v) => (yFormatter && typeof v === 'number' ? yFormatter(v) : String(v))} />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color ?? CHART_COLORS[i]} radius={[6, 6, 0, 0]} stackId={stacked ? 'a' : undefined} maxBarSize={36} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartBox>
  )
}
