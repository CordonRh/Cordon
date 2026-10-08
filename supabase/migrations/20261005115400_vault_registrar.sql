-- Testnet: requested NAV vaults are scheduled/executed through the timelock without ops.
-- The worker is a no-op unless the ADMIN_PRIVATE_KEY function secret is set.
select cron.schedule('cordon-vault-registrar', '*/10 * * * *', $$select public.invoke_worker('vault-registrar')$$);
