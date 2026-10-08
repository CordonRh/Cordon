-- Workers: pgmq relayer queue, pg_cron schedules for the edge
-- functions, and the extra public/owner tables the indexer and SDK need.
--
-- Cron jobs call the edge functions with the service key stored in Vault:
--   select vault.create_secret('<service_role key>', 'cordon_service_key');
--   select vault.create_secret('https://<ref>.supabase.co', 'cordon_project_url');
-- Until both exist the jobs are no-ops.

create extension if not exists pgmq;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select pgmq.create('relayer');

-- ─── Public tables fed by the indexer ───────────────────────────────────────

-- Deposits are public on-chain (asset, raw, commit); the depositor is not stored.
create table public.deposits (
  deposit_id     bigint primary key check (deposit_id >= 0),
  asset          public.address not null,
  raw            public.uint256 not null,
  commit         public.bytes32 not null,
  standby_until  timestamptz not null,
  settled        boolean not null default false,
  returned       boolean not null default false,
  flagged        boolean not null default false,
  block          bigint not null check (block >= 0)
);

-- Spent-note markers: a wallet restoring from backup checks its nullifiers here.
create table public.nullifiers (
  nullifier  public.bytes32 primary key,
  block      bigint not null check (block >= 0)
);

-- Allowed relay targets (the deployed engines) and function selectors.
create table public.relay_targets (
  target    public.address not null,
  selector  text not null check (selector ~ '^0x[0-9a-f]{8}$'),
  kind      text not null check (kind ~ '^[a-z][a-z_.]{0,39}$'),
  primary key (target, selector)
);

