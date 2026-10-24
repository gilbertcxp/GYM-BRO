-- GYM BRO: todas las migraciones en orden. Pegar completo en Supabase > SQL Editor > Run.

-- >>> supabase/migrations/20261023000001_schema.sql
-- =====================================================================
-- GYM BRO — Esquema base
-- Estrategia horaria: todos los eventos se guardan como timestamptz (UTC).
-- Los días "locales" (calendario, rachas, semanas) se calculan con la zona
-- horaria IANA guardada en user_preferences.timezone.
-- Todos los pesos se guardan en kilogramos; la conversión a libras es solo visual.
-- =====================================================================

-- ---------- Tipos ----------
create type public.muscle_group as enum (
  'chest','back','shoulders','biceps','triceps','forearms',
  'quads','hamstrings','glutes','calves','abs'
);
create type public.exercise_mechanics as enum ('compound','isolation');
create type public.exercise_modality as enum ('free_weight','machine','cable','bodyweight');
create type public.experience_level as enum ('beginner','intermediate','advanced');
create type public.main_goal as enum ('muscle_gain','fat_loss','recomposition','strength');
create type public.weight_unit as enum ('kg','lb');
create type public.routine_status as enum ('active','paused','archived');
create type public.session_status as enum ('in_progress','completed','abandoned');
create type public.set_type as enum ('warmup','normal','failure','drop','rest_pause');
create type public.photo_category as enum ('front','side','back','other');
create type public.pr_type as enum ('max_weight','max_reps_at_weight','est_1rm','max_session_volume');
create type public.goal_type as enum ('body_weight','strength','attendance','volume','measurement');
create type public.goal_status as enum ('pending','in_progress','completed','paused');
create type public.schedule_status as enum ('scheduled','completed','skipped','rest');
create type public.challenge_type as enum ('weekly_workouts','exercise_improvement','routine_consistency','monthly_attendance');
create type public.challenge_status as enum ('active','cancelled');
create type public.partnership_status as enum ('pending','accepted','rejected');

-- ---------- Utilidades ----------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------- Lista de correos autorizados (creación controlada de cuentas) ----------
-- Solo se gestiona desde el SQL Editor / service role. Sin políticas = sin acceso desde el cliente.
create table public.allowed_emails (
  email text primary key check (email = lower(email)),
  note text,
  created_at timestamptz not null default now()
);

-- ---------- Perfiles ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '' check (char_length(full_name) <= 80),
  avatar_path text,
  birth_date date check (birth_date is null or birth_date > date '1900-01-01'),
  height_cm numeric(5,1) check (height_cm is null or height_cm between 50 and 260),
  initial_weight_kg numeric(5,2) check (initial_weight_kg is null or initial_weight_kg between 20 and 400),
  target_weight_kg numeric(5,2) check (target_weight_kg is null or target_weight_kg between 20 and 400),
  tracking_start_date date not null default current_date,
  experience_level public.experience_level,
  main_goal public.main_goal,
  training_preferences text check (char_length(training_preferences) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index profiles_email_uq on public.profiles (lower(email));

-- Impide que el navegador cambie campos gestionados por el sistema (id, email, created_at).
create or replace function public.protect_profile_columns()
returns trigger language plpgsql as $$
begin
  new.id := old.id;
  new.email := old.email;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end $$;
create trigger profiles_protect before update on public.profiles
  for each row execute function public.protect_profile_columns();

create table public.user_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  weight_unit public.weight_unit not null default 'kg',
  timezone text not null default 'America/Santo_Domingo' check (char_length(timezone) <= 64),
  default_rest_seconds int not null default 90 check (default_rest_seconds between 10 and 900),
  weekly_workout_target smallint not null default 4 check (weekly_workout_target between 1 and 7),
  share_workouts boolean not null default true,
  share_measurements boolean not null default false,
  share_photos boolean not null default false,
  notify_scheduled boolean not null default true,
  notify_challenges boolean not null default true,
  notify_records boolean not null default true,
  notify_goals boolean not null default true,
  notify_weekly_summary boolean not null default true,
  updated_at timestamptz not null default now()
);
create trigger user_preferences_touch before update on public.user_preferences
  for each row execute function public.touch_updated_at();

-- Alta de usuario: solo correos autorizados. Crea perfil y preferencias.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.allowed_emails where email = lower(new.email)) then
    raise exception 'EMAIL_NOT_INVITED: % no está autorizado para registrarse', new.email
      using errcode = 'P0001';
  end if;
  insert into public.profiles (id, email, full_name)
  values (new.id, lower(new.email), coalesce(new.raw_user_meta_data->>'full_name', ''));
  insert into public.user_preferences (user_id) values (new.id);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Compañeros (Gym Bro) ----------
