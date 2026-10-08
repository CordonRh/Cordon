# Threat model and honest boundaries

## What Cordon cannot do (honest boundaries)

- **It is not audited.** An AI-assisted security review was done; an external audit of
  the contracts and circuits is required before real funds.
- **It does not hide that you use it.** Deposits and withdrawals are public transactions
  with an address, an asset and an amount. A note withdrawn whole, never split, carries
  its deposit amount and links the two. The dashboard asks how much to withdraw and keeps
  the rest as a new private note; withdrawing the whole note is opt-in (the client refuses
  it without an explicit confirmation under the linkability warning). Withdraw a different
  amount to keep the two unlinked.
- **It does not hide vault activity.** A vault that attests NAV publishes its holdings'
  nullifiers, so its later spends are linkable to it.
- **Testnet DvP is not private from its operator.** The hosted sequencer reads sealed
  orders (amounts and note openings, never spending keys). Mainnet runs the enclave
  sequencer; until its attestation is checked in the browser, the operator could read
  orders there too.
- **It depends on the issuer.** If the Stock Token issuer freezes the pool, changes the
  multiplier wrongly or forces a transfer, Cordon cannot undo it. Unexplained index jumps
  are held, not booked, but the underlying token is the issuer's.
- **It depends on the keeper for corporate actions and defaults.** A late split schedule
  delays income (it is held, never mis-booked); a dead keeper means held steps and
  requested defaults wait.
- **Prices are as good as Chainlink.** Equity feeds can be up to a day old outside
  market hours; DvP trades within 50 bps of the pinned marks and each order's own minimum.
- **Censorship:** the relayer, sequencer and database can delay or refuse service.
  Users can always call the contracts directly; exits never need them.
- **$CRDN is not launched**; `CrdnStaking` is not deployed.

## Threats and controls

| Threat | Control | Test |
|---|---|---|
| Double spend | Nullifier set; `Spent` revert | `CordonPool.t.sol` `test_depositSplitAndWithdraw`; `Invariants.t.sol` |
| Forged proof / wrong public inputs | On-chain verifiers; public-input order fixed per engine; CI rebuilds verifiers | every engine test with real proofs |
| Insolvency | Pool accounting `owed` + `fees`; hourly `SolvencyVerifier` | `Invariants.t.sol`, `SolvencyAndStaking.t.sol` |
| Exit blocked | No pause on `transact` / `unshieldToOrigin` / `unlock`; income pause only freezes the index; empty outputs take no leaf; tree depth 32 | `test_withdrawWorksUnderPauseAndRedeemOnly`, `test_incomePauseFreezesIndexButNotExit`, `test_fullWithdrawalTakesNoLeaf` |
| Proof griefing via root eviction | Root history kept per call, not per leaf | `test_rootHistorySpansCalls` |
| Deposit griefing | Only the depositor can unshield; `clear` skips settled ids | `test_onlyOriginUnshields`, `test_clearSkipsSettledIds` |
| Split booked as income | Steps > 5% held until the keeper schedules or confirms | `test_unscheduledSplitIsHeldNotIncome` |
| Pledgor reclaims collateral | Holder-only release secret (pledge code); no release after default | `test_releaseAfterDefaultIsRefused` |
| Counterparty makes your note unspendable | Output blindings derived in-circuit (enforce, unlock, DvP) | `test_lienWaterfallOrder` |
| Zero-value decoy settles an encumbrance | Empty notes cannot be inserted, encumbered, enforced or unlocked | `test_zeroRawDecoyCannotEnforce` |
| Sequencer steals or reroutes in DvP | Order proofs bind notes, amounts, receive key, class, minimum received and expiry | `test_sequencerCannotRedirectAnOrder`, `test_wantMinBindsTheFill` |
| Sequencer withholds results | New notes rebuildable from `TradeSettled` memos | `matcher.test.ts` "rebuilds its new note from the published memos" |
| Sequencer picks a favourable mark | Round must be in force at the batch time; one row per asset; pre-action rounds refused | `test_duplicatePriceRejected`, oracle tests |
| Poison order stalls batches | Order proofs refuse unprovable gives; per-trade error handling | `order` circuit tests |
| Income paid twice via a backdated unbundle | Unbundle requires income claimed no later than the proof time | `test_unbundleCannotReuseClaimedIncome` |
| Fake or malformed orders stall DvP | Orders are shape-checked and verified one by one; orders over notes not in the tree never pair; one open order per note | `src/server/sequencer.ts`, `wellFormed` |
| Batch reverts on a fresh oracle round | The sequencer pins the round in force at the batch time | `src/server/sequencer.ts` |
| Holder accepts a pledge that cannot be enforced | The holder checks the encumbrance exists and the locked note is the real leaf; pledge codes are single-use | `src/lib/cordon.ts` `heldState` |
| Spam / gas draining | Server-only queue writes, per-client rate limits (no global ceilings anyone could exhaust), separate keeper key and queue | `supabase/migrations/20261005154403_hardening.sql`, `src/server/trpc/trpc.ts` |
| Vault id squatting | Vault id derived server-side from the signed-in wallet identity | `src/server/trpc/router.ts` `requestVault` |
| Fee-share sniping / DoS | Listed fee tokens only; 7-day minimum stake | `test_justInTimeStakeCannotLeave`, `test_onlyListedAssetsAreFeeTokens` |
| Supply-chain compromise | Frozen lockfiles, exact pins, 24h release cooldown, no install scripts, digest-pinned images, SHA-pinned CI actions, gitleaks | `.github/workflows/ci.yml` |
