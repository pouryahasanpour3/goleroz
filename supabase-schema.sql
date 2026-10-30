-- Run once in Supabase Dashboard > SQL Editor for each project used by Goleroz.
-- Use only the Project URL and anon/public key in the browser; never use service_role.
create table if not exists public.cloud_backups (
  user_id uuid primary key references auth.users(id) on delete cascade,
  rev integer not null default 1,
  payload text not null,
  updated_at timestamptz not null default now()
);

-- Safe migration for an existing Goleroz table; preserves any saved encrypted backups.
alter table public.cloud_backups add column if not exists rev integer not null default 1;

alter table public.cloud_backups enable row level security;

revoke all on table public.cloud_backups from anon;
grant select, insert, update, delete on table public.cloud_backups to authenticated;

drop policy if exists "Users can read their own backup" on public.cloud_backups;
create policy "Users can read their own backup" on public.cloud_backups
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "Users can create their own backup" on public.cloud_backups;
create policy "Users can create their own backup" on public.cloud_backups
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "Users can update their own backup" on public.cloud_backups;
create policy "Users can update their own backup" on public.cloud_backups
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own backup" on public.cloud_backups;
create policy "Users can delete their own backup" on public.cloud_backups
  for delete to authenticated using (auth.uid() = user_id);