create table public.partnerships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status public.partnership_status not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (requester_id <> addressee_id)
);
create unique index partnerships_pair_uq on public.partnerships
  (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index partnerships_addressee_idx on public.partnerships (addressee_id);

-- ---------- Ejercicios ----------
create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles(id) on delete cascade, -- null = biblioteca global
  name text not null check (char_length(name) between 2 and 120),
  primary_muscle public.muscle_group not null,
  mechanics public.exercise_mechanics not null,
  modality public.exercise_modality not null,
  equipment text check (char_length(equipment) <= 120),
  instructions text check (char_length(instructions) <= 4000),
  common_mistakes text check (char_length(common_mistakes) <= 4000),
  video_url text check (video_url is null or video_url ~* '^https://'),
  image_url text check (image_url is null or image_url ~* '^https://'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index exercises_global_name_uq on public.exercises (lower(name)) where owner_id is null;
create unique index exercises_owner_name_uq on public.exercises (owner_id, lower(name)) where owner_id is not null;
create index exercises_owner_idx on public.exercises (owner_id);
create index exercises_muscle_idx on public.exercises (primary_muscle);
create trigger exercises_touch before update on public.exercises
  for each row execute function public.touch_updated_at();

-- Músculos secundarios
create table public.exercise_muscles (
  exercise_id uuid not null references public.exercises(id) on delete cascade,
  muscle public.muscle_group not null,
  primary key (exercise_id, muscle)
);

-- ---------- Rutinas ----------
create table public.routines (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  description text check (char_length(description) <= 1000),
  status public.routine_status not null default 'active',
  template_key text,
  shared_with_partner boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index routines_owner_idx on public.routines (owner_id, status);
create trigger routines_touch before update on public.routines
  for each row execute function public.touch_updated_at();

create table public.routine_days (
  id uuid primary key default gen_random_uuid(),
  routine_id uuid not null references public.routines(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  position smallint not null default 0,
  day_of_week smallint check (day_of_week between 0 and 6), -- 0 = domingo
  muscle_groups public.muscle_group[] not null default '{}',
  notes text check (char_length(notes) <= 1000)
);
create index routine_days_routine_idx on public.routine_days (routine_id, position);

create table public.routine_exercises (
  id uuid primary key default gen_random_uuid(),
  routine_day_id uuid not null references public.routine_days(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id) on delete restrict,
  position smallint not null default 0,
  target_sets smallint not null default 3 check (target_sets between 1 and 20),
  target_reps_min smallint check (target_reps_min between 1 and 100),
  target_reps_max smallint check (target_reps_max between 1 and 100),
  target_weight_kg numeric(6,2) check (target_weight_kg between 0 and 1000),
  rest_seconds int check (rest_seconds between 0 and 900),
  notes text check (char_length(notes) <= 1000),
  check (target_reps_min is null or target_reps_max is null or target_reps_min <= target_reps_max)
);
create index routine_exercises_day_idx on public.routine_exercises (routine_day_id, position);
create index routine_exercises_exercise_idx on public.routine_exercises (exercise_id);

-- ---------- Entrenamientos ----------
-- Los ids se generan en el cliente (uuid v4) para que la sincronización offline sea idempotente (upsert).
create table public.workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  routine_id uuid references public.routines(id) on delete set null,
  routine_day_id uuid references public.routine_days(id) on delete set null,
  -- Copia del nombre en el momento de entrenar: la rutina puede editarse o borrarse después.
  name text not null check (char_length(name) between 1 and 120),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  status public.session_status not null default 'in_progress',
  notes text check (char_length(notes) <= 2000),
  updated_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);
create index workout_sessions_user_started_idx on public.workout_sessions (user_id, started_at desc);
create index workout_sessions_routine_idx on public.workout_sessions (routine_id);
-- Evita sesiones activas duplicadas (p. ej. dos pestañas o reintentos de sincronización).
create unique index workout_sessions_one_active_uq on public.workout_sessions (user_id) where status = 'in_progress';
create trigger workout_sessions_touch before update on public.workout_sessions
  for each row execute function public.touch_updated_at();

create table public.workout_exercises (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.workout_sessions(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id) on delete restrict,
  position smallint not null default 0,
  rest_seconds int check (rest_seconds between 0 and 900),
  notes text check (char_length(notes) <= 1000)
);
create index workout_exercises_session_idx on public.workout_exercises (session_id, position);
create index workout_exercises_exercise_idx on public.workout_exercises (exercise_id);

create table public.workout_sets (
  id uuid primary key default gen_random_uuid(),
  workout_exercise_id uuid not null references public.workout_exercises(id) on delete cascade,
  set_number smallint not null check (set_number between 1 and 50),
  weight_kg numeric(6,2) not null default 0 check (weight_kg between 0 and 1000),
  reps smallint not null default 0 check (reps between 0 and 200),
  set_type public.set_type not null default 'normal',
  completed boolean not null default false,
  completed_at timestamptz,
  rpe numeric(3,1) check (rpe is null or rpe between 1 and 10),
  rir smallint check (rir is null or rir between 0 and 10),
  notes text check (char_length(notes) <= 500)
);
create index workout_sets_exercise_idx on public.workout_sets (workout_exercise_id, set_number);

-- ---------- Medidas corporales ----------
create table public.body_measurements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  measured_on date not null default current_date,
  weight_kg numeric(5,2) check (weight_kg between 20 and 400),
  height_cm numeric(5,1) check (height_cm between 50 and 260),
  waist_cm numeric(5,1) check (waist_cm between 5 and 300),
  chest_cm numeric(5,1) check (chest_cm between 5 and 300),
  hips_cm numeric(5,1) check (hips_cm between 5 and 300),
  arm_left_cm numeric(5,1) check (arm_left_cm between 5 and 300),
  arm_right_cm numeric(5,1) check (arm_right_cm between 5 and 300),
  forearm_left_cm numeric(5,1) check (forearm_left_cm between 5 and 300),
  forearm_right_cm numeric(5,1) check (forearm_right_cm between 5 and 300),
  thigh_left_cm numeric(5,1) check (thigh_left_cm between 5 and 300),
  thigh_right_cm numeric(5,1) check (thigh_right_cm between 5 and 300),
  calf_left_cm numeric(5,1) check (calf_left_cm between 5 and 300),
  calf_right_cm numeric(5,1) check (calf_right_cm between 5 and 300),
  body_fat_pct numeric(4,1) check (body_fat_pct between 2 and 70),
  method text check (char_length(method) <= 80),
  notes text check (char_length(notes) <= 1000),
  created_at timestamptz not null default now()
);
create index body_measurements_user_date_idx on public.body_measurements (user_id, measured_on desc);

-- ---------- Fotografías de progreso ----------
create table public.progress_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  storage_path text not null unique,
  taken_on date not null default current_date,
  category public.photo_category not null default 'front',
  visible_to_partner boolean not null default false,
  notes text check (char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  check (storage_path like user_id::text || '/%')
);
create index progress_photos_user_date_idx on public.progress_photos (user_id, taken_on desc);

-- ---------- Récords personales (registro de eventos, solo los escribe el servidor) ----------
create table public.personal_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id) on delete cascade,
  record_type public.pr_type not null,
  value numeric(10,2) not null,
  previous_value numeric(10,2), -- null = primera marca registrada para ese ejercicio
  weight_kg numeric(6,2),
  reps smallint,
  session_id uuid not null references public.workout_sessions(id) on delete cascade,
  workout_set_id uuid references public.workout_sets(id) on delete set null,
  achieved_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index personal_records_lookup_idx on public.personal_records (user_id, exercise_id, record_type, achieved_at desc);
create index personal_records_session_idx on public.personal_records (session_id);

-- ---------- Objetivos ----------
create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  goal_type public.goal_type not null,
  title text not null check (char_length(title) between 1 and 120),
  exercise_id uuid references public.exercises(id) on delete cascade,
  measurement_field text check (measurement_field in (
    'waist_cm','chest_cm','hips_cm','arm_left_cm','arm_right_cm','forearm_left_cm','forearm_right_cm',
    'thigh_left_cm','thigh_right_cm','calf_left_cm','calf_right_cm','body_fat_pct')),
  start_value numeric(10,2),
  target_value numeric(10,2) not null,
  target_date date,
  status public.goal_status not null default 'pending',
  archived boolean not null default false,
  completed_at timestamptz,
  notes text check (char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (goal_type <> 'strength' or exercise_id is not null),
  check (goal_type <> 'measurement' or measurement_field is not null),
  check (goal_type <> 'attendance' or target_value between 1 and 7)
);
create index goals_user_idx on public.goals (user_id, archived, status);
create trigger goals_touch before update on public.goals
  for each row execute function public.touch_updated_at();

-- ---------- Calendario ----------
create table public.scheduled_workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  scheduled_on date not null,
  routine_id uuid references public.routines(id) on delete set null,
  routine_day_id uuid references public.routine_days(id) on delete set null,
  status public.schedule_status not null default 'scheduled',
  session_id uuid references public.workout_sessions(id) on delete set null,
  notes text check (char_length(notes) <= 500),
  created_at timestamptz not null default now()
);
create index scheduled_workouts_user_date_idx on public.scheduled_workouts (user_id, scheduled_on);

-- ---------- Retos ----------
-- Límites deliberados para no incentivar entrenamientos peligrosos:
--  * máx. 6 entrenamientos/semana (al menos un día de descanso)
--  * mejora de ejercicio basada en 1RM ESTIMADO (no en intentos máximos), tope 15 %
create table public.challenges (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  description text check (char_length(description) <= 1000),
  challenge_type public.challenge_type not null,
  exercise_id uuid references public.exercises(id) on delete set null,
  routine_id uuid references public.routines(id) on delete set null,
  target_value numeric(8,2) not null check (target_value > 0),
  start_date date not null,
  end_date date not null,
  status public.challenge_status not null default 'active',
  created_at timestamptz not null default now(),
  check (end_date >= start_date),
  check (end_date - start_date <= 366),
  check (challenge_type <> 'weekly_workouts' or target_value between 1 and 6),
  check (challenge_type <> 'monthly_attendance' or target_value between 1 and 26),
  check (challenge_type <> 'exercise_improvement' or (exercise_id is not null and target_value <= 15)),
  check (challenge_type <> 'routine_consistency' or (routine_id is not null and target_value <= 90))
);
create index challenges_created_by_idx on public.challenges (created_by);

create table public.challenge_participants (
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  is_owner boolean not null default false, -- responsable del reto
  joined_at timestamptz not null default now(),
  primary key (challenge_id, user_id)
);
create index challenge_participants_user_idx on public.challenge_participants (user_id);

-- ---------- Notificaciones internas ----------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('scheduled_workout','challenge_ending','personal_record','goal_achieved','weekly_summary','partner')),
  title text not null,
  body text,
  link text check (link is null or link like '/%'),
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

