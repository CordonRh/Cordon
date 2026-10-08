-- Robinhood Chain Testnet (46630) wiring: relayable engine functions and the cron
-- invocation settings. The cron key is the project's public anon key (enough to reach
-- the functions' gateway; the functions use their own service credentials inside).
-- Replace the two placeholders below with your project's URL and anon key.

insert into public.relay_targets (target, selector, kind) values
  ('0x99452a9bbc8c3e67b225a98911dfce01201c747a', '0xf7930854', 'pool.transact'),
  ('0x547930b1199cf76cbd6bd798754e7b7500cd7e1a', '0x78792a69', 'bundle.bundle'),
  ('0x547930b1199cf76cbd6bd798754e7b7500cd7e1a', '0xa14501a3', 'bundle.unbundle'),
  ('0x547930b1199cf76cbd6bd798754e7b7500cd7e1a', '0x9e9d0f79', 'bundle.term'),
  ('0x547930b1199cf76cbd6bd798754e7b7500cd7e1a', '0xe9f9709c', 'bundle.claimincome'),
  ('0x5d18cf1f2e35b0658e3dd976c6abfd1a9a97d7d3', '0x73ac46e2', 'encumbrance.encumber'),
  ('0x5d18cf1f2e35b0658e3dd976c6abfd1a9a97d7d3', '0x3be9b3dd', 'encumbrance.unlock'),
  ('0x5d18cf1f2e35b0658e3dd976c6abfd1a9a97d7d3', '0x5153b113', 'encumbrance.enforce'),
  ('0x5d18cf1f2e35b0658e3dd976c6abfd1a9a97d7d3', '0x366a4120', 'encumbrance.release')
on conflict do nothing;

select vault.create_secret('https://<project-ref>.supabase.co', 'cordon_project_url')
where not exists (select 1 from vault.secrets where name = 'cordon_project_url');
select vault.create_secret(
  '<supabase-anon-key>',
  'cordon_service_key'
)
where not exists (select 1 from vault.secrets where name = 'cordon_service_key');
