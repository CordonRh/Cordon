-- Note delivery between wallets, the DvP order queue for the hosted testnet sequencer,
-- holder default requests and vault registration requests.

-- ─── Encrypted note inbox ──────────────────────────────────────────────────
-- Sealed boxes (X25519 -> AES-GCM) to a recipient's receiving key. Recipients try to
-- open every box (no recipient column), so the table reveals nothing about who gets what.
create table public.note_inbox (
  id          bigint generated always as identity primary key,
  box         text not null check (length(box) <= 20000 and box ~ '^[A-Za-z0-9+/=.]+$'),
  created_at  timestamptz not null default now()
);
alter table public.note_inbox enable row level security;
revoke all on public.note_inbox from anon, authenticated;
grant select, insert on public.note_inbox to anon, authenticated;
create policy "public read" on public.note_inbox for select to anon, authenticated using (true);
create policy "anyone posts" on public.note_inbox for insert to anon, authenticated with check (true);

-- ─── DvP orders (hosted sequencer) ─────────────────────────────────────────
-- Orders are sealed to the sequencer key; only the sequencer (service role) reads them.
create table public.dvp_orders (
  id          bigint generated always as identity primary key,
  box         text not null check (length(box) <= 200000),
  expires_at  timestamptz not null default now() + interval '1 hour',
  closed      boolean not null default false,
  taken_until timestamptz,
  created_at  timestamptz not null default now()
);
alter table public.dvp_orders enable row level security;
revoke all on public.dvp_orders from anon, authenticated;

-- A batch takes the open orders for 90 s, so overlapping runs never trade the same order twice.
create function public.dvp_take()
returns table (id bigint, box text)
language sql
security definer
set search_path = ''
as $$
  update public.dvp_orders o set taken_until = now() + interval '90 seconds'
  where not o.closed and o.expires_at > now() and (o.taken_until is null or o.taken_until < now())
  returning o.id, o.box;
$$;
revoke all on function public.dvp_take() from public, anon, authenticated;
grant execute on function public.dvp_take() to service_role;

create function public.dvp_enqueue(box text)
returns bigint
language sql
security definer
set search_path = ''
as $$
  insert into public.dvp_orders (box) values (box) returning id;
$$;
revoke all on function public.dvp_enqueue(text) from public;
grant execute on function public.dvp_enqueue(text) to anon, authenticated, service_role;

-- ─── Holder default requests ───────────────────────────────────────────────
-- Note: testnet approves a holder's request at once; mainnet keeps ops approval
-- (approved = false here) before the keeper declares the default.
create function public.request_default(enc public.bytes32)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.default_requests (enc_commit, approved) values (enc, true) on conflict do nothing;
$$;
revoke all on function public.request_default(public.bytes32) from public;
grant execute on function public.request_default(public.bytes32) to anon, authenticated, service_role;

-- ─── Vault registration requests (governance registers through the timelock) ─
create table public.vault_requests (
  vault_id    public.bytes32 primary key,
  manager     public.address not null,
  vault_pk    public.bytes32 not null,
  scheduled   boolean not null default false,
  created_at  timestamptz not null default now()
);
alter table public.vault_requests enable row level security;
revoke all on public.vault_requests from anon, authenticated;
grant select on public.vault_requests to anon, authenticated;
create policy "public read" on public.vault_requests for select to anon, authenticated using (true);

create function public.request_vault(vault public.bytes32, manager public.address, pk public.bytes32)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.vault_requests (vault_id, manager, vault_pk) values (vault, manager, pk) on conflict do nothing;
$$;
revoke all on function public.request_vault(public.bytes32, public.address, public.bytes32) from public;
grant execute on function public.request_vault(public.bytes32, public.address, public.bytes32) to anon, authenticated, service_role;

-- ─── App cron: the sequencer batch runs as an app route (proving needs more than an edge function) ─
-- Vault secrets (set outside migrations): cordon_app_url, cordon_cron_secret.
create function public.invoke_app(path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  url    text := (select decrypted_secret from vault.decrypted_secrets where name = 'cordon_app_url');
  secret text := (select decrypted_secret from vault.decrypted_secrets where name = 'cordon_cron_secret');
begin
  if url is null or secret is null then
    return;
  end if;
  perform net.http_post(
    url := url || path,
    headers := jsonb_build_object('x-cron-secret', secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
end;
$$;
revoke all on function public.invoke_app(text) from public, anon, authenticated;

select cron.schedule('cordon-sequencer', '* * * * *', $$select public.invoke_app('/api/sequencer')$$);
