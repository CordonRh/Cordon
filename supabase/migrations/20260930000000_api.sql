-- API support: relay job status for submitters, and disclosure grants.

-- A submitter polls its relay job by id; only status and tx hash are returned.
create function public.relay_status(job_id bigint)
returns table (status public.relayer_job_status, tx_hash public.bytes32, attempts integer)
language sql
stable
security definer
set search_path = ''
as $$
  select j.status, j.tx_hash, j.attempts from public.relayer_jobs j where j.id = job_id;
$$;

revoke all on function public.relay_status(bigint) from public;
grant execute on function public.relay_status(bigint) to anon, authenticated, service_role;

-- disclose.grant: a viewing key encrypted in the browser to the viewer's public key.
-- The viewer fetches it by id (disclosure_get); nobody can list grants, so owners
-- and viewers cannot be linked. Only the granting wallet can create or revoke one.
create table public.disclosures (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  viewer_pk   text not null check (viewer_pk ~ '^0x[0-9a-f]{64,130}$'),
  scope       text not null check (scope ~ '^[a-z][a-z0-9_:.-]{0,63}$'),
  ciphertext  text not null check (length(ciphertext) <= 200000 and ciphertext ~ '^[A-Za-z0-9+/]*={0,2}$'),
  revoked     boolean not null default false,
  created_at  timestamptz not null default now()
);

alter table public.disclosures enable row level security;
revoke all on public.disclosures from anon, authenticated;
grant select, insert, update on public.disclosures to authenticated;

create policy "owner read" on public.disclosures for select to authenticated
  using ((select auth.uid()) = owner);
create policy "owner grant" on public.disclosures for insert to authenticated
  with check ((select auth.uid()) = owner);
create policy "owner revoke" on public.disclosures for update to authenticated
  using ((select auth.uid()) = owner) with check ((select auth.uid()) = owner and revoked);

create function public.disclosure_get(grant_id uuid)
returns table (scope text, viewer_pk text, ciphertext text)
language sql
stable
security definer
set search_path = ''
as $$
  select d.scope, d.viewer_pk, d.ciphertext from public.disclosures d where d.id = grant_id and not d.revoked;
$$;

revoke all on function public.disclosure_get(uuid) from public;
grant execute on function public.disclosure_get(uuid) to anon, authenticated, service_role;
