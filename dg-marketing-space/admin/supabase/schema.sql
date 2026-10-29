-- DG Marketing Space – database schema (run once in Supabase → SQL Editor)
create extension if not exists pgcrypto;

create table if not exists public.employees (
  id                 uuid primary key default gen_random_uuid(),
  username           text not null unique check (username = lower(username)),
  display_name       text,
  password_hash      text not null,
  role               text not null default 'employee' check (role in ('admin', 'employee')),
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  last_login_at      timestamptz,
  last_seen_at       timestamptz,
  last_status        text,
  last_app           text,
  last_display_count int
);

create table if not exists public.telemetry_reports (
  id                    bigint generated always as identity primary key,
  employee_id           uuid not null references public.employees(id) on delete cascade,
  period_start          timestamptz not null,
  period_end            timestamptz not null,
  active_seconds        int not null default 0,
  idle_seconds          int not null default 0,
  locked_seconds        int not null default 0,
  clicks                int not null default 0,
  mouse_moves           int not null default 0,
  mouse_active_seconds  int not null default 0,
  mouse_distance_px     bigint not null default 0,
  display_count         int not null default 1,
  multi_monitor_seconds int not null default 0,
  workflow_seconds      int not null default 0,
  external_seconds      int not null default 0,
  apps                  jsonb not null default '[]',
  urls                  jsonb not null default '[]',
  displays              jsonb not null default '[]',
  events                jsonb not null default '[]',
  client                jsonb,
  received_at           timestamptz not null default now()
);

create index if not exists telemetry_reports_emp_time on public.telemetry_reports (employee_id, period_start desc);
create index if not exists telemetry_reports_time on public.telemetry_reports (period_start);

-- Only the server (service role) may touch these tables. No policies = no public access.
alter table public.employees enable row level security;
alter table public.telemetry_reports enable row level security;

-- ---------- reporting functions ----------
create or replace function public.dg_summary(p_from timestamptz, p_to timestamptz)
returns table (
  employee_id uuid, active_seconds bigint, idle_seconds bigint, locked_seconds bigint,
  clicks bigint, mouse_moves bigint, mouse_active_seconds bigint, max_displays int,
  multi_monitor_seconds bigint, workflow_seconds bigint, external_seconds bigint, reports bigint
) language sql stable as $$
  select r.employee_id, sum(r.active_seconds), sum(r.idle_seconds), sum(r.locked_seconds),
         sum(r.clicks), sum(r.mouse_moves), sum(r.mouse_active_seconds), max(r.display_count),
         sum(r.multi_monitor_seconds), sum(r.workflow_seconds), sum(r.external_seconds), count(*)
  from public.telemetry_reports r
  where r.period_start >= p_from and r.period_start < p_to
  group by r.employee_id
$$;

create or replace function public.dg_timeline(p_from timestamptz, p_to timestamptz, p_tz text, p_bucket text, p_employee uuid default null)
returns table (bucket timestamp, active_seconds bigint, idle_seconds bigint, workflow_seconds bigint, external_seconds bigint)
language sql stable as $$
  select date_trunc(case when p_bucket = 'day' then 'day' else 'hour' end, r.period_start at time zone p_tz),
         sum(r.active_seconds), sum(r.idle_seconds), sum(r.workflow_seconds), sum(r.external_seconds)
  from public.telemetry_reports r
  where r.period_start >= p_from and r.period_start < p_to
    and (p_employee is null or r.employee_id = p_employee)
  group by 1 order by 1
$$;

create or replace function public.dg_user_apps(p_employee uuid, p_from timestamptz, p_to timestamptz)
returns table (name text, workflow boolean, display text, seconds bigint)
language sql stable as $$
  select a->>'name', bool_or(coalesce((a->>'workflow')::boolean, false)), d.key, sum(d.value::numeric)::bigint
  from public.telemetry_reports r
  cross join lateral jsonb_array_elements(r.apps) a
  cross join lateral jsonb_each_text(coalesce(a->'displays', '{}'::jsonb)) d
  where r.employee_id = p_employee and r.period_start >= p_from and r.period_start < p_to
  group by 1, 3 order by 4 desc limit 300
$$;

create or replace function public.dg_user_urls(p_employee uuid, p_from timestamptz, p_to timestamptz, p_limit int default 25)
returns table (url text, seconds bigint, visits bigint)
language sql stable as $$
  select u->>'url', sum(coalesce((u->>'seconds')::numeric, 0))::bigint, sum(coalesce((u->>'visits')::numeric, 0))::bigint
  from public.telemetry_reports r
  cross join lateral jsonb_array_elements(r.urls) u
  where r.employee_id = p_employee and r.period_start >= p_from and r.period_start < p_to
  group by 1 order by 2 desc, 3 desc limit p_limit
$$;

create or replace function public.dg_user_displays(p_employee uuid, p_from timestamptz, p_to timestamptz)
returns table (display text, seconds bigint, workflow_seconds bigint, external_seconds bigint)
language sql stable as $$
  select d->>'display', sum(coalesce((d->>'seconds')::numeric, 0))::bigint,
         sum(coalesce((d->>'workflowSeconds')::numeric, 0))::bigint, sum(coalesce((d->>'externalSeconds')::numeric, 0))::bigint
  from public.telemetry_reports r
  cross join lateral jsonb_array_elements(r.displays) d
  where r.employee_id = p_employee and r.period_start >= p_from and r.period_start < p_to
  group by 1 order by 2 desc
$$;

create or replace function public.dg_user_events(p_employee uuid, p_from timestamptz, p_to timestamptz, p_limit int default 40)
returns table (at timestamptz, type text, detail text)
language sql stable as $$
  select (e->>'at')::timestamptz, e->>'type', e->>'detail'
  from public.telemetry_reports r
  cross join lateral jsonb_array_elements(r.events) e
  where r.employee_id = p_employee and r.period_start >= p_from and r.period_start < p_to
  order by 1 desc limit p_limit
$$;

-- Functions are callable by the server only.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'dg\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

-- Optional retention (enable pg_cron in Supabase → Database → Extensions first):
-- select cron.schedule('dg-retention', '15 3 * * *',
--   $$delete from public.telemetry_reports where period_start < now() - interval '90 days'$$);
