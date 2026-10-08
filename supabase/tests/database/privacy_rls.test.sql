-- Run with `supabase test db` (pgTAP). Covers spec §6 "Privacy CI" plus the
-- access rules the API and workers rely on.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(25);

-- Privacy CI: no table may hold an (owner, amount, type) tuple, and no
-- secret-bearing column may exist anywhere in the exposed schema.
select is_empty(
  $$
  select c.table_name from information_schema.columns c
  where c.table_schema = 'public'
  group by c.table_name
  having bool_or(c.column_name in ('owner', 'owner_pk', 'owner_address', 'wallet', 'holder', 'holder_pk'))
     and bool_or(c.column_name in ('amount', 'raw_units', 'shares', 'value', 'balance'))
     and bool_or(c.column_name in ('claim_type', 'type', 'kind', 'asset'))
  $$,
  'no public table holds (owner, amount, type) tuples'
);
select is_empty(
  $$
  select table_name || '.' || column_name from information_schema.columns
  where table_schema = 'public'
    and column_name in ('blinding', 'viewing_key', 'spending_key', 'plaintext', 'secret', 'private_key', 'mnemonic')
  $$,
  'no secret-bearing columns'
);

-- Every exposed table has RLS on.
select is_empty(
  $$ select relname from pg_class
     where relnamespace = 'public'::regnamespace and relkind in ('r', 'p') and not relrowsecurity $$,
  'RLS enabled on every public table'
);

-- Partitions are not exposed and anon cannot reach them.
select is_empty(
  $$ select c.relname from pg_inherits i join pg_class c on c.oid = i.inhrelid
     where c.relnamespace = 'public'::regnamespace $$,
  'no partitions in the public schema'
);
select ok(
  (select count(*) from pg_inherits where inhparent = 'public.income_index'::regclass) >= 5,
  'income_index has monthly + default partitions'
);
select ok(not has_schema_privilege('anon', 'cordon_partitions', 'usage'), 'anon cannot use cordon_partitions');
select ok(
  not has_function_privilege('anon', 'public.ensure_monthly_partitions(regclass, integer)', 'execute'),
  'anon cannot manage partitions'
);


-- Server-only functions: queues, rate limits, vault and default requests go through the
-- app server (service role) or workers; anon and signed-in users cannot call them.
select is_empty(
  $$ select f || ' ' || r from unnest(array[
       'public.dvp_enqueue(text)', 'public.dvp_take()', 'public.enqueue_keeper(text, public.address, text)',
       'public.enqueue_relay(public.address, text)', 'public.keeper_read(integer)', 'public.keeper_done(bigint)',
       'public.relay_read(integer)', 'public.relay_done(bigint)', 'public.prune_queues()',
       'public.rate_take(text, integer, integer)', 'public.request_default(public.bytes32)',
       'public.request_vault(public.bytes32, public.address, public.bytes32)', 'public.invoke_worker(text)',
       'public.invoke_app(text)'
     ]) f, unnest(array['anon', 'authenticated']) r
     where has_function_privilege(r, f, 'execute') $$,
  'anon and authenticated cannot execute server-only functions'
);
select ok(not has_table_privilege('anon', 'public.note_inbox', 'insert'), 'anon cannot write the inbox directly');
select ok(not has_table_privilege('anon', 'public.dvp_orders', 'select'), 'anon cannot read DvP orders');

-- Registry constraints.
select throws_ok(
  $$ insert into public.assets (asset, symbol, name, class, claim_types)
     values ('0x00000000000000000000000000000000000000aa', 'V', 'Vault', 'VAULT4626', '{PRINCIPAL,VOTE}') $$,
  '23514', null, 'a vault asset cannot carry VOTE'
);
select throws_ok(
  $$ insert into public.assets (asset, symbol, name, class, claim_types)
     values ('0x00000000000000000000000000000000000000AB', 'X', 'Upper', 'STOCK8056', '{PRINCIPAL}') $$,
  '23514', null, 'addresses must be lower-case hex'
);

insert into public.assets (asset, symbol, name, class, claim_types)
values ('0x00000000000000000000000000000000000000ac', 'T', 'Test', 'STOCK8056', '{PRINCIPAL,INCOME,VOTE,REDEEM,CONTROL}');

insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-00000000000b');

-- Anonymous visitors: read aggregates, write nothing, see no workspaces.
set local role anon;
select ok((select count(*) from public.assets) >= 1, 'anon reads assets');
select throws_ok(
  $$ insert into public.assets (asset, symbol, name, class, claim_types)
     values ('0x00000000000000000000000000000000000000ad', 'Z', 'Z', 'STOCK8056', '{PRINCIPAL}') $$,
  '42501', null, 'anon cannot write assets'
);
select throws_ok($$ select * from public.workspaces $$, '42501', null, 'anon cannot read workspaces');
select throws_ok($$ select * from public.relayer_jobs $$, '42501', null, 'anon cannot read relayer jobs');
reset role;

-- Wallet A writes its workspace.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select lives_ok(
  $$ insert into public.workspaces (ciphertext, iv, key_check)
     values ('AAAA', 'AAAAAAAAAAAAAAAA', repeat('a', 64)) $$,
  'owner creates workspace'
);
select is((select version from public.workspaces), 1, 'new workspace starts at version 1');
update public.workspaces set ciphertext = 'BBBB';
select is((select version from public.workspaces), 2, 'update bumps version');
select throws_ok(
  $$ insert into public.workspaces (owner, ciphertext, iv, key_check)
     values ('00000000-0000-0000-0000-00000000000b', 'AAAA', 'AAAAAAAAAAAAAAAA', repeat('a', 64)) $$,
  '42501', null, 'cannot create a workspace for another wallet'
);
select throws_ok(
  $$ update public.workspaces set owner = '00000000-0000-0000-0000-00000000000b' $$,
  null, null, 'cannot hand a workspace to another wallet'
);

-- Wallet B sees nothing of A.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select is_empty($$ select 1 from public.workspaces $$, 'other wallet cannot read the workspace');
update public.workspaces set ciphertext = 'CCCC';
delete from public.workspaces;
reset role;
select is(
  (select ciphertext from public.workspaces where owner = '00000000-0000-0000-0000-00000000000a'),
  'BBBB',
  'other wallet cannot modify or delete the workspace'
);

select throws_ok(
  $$ insert into public.workspaces (owner, ciphertext, iv, key_check)
     values ('00000000-0000-0000-0000-00000000000b', 'not base64!', 'AAAAAAAAAAAAAAAA', repeat('a', 64)) $$,
  '23514', null, 'ciphertext must be base64'
);
select throws_ok(
  $$ insert into public.encumbrances (enc_commit, kind, released, enforced, created_block)
     values ('0x' || repeat('1', 64), 'LIEN', true, true, 1) $$,
  '23514', null, 'an encumbrance cannot be both released and enforced'
);

select * from finish();
rollback;
