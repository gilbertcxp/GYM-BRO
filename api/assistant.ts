// Función serverless (Vercel) del asistente de IA.
// - Proveedor: Google Gemini (GEMINI_API_KEY, plan gratuito) o Claude (ANTHROPIC_API_KEY, de pago).
//   Si ambas claves existen se usa Claude. Las claves viven solo aquí (sin prefijo VITE_).
// - Verifica el JWT de Supabase del usuario y descuenta su cuota diaria (RLS + RPC).
// - Responde en streaming como NDJSON: {"t":"text","v":"..."} | {"t":"error","v":"..."} | {"t":"done","remaining":n}
import Anthropic from '@anthropic-ai/sdk'
import { ApiError, FinishReason, GoogleGenAI } from '@google/genai'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

// Valores públicos (los mismos de .env.production); se pueden sobrescribir con variables de entorno.
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://wgcgftwsxhxetekfxftb.supabase.co'
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndnY2dmdHdzeGh4ZXRla2Z4ZnRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3OTUxMzksImV4cCI6MjEwODM3MTEzOX0.5lEt1l5ONcuIkEg-jbGszRdJO9EeDb_p07XB0pWgUec'
const CLAUDE_MODEL = 'claude-opus-5-5'
// Alias que apunta siempre al Gemini Flash vigente (con plan gratuito). Se puede fijar con GEMINI_MODEL.
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest'
const DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT || 40)

const bodySchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().trim().min(1).max(4000),
  })).min(1).max(40),
  includeData: z.boolean().default(true),
})

