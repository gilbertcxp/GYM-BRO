-- =====================================================================
-- GYM BRO — Cardio
-- Sesiones de cardio registradas por el usuario. Distancia en km (la app
-- convierte a millas si el usuario usa libras). Las calorías solo se guardan
-- si el usuario las introduce (de su reloj o máquina): la app no las estima.
-- =====================================================================
create type public.cardio_activity as enum (
  'running', 'treadmill', 'walking', 'cycling', 'stationary_bike', 'elliptical',
  'rowing', 'stairs', 'swimming', 'jump_rope', 'hiit', 'other'
);

create table public.cardio_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  activity public.cardio_activity not null,
  started_at timestamptz not null default now(),
  duration_seconds int not null check (duration_seconds between 60 and 86400),
  distance_km numeric(7,3) check (distance_km is null or distance_km between 0.01 and 1000),
  calories int check (calories is null or calories between 1 and 10000),
  avg_heart_rate smallint check (avg_heart_rate is null or avg_heart_rate between 30 and 230),
  max_heart_rate smallint check (max_heart_rate is null or max_heart_rate between 30 and 240),
  rpe numeric(3,1) check (rpe is null or rpe between 1 and 10),
  incline_pct numeric(4,1) check (incline_pct is null or incline_pct between -10 and 40),
  notes text check (char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (max_heart_rate is null or avg_heart_rate is null or max_heart_rate >= avg_heart_rate)
);
create index cardio_sessions_user_started_idx on public.cardio_sessions (user_id, started_at desc);
create trigger cardio_sessions_touch before update on public.cardio_sessions
  for each row execute function public.touch_updated_at();

alter table public.cardio_sessions enable row level security;
-- Mismo permiso que los entrenamientos: el compañero lo ve solo si el dueño comparte entrenamientos.
create policy cardio_select on public.cardio_sessions for select to authenticated
  using (public.can_view(user_id, 'workouts'));
create policy cardio_insert on public.cardio_sessions for insert to authenticated
  with check (user_id = auth.uid());
create policy cardio_update on public.cardio_sessions for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy cardio_delete on public.cardio_sessions for delete to authenticated
  using (user_id = auth.uid());
revoke all on public.cardio_sessions from anon;
