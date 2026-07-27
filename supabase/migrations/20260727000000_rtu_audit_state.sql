-- Shared audit progress for the QuadReal RTU Audit field app.
--
-- Until now each phone kept its own progress in localStorage, so two technicians
-- working the same park could not see each other's work. This table is the single
-- copy every device syncs against.
--
-- Trust model: devices never talk to PostgREST. They call the rtu-pictures-api Worker
-- with the shared field password, and the Worker uses the Supabase service key. So this
-- table has no write policy at all — RLS denies everything the service key does not do.
--
-- Applied to project wyiymdtlncperqpwriuk (QR-East_Industrial_Database).

create table if not exists public.rtu_audit_state (
  building_slug text not null check (char_length(building_slug) between 1 and 120),
  rtu_key text not null check (char_length(rtu_key) between 1 and 64),
  -- Nullable on purpose: the app keys RTUs by slug + key, and matching those to the
  -- numeric inventory ids is a separate reconciliation job. Sync must not wait on it.
  rtu_id bigint references public.rtus(id) on delete set null,
  started boolean not null default false,
  complete boolean not null default false,
  photos_done boolean not null default false,
  note text not null default '' check (char_length(note) <= 4000),
  updated_at timestamptz not null default now(),
  updated_by text check (updated_by is null or char_length(updated_by) <= 64),
  primary key (building_slug, rtu_key)
);

comment on table public.rtu_audit_state is 'Shared per-RTU audit progress from the QuadReal RTU Audit field app. Written only by the rtu-pictures-api Worker using the service key; devices never talk to PostgREST directly.';

-- Devices pull incrementally: "everything changed since my last sync".
create index if not exists rtu_audit_state_updated_at_idx on public.rtu_audit_state (updated_at);

alter table public.rtu_audit_state enable row level security;

drop policy if exists "Editors read rtu_audit_state" on public.rtu_audit_state;
create policy "Editors read rtu_audit_state" on public.rtu_audit_state
  for select to authenticated using (public.is_app_editor());

-- Newest edit wins, resolved server-side so two offline devices converge.
create or replace function public.rtu_audit_state_sync(changes jsonb)
returns setof public.rtu_audit_state
language sql
set search_path = ''
as $$
  with input as (
    -- A device can queue the same RTU more than once while offline; ON CONFLICT can only
    -- touch a row once per statement, so collapse to the latest edit per RTU first.
    select distinct on (c.building_slug, c.rtu_key)
      c.building_slug,
      c.rtu_key,
      coalesce(c.started, false) as started,
      coalesce(c.complete, false) as complete,
      coalesce(c.photos_done, false) as photos_done,
      left(coalesce(c.note, ''), 4000) as note,
      -- A device clock running fast would otherwise pin a row so no later edit can win.
      least(c.updated_at, now()) as updated_at,
      left(c.updated_by, 64) as updated_by
    from jsonb_to_recordset(changes) as c(
      building_slug text, rtu_key text, started boolean, complete boolean,
      photos_done boolean, note text, updated_at timestamptz, updated_by text
    )
    where c.building_slug is not null and char_length(c.building_slug) between 1 and 120
      and c.rtu_key is not null and char_length(c.rtu_key) between 1 and 64
      and c.updated_at is not null
    order by c.building_slug, c.rtu_key, c.updated_at desc
  ),
  upserted as (
    insert into public.rtu_audit_state as t (
      building_slug, rtu_key, started, complete, photos_done, note, updated_at, updated_by
    )
    select building_slug, rtu_key, started, complete, photos_done, note, updated_at, updated_by
    from input
    on conflict (building_slug, rtu_key) do update set
      started = excluded.started,
      complete = excluded.complete,
      photos_done = excluded.photos_done,
      note = excluded.note,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by
    where excluded.updated_at > t.updated_at
    returning t.*
  )
  -- Rows the client lost the race on are returned at their stored value, so the device
  -- can correct itself in the same round trip instead of waiting for the next pull.
  select * from upserted
  union all
  select s.* from public.rtu_audit_state s
  join input i on i.building_slug = s.building_slug and i.rtu_key = s.rtu_key
  where not exists (
    select 1 from upserted u
    where u.building_slug = s.building_slug and u.rtu_key = s.rtu_key
  );
$$;

-- Only the Worker's service key may sync. Anything holding the anon key gets nothing.
revoke all on function public.rtu_audit_state_sync(jsonb) from public;
revoke all on function public.rtu_audit_state_sync(jsonb) from anon;
revoke all on function public.rtu_audit_state_sync(jsonb) from authenticated;
grant execute on function public.rtu_audit_state_sync(jsonb) to service_role;
