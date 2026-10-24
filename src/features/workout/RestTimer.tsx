import { Minus, Pause, Play, Plus, RotateCcw, X } from 'lucide-react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { Button } from '@/components/ui'
import { cn, formatClock } from '@/lib/utils'

// Temporizador de descanso persistente: guarda la hora de fin, así sobrevive a recargas.
interface TimerState { endsAt: number | null; pausedRemaining: number | null; duration: number }
const KEY = 'gymbro.restTimer'
let timer: TimerState = load()
const subs = new Set<() => void>()

function load(): TimerState {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as TimerState
  } catch { /* ignorar */ }
  return { endsAt: null, pausedRemaining: null, duration: 90 }
}
function set(next: TimerState) {
  timer = next
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* ignorar */ }
  subs.forEach((s) => s())
}

export const restTimer = {
  start(seconds: number) { set({ endsAt: Date.now() + seconds * 1000, pausedRemaining: null, duration: seconds }) },
  pause() {
    if (!timer.endsAt) return
    set({ ...timer, endsAt: null, pausedRemaining: Math.max(0, timer.endsAt - Date.now()) })
  },
  resume() {
    if (timer.pausedRemaining === null) return
    set({ ...timer, endsAt: Date.now() + timer.pausedRemaining, pausedRemaining: null })
  },
  reset() { set({ ...timer, endsAt: Date.now() + timer.duration * 1000, pausedRemaining: null }) },
  add(seconds: number) {
    if (timer.endsAt) set({ ...timer, endsAt: Math.max(Date.now(), timer.endsAt + seconds * 1000), duration: Math.max(5, timer.duration + seconds) })
    else if (timer.pausedRemaining !== null) set({ ...timer, pausedRemaining: Math.max(0, timer.pausedRemaining + seconds * 1000) })
  },
  stop() { set({ ...timer, endsAt: null, pausedRemaining: null }) },
}

function useTimer() {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb) }, () => timer)
}

export function RestTimerBar() {
  const t = useTimer()
  const [now, setNow] = useState(Date.now())
  const running = t.endsAt !== null
  const paused = t.pausedRemaining !== null
  useEffect(() => {
    if (!running) return
    const i = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(i)
  }, [running])

  const remainingMs = running ? Math.max(0, t.endsAt! - now) : t.pausedRemaining ?? 0
  const done = running && remainingMs === 0

  useEffect(() => {
    if (done) {
      try { navigator.vibrate?.([200, 100, 200]) } catch { /* sin vibración */ }
    }
  }, [done])

  if (!running && !paused) return null
  const pct = t.duration > 0 ? (remainingMs / (t.duration * 1000)) * 100 : 0

  return (
    <div className="fixed inset-x-0 bottom-[68px] z-30 px-3 lg:bottom-4 lg:left-64" role="timer" aria-live="polite">
      <div className={cn('mx-auto flex max-w-xl items-center gap-2 overflow-hidden rounded-2xl border bg-surface/95 p-2 shadow-2xl backdrop-blur', done ? 'border-accent' : 'border-border')}>
        <div className="relative min-w-0 flex-1 px-2">
          <p className="text-[11px] uppercase tracking-wide text-muted">{done ? '¡Descanso terminado!' : paused ? 'Descanso en pausa' : 'Descanso'}</p>
          <p className={cn('font-mono text-2xl font-bold tabular', done && 'text-accent')}>{formatClock(remainingMs / 1000)}</p>
          <div className="absolute bottom-0 left-2 right-2 h-0.5 rounded bg-surface-3"><div className="h-full rounded bg-accent" style={{ width: `${pct}%` }} /></div>
        </div>
        <Button variant="secondary" size="icon" aria-label="Restar 15 segundos" onClick={() => restTimer.add(-15)}><Minus className="h-4 w-4" /></Button>
        <Button variant="secondary" size="icon" aria-label="Sumar 15 segundos" onClick={() => restTimer.add(15)}><Plus className="h-4 w-4" /></Button>
        {paused
          ? <Button size="icon" aria-label="Reanudar" onClick={restTimer.resume}><Play className="h-4 w-4" /></Button>
          : <Button variant="secondary" size="icon" aria-label="Pausar" onClick={restTimer.pause} disabled={done}><Pause className="h-4 w-4" /></Button>}
        <Button variant="secondary" size="icon" aria-label="Reiniciar" onClick={restTimer.reset}><RotateCcw className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon" aria-label="Cerrar temporizador" onClick={restTimer.stop}><X className="h-4 w-4" /></Button>
      </div>
    </div>
  )
}
