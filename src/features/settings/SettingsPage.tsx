import { Download, LogOut, Moon, Sun, Trash2, Upload } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Avatar } from '@/components/Avatar'
import { Button, Card, CardTitle, ConfirmDialog, Field, Input, LoadingBlock, PageHeader, Select, Switch, Tabs, Textarea } from '@/components/ui'
import { keys, unwrap, useMut, usePrefs, useProfile, useSessions, useMeasurements, useGoals, useRecords } from '@/data/queries'
import { useAuth, useUserId } from '@/features/auth/AuthProvider'
import { ageFrom } from '@/lib/calc'
import { todayKey } from '@/lib/dates'
import { errorMessage } from '@/lib/errors'
import { downloadJson, exportMeasurementsCsv, exportSessionsCsv } from '@/lib/exporters'
import { EXPERIENCE_LABELS, MAIN_GOAL_LABELS } from '@/lib/labels'
import { AVATAR_BUCKET, PHOTO_BUCKET, supabase } from '@/lib/supabase'
import { applyTheme, getTheme } from '@/lib/theme'
import type { ExperienceLevel, MainGoal, Profile, UserPreferences } from '@/lib/types'
import { kgTo, toKg } from '@/lib/units'
import { numOrNull, uuid } from '@/lib/utils'

export default function SettingsPage() {
  const [tab, setTab] = useState<'profile' | 'prefs' | 'privacy' | 'data'>('profile')
  return (
    <div className="animate-fade-up">
      <PageHeader title="Configuración" />
      <Tabs className="mb-5" value={tab} onChange={setTab} options={[
        { value: 'profile', label: 'Perfil' }, { value: 'prefs', label: 'Preferencias' }, { value: 'privacy', label: 'Privacidad' }, { value: 'data', label: 'Datos y cuenta' },
      ]} />
      {tab === 'profile' ? <ProfileTab /> : tab === 'prefs' ? <PrefsTab /> : tab === 'privacy' ? <PrivacyTab /> : <DataTab />}
    </div>
  )
}

