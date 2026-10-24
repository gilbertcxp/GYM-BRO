import { useQueryClient } from '@tanstack/react-query'
import { lazy, Suspense, useEffect, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { AppLayout } from './components/layout/AppLayout'
import { LoadingBlock } from './components/ui'
import { AuthProvider, useAuth } from './features/auth/AuthProvider'
import { ForgotPasswordPage, LoginPage, ResetPasswordPage, SetupRequiredPage, SignupPage } from './features/auth/AuthPages'
import { initWorkoutStore, resetWorkoutStore } from './features/workout/store'
import { isSupabaseConfigured, supabase } from './lib/supabase'

const DashboardPage = lazy(() => import('./features/dashboard/DashboardPage'))
const WorkoutPage = lazy(() => import('./features/workout/WorkoutPage').then((m) => ({ default: m.WorkoutPage })))
const RoutinesPage = lazy(() => import('./features/routines/RoutinesPage'))
const ExercisesPage = lazy(() => import('./features/exercises/ExercisesPage'))
const ProgressPage = lazy(() => import('./features/progress/ProgressPage'))
const MeasurementsPage = lazy(() => import('./features/measurements/MeasurementsPage'))
const PhotosPage = lazy(() => import('./features/photos/PhotosPage'))
const CalendarPage = lazy(() => import('./features/calendar/CalendarPage'))
const GymBroPage = lazy(() => import('./features/gymbro/GymBroPage'))
const GoalsPage = lazy(() => import('./features/goals/GoalsPage'))
const HistoryPage = lazy(() => import('./features/history/HistoryPage'))
const SessionDetailPage = lazy(() => import('./features/history/SessionDetailPage'))
const NotificationsPage = lazy(() => import('./features/notifications/NotificationsPage'))
const SettingsPage = lazy(() => import('./features/settings/SettingsPage'))

function Protected({ children }: { children: ReactNode }) {
  const { session, loading, recovery } = useAuth()
  const location = useLocation()
  if (loading) return <LoadingBlock />
  if (!session) return <Navigate to="/login" replace state={{ from: location }} />
  if (recovery) return <Navigate to="/restablecer" replace />
  return <>{children}</>
}

/** Arranca el almacén de entrenamiento y las notificaciones internas al iniciar sesión. */
function SessionBoot() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()
  useEffect(() => {
    if (!user) {
      resetWorkoutStore()
      return
    }
    initWorkoutStore(user.id, (sessionId) => {
      qc.invalidateQueries()
      toast.success('Entrenamiento guardado', { action: { label: 'Ver', onClick: () => navigate(`/historial/${sessionId}`) } })
    })
    // Zona horaria del dispositivo para cálculos de días locales en el servidor.
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    void supabase.from('user_preferences').update({ timezone: tz }).eq('user_id', user.id).neq('timezone', tz)
      .then(() => supabase.rpc('generate_due_notifications'))
      .then(() => qc.invalidateQueries({ queryKey: ['notifications'] }))
  }, [user, qc, navigate])
  return null
}

export function App() {
  if (!isSupabaseConfigured) return <SetupRequiredPage />
  return (
    <AuthProvider>
      <SessionBoot />
      <Suspense fallback={<LoadingBlock />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/registro" element={<SignupPage />} />
          <Route path="/recuperar" element={<ForgotPasswordPage />} />
          <Route path="/restablecer" element={<ResetPasswordPage />} />
          <Route element={<Protected><AppLayout /></Protected>}>
            <Route index element={<DashboardPage />} />
            <Route path="entrenamiento" element={<WorkoutPage />} />
            <Route path="rutinas" element={<RoutinesPage />} />
            <Route path="ejercicios" element={<ExercisesPage />} />
            <Route path="progreso" element={<ProgressPage />} />
            <Route path="medidas" element={<MeasurementsPage />} />
            <Route path="fotos" element={<PhotosPage />} />
            <Route path="calendario" element={<CalendarPage />} />
            <Route path="gym-bro" element={<GymBroPage />} />
            <Route path="objetivos" element={<GoalsPage />} />
            <Route path="historial" element={<HistoryPage />} />
            <Route path="historial/:id" element={<SessionDetailPage />} />
            <Route path="notificaciones" element={<NotificationsPage />} />
            <Route path="configuracion" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </AuthProvider>
  )
}
