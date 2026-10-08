-- Robinhood Chain mainnet (4663): the relayable engine functions of the deployment, and
-- the settings a database migrated before the switch needs to match a fresh install.

-- Default auto-approval setting: the old prefixed key becomes auto_default, off (the keeper
-- reviews each request). app_settings holds no other key.
delete from public.app_settings where key like '%\_auto\_default' and key <> 'auto_default';
insert into public.app_settings (key, value) values ('auto_default', 'off')
on conflict (key) do update set value = 'off';

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

-- NAV vaults stay off on mainnet: no vault registration worker.
select cron.unschedule(jobid) from cron.job where jobname = 'cordon-vault-registrar';

-- Relayable engine functions of packages/shared/deployments/4663.json
-- (bun packages/shared/scripts/relay-targets.ts packages/shared/deployments/4663.json).
delete from public.relay_targets;
insert into public.relay_targets (target, selector, kind) values
  ('0x12771a4430fcc9602974440ddda79ef6251e156e', '0xf7930854', 'pool.transact'),
  ('0x6219305cd85b6c53ad8e5d95720b5ff3166b67a7', '0x78792a69', 'bundle.bundle'),
  ('0x6219305cd85b6c53ad8e5d95720b5ff3166b67a7', '0xa14501a3', 'bundle.unbundle'),
  ('0x6219305cd85b6c53ad8e5d95720b5ff3166b67a7', '0x9e9d0f79', 'bundle.term'),
  ('0x6219305cd85b6c53ad8e5d95720b5ff3166b67a7', '0xe9f9709c', 'bundle.claimincome'),
  ('0x8090e68bedaddbb2355c53e2e2a9c5495b715d4b', '0x73ac46e2', 'encumbrance.encumber'),
  ('0x8090e68bedaddbb2355c53e2e2a9c5495b715d4b', '0x3be9b3dd', 'encumbrance.unlock'),
  ('0x8090e68bedaddbb2355c53e2e2a9c5495b715d4b', '0x5153b113', 'encumbrance.enforce'),
  ('0x8090e68bedaddbb2355c53e2e2a9c5495b715d4b', '0x366a4120', 'encumbrance.release')
on conflict do nothing;