function ProfileTab() {
  const me = useUserId()
  const { data: p, isLoading } = useProfile()
  const { data: prefs } = usePrefs()
  const unit = prefs?.weight_unit ?? 'kg'
  const [f, setF] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!p) return
    setF({
      full_name: p.full_name, birth_date: p.birth_date ?? '', height_cm: p.height_cm?.toString() ?? '',
      initial_weight: p.initial_weight_kg ? String(Math.round(kgTo(p.initial_weight_kg, unit) * 10) / 10) : '',
      target_weight: p.target_weight_kg ? String(Math.round(kgTo(p.target_weight_kg, unit) * 10) / 10) : '',
      tracking_start_date: p.tracking_start_date, experience_level: p.experience_level ?? '', main_goal: p.main_goal ?? '',
      training_preferences: p.training_preferences ?? '',
    })
  }, [p, unit])
  const kg = (s: string) => { const n = numOrNull(s); return n === null ? null : Math.round(toKg(n, unit) * 100) / 100 }
  const save = useMut(async () => {
    if (!f.full_name?.trim()) throw new Error('El nombre es obligatorio')
    const height = numOrNull(f.height_cm)
    if (height !== null && (height < 50 || height > 260)) throw new Error('Estatura fuera de rango (50-260 cm)')
    for (const w of [kg(f.initial_weight), kg(f.target_weight)]) if (w !== null && (w < 20 || w > 400)) throw new Error('Peso fuera de rango')
    const row: Partial<Profile> = {
      full_name: f.full_name.trim(), birth_date: f.birth_date || null, height_cm: height,
      initial_weight_kg: kg(f.initial_weight), target_weight_kg: kg(f.target_weight), tracking_start_date: f.tracking_start_date || todayKey(),
      experience_level: (f.experience_level || null) as ExperienceLevel | null, main_goal: (f.main_goal || null) as MainGoal | null,
      training_preferences: f.training_preferences.trim() || null,
    }
    return unwrap(supabase.from('profiles').update(row).eq('id', me))
  }, { invalidate: [keys.profile(me)], success: 'Perfil guardado' })

  const avatar = useMut(async (file: File) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Formato no permitido')
    if (file.size > 3 * 1024 * 1024) throw new Error('Máximo 3 MB')
    const path = `${me}/${uuid()}.${file.type.split('/')[1]}`
    const { error } = await supabase.storage.from(AVATAR_BUCKET).upload(path, file, { contentType: file.type })
    if (error) throw error
    if (p?.avatar_path) await supabase.storage.from(AVATAR_BUCKET).remove([p.avatar_path])
    return unwrap(supabase.from('profiles').update({ avatar_path: path }).eq('id', me))
  }, { invalidate: [keys.profile(me)], success: 'Foto actualizada' })

  if (isLoading || !p) return <LoadingBlock />
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const age = ageFrom(f.birth_date || null)

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="flex flex-col items-center gap-3 text-center">
        <Avatar path={p.avatar_path} name={p.full_name || p.email} size={96} />
        <p className="font-bold">{p.full_name || 'Sin nombre'}</p>
        <p className="text-sm text-muted">{p.email}</p>
        <label className="cursor-pointer">
          <span className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm hover:bg-surface-2"><Upload className="h-4 w-4" /> Cambiar foto</span>
          <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] && avatar.mutate(e.target.files[0])} />
        </label>
        <PasswordForm />
      </Card>
      <Card className="lg:col-span-2">
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined) }}>
          <Field label="Nombre" className="sm:col-span-2">{(id) => <Input id={id} value={f.full_name ?? ''} maxLength={80} onChange={set('full_name')} />}</Field>
          <Field label="Fecha de nacimiento" hint={age !== null ? `${age} años` : undefined}>{(id) => <Input id={id} type="date" value={f.birth_date ?? ''} max={todayKey()} onChange={set('birth_date')} />}</Field>
          <Field label="Estatura (cm)">{(id) => <Input id={id} type="number" step="0.1" value={f.height_cm ?? ''} onChange={set('height_cm')} />}</Field>
          <Field label={`Peso inicial (${unit})`} hint="El peso actual se toma de tu última medición">{(id) => <Input id={id} type="number" step="any" value={f.initial_weight ?? ''} onChange={set('initial_weight')} />}</Field>
          <Field label={`Objetivo de peso (${unit})`}>{(id) => <Input id={id} type="number" step="any" value={f.target_weight ?? ''} onChange={set('target_weight')} />}</Field>
          <Field label="Inicio del seguimiento">{(id) => <Input id={id} type="date" value={f.tracking_start_date ?? ''} onChange={set('tracking_start_date')} />}</Field>
          <Field label="Nivel de experiencia">{(id) => (
            <Select id={id} value={f.experience_level ?? ''} onChange={set('experience_level')}><option value="">—</option>{Object.entries(EXPERIENCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          )}</Field>
          <Field label="Objetivo principal" className="sm:col-span-2">{(id) => (
            <Select id={id} value={f.main_goal ?? ''} onChange={set('main_goal')}><option value="">—</option>{Object.entries(MAIN_GOAL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          )}</Field>
          <Field label="Preferencias de entrenamiento" className="sm:col-span-2">{(id) => <Textarea id={id} rows={3} maxLength={1000} value={f.training_preferences ?? ''} onChange={set('training_preferences')} placeholder="Horario, equipamiento disponible, lesiones a cuidar…" />}</Field>
          <div className="flex justify-end sm:col-span-2"><Button type="submit" loading={save.isPending}>Guardar perfil</Button></div>
        </form>
      </Card>
    </div>
  )
}

function PasswordForm() {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (pw.length < 8) return toast.error('Mínimo 8 caracteres')
    if (pw !== pw2) return toast.error('Las contraseñas no coinciden')
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (error) toast.error(errorMessage(error))
    else { toast.success('Contraseña actualizada'); setPw(''); setPw2('') }
  }
  return (
    <form className="mt-4 w-full space-y-2 border-t border-border pt-4 text-left" onSubmit={(e) => { e.preventDefault(); void submit() }}>
      <p className="text-sm font-semibold">Cambiar contraseña</p>
      <Input type="password" autoComplete="new-password" placeholder="Nueva contraseña" value={pw} onChange={(e) => setPw(e.target.value)} aria-label="Nueva contraseña" />
      <Input type="password" autoComplete="new-password" placeholder="Repetir" value={pw2} onChange={(e) => setPw2(e.target.value)} aria-label="Repetir contraseña" />
      <Button type="submit" variant="outline" className="w-full" loading={busy}>Actualizar</Button>
    </form>
  )
}

function usePrefsMutation() {
  const me = useUserId()
  return useMut(async (p: Partial<UserPreferences>) => unwrap(supabase.from('user_preferences').update(p).eq('user_id', me)), { invalidate: [keys.prefs(me)] })
}

function PrefsTab() {
  const { data: p, isLoading } = usePrefs()
  const m = usePrefsMutation()
  const [theme, setTheme] = useState(getTheme())
  if (isLoading || !p) return <LoadingBlock />
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardTitle>Entrenamiento</CardTitle>
        <div className="space-y-3">
          <Field label="Unidad de peso">{(id) => (
            <Select id={id} value={p.weight_unit} onChange={(e) => m.mutate({ weight_unit: e.target.value as 'kg' | 'lb' })}>
              <option value="kg">Kilogramos (kg)</option><option value="lb">Libras (lb)</option>
            </Select>
          )}</Field>
          <Field label="Descanso por defecto (segundos)">{(id) => <Input id={id} type="number" min={10} max={900} defaultValue={p.default_rest_seconds}
            onBlur={(e) => { const n = numOrNull(e.target.value); if (n !== null && n >= 10 && n <= 900) m.mutate({ default_rest_seconds: Math.round(n) }) }} />}</Field>
          <Field label="Objetivo semanal de entrenamientos">{(id) => <Input id={id} type="number" min={1} max={7} defaultValue={p.weekly_workout_target}
            onBlur={(e) => { const n = numOrNull(e.target.value); if (n !== null && n >= 1 && n <= 7) m.mutate({ weekly_workout_target: Math.round(n) }) }} />}</Field>
          <Field label="Zona horaria" hint="Se toma automáticamente del dispositivo">{(id) => <Input id={id} value={p.timezone} disabled />}</Field>
        </div>
      </Card>
      <Card>
        <CardTitle>Notificaciones internas</CardTitle>
        <Switch checked={p.notify_scheduled} onChange={(v) => m.mutate({ notify_scheduled: v })} label="Entrenamientos programados" />
        <Switch checked={p.notify_challenges} onChange={(v) => m.mutate({ notify_challenges: v })} label="Retos próximos a finalizar" />
        <Switch checked={p.notify_records} onChange={(v) => m.mutate({ notify_records: v })} label="Nuevos récords personales" />
        <Switch checked={p.notify_goals} onChange={(v) => m.mutate({ notify_goals: v })} label="Objetivos alcanzados" />
        <Switch checked={p.notify_weekly_summary} onChange={(v) => m.mutate({ notify_weekly_summary: v })} label="Resumen semanal" />
        <p className="mt-2 text-xs text-muted">Solo se muestran dentro de la app. No hay correos ni push configurados.</p>
        <CardTitle className="mt-5">Apariencia</CardTitle>
        <Tabs value={theme} onChange={(t) => { setTheme(t); applyTheme(t) }} options={[{ value: 'dark', label: 'Oscuro' }, { value: 'light', label: 'Claro' }]} />
        <span className="sr-only">{theme === 'dark' ? <Moon /> : <Sun />}</span>
      </Card>
    </div>
  )
}

