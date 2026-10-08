-- Cordon protocol schema (spec §4.1).
--
-- Privacy rule: nothing here may hold (owner, amount, type) tuples. Public
-- tables carry commitments, counts and aggregates only; the one per-user table
-- (`workspaces`) stores AES-GCM ciphertext produced in the browser.
--
-- Time-series tables use native range partitioning + BRIN instead of Timescale
-- hypertables (TimescaleDB is not available on Supabase Postgres 17).

-- ─── Types ──────────────────────────────────────────────────────────────────

create type public.asset_class as enum ('STOCK8056', 'TREASURY', 'VAULT4626');
create type public.claim_type as enum ('PRINCIPAL', 'INCOME', 'VOTE', 'REDEEM', 'CONTROL');
create type public.encumbrance_kind as enum ('LOCKUP', 'PLEDGE', 'LIEN');
create type public.asset_mode as enum ('ACTIVE', 'REDEEM_ONLY');
create type public.relayer_job_status as enum ('queued', 'sent', 'confirmed', 'failed');

-- Lower-case 0x-hex, so equality and uniqueness are case-insensitive by construction.
create domain public.address as text check (value ~ '^0x[0-9a-f]{40}$');
create domain public.bytes32 as text check (value ~ '^0x[0-9a-f]{64}$');
-- uint256 values (1e18-scaled indexes, raw units, USDG) stored exactly.
create domain public.uint256 as numeric(78, 0) check (value >= 0);

-- Partitions live outside the API-exposed schema so they can never be read or
-- written directly, bypassing the parent table's policies.
create schema if not exists cordon_partitions;
revoke all on schema cordon_partitions from public;

-- ─── Public protocol tables ─────────────────────────────────────────────────

create table public.assets (
  asset        public.address primary key,
  symbol       text not null check (length(symbol) between 1 and 16),
  name         text not null check (length(name) between 1 and 80),
  class        public.asset_class not null,
  claim_types  public.claim_type[] not null,
  templates    public.encumbrance_kind[] not null default '{}',
  multiplier   public.uint256,
  next_mult    public.uint256,
  next_at      timestamptz,
  mode         public.asset_mode not null default 'ACTIVE',
  updated_at   timestamptz not null default now(),
  constraint vault_has_no_vote check (class <> 'VAULT4626' or not ('VOTE' = any (claim_types)))
);

create table public.income_index (
  asset     public.address not null references public.assets (asset),
  ts        timestamptz not null,
  block     bigint not null check (block >= 0),
  index     public.uint256 not null,
  verified  boolean not null default false,
  primary key (asset, ts)
) partition by range (ts);

create table public.commitments (
  leaf           bigint primary key check (leaf >= 0),
  commit         public.bytes32 not null unique,
  block          bigint not null check (block >= 0),
  tx             public.bytes32 not null,
  standby_until  timestamptz not null,
  cleared        boolean not null default false,
  flagged        boolean not null default false
);

create table public.encumbrances (
  enc_commit     public.bytes32 primary key,
  kind           public.encumbrance_kind not null,
  until          timestamptz,
  released       boolean not null default false,
  enforced       boolean not null default false,
  created_block  bigint not null check (created_block >= 0),
  constraint not_released_and_enforced check (not (released and enforced))
);

create table public.dvp_batches (
  seq          bigint not null check (seq >= 0),
  ts           timestamptz not null,
  n_trades     integer not null check (n_trades >= 0),
  n_legs       integer not null check (n_legs >= 0 and n_legs <= n_trades * 16),
  totals       jsonb not null default '{}',
  prices_hash  public.bytes32 not null,
  tx           public.bytes32 not null,
  primary key (seq, ts)
) partition by range (ts);

create table public.vaults (
  vault_id         public.bytes32 primary key,
  manager_pk_hash  public.bytes32 not null,
  epoch            bigint not null default 0 check (epoch >= 0),
  nav_per_share    public.uint256,
  total_shares     public.uint256,
  queue_usdg       public.uint256 not null default 0,
  proof_tx         public.bytes32,
  ts               timestamptz
);

create table public.nav_history (
  vault_id       public.bytes32 not null references public.vaults (vault_id),
  epoch          bigint not null check (epoch >= 0),
  ts             timestamptz not null,
  nav_per_share  public.uint256 not null,
  ok             boolean not null,
  primary key (vault_id, epoch, ts)
) partition by range (ts);

create table public.solvency (
  epoch         bigint not null check (epoch >= 0),
  asset         public.address not null references public.assets (asset),
  ts            timestamptz not null,
  pool_balance  public.uint256 not null,
  live_claims   public.uint256 not null,
  tx            public.bytes32 not null,
  primary key (epoch, asset)
);

create index income_index_ts_brin on public.income_index using brin (ts);
create index dvp_batches_ts_brin on public.dvp_batches using brin (ts);
create index nav_history_ts_brin on public.nav_history using brin (ts);
create index commitments_block_idx on public.commitments (block);
create index encumbrances_until_idx on public.encumbrances (until) where not released and not enforced;

-- ─── Operational tables (service role only) ─────────────────────────────────

create table public.indexer_cursor (
  contract    public.address primary key,
  last_block  bigint not null check (last_block >= 0),
  last_hash   public.bytes32 not null,
  updated_at  timestamptz not null default now()
);

create table public.oracle_marks (
  asset       public.address not null references public.assets (asset),
  round_id    public.uint256 not null,
  price       public.uint256 not null,
  multiplier  public.uint256 not null,
  ts          timestamptz not null,
  ok          boolean not null,
  primary key (asset, round_id)
);

