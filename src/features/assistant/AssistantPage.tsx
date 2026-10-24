import { ArrowUp, Bot, RotateCcw, Sparkles, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import { Button, ConfirmDialog, PageHeader, Switch, Textarea } from '@/components/ui'
import { useUserId } from '@/features/auth/AuthProvider'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

interface ChatMessage { role: 'user' | 'assistant'; content: string; error?: boolean }

const SUGGESTIONS = [
  '¿Cómo registro mi primer entrenamiento?',
  'Analiza mis últimas sesiones y dime qué mejorar',
  '¿Cómo progreso en press de banca si estoy estancado?',
  '¿Cuántas series por semana necesito para hipertrofia?',
  '¿Cómo creo un reto con mi Gym Bro?',
  '¿Cuánta proteína debería comer al día?',
]
const MAX_HISTORY = 20 // mensajes enviados al servidor por consulta

const storageKey = (uid: string) => `gymbro.assistant.${uid}`
function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}
function save(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* almacenamiento no disponible */ }
}

const md: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
  strong: ({ children }) => <strong className="font-semibold text-text">{children}</strong>,
  h1: ({ children }) => <p className="mb-2 font-bold">{children}</p>,
  h2: ({ children }) => <p className="mb-2 font-bold">{children}</p>,
  h3: ({ children }) => <p className="mb-1 font-semibold">{children}</p>,
  code: ({ children }) => <code className="rounded bg-surface-3 px-1 py-0.5 font-mono text-[0.85em]">{children}</code>,
  a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline">{children}</a>,
  table: ({ children }) => <div className="mb-2 overflow-x-auto"><table className="w-full text-sm">{children}</table></div>,
  th: ({ children }) => <th className="border-b border-border px-2 py-1 text-left">{children}</th>,
  td: ({ children }) => <td className="border-b border-border px-2 py-1">{children}</td>,
}

export default function AssistantPage() {
  const uid = useUserId()
  const [messages, setMessages] = useState<ChatMessage[]>(() => load(storageKey(uid), []))
  const [includeData, setIncludeData] = useState<boolean>(() => load('gymbro.assistant.includeData', true))
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => { save(storageKey(uid), messages.slice(-60)) }, [messages, uid])
  useEffect(() => { save('gymbro.assistant.includeData', includeData) }, [includeData])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages])
  useEffect(() => () => abortRef.current?.abort(), [])

  const appendToLast = (text: string, error = false) =>
    setMessages((prev) => {
      const next = [...prev]
      const last = next[next.length - 1]
      next[next.length - 1] = { ...last, content: last.content + text, error: error || last.error }
      return next
    })

  async function send(text: string) {
    const question = text.trim()
    if (!question || busy) return
    const history = [...messages.filter((m) => !m.error && m.content), { role: 'user' as const, content: question }]
    setMessages([...messages, { role: 'user', content: question }, { role: 'assistant', content: '' }])
    setInput('')
    setBusy(true)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const { data } = await supabase.auth.getSession()
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}` },
        body: JSON.stringify({ messages: history.slice(-MAX_HISTORY).map(({ role, content }) => ({ role, content: content.slice(0, 4000) })), includeData }),
        signal: controller.signal,
      })
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: `Error ${res.status}` }))
        appendToLast(err.error ?? 'No se pudo contactar al asistente.', true)
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          const evt = JSON.parse(line) as { t: 'text' | 'error' | 'done'; v?: string; remaining?: number }
          if (evt.t === 'text' && evt.v) appendToLast(evt.v)
          else if (evt.t === 'error') appendToLast(`\n\n${evt.v}`, true)
          else if (evt.t === 'done' && typeof evt.remaining === 'number') setRemaining(evt.remaining)
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') appendToLast(navigator.onLine ? 'No se pudo completar la respuesta.' : 'Sin conexión. El asistente necesita Internet.', true)
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  return (
    <div className="flex h-[calc(100dvh-11rem)] flex-col animate-fade-up lg:h-[calc(100dvh-5rem)]">
      <PageHeader title="Ayuda IA" subtitle="Pregunta sobre la app o sobre entrenamiento. Las respuestas son orientativas y no sustituyen a un profesional."
        actions={messages.length > 0 && <Button variant="ghost" onClick={() => setConfirmReset(true)} disabled={busy}><RotateCcw className="h-4 w-4" /> Nueva conversación</Button>} />

      <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-border bg-surface p-3 sm:p-5" aria-live="polite">
        {!messages.length ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/15 text-accent"><Sparkles className="h-7 w-7" /></span>
            <p className="font-bold">Asistente GYM BRO</p>
            <p className="mt-1 max-w-md text-sm text-muted">Te explico cómo usar cada módulo y te ayudo con técnica, rutinas, progresión y nutrición deportiva{includeData ? ', usando tus registros reales' : ''}.</p>
            <div className="mt-5 flex max-w-2xl flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => void send(s)} className="rounded-full border border-border px-3 py-1.5 text-sm text-muted transition hover:border-accent/50 hover:text-text">{s}</button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((m, i) => (
              <div key={i} className={cn('flex gap-2', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                {m.role === 'assistant' && <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent"><Bot className="h-4 w-4" /></span>}
                <div className={cn('max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                  m.role === 'user' ? 'bg-accent text-accent-fg' : m.error ? 'bg-danger/10 text-danger' : 'bg-surface-2 text-text/90')}>
                  {m.role === 'user' ? <p className="whitespace-pre-wrap">{m.content}</p>
                    : m.content ? <ReactMarkdown components={md}>{m.content}</ReactMarkdown>
                    : <span className="inline-flex gap-1" aria-label="Escribiendo"><span className="h-2 w-2 animate-bounce rounded-full bg-muted" /><span className="h-2 w-2 animate-bounce rounded-full bg-muted [animation-delay:150ms]" /><span className="h-2 w-2 animate-bounce rounded-full bg-muted [animation-delay:300ms]" /></span>}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>
        )}
      </div>

      <form className="mt-3" onSubmit={(e) => { e.preventDefault(); void send(input) }}>
        <div className="flex items-end gap-2">
          <Textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder="Escribe tu pregunta…" rows={1} maxLength={4000}
            className="max-h-40 min-h-12 flex-1 resize-none py-3" aria-label="Pregunta para el asistente"
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(input) } }} />
          {busy
            ? <Button size="lg" variant="secondary" className="h-12 w-12 p-0" aria-label="Detener respuesta" onClick={() => abortRef.current?.abort()}><Square className="h-4 w-4" /></Button>
            : <Button size="lg" type="submit" className="h-12 w-12 p-0" aria-label="Enviar" disabled={!input.trim()}><ArrowUp className="h-5 w-5" /></Button>}
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <div className="-my-2"><Switch checked={includeData} onChange={setIncludeData} label="Usar mis datos de entrenamiento"
            description="Envía al asistente un resumen de tus sesiones, récords, medidas y rutinas para personalizar la respuesta." /></div>
          {remaining !== null && <span className="text-xs text-muted">{remaining} consultas restantes hoy</span>}
        </div>
      </form>

      <ConfirmDialog open={confirmReset} onOpenChange={setConfirmReset} title="¿Nueva conversación?" description="Se borrará el historial de este chat en este dispositivo."
        confirmLabel="Borrar y empezar" onConfirm={() => { setMessages([]); setConfirmReset(false) }} />
    </div>
  )
}
