-- Local development seed. Production assets are registered on-chain through
-- AssetGate and mirrored into public.assets by the indexer; these rows only
-- give `supabase db reset` something to render in the dashboard.
insert into public.assets (asset, symbol, name, class, claim_types, templates, multiplier, mode)
values
  ('0x0000000000000000000000000000000000000001', 'NVDA', 'NVDA Stock Token', 'STOCK8056',
   '{PRINCIPAL,INCOME,VOTE,REDEEM,CONTROL}', '{LOCKUP,PLEDGE,LIEN}', 1000000000000000000, 'ACTIVE'),
  ('0x0000000000000000000000000000000000000002', 'TBILL', 'Treasury token', 'TREASURY',
   '{PRINCIPAL,INCOME,REDEEM,CONTROL}', '{LOCKUP,PLEDGE,LIEN}', 1000000000000000000, 'ACTIVE'),
  ('0x0000000000000000000000000000000000000003', 'vUSDG', 'USDG vault', 'VAULT4626',
   '{PRINCIPAL,INCOME,REDEEM,CONTROL}', '{LOCKUP,PLEDGE}', 1000000000000000000, 'ACTIVE')
on conflict (asset) do nothing;
