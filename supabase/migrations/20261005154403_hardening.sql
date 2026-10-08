-- Audit hardening (2026-10-06).
-- 1. Anonymous writes (relay jobs, DvP orders, inbox boxes) go through the app server,
--    which rate-limits them per IP and calls these functions with the service role.
--    Direct anon/authenticated access is revoked so the limits cannot be bypassed.
-- 2. Keeper jobs use their own queue and key, so user relays cannot starve or drain them.
-- 3. Vault requests are written by the server for the signed-in wallet only.
-- 4. Auto-approval of default requests is an explicit setting, off unless turned on.
-- 5. dvp_take reads at most 50 orders per batch; closed or expired orders are pruned.

-- ─── 1. Rate limits and server-only writes ──────────────────────────────────
create table public.rate_buckets (
  key          text primary key,
  window_start timestamptz not null,
  count        integer not null
);
alter table public.rate_buckets enable row level security;
revoke all on public.rate_buckets from anon, authenticated;

-- Fixed-window counter: true while `key` has used fewer than `max_count` calls this window.
create function public.rate_take(key text, max_count integer, window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  insert into public.rate_buckets as b (key, window_start, count) values (rate_take.key, now(), 1)
  on conflict on constraint rate_buckets_pkey do update set
    window_start = case when b.window_start < now() - make_interval(secs => window_seconds) then now() else b.window_start end,
    count = case when b.window_start < now() - make_interval(secs => window_seconds) then 1 else b.count + 1 end
  returning b.count into n;
  return n <= max_count;
end;
$$;
revoke all on function public.rate_take(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_take(text, integer, integer) to service_role;

revoke execute on function public.enqueue_relay(public.address, text) from anon, authenticated;
revoke execute on function public.dvp_enqueue(text) from anon, authenticated;
drop policy "anyone posts" on public.note_inbox;
-- Inbox boxes are small (notes, pledge terms, DvP results): cap them at 12 KB.
alter table public.note_inbox drop constraint if exists note_inbox_box_check;
alter table public.note_inbox add constraint note_inbox_box_check check (length(box) <= 12000 and box ~ '^[A-Za-z0-9+/=.]+$');
revoke insert on public.note_inbox from anon, authenticated;
grant insert on public.note_inbox to service_role;

-- ─── 2. Keeper queue ────────────────────────────────────────────────────────
select pgmq.create('keeper');

create or replace function public.enqueue_keeper(kind text, target public.address, calldata text)
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
  perform pgmq.send('keeper', jsonb_build_object('job', id, 'to', target, 'data', calldata));
  return id;
end;
$$;

create function public.keeper_read(qty integer default 5)
returns table (msg_id bigint, read_ct integer, message jsonb)
language sql
security definer
set search_path = ''
as $$
  select r.msg_id, r.read_ct, r.message from pgmq.read('keeper', 120, qty) r;
$$;

create function public.keeper_done(msg_id bigint)
returns void
language sql
security definer
set search_path = ''
as $$
  select pgmq.delete('keeper', msg_id);
$$;
revoke all on function public.keeper_read(integer) from public, anon, authenticated;
revoke all on function public.keeper_done(bigint) from public, anon, authenticated;
grant execute on function public.keeper_read(integer), public.keeper_done(bigint) to service_role;

-- ─── 3. Vault requests: server-written for the signed-in wallet ─────────────
revoke execute on function public.request_vault(public.bytes32, public.address, public.bytes32) from anon, authenticated;

-- ─── 4. Default auto-approval behind an explicit setting ───────────────────
create table public.app_settings (
  key   text primary key,
  value text not null
);
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;
-- Off: the keeper reviews each request. It turns on with
--   update public.app_settings set value = 'on' where key = 'auto_default';
insert into public.app_settings (key, value) values ('auto_default', 'off');

create or replace function public.request_default(enc public.bytes32)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.default_requests (enc_commit, approved)
  values (enc, coalesce((select value = 'on' from public.app_settings where key = 'auto_default'), false))
  on conflict do nothing;
$$;

-- ─── 5. Bounded batches, pruning ────────────────────────────────────────────
create or replace function public.dvp_take()
returns table (id bigint, box text)
language sql
security definer
set search_path = ''
as $$
  with picked as (
    select o.id from public.dvp_orders o
    where not o.closed and o.expires_at > now() and (o.taken_until is null or o.taken_until < now())
    order by o.taken_until nulls first, o.id  -- least recently tried first: no head-of-line blocking
    limit 50
    for update skip locked
  )
  update public.dvp_orders o set taken_until = now() + interval '90 seconds'
  from picked where o.id = picked.id
  returning o.id, o.box;
$$;

create function public.prune_queues()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.dvp_orders where closed or expires_at < now() - interval '1 day';
  delete from public.note_inbox where created_at < now() - interval '30 days';
  delete from public.rate_buckets where window_start < now() - interval '1 day';
$$;
revoke all on function public.prune_queues() from public, anon, authenticated;

select cron.schedule('cordon-prune', '17 * * * *', $$select public.prune_queues()$$);

-- ─── 6. Monitoring (supabase/functions/monitor) ────────────────────────────
create table public.alerts (
  id         bigint generated always as identity primary key,
  kind       text not null,
  detail     jsonb not null,
  dedupe     text not null unique,
  notified   boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.alerts enable row level security;
revoke all on public.alerts from anon, authenticated;

create table public.monitor_state (
  key   text primary key,
  value text not null
);
alter table public.monitor_state enable row level security;
revoke all on public.monitor_state from anon, authenticated;

select cron.schedule('cordon-monitor', '*/5 * * * *', $$select public.invoke_worker('monitor')$$);

-- rate_take regression check, run once at migration time (true, true, false).
do $$
begin
  if not (public.rate_take('migration-selftest', 2, 60) and public.rate_take('migration-selftest', 2, 60)
          and not public.rate_take('migration-selftest', 2, 60)) then
    raise exception 'rate_take self-test failed';
  end if;
  delete from public.rate_buckets where key = 'migration-selftest';
end $$;