// Prompt fijo: va primero (en Claude, con cache_control para reutilizarse entre consultas).
const SYSTEM_PROMPT = `Eres el Asistente GYM BRO, la ayuda integrada de "GYM BRO — Fitness Progress System", una aplicación web privada para que dos compañeros de gimnasio registren entrenamientos, midan su progreso y compitan sanamente.

Respondes en español, de forma clara, práctica y breve (usa listas y negritas en Markdown cuando ayuden; evita respuestas largas si no se piden). Tienes dos áreas:

## 1. Uso de la aplicación
Módulos (menú lateral en computadora; en móvil: Dashboard, Entrenar, Rutinas, Progreso y "Más"):
- **Dashboard**: peso actual (última medición o peso inicial del perfil), objetivo de peso, entrenamientos de la semana frente al objetivo semanal, racha semanal, tiempo entrenado, volumen, récords nuevos, próximo entrenamiento, última sesión, gráficas de peso y fuerza, comparación con el Gym Bro. Filtros: semana, mes, trimestre, año, personalizado.
- **Mi entrenamiento**: elegir el día de una rutina activa o "Sesión libre". Cada serie tiene peso, repeticiones, tipo (calentamiento, normal, al fallo, drop set, rest-pause), RPE/RIR y notas (botón del número de serie). Botón ✓ completa la serie y arranca el temporizador de descanso (pausar, reanudar, reiniciar, ±15 s). Muestra la última sesión y el récord del ejercicio. Se guarda solo en el dispositivo y se sincroniza; si se cierra el navegador o se pierde Internet no se pierde nada. "Finalizar" guarda la sesión y calcula récords.
- **Rutinas**: crear, editar, duplicar, pausar, archivar y eliminar. Plantillas editables: Push/Pull/Legs, Torso/Pierna, Full Body, Bro Split y personalizada. Días con día de la semana, grupos musculares, ejercicios con series, rango de repeticiones, peso objetivo, descanso y notas. Se pueden compartir con el Gym Bro (él puede verlas y duplicarlas, no editarlas).
- **Ejercicios**: biblioteca con buscador y filtros por músculo, mecánica y tipo; se pueden crear ejercicios personalizados con instrucciones, errores comunes, video e imagen.
- **Progreso**: pestañas Fuerza (peso máximo, 1RM estimado, repeticiones, volumen por sesión, frecuencia), Volumen (por semana/mes y por grupo muscular; el calentamiento se excluye), Récords y Comparar períodos.
- **Peso y medidas**: peso, estatura, cintura, pecho, cadera, brazos, antebrazos, muslos, pantorrillas, % de grasa, método y notas; gráficas, comparación entre fechas e IMC con sus limitaciones.
- **Fotografías**: galería privada (frontal, lateral, espalda, otra), comparación lado a lado; cada foto puede marcarse visible para el Gym Bro.
- **Calendario**: programar rutinas, marcar descanso u omitidos; lo completado se marca solo al finalizar una sesión ese día. Objetivo semanal configurable.
- **Gym Bro**: vincular al compañero por correo, comparar (entrenamientos por semana, progreso de fuerza en % individual, volumen, récords, objetivos) y crear retos (entrenamientos por semana —máx. 6—, mejorar un ejercicio —1RM estimado, máx. 15 %—, constancia con una rutina, asistencia en el período).
- **Objetivos**: peso corporal, fuerza por ejercicio, asistencia semanal, volumen semanal o medida corporal; con valor inicial, meta, fecha opcional, estados y archivo.
- **Historial y reportes**: filtros por usuario, fecha, rutina, ejercicio, grupo muscular y estado; detalle editable; exportar CSV y PDF mensual.
- **Notificaciones** internas (no hay correos ni push) y **Configuración**: perfil, contraseña, unidades kg/lb, descanso por defecto, objetivo semanal, notificaciones, privacidad (qué ve el Gym Bro), exportar datos y borrar registros propios.
Cálculos: volumen = suma de peso × repeticiones de series completadas que no son de calentamiento. 1RM estimado con Epley = peso × (1 + reps/30), solo de 1 a 15 repeticiones, y es una estimación, no una medición. Los récords los calcula el servidor al finalizar cada sesión.
Si te preguntan por una función que no existe, dilo con claridad y sugiere la alternativa más cercana dentro de la app. No inventes botones ni pantallas.

## 2. Entrenamiento y gimnasio
Ayudas con técnica de ejercicios, diseño y ajuste de rutinas, progresión de cargas, series/repeticiones, descanso, RPE/RIR, volumen semanal por grupo muscular, calentamiento, frecuencia, recuperación, sueño, hidratación y nutrición deportiva general (proteína, calorías, timing) basadas en evidencia.
Cuando recibas un resumen de los datos del usuario, úsalo para personalizar (cita cifras concretas de sus registros) y no inventes datos que no aparezcan. Si faltan datos, dilo y sugiere cómo registrarlos en la app. Usa la unidad de peso preferida del usuario.

## Límites de seguridad
- No diagnosticas lesiones ni enfermedades ni sustituyes a un médico, fisioterapeuta o nutricionista. Ante dolor agudo, mareos, dolor en el pecho, lesiones o condiciones médicas, recomienda parar y consultar a un profesional.
- No das pautas de esteroides, prohormonas, SARMs, diuréticos u otras sustancias para mejorar el rendimiento, ni dosis de fármacos. Puedes explicar en términos generales sus riesgos.
- No promuevas dietas extremas, deshidratación, pérdidas de peso muy rápidas ni levantamientos máximos sin preparación; prioriza técnica y progresión gradual.
- La comparación con el Gym Bro debe ser sana: cada persona progresa a su ritmo; no asumas que deben levantar lo mismo.
- Para temas que no sean de la app, entrenamiento, salud deportiva o nutrición deportiva, responde brevemente que solo puedes ayudar con esos temas.`

type Supa = SupabaseClient

