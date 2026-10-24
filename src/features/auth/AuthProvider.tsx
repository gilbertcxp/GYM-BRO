import type { Session, User } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

interface AuthState {
  session: Session | null
  user: User | null
  loading: boolean
  recovery: boolean // el usuario llegó desde un enlace de recuperación de contraseña
  clearRecovery: () => void
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [recovery, setRecovery] = useState(false)
  const qc = useQueryClient()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      if (event === 'SIGNED_OUT') qc.clear()
    })
    return () => sub.subscription.unsubscribe()
  }, [qc])

  const value: AuthState = {
    session,
    user: session?.user ?? null,
    loading,
    recovery,
    clearRecovery: () => setRecovery(false),
    signOut: async () => {
      await supabase.auth.signOut()
    },
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth fuera de AuthProvider')
  return ctx
}

/** Id del usuario autenticado (las rutas protegidas garantizan que existe). */
export function useUserId() {
  const { user } = useAuth()
  if (!user) throw new Error('Usuario no autenticado')
  return user.id
}
