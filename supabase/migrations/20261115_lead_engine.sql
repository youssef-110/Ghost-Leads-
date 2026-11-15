-- Lead engine: lists of prospects from any source, custom scrapes, daily usage metering.
-- Additive only. The gl_events / gl_leads / gl_attendees / gl_jobs tables of the event pipeline are untouched.

alter table public.gl_workspaces add column if not exists plan text not null default 'free'
  check (plan in ('free', 'pro', 'team'));
-- members may create and rename a workspace, never set its plan (plan changes come from a trusted backend only)
revoke insert, update on public.gl_workspaces from authenticated, anon;
grant insert (name), update (name) on public.gl_workspaces to authenticated;

create table if not exists public.gl_lists (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.gl_workspaces (id) on delete cascade,
  name text not null check (length(name) between 1 and 160),
  source text not null,
  query jsonb not null default '{}',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.gl_prospects (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.gl_workspaces (id) on delete cascade,
  list_id uuid not null references public.gl_lists (id) on delete cascade,
  key text not null,                       -- domain, or a slug of name+city when the company has no website
  company_name text not null,
  domain text, website text, phone text, email text, address text, city text, country text,
  industry text, description text,
  source text not null, source_url text,
  emails jsonb not null default '[]', phones jsonb not null default '[]', socials jsonb not null default '{}',
  people jsonb not null default '[]', tech jsonb not null default '[]', signals jsonb not null default '[]',
  score int, score_reasons jsonb not null default '[]',
  status text not null default 'new' check (status in ('new', 'enriching', 'enriched', 'failed')),
  error text, message text, notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (list_id, key)
);
create index if not exists gl_prospects_ws_list on public.gl_prospects (workspace_id, list_id);

create table if not exists public.gl_scrapes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.gl_workspaces (id) on delete cascade,
  name text not null, url text not null,
  fields jsonb not null default '[]', columns jsonb not null default '[]', rows jsonb not null default '[]',
  method text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.gl_usage (
  workspace_id uuid not null references public.gl_workspaces (id) on delete cascade,
  day date not null, kind text not null, n int not null default 0,
  primary key (workspace_id, day, kind)
);

create or replace function public.gl_touch() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists gl_prospects_touch on public.gl_prospects;
create trigger gl_prospects_touch before update on public.gl_prospects for each row execute function public.gl_touch();

alter table public.gl_lists enable row level security;
alter table public.gl_prospects enable row level security;
alter table public.gl_scrapes enable row level security;
alter table public.gl_usage enable row level security;

create policy lists_all on public.gl_lists for all to authenticated
  using (public.gl_is_member(workspace_id)) with check (public.gl_is_member(workspace_id));
create policy prospects_all on public.gl_prospects for all to authenticated
  using (public.gl_is_member(workspace_id)) with check (public.gl_is_member(workspace_id));
create policy scrapes_all on public.gl_scrapes for all to authenticated
  using (public.gl_is_member(workspace_id)) with check (public.gl_is_member(workspace_id));
-- usage is written only by gl_use()
create policy usage_read on public.gl_usage for select to authenticated using (public.gl_is_member(workspace_id));

-- Meter one API call. The Vercel functions call this with the caller's own token before doing any work,
-- so it is also the membership check. Raises 'quota' when the workspace's daily limit would be exceeded.
create or replace function public.gl_use(p_ws uuid, p_kind text, p_n int default 1) returns jsonb
language plpgsql security definer set search_path = public as $$
declare lim int; used int;
begin
  if auth.uid() is null or not public.gl_is_member(p_ws) then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;
  if p_n < 1 or p_n > 50 then raise exception 'bad amount' using errcode = '22023'; end if;
  select (case p_kind when 'discover' then 40 when 'enrich' then 200 when 'extract' then 40
                      when 'draft' then 60 when 'verify' then 500 else 0 end)
       * (case plan when 'pro' then 25 when 'team' then 100 else 1 end)
    into lim from public.gl_workspaces where id = p_ws;
  insert into public.gl_usage (workspace_id, day, kind, n) values (p_ws, current_date, p_kind, 0)
    on conflict do nothing;
  update public.gl_usage u set n = u.n + p_n
    where u.workspace_id = p_ws and u.day = current_date and u.kind = p_kind and u.n + p_n <= lim
    returning u.n into used;
  if used is null then raise exception 'quota' using errcode = 'P0001'; end if;
  return jsonb_build_object('used', used, 'limit', lim);
end $$;
revoke execute on function public.gl_use(uuid, text, int) from public, anon;
grant execute on function public.gl_use(uuid, text, int) to authenticated;

-- Hardening (review findings) ------------------------------------------------------------------------------
-- a prospect's list must belong to the same workspace (FK checks bypass RLS)
alter table public.gl_lists add constraint gl_lists_id_ws_key unique (id, workspace_id);
alter table public.gl_prospects drop constraint gl_prospects_list_id_fkey;
alter table public.gl_prospects add constraint gl_prospects_list_ws_fkey
  foreign key (list_id, workspace_id) references public.gl_lists (id, workspace_id) on delete cascade;

-- find-or-create the caller's workspace in one transaction: no duplicate workspaces on first sign-in,
-- and no fresh free quota from creating extra workspaces
create or replace function public.gl_my_workspace(p_name text) returns table (id uuid, name text, plan text)
language plpgsql security definer set search_path = public as $$
declare ws uuid;
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  select m.workspace_id into ws from gl_members m join gl_workspaces w on w.id = m.workspace_id
    where m.user_id = auth.uid() order by w.created_at limit 1;
  if ws is null then
    insert into gl_workspaces (name, created_by)
      values (coalesce(nullif(left(btrim(p_name), 120), ''), 'My company'), auth.uid())
      returning gl_workspaces.id into ws;
  end if;
  return query select w.id, w.name, w.plan from gl_workspaces w where w.id = ws;
end $$;
revoke execute on function public.gl_my_workspace(text) from public, anon;
grant execute on function public.gl_my_workspace(text) to authenticated;
-- workspaces are created only through gl_my_workspace()
revoke insert on public.gl_workspaces from authenticated, anon;

-- Public contact form (/contact): insert-only for visitors, readable only from the dashboard / service role.
create table if not exists public.gl_contact (
  id bigint generated always as identity primary key,
  email text not null check (length(email) between 5 and 200 and email like '%_@_%._%'),
  topic text not null default 'General' check (length(topic) <= 80),
  message text not null check (length(message) between 1 and 4000),
  created_at timestamptz not null default now()
);
alter table public.gl_contact enable row level security;
revoke all on public.gl_contact from anon, authenticated;
grant insert (email, topic, message) on public.gl_contact to anon, authenticated;
create policy contact_write on public.gl_contact for insert to anon, authenticated with check (true);