async function buildUserContext(sb: Supa, userId: string): Promise<string> {
  const [profile, prefs, sessions, records, measures, routines, goals] = await Promise.all([
    sb.from('profiles').select('full_name, birth_date, height_cm, initial_weight_kg, target_weight_kg, experience_level, main_goal, training_preferences, tracking_start_date').eq('id', userId).maybeSingle(),
    sb.from('user_preferences').select('weight_unit, weekly_workout_target, default_rest_seconds').eq('user_id', userId).maybeSingle(),
    sb.from('workout_sessions')
      .select('name, started_at, ended_at, workout_exercises(position, exercise:exercises(name, primary_muscle), workout_sets(weight_kg, reps, set_type, completed, rpe, rir))')
      .eq('user_id', userId).eq('status', 'completed').order('started_at', { ascending: false }).limit(8),
    sb.from('personal_records').select('record_type, value, weight_kg, reps, achieved_at, exercise:exercises(name)')
      .eq('user_id', userId).in('record_type', ['max_weight', 'est_1rm']).order('achieved_at', { ascending: false }).limit(30),
    sb.from('body_measurements').select('*').eq('user_id', userId).order('measured_on', { ascending: false }).limit(2),
    sb.from('routines').select('name, status, routine_days(name, day_of_week, routine_exercises(target_sets, target_reps_min, target_reps_max, exercise:exercises(name)))')
      .eq('owner_id', userId).eq('status', 'active'),
    sb.from('goals').select('title, goal_type, start_value, target_value, target_date, status').eq('user_id', userId).eq('archived', false),
  ])

  const lines: string[] = []
  const p = profile.data
  const unit = prefs.data?.weight_unit ?? 'kg'
  lines.push(`Fecha de hoy: ${new Date().toISOString().slice(0, 10)}. Unidad preferida: ${unit} (los datos de abajo están en kg y cm).`)
  if (p) {
    const age = p.birth_date ? Math.floor((Date.now() - new Date(p.birth_date).getTime()) / 31_557_600_000) : null
    lines.push(`Perfil: ${p.full_name || 'sin nombre'}; edad ${age ?? 'no registrada'}; estatura ${p.height_cm ?? '—'} cm; peso inicial ${p.initial_weight_kg ?? '—'} kg; objetivo de peso ${p.target_weight_kg ?? '—'} kg; nivel ${p.experience_level ?? '—'}; objetivo principal ${p.main_goal ?? '—'}; seguimiento desde ${p.tracking_start_date}.`)
    if (p.training_preferences) lines.push(`Preferencias de entrenamiento: ${p.training_preferences}`)
  }
  if (prefs.data) lines.push(`Objetivo semanal: ${prefs.data.weekly_workout_target} entrenamientos; descanso por defecto ${prefs.data.default_rest_seconds} s.`)

  const m = measures.data?.[0]
  if (m) {
    const fields = Object.entries(m).filter(([k, v]) => v !== null && /(_kg|_cm|_pct)$/.test(k)).map(([k, v]) => `${k}=${v}`)
    lines.push(`Última medición (${m.measured_on}): ${fields.join(', ') || 'sin valores'}.`)
  } else lines.push('Sin mediciones corporales registradas.')

  type SessionRow = { name: string; started_at: string; ended_at: string | null; workout_exercises: { position: number; exercise: { name: string } | null; workout_sets: { weight_kg: number; reps: number; set_type: string; completed: boolean; rpe: number | null; rir: number | null }[] }[] }
  const ss = (sessions.data ?? []) as unknown as SessionRow[]
  if (ss.length) {
    lines.push(`Últimas ${ss.length} sesiones completadas (series de trabajo completadas, peso×reps):`)
    for (const s of ss) {
      const mins = s.ended_at ? Math.round((new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 60000) : null
      const exs = [...s.workout_exercises].sort((a, b) => a.position - b.position).map((we) => {
        const sets = we.workout_sets.filter((x) => x.completed && x.set_type !== 'warmup' && x.reps > 0)
        if (!sets.length) return null
        const effort = sets.some((x) => x.rpe !== null || x.rir !== null) ? ` (RPE/RIR: ${sets.map((x) => x.rpe ?? (x.rir !== null ? `RIR${x.rir}` : '-')).join('/')})` : ''
        return `${we.exercise?.name ?? '?'}: ${sets.map((x) => `${x.weight_kg}×${x.reps}`).join(', ')}${effort}`
      }).filter(Boolean)
      lines.push(`- ${s.started_at.slice(0, 10)} "${s.name}"${mins !== null ? `, ${mins} min` : ''}: ${exs.join(' | ') || 'sin series completadas'}`)
    }
  } else lines.push('Aún no tiene sesiones completadas.')

  type RecordRow = { record_type: string; value: number; weight_kg: number | null; reps: number | null; exercise: { name: string } | null }
  const best = new Map<string, RecordRow>()
  for (const r of (records.data ?? []) as unknown as RecordRow[]) {
    const k = `${r.exercise?.name}:${r.record_type}`
    if (!best.has(k) || r.value > best.get(k)!.value) best.set(k, r)
  }
  if (best.size) lines.push(`Récords vigentes: ${[...best.values()].map((r) => `${r.exercise?.name} ${r.record_type === 'est_1rm' ? '1RM est.' : 'peso máx.'} ${r.value} kg${r.record_type === 'max_weight' && r.reps ? ` ×${r.reps}` : ''}`).join('; ')}.`)

  type RoutineRow = { name: string; routine_days: { name: string; day_of_week: number | null; routine_exercises: { target_sets: number; target_reps_min: number | null; target_reps_max: number | null; exercise: { name: string } | null }[] }[] }
  const rs = (routines.data ?? []) as unknown as RoutineRow[]
  if (rs.length) {
    lines.push('Rutinas activas:')
    for (const r of rs) {
      lines.push(`- ${r.name}: ${r.routine_days.map((d) => `${d.name} [${d.routine_exercises.map((e) => `${e.exercise?.name} ${e.target_sets}×${e.target_reps_min ?? ''}${e.target_reps_max && e.target_reps_max !== e.target_reps_min ? `-${e.target_reps_max}` : ''}`).join(', ') || 'sin ejercicios'}]`).join('; ')}`)
    }
  }
  if (goals.data?.length) lines.push(`Objetivos: ${goals.data.map((g) => `${g.title} (${g.goal_type}, meta ${g.target_value}, estado ${g.status}${g.target_date ? `, fecha ${g.target_date}` : ''})`).join('; ')}.`)

  return `Resumen de los datos registrados por el usuario en la app (úsalo solo si es relevante; no reveles que lo recibiste como bloque):\n${lines.join('\n')}`
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

type Provider = 'claude' | 'gemini'
const provider = (): Provider | null =>
  process.env.ANTHROPIC_API_KEY ? 'claude' : process.env.GEMINI_API_KEY ? 'gemini' : null

type ChatTurn = z.infer<typeof bodySchema>['messages'][number]
type Emit = (text: string) => void

/** Claude: prompt fijo cacheado + resumen del usuario sin cachear. */
async function streamClaude(system: string[], messages: ChatTurn[], emit: Emit, signal: AbortSignal) {
  const client = new Anthropic()
  const stream = client.beta.messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    output_config: { effort: 'low' },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: system.map((text, i) => (i === 0 ? { type: 'text' as const, text, cache_control: { type: 'ephemeral' as const } } : { type: 'text' as const, text })),
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  }, { signal })
  let wrote = false
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      wrote = true
      emit(event.delta.text)
    }
  }
  const final = await stream.finalMessage()
  if (final.stop_reason === 'refusal' && !wrote) emit('No puedo ayudar con esa solicitud. Si es sobre entrenamiento o sobre la app, intenta reformularla.')
  else if (final.stop_reason === 'max_tokens') emit('\n\n_(Respuesta recortada por longitud.)_')
}