-- >>> supabase/migrations/20261023000002_security.sql
-- =====================================================================
-- GYM BRO — Seguridad: funciones de autorización y Row Level Security
-- Principios:
--  * Cada usuario solo puede ESCRIBIR sus propios registros.
--  * El compañero solo puede LEER cuando existe una relación aceptada y el
--    dueño de los datos lo autorizó en sus preferencias (share_*).
--  * No hay columnas de rol/administración editables desde el cliente.
-- =====================================================================

-- El rol anónimo no necesita acceso a ninguna tabla (el login usa la API de Auth).
revoke all on all tables in schema public from anon;
revoke all on public.allowed_emails from authenticated;

-- ---------- Funciones de autorización ----------
create or replace function public.partner_id()
returns uuid language sql stable security definer set search_path = public as $$
  select case when p.requester_id = auth.uid() then p.addressee_id else p.requester_id end
  from public.partnerships p
  where p.status = 'accepted' and auth.uid() in (p.requester_id, p.addressee_id)
  limit 1
$$;

-- ¿Puede el usuario actual ver los datos de `owner` en el ámbito indicado?
create or replace function public.can_view(owner uuid, scope text)
returns boolean language sql stable security definer set search_path = public as $$
  select owner = auth.uid() or exists (
    select 1
    from public.partnerships p
    join public.user_preferences up on up.user_id = owner
    where p.status = 'accepted'
      and ((p.requester_id = owner and p.addressee_id = auth.uid())
        or (p.addressee_id = owner and p.requester_id = auth.uid()))
      and case scope
            when 'profile' then true
            when 'workouts' then up.share_workouts
            when 'measurements' then up.share_measurements
            when 'photos' then up.share_photos
            else false
          end
  )
$$;

create or replace function public.owns_routine(p_routine uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.routines r where r.id = p_routine and r.owner_id = auth.uid())
$$;

create or replace function public.can_view_routine(p_routine uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.routines r
    where r.id = p_routine
      and (r.owner_id = auth.uid() or (r.shared_with_partner and r.owner_id = public.partner_id()))
  )
$$;

