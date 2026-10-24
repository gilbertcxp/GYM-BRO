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
