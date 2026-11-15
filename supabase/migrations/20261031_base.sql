-- Base schema of the hosted app: workspaces, membership and the event pipeline (events, leads, attendees, jobs)
-- with the worker bridge RPCs. Reconstructed from the live database so a fresh Supabase project can be set up;
-- run this first, then 20261115_lead_engine.sql.

create extension if not exists pgcrypto with schema extensions;

create table public.gl_workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create table public.gl_members (
  workspace_id uuid not null references public.gl_workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create table public.gl_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.gl_workspaces (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  city text, start_date date, end_date date, url text,
  search_terms text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (workspace_id, name)
);
-- the local worker keys its SQLite rows by event name, so a name belongs to one workspace only
create unique index gl_events_name_global on public.gl_events (lower(name));
create table public.gl_leads (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.gl_workspaces (id) on delete cascade,
  event_name text not null, company_name text, domain text not null,
  owner_name text, owner_title text, linkedin_url text, email text, email_status text,
  in_aiark smallint, stage text not null default 'scraped', needle_status text default 'pending',
  message text, source_url text, reply_class text, meeting_start timestamptz, meeting_location text,
  updated_at timestamptz not null default now(),
  unique (workspace_id, event_name, domain)
);
create table public.gl_attendees (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.gl_workspaces (id) on delete cascade,
  event_name text not null, person_name text, headline text, linkedin_url text not null,
  signal text, decision text, event_score int, attend_score int, reason text, post_url text,
  created_at timestamptz not null default now(),
  unique (workspace_id, event_name, linkedin_url)
);
create table public.gl_jobs (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.gl_workspaces (id) on delete cascade,
  kind text not null check (kind in ('attendee_search', 'pipeline', 'queue_drafts', 'sync')),
  payload jsonb not null default '{}',
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  result jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(), started_at timestamptz, finished_at timestamptz
);
create index gl_jobs_status_created_at_idx on public.gl_jobs (status, created_at);
create unique index gl_jobs_one_active on public.gl_jobs (workspace_id, kind, md5(payload::text))
  where status in ('queued', 'running');
-- sha256 hex of each worker secret (GL_WORKER_SECRET); insert a row per worker with the SQL editor
create table public.gl_worker_keys (key_hash text primary key, label text, created_at timestamptz default now());

create function public.gl_is_member(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from gl_members where workspace_id = ws and user_id = auth.uid())
$$;
revoke execute on function public.gl_is_member(uuid) from public, anon;
grant execute on function public.gl_is_member(uuid) to authenticated;

create function public.gl_add_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into gl_members (workspace_id, user_id, role) values (new.id, new.created_by, 'owner');
  return new;
end $$;
revoke execute on function public.gl_add_owner() from public, anon, authenticated;
create trigger gl_workspace_owner after insert on public.gl_workspaces
  for each row execute function public.gl_add_owner();

alter table public.gl_workspaces enable row level security;
alter table public.gl_members enable row level security;
alter table public.gl_events enable row level security;
alter table public.gl_leads enable row level security;
alter table public.gl_attendees enable row level security;
alter table public.gl_jobs enable row level security;
alter table public.gl_worker_keys enable row level security;   -- no policies: reachable only through gl_worker_ok()

create policy ws_read on public.gl_workspaces for select using (public.gl_is_member(id));
create policy ws_create on public.gl_workspaces for insert with check (created_by = auth.uid());
create policy ws_rename on public.gl_workspaces for update using (public.gl_is_member(id)) with check (public.gl_is_member(id));
create policy mem_read on public.gl_members for select using (public.gl_is_member(workspace_id));
create policy ev_all on public.gl_events for all using (public.gl_is_member(workspace_id)) with check (public.gl_is_member(workspace_id));
create policy leads_read on public.gl_leads for select using (public.gl_is_member(workspace_id));
create policy leads_edit on public.gl_leads for update using (public.gl_is_member(workspace_id)) with check (public.gl_is_member(workspace_id));
create policy att_read on public.gl_attendees for select using (public.gl_is_member(workspace_id));
create policy jobs_read on public.gl_jobs for select using (public.gl_is_member(workspace_id));
create policy jobs_create on public.gl_jobs for insert
  with check (public.gl_is_member(workspace_id) and status = 'queued' and created_by = auth.uid());

-- Worker bridge: the local Python worker (python -m ghostleads.cloud worker) calls these with its secret.
create function public.gl_worker_ok(secret text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from gl_worker_keys where key_hash = encode(extensions.digest(secret, 'sha256'), 'hex'))
$$;
revoke execute on function public.gl_worker_ok(text) from public, anon, authenticated;

create function public.gl_worker_claim(secret text) returns setof public.gl_jobs
language plpgsql security definer set search_path = public as $$
begin
  if not gl_worker_ok(secret) then raise exception 'forbidden'; end if;
  return query
  update gl_jobs set status = 'running', started_at = now()
  where id = (select id from gl_jobs where status = 'queued' order by created_at limit 1 for update skip locked)
  returning *;
end $$;

create function public.gl_worker_claim_event(secret text, ws uuid, event_name text) returns boolean
language plpgsql security definer set search_path = public as $$
declare owner uuid;
begin
  if not gl_worker_ok(secret) then raise exception 'forbidden'; end if;
  select workspace_id into owner from gl_events where lower(name) = lower(event_name);
  if owner is null then
    insert into gl_events (workspace_id, name) values (ws, event_name);
    return true;
  end if;
  return owner = ws;
end $$;

create function public.gl_worker_event(secret text, ws uuid, event_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not gl_worker_ok(secret) then raise exception 'forbidden'; end if;
  return (select to_jsonb(e) from gl_events e where e.workspace_id = ws and e.name = event_name);
end $$;

create function public.gl_worker_finish(secret text, job_id bigint, ok boolean, res jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not gl_worker_ok(secret) then raise exception 'forbidden'; end if;
  update gl_jobs set status = case when ok then 'done' else 'failed' end, result = res, finished_at = now()
  where id = job_id and status = 'running';
end $$;

create function public.gl_worker_job_leads(secret text, job bigint) returns setof jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not gl_worker_ok(secret) then raise exception 'forbidden'; end if;
  return query
  select jsonb_build_object('event_name', l.event_name, 'domain', l.domain, 'message', l.message)
  from gl_jobs j
  cross join lateral jsonb_array_elements(coalesce(j.payload->'lead_ids', '[]')) as k
  join gl_leads l on l.workspace_id = j.workspace_id and l.event_name = k->>'event_name' and l.domain = k->>'domain'
  join gl_events e on e.workspace_id = j.workspace_id and e.name = l.event_name
  where j.id = job and j.kind = 'queue_drafts';
end $$;

create function public.gl_worker_messages(secret text, ws uuid) returns setof jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not gl_worker_ok(secret) then raise exception 'forbidden'; end if;
  return query select jsonb_build_object('event_name', event_name, 'domain', domain, 'message', message)
    from gl_leads where workspace_id = ws and message is not null;
end $$;

create function public.gl_worker_push(secret text, ws uuid, leads jsonb, attendees jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare nl int; na int;
begin
  if not gl_worker_ok(secret) then raise exception 'forbidden'; end if;
  insert into gl_leads (workspace_id, event_name, company_name, domain, owner_name, owner_title, linkedin_url,
    email, email_status, in_aiark, stage, needle_status, message, source_url, reply_class, meeting_start, meeting_location, updated_at)
  select ws, x.event_name, x.company_name, x.domain, x.owner_name, x.owner_title, x.linkedin_url, x.email,
    x.email_status, x.in_aiark, x.stage, x.needle_status, x.message, x.source_url, x.reply_class,
    x.meeting_start, x.meeting_location, now()
  from jsonb_to_recordset(coalesce(leads, '[]')) as x(event_name text, company_name text, domain text, owner_name text,
    owner_title text, linkedin_url text, email text, email_status text, in_aiark smallint, stage text,
    needle_status text, message text, source_url text, reply_class text, meeting_start timestamptz, meeting_location text)
  where exists (select 1 from gl_events e where e.workspace_id = ws and e.name = x.event_name)
  on conflict (workspace_id, event_name, domain) do update set
    company_name = excluded.company_name, owner_name = excluded.owner_name, owner_title = excluded.owner_title,
    linkedin_url = excluded.linkedin_url, email = excluded.email, email_status = excluded.email_status,
    in_aiark = excluded.in_aiark, stage = excluded.stage, needle_status = excluded.needle_status,
    message = coalesce(excluded.message, gl_leads.message), source_url = excluded.source_url,
    reply_class = excluded.reply_class, meeting_start = excluded.meeting_start,
    meeting_location = excluded.meeting_location, updated_at = now();
  get diagnostics nl = row_count;
  insert into gl_attendees (workspace_id, event_name, person_name, headline, linkedin_url, signal, decision,
    event_score, attend_score, reason, post_url)
  select ws, x.event_name, x.person_name, x.headline, x.linkedin_url, x.signal, x.decision, x.event_score,
    x.attend_score, x.reason, x.post_url
  from jsonb_to_recordset(coalesce(attendees, '[]')) as x(event_name text, person_name text, headline text,
    linkedin_url text, signal text, decision text, event_score int, attend_score int, reason text, post_url text)
  where exists (select 1 from gl_events e where e.workspace_id = ws and e.name = x.event_name)
  on conflict (workspace_id, event_name, linkedin_url) do update set decision = excluded.decision,
    event_score = excluded.event_score, attend_score = excluded.attend_score, reason = excluded.reason;
  get diagnostics na = row_count;
  return jsonb_build_object('leads', nl, 'attendees', na);
end $$;

create function public.gl_worker_workspaces(secret text) returns setof jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not gl_worker_ok(secret) then raise exception 'forbidden'; end if;
  return query select jsonb_build_object('id', id, 'name', name) from gl_workspaces order by created_at;
end $$;

create function public.gl_worker_ws_events(secret text, ws uuid) returns setof text
language plpgsql security definer set search_path = public as $$
begin
  if not gl_worker_ok(secret) then raise exception 'forbidden'; end if;
  return query select name from gl_events where workspace_id = ws;
end $$;