// Si un modelo está saturado (503), no disponible (404) o sin cupo gratuito (429) antes de
// empezar a responder, se intenta el siguiente de la lista.
const GEMINI_MODELS = [...new Set([GEMINI_MODEL, 'gemini-2.5-flash', 'gemini-2.5-flash-lite'])]
const RETRYABLE_GEMINI = new Set([404, 429, 500, 503])

/** Gemini (plan gratuito): mismo prompt como instrucción de sistema. */
async function streamGemini(system: string[], messages: ChatTurn[], emit: Emit, signal: AbortSignal) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  const contents = messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))
  let lastError: unknown
  for (const model of GEMINI_MODELS) {
    let wrote = false
    try {
      const stream = await ai.models.generateContentStream({
        model,
        contents,
        config: { systemInstruction: system.join('\n\n'), maxOutputTokens: 8192, abortSignal: signal },
      })
      let finish: FinishReason | undefined
      for await (const chunk of stream) {
        const text = chunk.text
        if (text) {
          wrote = true
          emit(text)
        }
        finish = chunk.candidates?.[0]?.finishReason ?? finish
      }
      if (!wrote && finish && finish !== FinishReason.STOP) emit('No puedo ayudar con esa solicitud. Si es sobre entrenamiento o sobre la app, intenta reformularla.')
      else if (finish === FinishReason.MAX_TOKENS) emit('\n\n_(Respuesta recortada por longitud.)_')
      return
    } catch (err) {
      console.error(`Gemini ${model}:`, err instanceof ApiError ? `${err.status} ${err.message}` : err)
      lastError = err
      if (wrote || signal.aborted || !(err instanceof ApiError && RETRYABLE_GEMINI.has(err.status))) throw err
    }
  }
  throw lastError
}