-- Relayers store calldata hashes and outcomes only — never note plaintext.
create table public.relayer_jobs (
  id             bigint generated always as identity primary key,
  kind           text not null check (kind ~ '^[a-z][a-z_.]{0,39}$'),
  calldata_hash  public.bytes32 not null,
  status         public.relayer_job_status not null default 'queued',
  tx_hash        public.bytes32,
  attempts       integer not null default 0 check (attempts >= 0),
  error          text check (length(error) <= 500),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ─── Per-user encrypted workspace ───────────────────────────────────────────

create table public.workspaces (
  owner       uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  ciphertext  text not null check (length(ciphertext) <= 1400000 and ciphertext ~ '^[A-Za-z0-9+/]*={0,2}$'),
  iv          text not null check (iv ~ '^[A-Za-z0-9+/]{16}$'),
  key_check   text not null check (key_check ~ '^[0-9a-f]{64}$'),
  version     integer not null default 1 check (version >= 1),
  updated_at  timestamptz not null default now()
);

-- Every write bumps the version (optimistic concurrency) and pins the owner.
create function public.workspaces_bump_version() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.owner <> old.owner then
    raise exception 'workspace owner cannot change';
  end if;
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.workspaces_bump_version() from public, anon, authenticated;

create trigger workspaces_bump_version
before update on public.workspaces
for each row execute function public.workspaces_bump_version();

-- ─── Partition management ───────────────────────────────────────────────────

-- Creates monthly partitions from last month to `months_ahead` months out, plus
-- a default partition so an out-of-range timestamp never drops a write.
-- Idempotent; scheduled monthly once pg_cron is enabled (workers phase).
create function public.ensure_monthly_partitions(parent regclass, months_ahead integer default 3)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  base   text := (select c.relname from pg_catalog.pg_class c where c.oid = parent);
  month  date;
  part   text;
begin
  for i in -1 .. months_ahead loop
    month := (date_trunc('month', now()) + make_interval(months => i))::date;
    part := format('%s_p%s', base, to_char(month, 'YYYYMM'));
    if to_regclass(format('cordon_partitions.%I', part)) is null then
      execute format(
        'create table cordon_partitions.%I partition of %s for values from (%L) to (%L)',
        part, parent, month, (month + interval '1 month')::date
      );
      execute format('alter table cordon_partitions.%I enable row level security', part);
    end if;
  end loop;

  part := base || '_default';
  if to_regclass(format('cordon_partitions.%I', part)) is null then
    execute format('create table cordon_partitions.%I partition of %s default', part, parent);
    execute format('alter table cordon_partitions.%I enable row level security', part);
  end if;
end;
$$;

-- Supabase grants EXECUTE to anon/authenticated by default; this must stay service-only.
revoke all on function public.ensure_monthly_partitions(regclass, integer) from public, anon, authenticated;

select public.ensure_monthly_partitions('public.income_index');
select public.ensure_monthly_partitions('public.dvp_batches');
select public.ensure_monthly_partitions('public.nav_history');

-- ─── Access control ─────────────────────────────────────────────────────────

alter table public.assets enable row level security;
alter table public.income_index enable row level security;
alter table public.commitments enable row level security;
alter table public.encumbrances enable row level security;
alter table public.dvp_batches enable row level security;
alter table public.vaults enable row level security;
alter table public.nav_history enable row level security;
alter table public.solvency enable row level security;
alter table public.indexer_cursor enable row level security;
alter table public.oracle_marks enable row level security;
alter table public.relayer_jobs enable row level security;
alter table public.workspaces enable row level security;

-- Clients never write protocol state; only workers (service role) do.
revoke all on
  public.assets, public.income_index, public.commitments, public.encumbrances,
  public.dvp_batches, public.vaults, public.nav_history, public.solvency,
  public.indexer_cursor, public.oracle_marks, public.relayer_jobs, public.workspaces
from anon, authenticated;

-- Public aggregates are readable by anyone.
grant select on
  public.assets, public.income_index, public.commitments, public.encumbrances,
  public.dvp_batches, public.vaults, public.nav_history, public.solvency,
  public.oracle_marks
to anon, authenticated;

create policy "public read" on public.assets for select to anon, authenticated using (true);
create policy "public read" on public.income_index for select to anon, authenticated using (true);
create policy "public read" on public.commitments for select to anon, authenticated using (true);
create policy "public read" on public.encumbrances for select to anon, authenticated using (true);
create policy "public read" on public.dvp_batches for select to anon, authenticated using (true);
create policy "public read" on public.vaults for select to anon, authenticated using (true);
create policy "public read" on public.nav_history for select to anon, authenticated using (true);
create policy "public read" on public.solvency for select to anon, authenticated using (true);
create policy "public read" on public.oracle_marks for select to anon, authenticated using (true);

-- A signed-in wallet reads and writes only its own ciphertext.
grant select, insert, update, delete on public.workspaces to authenticated;

create policy "owner read" on public.workspaces for select to authenticated
  using ((select auth.uid()) = owner);
create policy "owner insert" on public.workspaces for insert to authenticated
  with check ((select auth.uid()) = owner);
create policy "owner update" on public.workspaces for update to authenticated
  using ((select auth.uid()) = owner) with check ((select auth.uid()) = owner);
create policy "owner delete" on public.workspaces for delete to authenticated
  using ((select auth.uid()) = owner);
