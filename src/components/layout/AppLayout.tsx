import {
  Bell, CalendarDays, Camera, ChartLine, Dumbbell, History, LayoutDashboard, ListChecks, Menu,
  Ruler, Settings, Swords, Target, Timer, X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useNotifications, useProfile } from '@/data/queries'
import { useActiveWorkout } from '@/features/workout/store'
import { useOnline } from '@/lib/useOnline'
import { cn } from '@/lib/utils'
import { Avatar } from '../Avatar'

export const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/entrenamiento', label: 'Mi entrenamiento', icon: Timer },
  { to: '/rutinas', label: 'Rutinas', icon: ListChecks },
  { to: '/ejercicios', label: 'Ejercicios', icon: Dumbbell },
  { to: '/progreso', label: 'Progreso', icon: ChartLine },
  { to: '/medidas', label: 'Peso y medidas', icon: Ruler },
  { to: '/fotos', label: 'Fotografías', icon: Camera },
  { to: '/calendario', label: 'Calendario', icon: CalendarDays },
  { to: '/gym-bro', label: 'Gym Bro', icon: Swords },
  { to: '/objetivos', label: 'Objetivos', icon: Target },
  { to: '/historial', label: 'Historial y reportes', icon: History },
  { to: '/notificaciones', label: 'Notificaciones', icon: Bell },
  { to: '/configuracion', label: 'Configuración', icon: Settings },
] as const

const MOBILE_PRIMARY = ['/', '/entrenamiento', '/rutinas', '/progreso']

function NavItem({ to, label, icon: Icon, badge, onClick }: { to: string; label: string; icon: typeof Bell; badge?: number; onClick?: () => void }) {
  return (
    <NavLink
      to={to} end={to === '/'} onClick={onClick}
      className={({ isActive }) => cn(
        'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition',
        isActive ? 'bg-accent/10 font-semibold text-accent' : 'text-muted hover:bg-surface-2 hover:text-text',
      )}
    >
      <Icon className="h-[18px] w-[18px]" aria-hidden />
      <span className="flex-1">{label}</span>
      {!!badge && <span className="rounded-full bg-accent px-1.5 text-[11px] font-bold text-accent-fg">{badge}</span>}
    </NavLink>
  )
}

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2.5 px-2">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-accent-fg"><Dumbbell className="h-5 w-5" /></span>
      <span>
        <span className="block text-lg font-black leading-none tracking-tight">GYM BRO</span>
        <span className="block text-[10px] uppercase tracking-[0.18em] text-muted">Progress System</span>
      </span>
    </Link>
  )
}

export function AppLayout() {
  const { data: notifications } = useNotifications()
  const { data: profile } = useProfile()
  const active = useActiveWorkout()
  const online = useOnline()
  const unread = notifications?.filter((n) => !n.read_at).length ?? 0
  const [moreOpen, setMoreOpen] = useState(false)
  const location = useLocation()
  useEffect(() => setMoreOpen(false), [location.pathname])

  const sideNav = (onClick?: () => void) => NAV.map((n) => (
    <NavItem key={n.to} {...n} badge={n.to === '/notificaciones' ? unread : undefined} onClick={onClick} />
  ))

  return (
    <div className="min-h-dvh lg:pl-64">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-fg">Saltar al contenido</a>

      {/* Menú lateral (escritorio) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border bg-surface px-3 py-5 lg:flex">
        <Brand />
        <nav className="mt-8 flex-1 space-y-0.5 overflow-y-auto" aria-label="Principal">{sideNav()}</nav>
        <Link to="/configuracion" className="mt-4 flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-surface-2">
          <Avatar path={profile?.avatar_path} name={profile?.full_name || profile?.email || ''} size={36} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{profile?.full_name || 'Mi perfil'}</span>
            <span className="block truncate text-xs text-muted">{profile?.email}</span>
          </span>
        </Link>
      </aside>

      {/* Barra superior (móvil) */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-bg/85 px-4 py-3 backdrop-blur lg:hidden">
        <Brand />
        <Link to="/notificaciones" className="relative rounded-xl p-2 text-muted hover:text-text" aria-label={`Notificaciones (${unread} sin leer)`}>
          <Bell className="h-5 w-5" />
          {unread > 0 && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-accent" />}
        </Link>
      </header>

      {!online && (
        <div role="status" className="bg-warning/15 px-4 py-2 text-center text-xs font-medium text-warning">
          Sin conexión. Las series del entrenamiento activo se guardan en este dispositivo y se sincronizarán al reconectar.
        </div>
      )}

      {active && location.pathname !== '/entrenamiento' && (
        <Link to="/entrenamiento" className="mx-4 mt-4 flex items-center justify-between rounded-2xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm lg:mx-8">
          <span className="flex items-center gap-2 font-semibold text-accent"><Timer className="h-4 w-4" /> Entrenamiento en curso: {active.session.name}</span>
          <span className="text-accent">Continuar →</span>
        </Link>
      )}

      <main id="main" className="mx-auto max-w-7xl px-4 pb-28 pt-6 sm:px-6 lg:px-8 lg:pb-12">
        <Outlet />
      </main>

      {/* Navegación inferior (móvil) */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-surface/95 pb-safe backdrop-blur lg:hidden" aria-label="Principal móvil">
        {NAV.filter((n) => MOBILE_PRIMARY.includes(n.to)).map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === '/'}
            className={({ isActive }) => cn('flex flex-col items-center gap-1 py-2.5 text-[11px]', isActive ? 'text-accent' : 'text-muted')}>
            <Icon className="h-5 w-5" aria-hidden />
            {to === '/entrenamiento' ? 'Entrenar' : label}
          </NavLink>
        ))}
        <button type="button" onClick={() => setMoreOpen(true)} className="flex flex-col items-center gap-1 py-2.5 text-[11px] text-muted" aria-haspopup="dialog">
          <Menu className="h-5 w-5" aria-hidden /> Más
        </button>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menú">
          <button type="button" aria-label="Cerrar menú" className="absolute inset-0 bg-black/70" onClick={() => setMoreOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-3xl border-t border-border bg-surface p-4 pb-safe animate-fade-up">
            <div className="mb-2 flex items-center justify-between px-2">
              <span className="font-bold">Menú</span>
              <button type="button" onClick={() => setMoreOpen(false)} className="rounded-lg p-2 text-muted" aria-label="Cerrar"><X className="h-5 w-5" /></button>
            </div>
            <nav className="grid grid-cols-1 gap-0.5">{sideNav(() => setMoreOpen(false))}</nav>
          </div>
        </div>
      )}
    </div>
  )
}
