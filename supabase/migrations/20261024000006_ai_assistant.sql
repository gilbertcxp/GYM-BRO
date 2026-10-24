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
