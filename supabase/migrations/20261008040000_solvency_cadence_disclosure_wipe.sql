-- Solvency runs every 10 minutes; the worker attests only assets whose last attestation is
-- an epoch (1 hour) old. The hourly run at :05 drifted behind attestations that landed later
-- in the hour and reverted TooEarly until a retry.
select cron.alter_job(
  job_id := (select jobid from cron.job where jobname = 'cordon-solvency'),
  schedule := '*/10 * * * *'
);

-- A revoked disclosure keeps no copy of the notes (revoke now clears it too).
update public.disclosures set ciphertext = '' where revoked and ciphertext <> '';