-- Encumbrance defaults approved by ops for the keeper to declare on-chain.
create table public.default_requests (
  enc_commit  public.bytes32 primary key references public.encumbrances (enc_commit),
  approved    boolean not null default false,
  submitted   boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ─── Per-user encrypted note backup (same scheme as workspaces) ────────────

create table public.notes_vault (
  owner       uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  ciphertext  text not null check (length(ciphertext) <= 4000000 and ciphertext ~ '^[A-Za-z0-9+/]*={0,2}$'),
  iv          text not null check (iv ~ '^[A-Za-z0-9+/]{16}$'),
  key_check   text not null check (key_check ~ '^[0-9a-f]{64}$'),
  version     integer not null default 1 check (version >= 1),
  updated_at  timestamptz not null default now()
);

create trigger notes_vault_bump_version
before update on public.notes_vault
for each row execute function public.workspaces_bump_version();

-- ─── Access control ─────────────────────────────────────────────────────────

alter table public.deposits enable row level security;
alter table public.nullifiers enable row level security;
alter table public.relay_targets enable row level security;
alter table public.default_requests enable row level security;
alter table public.notes_vault enable row level security;

revoke all on public.deposits, public.nullifiers, public.relay_targets, public.default_requests, public.notes_vault
from anon, authenticated;

grant select on public.deposits, public.nullifiers, public.relay_targets to anon, authenticated;
create policy "public read" on public.deposits for select to anon, authenticated using (true);
create policy "public read" on public.nullifiers for select to anon, authenticated using (true);
create policy "public read" on public.relay_targets for select to anon, authenticated using (true);

grant select, insert, update, delete on public.notes_vault to authenticated;
create policy "owner read" on public.notes_vault for select to authenticated
  using ((select auth.uid()) = owner);
create policy "owner insert" on public.notes_vault for insert to authenticated
  with check ((select auth.uid()) = owner);
create policy "owner update" on public.notes_vault for update to authenticated
  using ((select auth.uid()) = owner) with check ((select auth.uid()) = owner);
create policy "owner delete" on public.notes_vault for delete to authenticated
  using ((select auth.uid()) = owner);

-- ─── Relayer queue ──────────────────────────────────────────────────────────

-- Anyone may ask the relayer to submit a proof-carrying call, but only to an
-- allowed engine function; the job row keeps a hash of the calldata, never notes.
create function public.enqueue_relay(target public.address, calldata text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  k   text;
  id  bigint;
begin
  if calldata !~ '^0x[0-9a-f]{8}([0-9a-f]{2})*$' or length(calldata) > 200000 then
    raise exception 'bad calldata';
  end if;
  select rt.kind into k from public.relay_targets rt
   where rt.target = enqueue_relay.target and rt.selector = substr(calldata, 1, 10);
  if k is null then
    raise exception 'target or function not relayable';
  end if;
  insert into public.relayer_jobs (kind, calldata_hash)
  values (k, '0x' || encode(extensions.digest(decode(substr(calldata, 3), 'hex'), 'sha256'), 'hex'))
  returning relayer_jobs.id into id;
  perform pgmq.send('relayer', jsonb_build_object('job', id, 'to', target, 'data', calldata));
  return id;
end;
$$;

revoke all on function public.enqueue_relay(public.address, text) from public;
grant execute on function public.enqueue_relay(public.address, text) to anon, authenticated, service_role;

-- Worker-side queue access (service role only).
create function public.relay_read(qty integer default 5)
returns table (msg_id bigint, read_ct integer, message jsonb)
language sql
security definer
set search_path = ''
as $$
  select r.msg_id, r.read_ct, r.message from pgmq.read('relayer', 120, qty) r;
$$;

create function public.relay_done(msg_id bigint)
returns void
language sql
security definer
set search_path = ''
as $$
  select pgmq.delete('relayer', msg_id);
$$;

-- Keepers enqueue their own calls (ActionEngine.sync, SolvencyVerifier.attest, ...).
create function public.enqueue_keeper(kind text, target public.address, calldata text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  id bigint;
begin
  insert into public.relayer_jobs (kind, calldata_hash)
  values (kind, '0x' || encode(extensions.digest(decode(substr(calldata, 3), 'hex'), 'sha256'), 'hex'))
  returning relayer_jobs.id into id;
  perform pgmq.send('relayer', jsonb_build_object('job', id, 'to', target, 'data', calldata));
  return id;
end;
$$;

revoke all on function public.relay_read(integer) from public, anon, authenticated;
revoke all on function public.relay_done(bigint) from public, anon, authenticated;
revoke all on function public.enqueue_keeper(text, public.address, text) from public, anon, authenticated;
grant execute on function public.relay_read(integer), public.relay_done(bigint),
  public.enqueue_keeper(text, public.address, text) to service_role;

-- ─── Schedules ──────────────────────────────────────────────────────────────

create function public.invoke_worker(fn text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  url  text := (select decrypted_secret from vault.decrypted_secrets where name = 'cordon_project_url');
  key  text := (select decrypted_secret from vault.decrypted_secrets where name = 'cordon_service_key');
begin
  if url is null or key is null then
    return;
  end if;
  perform net.http_post(
    url := url || '/functions/v1/' || fn,
    headers := jsonb_build_object('Authorization', 'Bearer ' || key, 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
end;
$$;

revoke all on function public.invoke_worker(text) from public, anon, authenticated;

select cron.schedule('cordon-indexer', '15 seconds', $$select public.invoke_worker('indexer')$$);
select cron.schedule('cordon-relayer', '10 seconds', $$select public.invoke_worker('relayer')$$);
select cron.schedule('cordon-action-watcher', '* * * * *', $$select public.invoke_worker('action-watcher')$$);
select cron.schedule('cordon-solvency', '5 * * * *', $$select public.invoke_worker('solvency')$$);
select cron.schedule('cordon-encumbrance-keeper', '* * * * *', $$select public.invoke_worker('encumbrance-keeper')$$);
select cron.schedule(
  'cordon-partitions', '0 3 1 * *',
  $$select public.ensure_monthly_partitions('public.income_index');
    select public.ensure_monthly_partitions('public.dvp_batches');
    select public.ensure_monthly_partitions('public.nav_history');$$
);