function PrivacyTab() {
  const { data: p, isLoading } = usePrefs()
  const m = usePrefsMutation()
  if (isLoading || !p) return <LoadingBlock />
  return (
    <Card className="max-w-2xl">
      <CardTitle>Qué puede ver tu Gym Bro</CardTitle>
      <p className="mb-3 text-sm text-muted">Estos permisos se aplican en la base de datos (Row Level Security), no solo en la pantalla. Tu compañero nunca puede modificar tus registros.</p>
      <Switch checked={p.share_workouts} onChange={(v) => m.mutate({ share_workouts: v })} label="Entrenamientos, récords, objetivos y calendario" description="Necesario para la comparación Gym Bro." />
      <Switch checked={p.share_measurements} onChange={(v) => m.mutate({ share_measurements: v })} label="Peso y medidas corporales" />
      <Switch checked={p.share_photos} onChange={(v) => m.mutate({ share_photos: v })} label="Fotografías de progreso" description="Además, cada foto debe marcarse como visible individualmente." />
      <p className="mt-3 text-xs text-muted">Tu nombre y foto de perfil son visibles para tu Gym Bro vinculado. El progreso de los retos en los que participas es visible para los demás participantes.</p>
    </Card>
  )
}

function DataTab() {
  const me = useUserId()
  const { signOut } = useAuth()
  const { data: prefs } = usePrefs()
  const { data: profile } = useProfile()
  const { data: sessions } = useSessions()
  const { data: measurements } = useMeasurements()
  const { data: goals } = useGoals()
  const { data: records } = useRecords()
  const [confirm, setConfirm] = useState<null | 'workouts' | 'measurements' | 'photos'>(null)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const unit = prefs?.weight_unit ?? 'kg'

  const wipe = async () => {
    if (!confirm) return
    setBusy(true)
    try {
      if (confirm === 'workouts') {
        await unwrap(supabase.from('workout_sessions').delete().eq('user_id', me))
        await unwrap(supabase.from('scheduled_workouts').delete().eq('user_id', me))
      } else if (confirm === 'measurements') {
        await unwrap(supabase.from('body_measurements').delete().eq('user_id', me))
      } else {
        const rows = await unwrap<{ id: string; storage_path: string }[]>(supabase.from('progress_photos').select('id, storage_path').eq('user_id', me))
        if (rows.length) {
          const { error } = await supabase.storage.from(PHOTO_BUCKET).remove(rows.map((r) => r.storage_path))
          if (error) throw error
          await unwrap(supabase.from('progress_photos').delete().eq('user_id', me))
        }
      }
      toast.success('Registros eliminados')
      setConfirm(null); setTyped('')
      window.location.reload()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardTitle>Exportar mis datos</CardTitle>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={!sessions?.length} onClick={() => exportSessionsCsv(sessions ?? [], unit)}><Download className="h-4 w-4" /> Entrenamientos (CSV)</Button>
          <Button variant="outline" disabled={!measurements?.length} onClick={() => exportMeasurementsCsv(measurements ?? [])}><Download className="h-4 w-4" /> Medidas (CSV)</Button>
          <Button variant="outline" onClick={() => downloadJson(`gymbro-datos-${todayKey()}.json`, { profile, preferences: prefs, sessions, measurements, goals, records })}><Download className="h-4 w-4" /> Todo (JSON)</Button>
        </div>
      </Card>
      <Card>
        <CardTitle>Sesión</CardTitle>
        <Button variant="secondary" onClick={() => void signOut()}><LogOut className="h-4 w-4" /> Cerrar sesión</Button>
      </Card>
      <Card className="border-danger/30 lg:col-span-2">
        <CardTitle className="text-danger">Eliminar registros propios</CardTitle>
        <p className="mb-3 text-sm text-muted">Acciones permanentes. Exporta tus datos antes si quieres conservarlos.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="danger" onClick={() => setConfirm('workouts')}><Trash2 className="h-4 w-4" /> Entrenamientos y calendario</Button>
          <Button variant="danger" onClick={() => setConfirm('measurements')}><Trash2 className="h-4 w-4" /> Medidas</Button>
          <Button variant="danger" onClick={() => setConfirm('photos')}><Trash2 className="h-4 w-4" /> Fotografías</Button>
        </div>
      </Card>
      <ConfirmDialog open={!!confirm} onOpenChange={(o) => { if (!o) { setConfirm(null); setTyped('') } }} danger loading={busy}
        title="Confirmar eliminación" confirmLabel="Eliminar definitivamente"
        description={`Se eliminarán TODOS tus registros de ${confirm === 'workouts' ? 'entrenamientos (incluye récords) y calendario' : confirm === 'measurements' ? 'medidas corporales' : 'fotografías'}. Escribe ELIMINAR para confirmar.`}
        onConfirm={() => (typed === 'ELIMINAR' ? void wipe() : toast.error('Escribe ELIMINAR para confirmar'))}>
        <Input autoFocus placeholder="ELIMINAR" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Escribe ELIMINAR" />
      </ConfirmDialog>
    </div>
  )
}
