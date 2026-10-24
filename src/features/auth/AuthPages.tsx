import { zodResolver } from '@hookform/resolvers/zod'
import { Dumbbell } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button, Card, Field, Input } from '@/components/ui'
import { errorMessage } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { useAuth } from './AuthProvider'

const email = z.string().trim().toLowerCase().email('Correo no válido')
const password = z.string().min(8, 'Mínimo 8 caracteres').max(72)

function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[radial-gradient(ellipse_at_top,rgba(163,255,18,0.08),transparent_60%)] px-4 py-10">
      <div className="w-full max-w-md animate-fade-up">
        <div className="mb-8 flex items-center justify-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-accent-fg"><Dumbbell className="h-7 w-7" /></div>
          <div>
            <p className="text-2xl font-black tracking-tight">GYM BRO</p>
            <p className="text-xs uppercase tracking-[0.2em] text-muted">Fitness Progress System</p>
          </div>
        </div>
        <Card className="p-6 sm:p-8">
          <h1 className="text-xl font-bold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </Card>
      </div>
    </main>
  )
}

export function LoginPage() {
  const { session } = useAuth()
  const schema = z.object({ email, password: z.string().min(1, 'Requerido') })
  const { register, handleSubmit, formState } = useForm({ resolver: zodResolver(schema) })
  const [error, setError] = useState<string | null>(null)
  if (session) return <Navigate to="/" replace />

  const onSubmit = handleSubmit(async (v) => {
    setError(null)
    const { error } = await supabase.auth.signInWithPassword(v)
    if (error) setError(errorMessage(error))
  })

  return (
    <AuthShell title="Iniciar sesión" subtitle="Plataforma privada para ti y tu Gym Bro.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Correo" error={formState.errors.email?.message}>
          {(id) => <Input id={id} type="email" autoComplete="email" {...register('email')} />}
        </Field>
        <Field label="Contraseña" error={formState.errors.password?.message}>
          {(id) => <Input id={id} type="password" autoComplete="current-password" {...register('password')} />}
        </Field>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <Button type="submit" size="lg" className="w-full" loading={formState.isSubmitting}>Entrar</Button>
      </form>
      <div className="mt-6 flex justify-between text-sm">
        <Link className="text-muted hover:text-accent" to="/recuperar">¿Olvidaste tu contraseña?</Link>
        <Link className="text-muted hover:text-accent" to="/registro">Tengo invitación</Link>
      </div>
    </AuthShell>
  )
}

export function SignupPage() {
  const schema = z.object({ full_name: z.string().trim().min(2, 'Escribe tu nombre').max(80), email, password, confirm: z.string() })
    .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Las contraseñas no coinciden' })
  const { register, handleSubmit, formState } = useForm({ resolver: zodResolver(schema) })
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const onSubmit = handleSubmit(async (v) => {
    setError(null)
    const { data, error } = await supabase.auth.signUp({
      email: v.email, password: v.password,
      options: { data: { full_name: v.full_name }, emailRedirectTo: window.location.origin },
    })
    if (error) return setError(errorMessage(error))
    if (!data.session) setDone(true)
  })

  if (done) {
    return (
      <AuthShell title="Revisa tu correo" subtitle="Te enviamos un enlace para confirmar la cuenta.">
        <Link to="/login"><Button variant="outline" className="w-full">Volver al inicio de sesión</Button></Link>
      </AuthShell>
    )
  }
  return (
    <AuthShell title="Crear cuenta" subtitle="Solo correos invitados por el administrador pueden registrarse.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Nombre" error={formState.errors.full_name?.message}>
          {(id) => <Input id={id} autoComplete="name" {...register('full_name')} />}
        </Field>
        <Field label="Correo invitado" error={formState.errors.email?.message}>
          {(id) => <Input id={id} type="email" autoComplete="email" {...register('email')} />}
        </Field>
        <Field label="Contraseña" error={formState.errors.password?.message}>
          {(id) => <Input id={id} type="password" autoComplete="new-password" {...register('password')} />}
        </Field>
        <Field label="Repite la contraseña" error={formState.errors.confirm?.message}>
          {(id) => <Input id={id} type="password" autoComplete="new-password" {...register('confirm')} />}
        </Field>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <Button type="submit" size="lg" className="w-full" loading={formState.isSubmitting}>Crear cuenta</Button>
      </form>
      <p className="mt-6 text-center text-sm"><Link className="text-muted hover:text-accent" to="/login">Ya tengo cuenta</Link></p>
    </AuthShell>
  )
}