create or replace function public.session_owner(p_session uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select user_id from public.workout_sessions where id = p_session
$$;

create or replace function public.workout_exercise_owner(p_we uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select s.user_id from public.workout_exercises we
  join public.workout_sessions s on s.id = we.session_id
  where we.id = p_we
$$;

create or replace function public.is_challenge_member(p_challenge uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.challenge_participants cp
                 where cp.challenge_id = p_challenge and cp.user_id = auth.uid())
      or exists (select 1 from public.challenges c
                 where c.id = p_challenge and c.created_by = auth.uid())
$$;

-- ---------- Activar RLS en todas las tablas ----------
alter table public.allowed_emails enable row level security;
alter table public.profiles enable row level security;
alter table public.user_preferences enable row level security;
alter table public.partnerships enable row level security;
alter table public.exercises enable row level security;
alter table public.exercise_muscles enable row level security;
alter table public.routines enable row level security;
alter table public.routine_days enable row level security;
alter table public.routine_exercises enable row level security;
alter table public.workout_sessions enable row level security;
alter table public.workout_exercises enable row level security;
alter table public.workout_sets enable row level security;
alter table public.body_measurements enable row level security;
alter table public.progress_photos enable row level security;
alter table public.personal_records enable row level security;
alter table public.goals enable row level security;
alter table public.scheduled_workouts enable row level security;
alter table public.challenges enable row level security;
alter table public.challenge_participants enable row level security;
alter table public.notifications enable row level security;

-- ---------- profiles ----------
create policy profiles_select on public.profiles for select to authenticated
  using (public.can_view(id, 'profile'));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- ---------- user_preferences (solo el dueño) ----------
create policy prefs_select on public.user_preferences for select to authenticated
  using (user_id = auth.uid());
create policy prefs_update on public.user_preferences for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- partnerships (altas y respuestas vía RPC) ----------
create policy partnerships_select on public.partnerships for select to authenticated
  using (auth.uid() in (requester_id, addressee_id));
create policy partnerships_delete on public.partnerships for delete to authenticated
  using (auth.uid() in (requester_id, addressee_id));

-- ---------- exercises ----------
create policy exercises_select on public.exercises for select to authenticated
  using (owner_id is null or owner_id = auth.uid() or owner_id = public.partner_id());
create policy exercises_insert on public.exercises for insert to authenticated
  with check (owner_id = auth.uid());
create policy exercises_update on public.exercises for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy exercises_delete on public.exercises for delete to authenticated
  using (owner_id = auth.uid());

create policy exercise_muscles_select on public.exercise_muscles for select to authenticated
  using (exists (select 1 from public.exercises e where e.id = exercise_id));
create policy exercise_muscles_write on public.exercise_muscles for all to authenticated
  using (exists (select 1 from public.exercises e where e.id = exercise_id and e.owner_id = auth.uid()))
  with check (exists (select 1 from public.exercises e where e.id = exercise_id and e.owner_id = auth.uid()));

-- ---------- routines ----------
create policy routines_select on public.routines for select to authenticated
  using (owner_id = auth.uid() or (shared_with_partner and owner_id = public.partner_id()));
create policy routines_insert on public.routines for insert to authenticated
  with check (owner_id = auth.uid());
create policy routines_update on public.routines for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy routines_delete on public.routines for delete to authenticated
  using (owner_id = auth.uid());

create policy routine_days_select on public.routine_days for select to authenticated
  using (public.can_view_routine(routine_id));
create policy routine_days_write on public.routine_days for all to authenticated
  using (public.owns_routine(routine_id)) with check (public.owns_routine(routine_id));

create policy routine_exercises_select on public.routine_exercises for select to authenticated
  using (exists (select 1 from public.routine_days d where d.id = routine_day_id and public.can_view_routine(d.routine_id)));
create policy routine_exercises_write on public.routine_exercises for all to authenticated
  using (exists (select 1 from public.routine_days d where d.id = routine_day_id and public.owns_routine(d.routine_id)))
  with check (exists (select 1 from public.routine_days d where d.id = routine_day_id and public.owns_routine(d.routine_id)));

-- ---------- workout_sessions / exercises / sets ----------
create policy sessions_select on public.workout_sessions for select to authenticated
  using (public.can_view(user_id, 'workouts'));
create policy sessions_insert on public.workout_sessions for insert to authenticated
  with check (user_id = auth.uid());
create policy sessions_update on public.workout_sessions for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy sessions_delete on public.workout_sessions for delete to authenticated
  using (user_id = auth.uid());

create policy wex_select on public.workout_exercises for select to authenticated
  using (public.can_view(public.session_owner(session_id), 'workouts'));
create policy wex_write on public.workout_exercises for all to authenticated
  using (public.session_owner(session_id) = auth.uid())
  with check (public.session_owner(session_id) = auth.uid());

create policy wset_select on public.workout_sets for select to authenticated
  using (public.can_view(public.workout_exercise_owner(workout_exercise_id), 'workouts'));
create policy wset_write on public.workout_sets for all to authenticated
  using (public.workout_exercise_owner(workout_exercise_id) = auth.uid())
  with check (public.workout_exercise_owner(workout_exercise_id) = auth.uid());

-- ---------- body_measurements ----------
create policy measurements_select on public.body_measurements for select to authenticated
  using (public.can_view(user_id, 'measurements'));
create policy measurements_insert on public.body_measurements for insert to authenticated
  with check (user_id = auth.uid());
create policy measurements_update on public.body_measurements for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy measurements_delete on public.body_measurements for delete to authenticated
  using (user_id = auth.uid());

-- ---------- progress_photos ----------
create policy photos_select on public.progress_photos for select to authenticated
  using (user_id = auth.uid() or (visible_to_partner and public.can_view(user_id, 'photos')));
create policy photos_insert on public.progress_photos for insert to authenticated
  with check (user_id = auth.uid());
create policy photos_update on public.progress_photos for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy photos_delete on public.progress_photos for delete to authenticated
  using (user_id = auth.uid());

-- ---------- personal_records (solo lectura; los escribe recompute_session_records) ----------
create policy records_select on public.personal_records for select to authenticated
  using (public.can_view(user_id, 'workouts'));

-- ---------- goals ----------
create policy goals_select on public.goals for select to authenticated
  using (public.can_view(user_id, 'workouts'));
create policy goals_insert on public.goals for insert to authenticated
  with check (user_id = auth.uid());
create policy goals_update on public.goals for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy goals_delete on public.goals for delete to authenticated
  using (user_id = auth.uid());

-- ---------- scheduled_workouts ----------
create policy schedule_select on public.scheduled_workouts for select to authenticated
  using (public.can_view(user_id, 'workouts'));
create policy schedule_insert on public.scheduled_workouts for insert to authenticated
  with check (user_id = auth.uid());
create policy schedule_update on public.scheduled_workouts for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy schedule_delete on public.scheduled_workouts for delete to authenticated
  using (user_id = auth.uid());

-- ---------- challenges ----------
create policy challenges_select on public.challenges for select to authenticated
  using (created_by = auth.uid() or public.is_challenge_member(id));
create policy challenges_insert on public.challenges for insert to authenticated
  with check (created_by = auth.uid());
create policy challenges_update on public.challenges for update to authenticated
  using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy challenges_delete on public.challenges for delete to authenticated
  using (created_by = auth.uid());

create policy cp_select on public.challenge_participants for select to authenticated
  using (public.is_challenge_member(challenge_id));
-- Solo el creador del reto añade participantes, y solo a sí mismo o a su compañero aceptado.
create policy cp_insert on public.challenge_participants for insert to authenticated
  with check (
    exists (select 1 from public.challenges c where c.id = challenge_id and c.created_by = auth.uid())
    and (user_id = auth.uid() or user_id = public.partner_id())
  );
create policy cp_delete on public.challenge_participants for delete to authenticated
  using (user_id = auth.uid()
    or exists (select 1 from public.challenges c where c.id = challenge_id and c.created_by = auth.uid()));

-- ---------- notifications (las crea el servidor) ----------
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_delete on public.notifications for delete to authenticated
  using (user_id = auth.uid());

-- Las notificaciones solo pueden cambiar read_at desde el cliente.
create or replace function public.protect_notification_columns()
returns trigger language plpgsql as $$
begin
  if new.user_id <> old.user_id or new.kind <> old.kind or new.title <> old.title
     or new.body is distinct from old.body or new.link is distinct from old.link then
    raise exception 'Solo se puede marcar la notificación como leída';
  end if;
  return new;
end $$;
create trigger notifications_protect before update on public.notifications
  for each row execute function public.protect_notification_columns();

-- Los récords y notificaciones no se insertan desde el cliente.
revoke insert on public.personal_records from authenticated;
revoke insert on public.notifications from authenticated;
revoke insert, delete on public.profiles from authenticated;
revoke insert, delete on public.user_preferences from authenticated;
revoke insert, update on public.partnerships from authenticated;

-- >>> supabase/migrations/20261023000003_functions.sql
-- =====================================================================
-- GYM BRO — Lógica de servidor (RPC)
-- =====================================================================

-- Fecha local de un instante según la zona horaria del usuario.
create or replace function public.user_local_date(p_user uuid, p_at timestamptz)
returns date language sql stable security definer set search_path = public as $$
  select (p_at at time zone coalesce(
    (select timezone from public.user_preferences where user_id = p_user), 'UTC'))::date
$$;

-- 1RM estimado (fórmula de Epley). Es una ESTIMACIÓN, no una medición real.
-- Con 1 repetición devuelve el peso levantado; más de 15 repeticiones no se estiman.
create or replace function public.epley_1rm(p_weight numeric, p_reps int)
returns numeric language sql immutable as $$
  select case
    when p_weight is null or p_weight <= 0 or p_reps is null or p_reps < 1 or p_reps > 15 then null
    when p_reps = 1 then p_weight
    else round(p_weight * (1 + p_reps / 30.0), 2)
  end
$$;

-- Series de trabajo (completadas, no calentamiento) de un usuario.
create or replace function public.working_sets(p_user uuid)
returns table (session_id uuid, started_at timestamptz, exercise_id uuid, set_id uuid,
               weight_kg numeric, reps int, e1rm numeric)
language sql stable security definer set search_path = public as $$
  select s.id, s.started_at, we.exercise_id, ws.id, ws.weight_kg, ws.reps::int,
         public.epley_1rm(ws.weight_kg, ws.reps)
  from public.workout_sessions s
  join public.workout_exercises we on we.session_id = s.id
  join public.workout_sets ws on ws.workout_exercise_id = we.id
  where s.user_id = p_user and s.status = 'completed'
    and ws.completed and ws.set_type <> 'warmup' and ws.reps > 0
$$;

-- ---------- Récords personales ----------
-- Recalcula (de forma idempotente) los récords obtenidos en una sesión completada,
-- comparando con el historial de sesiones ANTERIORES del mismo usuario.
create or replace function public.recompute_session_records(p_session uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
  v_started timestamptz;
  v_beaten int;
  v_notify boolean;
begin
  select user_id, started_at into v_user, v_started
  from public.workout_sessions where id = p_session and status = 'completed';
  if v_user is null then return 0; end if;
  if v_user <> auth.uid() then raise exception 'No autorizado' using errcode = '42501'; end if;

  delete from public.personal_records where session_id = p_session;

  -- Mayor peso levantado
  insert into public.personal_records (user_id, exercise_id, record_type, value, previous_value, weight_kg, reps, session_id, workout_set_id, achieved_at)
  select v_user, cur.exercise_id, 'max_weight', cur.weight_kg, prev.best, cur.weight_kg, cur.reps, p_session, cur.set_id, v_started
  from (select distinct on (exercise_id) * from public.working_sets(v_user)
        where session_id = p_session and weight_kg > 0
        order by exercise_id, weight_kg desc, reps desc) cur
  left join lateral (select max(w.weight_kg) best from public.working_sets(v_user) w
                     where w.exercise_id = cur.exercise_id and w.started_at < v_started) prev on true
  where prev.best is null or cur.weight_kg > prev.best;

  -- Mejor 1RM estimado
  insert into public.personal_records (user_id, exercise_id, record_type, value, previous_value, weight_kg, reps, session_id, workout_set_id, achieved_at)
  select v_user, cur.exercise_id, 'est_1rm', cur.e1rm, prev.best, cur.weight_kg, cur.reps, p_session, cur.set_id, v_started
  from (select distinct on (exercise_id) * from public.working_sets(v_user)
        where session_id = p_session and e1rm is not null
        order by exercise_id, e1rm desc) cur
  left join lateral (select max(w.e1rm) best from public.working_sets(v_user) w
                     where w.exercise_id = cur.exercise_id and w.started_at < v_started) prev on true
  where prev.best is null or cur.e1rm > prev.best;

  -- Más repeticiones con un peso determinado (solo si ya existía historial con ese peso)
  insert into public.personal_records (user_id, exercise_id, record_type, value, previous_value, weight_kg, reps, session_id, workout_set_id, achieved_at)
  select v_user, cur.exercise_id, 'max_reps_at_weight', cur.reps, prev.best, cur.weight_kg, cur.reps, p_session, cur.set_id, v_started
  from (select distinct on (exercise_id, weight_kg) * from public.working_sets(v_user)
        where session_id = p_session and weight_kg > 0
        order by exercise_id, weight_kg, reps desc) cur
  join lateral (select max(w.reps) best from public.working_sets(v_user) w
                where w.exercise_id = cur.exercise_id and w.weight_kg = cur.weight_kg
                  and w.started_at < v_started) prev on prev.best is not null
  where cur.reps > prev.best;

  -- Mayor volumen por sesión (peso × repeticiones, series de trabajo)
  insert into public.personal_records (user_id, exercise_id, record_type, value, previous_value, session_id, achieved_at)
  select v_user, cur.exercise_id, 'max_session_volume', cur.vol, prev.best, p_session, v_started
  from (select exercise_id, sum(weight_kg * reps) vol from public.working_sets(v_user)
        where session_id = p_session group by exercise_id having sum(weight_kg * reps) > 0) cur
  left join lateral (select max(v.vol) best from (
                       select w.session_id, sum(w.weight_kg * w.reps) vol from public.working_sets(v_user) w
                       where w.exercise_id = cur.exercise_id and w.started_at < v_started
                       group by w.session_id) v) prev on true
  where prev.best is null or cur.vol > prev.best;

  select count(*) into v_beaten from public.personal_records
  where session_id = p_session and previous_value is not null;

  select notify_records into v_notify from public.user_preferences where user_id = v_user;
  if v_beaten > 0 and coalesce(v_notify, true) then
    insert into public.notifications (user_id, kind, title, body, link, dedupe_key)
    values (v_user, 'personal_record', '¡Nuevos récords personales!',
            v_beaten || ' récord(s) superado(s) en tu última sesión.', '/progreso', 'pr:' || p_session)
    on conflict (user_id, dedupe_key) do update set body = excluded.body, read_at = null;
  end if;

  return v_beaten;
end $$;

-- Finaliza una sesión: la marca completada, calcula récords y la enlaza con el calendario.
-- El cliente llama esta función DESPUÉS de sincronizar ejercicios y series.
create or replace function public.finish_workout_session(p_session uuid, p_ended_at timestamptz default now())
returns int language plpgsql security definer set search_path = public as $$
declare
  v_started timestamptz;
  v_local date;
begin
  update public.workout_sessions
     set status = 'completed', ended_at = greatest(coalesce(p_ended_at, now()), started_at)
   where id = p_session and user_id = auth.uid() and status in ('in_progress', 'completed')
  returning started_at into v_started;
  if v_started is null then raise exception 'Sesión no encontrada' using errcode = 'P0002'; end if;

  v_local := public.user_local_date(auth.uid(), v_started);
  update public.scheduled_workouts
     set status = 'completed', session_id = p_session
   where id = (select id from public.scheduled_workouts
               where user_id = auth.uid() and scheduled_on = v_local
                 and status = 'scheduled' and session_id is null
               order by created_at limit 1);

  return public.recompute_session_records(p_session);
end $$;

-- ---------- Compañero (Gym Bro) ----------
create or replace function public.send_partner_request(p_email text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_target uuid;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'No autenticado' using errcode = '42501'; end if;
  select id into v_target from public.profiles where lower(email) = lower(trim(p_email));
  if v_target is null then raise exception 'No existe un usuario registrado con ese correo'; end if;
  if v_target = auth.uid() then raise exception 'No puedes invitarte a ti mismo'; end if;
  if exists (select 1 from public.partnerships
             where status = 'accepted' and (auth.uid() in (requester_id, addressee_id)
                                            or v_target in (requester_id, addressee_id))) then
    raise exception 'Uno de los dos ya tiene un Gym Bro vinculado';
  end if;
  delete from public.partnerships
   where status = 'rejected'
     and least(requester_id, addressee_id) = least(auth.uid(), v_target)
     and greatest(requester_id, addressee_id) = greatest(auth.uid(), v_target);
  insert into public.partnerships (requester_id, addressee_id) values (auth.uid(), v_target)
  returning id into v_id;
  insert into public.notifications (user_id, kind, title, body, link, dedupe_key)
  values (v_target, 'partner', 'Solicitud de Gym Bro',
          (select coalesce(nullif(full_name, ''), email) from public.profiles where id = auth.uid())
            || ' quiere vincularse contigo.', '/gym-bro', 'partner:' || v_id);
  return v_id;
end $$;

create or replace function public.respond_partner_request(p_id uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_row public.partnerships;
begin
  select * into v_row from public.partnerships where id = p_id and addressee_id = auth.uid() and status = 'pending';
  if v_row.id is null then raise exception 'Solicitud no encontrada'; end if;
  if p_accept and exists (select 1 from public.partnerships
                          where status = 'accepted' and id <> p_id
                            and (v_row.requester_id in (requester_id, addressee_id)
                                 or v_row.addressee_id in (requester_id, addressee_id))) then
    raise exception 'Uno de los dos ya tiene un Gym Bro vinculado';
  end if;
  update public.partnerships
     set status = case when p_accept then 'accepted'::public.partnership_status else 'rejected' end,
         responded_at = now()
   where id = p_id;
end $$;

-- ---------- Retos ----------
-- Progreso de cada participante, calculado en el servidor a partir de las sesiones reales.
create or replace function public.challenge_progress(p_challenge uuid)
returns table (user_id uuid, progress numeric, goal numeric, outcome text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  c public.challenges;
  v_today date := current_date;
begin
  if not public.is_challenge_member(p_challenge) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  select * into c from public.challenges where id = p_challenge;

  return query
  with parts as (
    select cp.user_id from public.challenge_participants cp where cp.challenge_id = c.id
  ),
  sess as (
    select s.user_id, s.routine_id, public.user_local_date(s.user_id, s.started_at) d, s.id
    from public.workout_sessions s
    join parts p on p.user_id = s.user_id
    where s.status = 'completed'
  ),
  calc as (
    select p.user_id,
      case c.challenge_type
        when 'weekly_workouts' then (
          select count(*)::numeric from (
            select wk from generate_series(date_trunc('week', c.start_date)::date, c.end_date, interval '7 day') wk
          ) w
          where (select count(*) from sess s where s.user_id = p.user_id
                   and s.d between greatest(w.wk::date, c.start_date) and least(w.wk::date + 6, c.end_date))
                >= c.target_value)
        when 'monthly_attendance' then (
          select count(*)::numeric from sess s where s.user_id = p.user_id and s.d between c.start_date and c.end_date)
        when 'routine_consistency' then (
          select count(*)::numeric from sess s where s.user_id = p.user_id and s.routine_id = c.routine_id
            and s.d between c.start_date and c.end_date)
        when 'exercise_improvement' then (
          select case when base.v is null or base.v = 0 or best.v is null then 0
                      else round((best.v - base.v) / base.v * 100, 1) end
          from (select max(w.e1rm) v from public.working_sets(p.user_id) w
                where w.exercise_id = c.exercise_id
                  and public.user_local_date(p.user_id, w.started_at) < c.start_date) base0,
          lateral (select coalesce(base0.v, (
                     select w.e1rm from public.working_sets(p.user_id) w
                     where w.exercise_id = c.exercise_id
                       and public.user_local_date(p.user_id, w.started_at) between c.start_date and c.end_date
                     order by w.started_at, w.e1rm desc nulls last limit 1)) v) base,
          lateral (select max(w.e1rm) v from public.working_sets(p.user_id) w
                   where w.exercise_id = c.exercise_id
                     and public.user_local_date(p.user_id, w.started_at) between c.start_date and c.end_date) best)
      end as progress,
      case c.challenge_type
        when 'weekly_workouts' then (
          select count(*)::numeric from generate_series(date_trunc('week', c.start_date)::date, c.end_date, interval '7 day'))
        else c.target_value
      end as goal
    from parts p
  )
  select calc.user_id, coalesce(calc.progress, 0), calc.goal,
    case
      when c.status = 'cancelled' then 'cancelled'
      when coalesce(calc.progress, 0) >= calc.goal then 'completed'
      when v_today > c.end_date then 'failed'
      else 'active'
    end
  from calc;
end $$;

-- ---------- Notificaciones internas generadas bajo demanda ----------
-- Idempotente (dedupe_key). El cliente la invoca al abrir la app; no envía nada externo.
create or replace function public.generate_due_notifications()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_prefs public.user_preferences;
  v_today date;
  v_week_start date;
  v_count int := 0;
  v_n int;
  v_sessions int;
  v_volume numeric;
begin
  if v_user is null then return 0; end if;
  select * into v_prefs from public.user_preferences where user_id = v_user;
  v_today := (now() at time zone coalesce(v_prefs.timezone, 'UTC'))::date;

  if v_prefs.notify_scheduled then
    insert into public.notifications (user_id, kind, title, body, link, dedupe_key)
    select v_user, 'scheduled_workout', 'Entrenamiento programado hoy',
           coalesce((select r.name from public.routines r where r.id = sw.routine_id), 'Sesión programada')
             || coalesce(' — ' || (select d.name from public.routine_days d where d.id = sw.routine_day_id), ''),
           '/entrenamiento', 'sched:' || sw.id
    from public.scheduled_workouts sw
    where sw.user_id = v_user and sw.scheduled_on = v_today and sw.status = 'scheduled'
    on conflict (user_id, dedupe_key) do nothing;
    get diagnostics v_n = row_count; v_count := v_count + v_n;
  end if;

  if v_prefs.notify_challenges then
    insert into public.notifications (user_id, kind, title, body, link, dedupe_key)
    select v_user, 'challenge_ending', 'Reto por finalizar',
           c.title || ' termina el ' || to_char(c.end_date, 'DD/MM/YYYY') || '.', '/gym-bro', 'chal_end:' || c.id
    from public.challenges c
    join public.challenge_participants cp on cp.challenge_id = c.id and cp.user_id = v_user
    where c.status = 'active' and c.end_date between v_today and v_today + 3
    on conflict (user_id, dedupe_key) do nothing;
    get diagnostics v_n = row_count; v_count := v_count + v_n;
  end if;

  if v_prefs.notify_weekly_summary then
    v_week_start := date_trunc('week', v_today)::date - 7; -- semana anterior (lunes a domingo)
    select count(distinct s.id), coalesce(sum(ws.weight_kg * ws.reps) filter (where ws.completed and ws.set_type <> 'warmup'), 0)
      into v_sessions, v_volume
    from public.workout_sessions s
    left join public.workout_exercises we on we.session_id = s.id
    left join public.workout_sets ws on ws.workout_exercise_id = we.id
    where s.user_id = v_user and s.status = 'completed'
      and public.user_local_date(v_user, s.started_at) between v_week_start and v_week_start + 6;
    if exists (select 1 from public.workout_sessions where user_id = v_user
               and public.user_local_date(v_user, started_at) <= v_week_start + 6) then
      insert into public.notifications (user_id, kind, title, body, link, dedupe_key)
      values (v_user, 'weekly_summary', 'Resumen semanal',
              'Semana del ' || to_char(v_week_start, 'DD/MM') || ': ' || v_sessions || ' entrenamiento(s), '
                || round(v_volume) || ' kg de volumen (series de trabajo).',
              '/historial', 'week:' || v_week_start)
      on conflict (user_id, dedupe_key) do nothing;
      get diagnostics v_n = row_count; v_count := v_count + v_n;
    end if;
  end if;

  return v_count;
end $$;

-- Notificación al completar un objetivo.
create or replace function public.on_goal_completed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    new.completed_at := coalesce(new.completed_at, now());
    if coalesce((select notify_goals from public.user_preferences where user_id = new.user_id), true) then
      insert into public.notifications (user_id, kind, title, body, link, dedupe_key)
      values (new.user_id, 'goal_achieved', '¡Objetivo alcanzado!', new.title, '/objetivos', 'goal:' || new.id)
      on conflict (user_id, dedupe_key) do nothing;
    end if;
  elsif new.status <> 'completed' then
    new.completed_at := null;
  end if;
  return new;
end $$;
create trigger goals_completed before update on public.goals
  for each row execute function public.on_goal_completed();

-- ---------- Permisos de ejecución ----------
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.partner_id(), public.can_view(uuid, text), public.owns_routine(uuid), public.can_view_routine(uuid),
  public.session_owner(uuid), public.workout_exercise_owner(uuid), public.is_challenge_member(uuid),
  public.user_local_date(uuid, timestamptz), public.epley_1rm(numeric, int),
  public.recompute_session_records(uuid), public.finish_workout_session(uuid, timestamptz),
  public.send_partner_request(text), public.respond_partner_request(uuid, boolean),
  public.challenge_progress(uuid), public.generate_due_notifications()
to authenticated;
-- working_sets() lee datos de cualquier usuario: solo para uso interno de otras funciones.
revoke execute on function public.working_sets(uuid) from authenticated;

-- >>> supabase/migrations/20261023000004_storage.sql
-- =====================================================================
-- GYM BRO — Almacenamiento privado (fotos de progreso y avatares)
-- Los archivos se guardan como  <user_id>/<uuid>.<ext>  en buckets PRIVADOS.
-- El cliente solo accede mediante URLs firmadas de corta duración.
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('progress-photos', 'progress-photos', false, 10485760, array['image/jpeg','image/png','image/webp']),
  ('avatars', 'avatars', false, 3145728, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false;

-- Fotos de progreso
create policy "progress_photos_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "progress_photos_select" on storage.objects for select to authenticated
  using (bucket_id = 'progress-photos' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (select 1 from public.progress_photos p
               where p.storage_path = objects.name
                 and p.visible_to_partner
                 and public.can_view(p.user_id, 'photos'))));

create policy "progress_photos_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- Avatares (visibles para el compañero vinculado)
create policy "avatars_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars_update_own" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars_select" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and exists (
    select 1 from public.profiles pr
    where pr.id::text = (storage.foldername(objects.name))[1] and public.can_view(pr.id, 'profile')));

create policy "avatars_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- >>> supabase/migrations/20261023000005_seed_exercises.sql
-- =====================================================================
-- GYM BRO — Biblioteca global de ejercicios (datos de referencia, no de usuario)
-- owner_id = null => visibles para todos. Generado por scripts/gen-exercise-seed.py
-- =====================================================================
insert into public.exercises (name, primary_muscle, mechanics, modality, equipment, instructions, common_mistakes) values
  ('Press de banca con barra', 'chest', 'compound', 'free_weight', 'Barra y banco plano', 'Acuéstate con los ojos bajo la barra, escápulas retraídas y pies firmes. Baja la barra controlada hasta la parte media del pecho y empuja hasta extender los codos.', 'Rebotar la barra en el pecho; despegar los glúteos del banco; abrir los codos a 90°.'),
  ('Press inclinado con mancuernas', 'chest', 'compound', 'free_weight', 'Mancuernas y banco inclinado', 'Banco a 30-45°. Baja las mancuernas a los lados del pecho superior con los codos a unos 45° y empuja hacia arriba.', 'Inclinación excesiva del banco; rango de movimiento corto.'),
  ('Press de pecho en máquina', 'chest', 'compound', 'machine', 'Máquina de press', 'Ajusta el asiento para que las manijas queden a la altura del pecho medio. Empuja sin bloquear los codos de golpe.', 'Asiento mal ajustado; despegar la espalda del respaldo.'),
  ('Aperturas con mancuernas', 'chest', 'isolation', 'free_weight', 'Mancuernas y banco', 'Con codos ligeramente flexionados, abre los brazos en arco hasta sentir estiramiento en el pecho y vuelve a juntar.', 'Bajar demasiado con peso excesivo; convertirlo en un press.'),
  ('Cruce de poleas', 'chest', 'isolation', 'cable', 'Poleas altas', 'Da un paso al frente, torso ligeramente inclinado, y junta las manos frente al pecho en arco.', 'Usar impulso del torso; flexionar demasiado los codos.'),
  ('Fondos en paralelas', 'chest', 'compound', 'bodyweight', 'Barras paralelas', 'Inclina el torso hacia adelante, baja hasta que los hombros queden a la altura de los codos y empuja.', 'Bajar demasiado con dolor de hombro; balancearse.'),
  ('Flexiones', 'chest', 'compound', 'bodyweight', 'Ninguno', 'Cuerpo en línea recta, manos algo más abiertas que los hombros. Baja el pecho cerca del suelo y empuja.', 'Cadera caída; codos totalmente abiertos.'),
  ('Dominadas', 'back', 'compound', 'bodyweight', 'Barra fija', 'Agarre prono algo más ancho que los hombros. Tira llevando el pecho hacia la barra y baja controlado hasta extender.', 'Kipping sin control; medio rango de movimiento.'),
  ('Jalón al pecho', 'back', 'compound', 'cable', 'Polea alta con barra', 'Siéntate con los muslos fijos, tira la barra hacia la parte alta del pecho llevando los codos hacia abajo.', 'Inclinarse demasiado atrás; tirar con los brazos en lugar de la espalda.'),
  ('Remo con barra', 'back', 'compound', 'free_weight', 'Barra', 'Bisagra de cadera con espalda neutra, tira la barra hacia el abdomen bajo y baja controlado.', 'Redondear la espalda baja; usar impulso de la cadera.'),
  ('Remo con mancuerna a una mano', 'back', 'compound', 'free_weight', 'Mancuerna y banco', 'Apoya rodilla y mano en el banco. Tira la mancuerna hacia la cadera manteniendo el torso estable.', 'Rotar el torso; encoger el hombro.'),
  ('Remo sentado en polea', 'back', 'compound', 'cable', 'Polea baja con agarre en V', 'Torso erguido, tira el agarre hacia el abdomen juntando escápulas y extiende controlado.', 'Balancear el torso; encoger hombros.'),
  ('Peso muerto convencional', 'back', 'compound', 'free_weight', 'Barra', 'Barra sobre medio pie, espalda neutra, empuja el suelo con las piernas y extiende la cadera. Baja con control.', 'Redondear la espalda; alejar la barra del cuerpo; hiperextender arriba.'),
  ('Pullover en polea', 'back', 'isolation', 'cable', 'Polea alta con cuerda o barra', 'Con brazos casi extendidos, lleva la barra desde arriba hasta los muslos usando los dorsales.', 'Flexionar los codos convirtiéndolo en un jalón de tríceps.'),
  ('Press militar con barra', 'shoulders', 'compound', 'free_weight', 'Barra', 'De pie, glúteos y abdomen firmes. Empuja la barra desde la clavícula hasta arriba de la cabeza.', 'Arquear la zona lumbar; empujar la barra hacia adelante.'),
  ('Press de hombros con mancuernas', 'shoulders', 'compound', 'free_weight', 'Mancuernas y banco', 'Sentado con respaldo, empuja las mancuernas desde la altura de las orejas hasta arriba.', 'Rango corto; arquear la espalda.'),
  ('Elevaciones laterales', 'shoulders', 'isolation', 'free_weight', 'Mancuernas', 'Eleva las mancuernas a los lados hasta la altura de los hombros con codos ligeramente flexionados.', 'Usar impulso; subir por encima de los hombros encogiendo trapecios.'),
  ('Elevaciones laterales en polea', 'shoulders', 'isolation', 'cable', 'Polea baja', 'De lado a la polea, eleva el brazo hasta la altura del hombro con control.', 'Inclinar el torso para ayudar.'),
  ('Face pull', 'shoulders', 'isolation', 'cable', 'Polea con cuerda', 'Tira la cuerda hacia la cara separando las manos y rotando externamente los hombros.', 'Usar demasiado peso; tirar hacia el pecho.'),
  ('Pájaros (deltoides posterior)', 'shoulders', 'isolation', 'free_weight', 'Mancuernas', 'Inclinado con espalda neutra, abre los brazos a los lados con codos suaves.', 'Tirar con la espalda baja; usar impulso.'),
  ('Curl con barra', 'biceps', 'isolation', 'free_weight', 'Barra', 'Codos pegados al cuerpo, flexiona hasta contraer el bíceps y baja controlado.', 'Balancear el torso; adelantar los codos.'),
  ('Curl con mancuernas alterno', 'biceps', 'isolation', 'free_weight', 'Mancuernas', 'Flexiona un brazo a la vez supinando la muñeca durante la subida.', 'Rango incompleto; usar impulso.'),
  ('Curl martillo', 'biceps', 'isolation', 'free_weight', 'Mancuernas', 'Agarre neutro, flexiona los codos sin moverlos de los costados.', 'Balancear; separar los codos.'),
  ('Curl en polea', 'biceps', 'isolation', 'cable', 'Polea baja', 'Frente a la polea, flexiona con codos fijos manteniendo tensión constante.', 'Inclinarse hacia atrás.'),
  ('Curl predicador', 'biceps', 'isolation', 'machine', 'Banco Scott o máquina', 'Brazos apoyados en el cojín, flexiona y baja casi a extensión completa controlado.', 'Dejar caer el peso abajo; despegar los codos.'),
  ('Extensión de tríceps en polea', 'triceps', 'isolation', 'cable', 'Polea alta con cuerda o barra', 'Codos fijos a los costados, extiende hasta bloquear y regresa controlado.', 'Mover los codos; inclinarse sobre la polea.'),
  ('Press francés', 'triceps', 'isolation', 'free_weight', 'Barra Z y banco', 'Acostado, baja la barra hacia la frente flexionando solo los codos y extiende.', 'Abrir los codos; mover los hombros.'),
  ('Extensión de tríceps sobre la cabeza', 'triceps', 'isolation', 'cable', 'Polea con cuerda', 'De espaldas a la polea, extiende los brazos por encima de la cabeza manteniendo los codos cerca.', 'Arquear la espalda; abrir los codos.'),
  ('Press de banca agarre cerrado', 'triceps', 'compound', 'free_weight', 'Barra y banco', 'Agarre al ancho de hombros, codos cerca del torso, baja al pecho bajo y empuja.', 'Agarre demasiado cerrado que fuerza las muñecas.'),
  ('Curl de muñeca', 'forearms', 'isolation', 'free_weight', 'Barra o mancuernas', 'Antebrazos apoyados, flexiona las muñecas hacia arriba y baja controlado.', 'Usar todo el brazo; rango corto.'),
  ('Paseo del granjero', 'forearms', 'compound', 'free_weight', 'Mancuernas pesadas', 'Camina erguido sosteniendo pesos a los lados con pasos cortos y controlados.', 'Inclinarse; encoger los hombros.'),
  ('Sentadilla con barra', 'quads', 'compound', 'free_weight', 'Barra y rack', 'Barra sobre trapecios, pies al ancho de hombros. Baja con la espalda neutra hasta al menos paralelo y sube empujando el suelo.', 'Rodillas hacia adentro; talones despegados; redondear la espalda.'),
  ('Prensa de piernas', 'quads', 'compound', 'machine', 'Máquina de prensa', 'Pies al ancho de cadera en la plataforma. Baja controlado sin despegar la pelvis y empuja sin bloquear las rodillas.', 'Bajar tanto que la pelvis se despega; bloquear las rodillas.'),
  ('Sentadilla búlgara', 'quads', 'compound', 'free_weight', 'Mancuernas y banco', 'Pie trasero sobre el banco. Baja la rodilla trasera hacia el suelo manteniendo el torso estable.', 'Pie delantero demasiado cerca; perder el equilibrio por prisa.'),
  ('Extensión de cuádriceps', 'quads', 'isolation', 'machine', 'Máquina de extensión', 'Ajusta el rodillo sobre los tobillos. Extiende las rodillas y baja controlado.', 'Patear el peso; levantar la cadera del asiento.'),
  ('Sentadilla hack', 'quads', 'compound', 'machine', 'Máquina hack', 'Espalda apoyada, baja controlado hasta una profundidad cómoda y empuja.', 'Despegar los talones; rodillas hacia adentro.'),
  ('Zancadas', 'quads', 'compound', 'free_weight', 'Mancuernas', 'Da un paso largo y baja hasta que ambas rodillas formen unos 90°. Empuja para volver.', 'Rodilla delantera colapsando hacia adentro.'),
  ('Peso muerto rumano', 'hamstrings', 'compound', 'free_weight', 'Barra o mancuernas', 'Rodillas suaves, lleva la cadera atrás bajando la barra pegada a las piernas hasta sentir estiramiento.', 'Redondear la espalda; flexionar demasiado las rodillas.'),
  ('Curl femoral acostado', 'hamstrings', 'isolation', 'machine', 'Máquina de curl femoral', 'Acostado boca abajo, flexiona las rodillas llevando el rodillo hacia los glúteos.', 'Levantar la cadera; usar impulso.'),
  ('Curl femoral sentado', 'hamstrings', 'isolation', 'machine', 'Máquina de curl femoral sentado', 'Ajusta el respaldo y flexiona las rodillas con control.', 'Rango incompleto.'),
  ('Hip thrust con barra', 'glutes', 'compound', 'free_weight', 'Barra y banco', 'Espalda alta sobre el banco, empuja la cadera hacia arriba hasta alinear torso y muslos, contrae glúteos.', 'Hiperextender la espalda baja; pies demasiado lejos.'),
  ('Patada de glúteo en polea', 'glutes', 'isolation', 'cable', 'Polea baja con tobillera', 'Extiende la cadera llevando la pierna hacia atrás sin arquear la espalda.', 'Arquear la zona lumbar.'),
  ('Abducción de cadera en máquina', 'glutes', 'isolation', 'machine', 'Máquina abductora', 'Sentado, abre las piernas contra la resistencia y vuelve controlado.', 'Usar impulso; rango corto.'),
  ('Elevación de talones de pie', 'calves', 'isolation', 'machine', 'Máquina o escalón', 'Sube sobre las puntas lo más alto posible, pausa, y baja hasta estirar la pantorrilla.', 'Rebotar; rango corto.'),
  ('Elevación de talones sentado', 'calves', 'isolation', 'machine', 'Máquina de pantorrilla sentado', 'Con las rodillas bajo el cojín, eleva los talones y baja con control.', 'Rebotar abajo.'),
  ('Plancha', 'abs', 'isolation', 'bodyweight', 'Ninguno', 'Apoya antebrazos y puntas, cuerpo en línea recta, abdomen y glúteos firmes.', 'Cadera caída o demasiado alta; contener la respiración.'),
  ('Crunch en polea', 'abs', 'isolation', 'cable', 'Polea alta con cuerda', 'De rodillas, flexiona el tronco llevando los codos hacia las rodillas.', 'Tirar con los brazos; mover la cadera.'),
  ('Elevación de piernas colgado', 'abs', 'isolation', 'bodyweight', 'Barra fija', 'Colgado, eleva las piernas controlando el balanceo y baja lentamente.', 'Balancearse; usar impulso.'),
  ('Rueda abdominal', 'abs', 'compound', 'bodyweight', 'Rueda abdominal', 'De rodillas, rueda hacia adelante manteniendo el abdomen firme y regresa sin arquear la espalda.', 'Arquear la zona lumbar; ir más lejos de lo que se controla.')
on conflict do nothing;

insert into public.exercise_muscles (exercise_id, muscle)
select e.id, m.muscle::public.muscle_group
from (values
  ('Press de banca con barra', 'triceps'),
  ('Press de banca con barra', 'shoulders'),
  ('Press inclinado con mancuernas', 'shoulders'),
  ('Press inclinado con mancuernas', 'triceps'),
  ('Press de pecho en máquina', 'triceps'),
  ('Press de pecho en máquina', 'shoulders'),
  ('Cruce de poleas', 'shoulders'),
  ('Fondos en paralelas', 'triceps'),
  ('Fondos en paralelas', 'shoulders'),
  ('Flexiones', 'triceps'),
  ('Flexiones', 'shoulders'),
  ('Flexiones', 'abs'),
  ('Dominadas', 'biceps'),
  ('Dominadas', 'forearms'),
  ('Jalón al pecho', 'biceps'),
  ('Remo con barra', 'biceps'),
  ('Remo con barra', 'hamstrings'),
  ('Remo con mancuerna a una mano', 'biceps'),
  ('Remo sentado en polea', 'biceps'),
  ('Peso muerto convencional', 'hamstrings'),
  ('Peso muerto convencional', 'glutes'),
  ('Peso muerto convencional', 'forearms'),
  ('Press militar con barra', 'triceps'),
  ('Press de hombros con mancuernas', 'triceps'),
  ('Face pull', 'back'),
  ('Pájaros (deltoides posterior)', 'back'),
  ('Curl con barra', 'forearms'),
  ('Curl con mancuernas alterno', 'forearms'),
  ('Curl martillo', 'forearms'),
  ('Curl en polea', 'forearms'),
  ('Press de banca agarre cerrado', 'chest'),
  ('Press de banca agarre cerrado', 'shoulders'),
  ('Paseo del granjero', 'abs'),
  ('Paseo del granjero', 'back'),
  ('Sentadilla con barra', 'glutes'),
  ('Sentadilla con barra', 'hamstrings'),
  ('Sentadilla con barra', 'abs'),
  ('Prensa de piernas', 'glutes'),
  ('Prensa de piernas', 'hamstrings'),
  ('Sentadilla búlgara', 'glutes'),
  ('Sentadilla hack', 'glutes'),
  ('Zancadas', 'glutes'),
  ('Zancadas', 'hamstrings'),
  ('Peso muerto rumano', 'glutes'),
  ('Peso muerto rumano', 'back'),
  ('Hip thrust con barra', 'hamstrings'),
  ('Plancha', 'shoulders'),
  ('Elevación de piernas colgado', 'forearms'),
  ('Rueda abdominal', 'shoulders'),
  ('Rueda abdominal', 'back')
) as m(name, muscle)
join public.exercises e on e.owner_id is null and e.name = m.name
on conflict do nothing;

-- >>> supabase/migrations/20261024000006_ai_assistant.sql
-- =====================================================================
-- GYM BRO — Asistente de IA: cuota diaria por usuario
-- La función serverless /api/assistant llama consume_ai_quota() con el JWT
-- del usuario antes de cada consulta. El cliente no puede escribir la tabla.
-- =====================================================================
create table public.ai_usage (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  requests int not null default 0 check (requests >= 0),
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
create policy ai_usage_select on public.ai_usage for select to authenticated
  using (user_id = auth.uid());
revoke insert, update, delete on public.ai_usage from authenticated;
revoke all on public.ai_usage from anon;

-- Suma una consulta al día local del usuario. Devuelve cuántas quedan
-- (-1 si ya se alcanzó el límite y no se contó).
create or replace function public.consume_ai_quota(p_daily_limit int default 40)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_day date;
  v_used int;
  v_limit int := least(greatest(coalesce(p_daily_limit, 40), 1), 200);
begin
  if v_user is null then raise exception 'No autenticado' using errcode = '42501'; end if;
  v_day := public.user_local_date(v_user, now());
  insert into public.ai_usage (user_id, day, requests) values (v_user, v_day, 0)
  on conflict (user_id, day) do nothing;
  update public.ai_usage set requests = requests + 1
   where user_id = v_user and day = v_day and requests < v_limit
  returning requests into v_used;
  if v_used is null then return -1; end if;
  return v_limit - v_used;
end $$;

revoke execute on function public.consume_ai_quota(int) from public, anon;
grant execute on function public.consume_ai_quota(int) to authenticated;
