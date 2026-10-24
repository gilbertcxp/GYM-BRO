/** Traduce errores de Supabase/PostgREST/red a mensajes comprensibles. */
export function errorMessage(err: unknown): string {
  if (!err) return 'Error desconocido'
  const e = err as { message?: string; code?: string; status?: number }
  const msg = e.message ?? String(err)

  if (/Failed to fetch|NetworkError|Load failed|fetch failed/i.test(msg)) return 'Sin conexión con el servidor. Revisa tu Internet.'
  if (/EMAIL_NOT_INVITED|Database error saving new user/i.test(msg)) return 'Este correo no está autorizado. Pide al administrador que lo agregue a la lista de invitados.'
  if (/Invalid login credentials/i.test(msg)) return 'Correo o contraseña incorrectos.'
  if (/Email not confirmed/i.test(msg)) return 'Debes confirmar tu correo antes de iniciar sesión.'
  if (/User already registered/i.test(msg)) return 'Ya existe una cuenta con este correo.'
  if (/Password should be at least/i.test(msg)) return 'La contraseña debe tener al menos 8 caracteres.'
  if (/rate limit/i.test(msg)) return 'Demasiados intentos. Espera unos minutos.'
  if (e.code === '23505' || /duplicate key/i.test(msg)) return 'Ya existe un registro igual.'
  if (e.code === '23503' || /foreign key/i.test(msg)) return 'No se puede eliminar: está en uso por otros registros (rutinas o historial).'
  if (e.code === '23514' || /check constraint/i.test(msg)) return 'Algún valor está fuera del rango permitido.'
  if (e.code === '42501' || /row-level security|permission denied/i.test(msg)) return 'No tienes permiso para esta acción.'
  if (e.status === 401 || /JWT expired/i.test(msg)) return 'Tu sesión expiró. Inicia sesión de nuevo.'
  return msg
}

export function isNetworkError(err: unknown) {
  const msg = (err as { message?: string })?.message ?? String(err)
  return !navigator.onLine || /Failed to fetch|NetworkError|Load failed|fetch failed/i.test(msg)
}
