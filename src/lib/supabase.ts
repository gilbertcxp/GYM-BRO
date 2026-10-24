import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** true si hay URL y clave pública configuradas. Sin ellas la app muestra la pantalla de configuración. */
export const isSupabaseConfigured = Boolean(url && anonKey)

// Solo la clave pública (anon/publishable). La service_role nunca debe llegar al navegador.
export const supabase: SupabaseClient = isSupabaseConfigured
  ? createClient(url!, anonKey!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : (null as unknown as SupabaseClient)

export const PHOTO_BUCKET = 'progress-photos'
export const AVATAR_BUCKET = 'avatars'

/** URL firmada de corta duración para archivos privados. */
export async function signedUrl(bucket: string, path: string, expiresIn = 3600) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn)
  if (error) throw error
  return data.signedUrl
}
