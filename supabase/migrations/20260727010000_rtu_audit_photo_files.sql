-- Carry photo object keys in the shared audit state.
--
-- Photos themselves stay in the rtu-pictures R2 bucket; only their keys travel through
-- Supabase so a device that did not take a photo knows what to ask the Worker for. A key
-- is published only after the upload succeeds, so a second device never chases a file
-- that has not landed yet.

alter table public.rtu_audit_state
  add column if not exists photo_files jsonb not null default '[]'::jsonb;

alter table public.rtu_audit_state
  drop constraint if exists rtu_audit_state_photo_files_shape;
alter table public.rtu_audit_state
  add constraint rtu_audit_state_photo_files_shape
  check (jsonb_typeof(photo_files) = 'array' and jsonb_array_length(photo_files) <= 4);

comment on column public.rtu_audit_state.photo_files is 'Object keys in the rtu-pictures R2 bucket, one entry per photo slot (null where empty). Recorded only after a successful upload, so another device never tries to fetch a photo that has not landed yet.';

-- The return type follows the table's composite type, so the new column needs a drop
-- rather than a replace.
drop function if exists public.rtu_audit_state_sync(jsonb);

create function public.rtu_audit_state_sync(changes jsonb)
returns setof public.rtu_audit_state
language sql
set search_path = ''
as $$
  with input as (
    select distinct on (c.building_slug, c.rtu_key)
      c.building_slug,
      c.rtu_key,
      coalesce(c.started, false) as started,
      coalesce(c.complete, false) as complete,
      coalesce(c.photos_done, false) as photos_done,
      left(coalesce(c.note, ''), 4000) as note,
      least(c.updated_at, now()) as updated_at,
      left(c.updated_by, 64) as updated_by,
      -- Coerce a malformed array to empty so one bad row cannot fail a whole batch.
      case
        when jsonb_typeof(c.photo_files) = 'array' and jsonb_array_length(c.photo_files) <= 4
          then c.photo_files
        else '[]'::jsonb
      end as photo_files
    from jsonb_to_recordset(changes) as c(
      building_slug text, rtu_key text, started boolean, complete boolean,
      photos_done boolean, note text, updated_at timestamptz, updated_by text,
      photo_files jsonb
    )
    where c.building_slug is not null and char_length(c.building_slug) between 1 and 120
      and c.rtu_key is not null and char_length(c.rtu_key) between 1 and 64
      and c.updated_at is not null
    order by c.building_slug, c.rtu_key, c.updated_at desc
  ),
  upserted as (
    insert into public.rtu_audit_state as t (
      building_slug, rtu_key, started, complete, photos_done, note, updated_at, updated_by, photo_files
    )
    select building_slug, rtu_key, started, complete, photos_done, note, updated_at, updated_by, photo_files
    from input
    on conflict (building_slug, rtu_key) do update set
      started = excluded.started,
      complete = excluded.complete,
      photos_done = excluded.photos_done,
      note = excluded.note,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by,
      photo_files = excluded.photo_files
    where excluded.updated_at > t.updated_at
    returning t.*
  )
  select * from upserted
  union all
  -- Rows the caller lost the race on come back at their current server state so the
  -- device can correct itself in the same round trip.
  select s.* from public.rtu_audit_state s
  join input i on i.building_slug = s.building_slug and i.rtu_key = s.rtu_key
  where not exists (
    select 1 from upserted u
    where u.building_slug = s.building_slug and u.rtu_key = s.rtu_key
  );
$$;

revoke all on function public.rtu_audit_state_sync(jsonb) from public;
revoke all on function public.rtu_audit_state_sync(jsonb) from anon;
revoke all on function public.rtu_audit_state_sync(jsonb) from authenticated;
grant execute on function public.rtu_audit_state_sync(jsonb) to service_role;
