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
