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
