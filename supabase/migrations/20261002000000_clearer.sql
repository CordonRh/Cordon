-- Deposits past their standby enter the note tree without anyone having to ask.
select cron.schedule('cordon-clearer', '* * * * *', $$select public.invoke_worker('clearer')$$);
