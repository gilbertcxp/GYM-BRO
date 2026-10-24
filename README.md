# GYM BRO — Fitness Progress System

Aplicación web privada para que dos compañeros de gimnasio registren entrenamientos, midan su progreso y compitan sanamente.

**Stack:** React 19 + TypeScript + Vite · Tailwind CSS v4 · componentes propios estilo shadcn/ui (Radix Dialog) · Recharts · Lucide · React Query · Zod + React Hook Form · Supabase (PostgreSQL, Auth, Storage, RLS) · PWA (vite-plugin-pwa).

## Arquitectura

```
src/
  components/      UI base (ui/), layout (menú lateral + navegación móvil), gráficas, filtros de fecha
  data/queries.ts  Hooks de React Query sobre Supabase (una sola capa de datos)
  features/        Un módulo por sección: auth, dashboard, workout, routines, exercises, progress,
                   measurements, photos, calendar, gymbro, goals, history, notifications, settings
  lib/             Cálculos puros (calc.ts, con pruebas), fechas, unidades, etiquetas, exportaciones CSV/PDF
supabase/
  migrations/      Migraciones SQL versionadas (esquema, seguridad, funciones, storage, biblioteca)
  setup_completo.sql  Las 5 migraciones concatenadas, para pegar en el SQL Editor
tests/db/          Pruebas de RLS y funciones SQL sobre PGlite (Postgres en WASM)
```

**Decisiones clave**
- Todos los pesos se guardan en **kg**; la conversión a lb es solo visual.
- Eventos en `timestamptz` (UTC); los "días locales" usan la zona horaria IANA del usuario (`user_preferences.timezone`, tomada del dispositivo).
- Los **récords personales** los calcula el servidor (`finish_workout_session` → `recompute_session_records`) comparando con el historial previo; el cliente no puede escribirlos.
- El progreso de los **retos** se calcula en el servidor (`challenge_progress`) a partir de sesiones reales.
- **1RM** = Epley `peso × (1 + reps/30)`, solo para 1–15 reps, siempre etiquetado como estimación.
- **Volumen** = Σ(peso × reps) de series completadas que no son de calentamiento (el calentamiento se muestra aparte).

## Seguridad
- RLS en todas las tablas. Cada usuario solo escribe sus registros; el compañero solo **lee** si hay vínculo aceptado **y** el dueño lo autorizó (`share_workouts`, `share_measurements`, `share_photos`).
- Altas controladas: solo correos presentes en `allowed_emails` pueden registrarse (trigger en `auth.users`).
- No existen columnas de rol editables; un trigger impide cambiar `id`/`email` del perfil.
- Fotos y avatares en **buckets privados**, accesibles solo con URLs firmadas temporales.
- El frontend usa únicamente la clave pública `anon`.

## Puesta en marcha

### 1. Supabase (una sola vez)
1. Crea un proyecto en Supabase.
2. **SQL Editor** → pega el contenido de `supabase/setup_completo.sql` → **Run**.
3. Autoriza los correos que podrán registrarse:
   ```sql
   insert into public.allowed_emails (email) values ('tu-correo@ejemplo.com'), ('correo-gymbro@ejemplo.com');
   ```
4. **Authentication → URL Configuration**: `Site URL` = URL de producción (o `http://localhost:5173` en desarrollo) y agrega en *Redirect URLs* `http://localhost:5173/**` y `https://TU-DOMINIO/**` (necesario para confirmar correo y recuperar contraseña).
5. (Recomendado) **Authentication → Sign In / Providers → Email**: deja activa la confirmación de correo.

### 2. Local
```bash
cp .env.example .env.local   # completa VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY
npm install
npm run dev                  # http://localhost:5173
```

### 3. Pruebas
```bash
npm test          # cálculos (vitest) + pruebas SQL de RLS/funciones sobre PGlite
npm run typecheck
npm run build
```

### 4. Despliegue en Vercel
1. Importa el repositorio en Vercel (framework: Vite; build `npm run build`; output `dist`).
2. Variables de entorno: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
3. `vercel.json` ya incluye el rewrite para rutas SPA.
4. Agrega la URL de Vercel en Supabase → Authentication → URL Configuration.

## Uso inicial
1. Cada uno se registra en `/registro` con su correo autorizado y confirma el correo.
2. En **Gym Bro**, uno envía la solicitud al correo del otro y el otro la acepta.
3. En **Configuración → Privacidad** cada uno decide qué comparte.
4. Crea una rutina desde **Rutinas → Plantillas** y empieza en **Mi entrenamiento**.

## Funcionamiento sin conexión
- El entrenamiento activo se guarda en `localStorage` en cada cambio y se sincroniza con upserts idempotentes (ids generados en el cliente); un índice único impide dos sesiones activas por usuario.
- Si se pierde Internet, las series quedan en el dispositivo y se envían al reconectar (reintento automático cada 15 s y al evento `online`). Finalizar sin conexión deja la finalización pendiente.
- La PWA precachea la interfaz. El resto de pantallas (historial, gráficas) requieren conexión.