export function ForgotPasswordPage() {
  const schema = z.object({ email })
  const { register, handleSubmit, formState } = useForm({ resolver: zodResolver(schema) })
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const onSubmit = handleSubmit(async (v) => {
    setError(null)
    const { error } = await supabase.auth.resetPasswordForEmail(v.email, { redirectTo: `${window.location.origin}/restablecer` })
    if (error) setError(errorMessage(error))
    else setSent(true)
  })
  return (
    <AuthShell title="Recuperar contraseña" subtitle="Te enviaremos un enlace para crear una nueva.">
      {sent ? (
        <p className="text-sm text-muted">Si el correo está registrado, recibirás un enlace en unos minutos.</p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label="Correo" error={formState.errors.email?.message}>
            {(id) => <Input id={id} type="email" autoComplete="email" {...register('email')} />}
          </Field>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <Button type="submit" size="lg" className="w-full" loading={formState.isSubmitting}>Enviar enlace</Button>
        </form>
      )}
      <p className="mt-6 text-center text-sm"><Link className="text-muted hover:text-accent" to="/login">Volver</Link></p>
    </AuthShell>
  )
}

export function ResetPasswordPage() {
  const { session, clearRecovery } = useAuth()
  const navigate = useNavigate()
  const schema = z.object({ password, confirm: z.string() })
    .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Las contraseñas no coinciden' })
  const { register, handleSubmit, formState } = useForm({ resolver: zodResolver(schema) })
  const [error, setError] = useState<string | null>(null)
  const onSubmit = handleSubmit(async (v) => {
    setError(null)
    const { error } = await supabase.auth.updateUser({ password: v.password })
    if (error) return setError(errorMessage(error))
    clearRecovery()
    toast.success('Contraseña actualizada')
    navigate('/', { replace: true })
  })
  return (
    <AuthShell title="Nueva contraseña">
      {!session ? (
        <p className="text-sm text-muted">El enlace no es válido o expiró. <Link className="text-accent" to="/recuperar">Solicita otro</Link>.</p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label="Nueva contraseña" error={formState.errors.password?.message}>
            {(id) => <Input id={id} type="password" autoComplete="new-password" {...register('password')} />}
          </Field>
          <Field label="Repite la contraseña" error={formState.errors.confirm?.message}>
            {(id) => <Input id={id} type="password" autoComplete="new-password" {...register('confirm')} />}
          </Field>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <Button type="submit" size="lg" className="w-full" loading={formState.isSubmitting}>Guardar</Button>
        </form>
      )}
    </AuthShell>
  )
}

export function SetupRequiredPage() {
  return (
    <AuthShell title="Configuración pendiente" subtitle="Falta conectar Supabase.">
      {import.meta.env.DEV ? (
        <ol className="list-decimal space-y-2 pl-5 text-sm text-muted">
          <li>Copia <code className="text-text">.env.example</code> a <code className="text-text">.env.local</code>.</li>
          <li>Completa <code className="text-text">VITE_SUPABASE_URL</code> y <code className="text-text">VITE_SUPABASE_ANON_KEY</code> (clave pública).</li>
          <li>Reinicia <code className="text-text">npm run dev</code>.</li>
        </ol>
      ) : (
        <ol className="list-decimal space-y-2 pl-5 text-sm text-muted">
          <li>En Vercel: Settings → Environment Variables, define <code className="text-text">VITE_SUPABASE_URL</code> y <code className="text-text">VITE_SUPABASE_ANON_KEY</code> para Production.</li>
          <li>Deployments → ⋯ → Redeploy (las variables se incorporan al compilar).</li>
        </ol>
      )}
    </AuthShell>
  )
}