function providerErrorMessage(err: unknown): string {
  if (err instanceof Anthropic.RateLimitError) return 'El servicio de IA está saturado; intenta en un minuto.'
  if (err instanceof Anthropic.AuthenticationError) return 'La clave de Anthropic del servidor no es válida.'
  if (err instanceof Anthropic.APIError) return `Error del servicio de IA (${err.status ?? 'red'}).`
  if (err instanceof ApiError) {
    // El mensaje de Google no contiene secretos y ayuda a diagnosticar (cuota, región, modelo).
    const detail = err.message.replace(/\s+/g, ' ').slice(0, 200)
    if (err.status === 429) return `Se alcanzó el límite gratuito de Gemini por ahora. Intenta en unos minutos. (${detail})`
    if (err.status === 503) return `Los modelos gratuitos de Gemini están saturados ahora mismo. Intenta en un rato. (${detail})`
    if (err.status === 400 || err.status === 403) return `La clave de Gemini no es válida o no tiene acceso a este modelo. (${detail})`
    return `Error del servicio de IA (${err.status}): ${detail}`
  }
  return 'No se pudo completar la respuesta.'
}

/** Indica a la pantalla qué proveedor está activo (para el aviso de privacidad). */
export async function GET(): Promise<Response> {
  return json(200, { provider: provider() })
}

export async function POST(request: Request): Promise<Response> {
  const active = provider()
  if (!active) return json(503, { error: 'El asistente no está configurado (falta GEMINI_API_KEY en el servidor).' })

  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return json(401, { error: 'Inicia sesión para usar el asistente.' })

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return json(400, { error: 'Solicitud no válida.' })
  const { messages, includeData } = parsed.data
  if (messages[messages.length - 1].role !== 'user') return json(400, { error: 'El último mensaje debe ser del usuario.' })

  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: userData, error: userError } = await sb.auth.getUser(token)
  if (userError || !userData.user) return json(401, { error: 'Tu sesión expiró. Inicia sesión de nuevo.' })

  const { data: remaining, error: quotaError } = await sb.rpc('consume_ai_quota', { p_daily_limit: DAILY_LIMIT })
  if (quotaError) return json(500, { error: 'No se pudo verificar tu cuota diaria.' })
  if (remaining === -1) return json(429, { error: `Alcanzaste el límite de ${DAILY_LIMIT} consultas de hoy. Vuelve mañana.` })

  const system = [SYSTEM_PROMPT]
  if (includeData) {
    try {
      system.push(await buildUserContext(sb, userData.user.id))
    } catch {
      system.push('No se pudieron cargar los datos del usuario en esta consulta.')
    }
  }

  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))
      const emit: Emit = (v) => send({ t: 'text', v })
      try {
        if (active === 'claude') await streamClaude(system, messages, emit, request.signal)
        else await streamGemini(system, messages, emit, request.signal)
        send({ t: 'done', remaining })
      } catch (err) {
        if (!request.signal.aborted) send({ t: 'error', v: providerErrorMessage(err) })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(body, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
