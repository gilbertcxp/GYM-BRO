-- =====================================================================
-- GYM BRO — Cardio con GPS
-- * cardio_sessions: modo de seguimiento (manual/gps) y hora de fin.
-- * cardio_routes: coordenadas del recorrido (una fila por sesión).
--   Una ruta GPS revela lugares frecuentes (p. ej. la casa), por eso tiene su
--   propio permiso `share_routes`, desactivado por defecto e independiente de
--   compartir entrenamientos.
-- * profiles.cardio_weekly_goal_km: meta semanal visible para el compañero,
--   para comparar el progreso de cada uno frente a su propia meta.
-- La distancia se mantiene en km con 3 decimales (precisión de 1 metro).
-- =====================================================================
alter table public.cardio_sessions
  add column tracking_mode text not null default 'manual' check (tracking_mode in ('manual', 'gps')),
  add column ended_at timestamptz;
alter table public.cardio_sessions
  add constraint cardio_sessions_ended_after_start check (ended_at is null or ended_at >= started_at);

alter table public.user_preferences
  add column share_routes boolean not null default false;

alter table public.profiles
  add column cardio_weekly_goal_km numeric(6,2) check (cardio_weekly_goal_km is null or cardio_weekly_goal_km between 0.5 and 1000);

-- Nuevo ámbito 'routes' en la función de autorización.
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
            when 'routes' then up.share_workouts and up.share_routes
            else false
          end
  )
$$;

-- Puntos: [[lat, lng, segundos_desde_inicio, segmento], ...]. El segmento cambia tras
-- cada pausa para no unir con una línea ni sumar distancia entre pausas.
create table public.cardio_routes (
  session_id uuid primary key references public.cardio_sessions(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  points jsonb not null check (jsonb_typeof(points) = 'array' and jsonb_array_length(points) between 2 and 20000),
  created_at timestamptz not null default now()
);
create index cardio_routes_user_idx on public.cardio_routes (user_id);

create or replace function public.cardio_session_owner(p_session uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select user_id from public.cardio_sessions where id = p_session
$$;
revoke execute on function public.cardio_session_owner(uuid) from public, anon;
grant execute on function public.cardio_session_owner(uuid) to authenticated;

alter table public.cardio_routes enable row level security;
create policy cardio_routes_select on public.cardio_routes for select to authenticated
  using (public.can_view(user_id, 'routes'));
create policy cardio_routes_insert on public.cardio_routes for insert to authenticated
  with check (user_id = auth.uid() and public.cardio_session_owner(session_id) = auth.uid());
create policy cardio_routes_update on public.cardio_routes for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.cardio_session_owner(session_id) = auth.uid());
create policy cardio_routes_delete on public.cardio_routes for delete to authenticated
  using (user_id = auth.uid());
revoke all on public.cardio_routes from anon;
