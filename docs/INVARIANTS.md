# Invariants

Each property is checked by the test named next to it. `Invariants.t.sol` runs stateful
campaigns (256 runs × 500 calls per module, about 128,000 calls each) with mock
verifiers so the accounting is exercised far beyond what real proofs allow; the other
suites use real proofs from the circuits.

## Pool (funds)

| # | Invariant | Test |
|---|---|---|
| P1 | Solvency: for every asset, `balanceOf(pool) ≥ owed + fees` | `Invariants.t.sol` `PoolInvariants.invariant_poolSolvent`; live: `SolvencyVerifier.attest` hourly (`SolvencyAndStaking.t.sol` `test_solventHourly`, `test_injectedDeficitFails`) |
| P2 | Exact ledger: `owed` = pending deposits + value in notes; `fees` = credited − collected | `PoolInvariants.invariant_poolLedgerExact` |
| P3 | A nullifier is spent at most once (`transact` and `applyOp`) | `PoolInvariants.invariant_nullifierSpentOnce`, `afterInvariant`; `CordonPool.t.sol` `test_depositSplitAndWithdraw` |
| P4 | Leaves = non-zero commitments inserted; empty outputs take no leaf | `PoolInvariants.invariant_leafCountMatchesInserts`; `test_fullWithdrawalTakesNoLeaf` |
| P5 | The current root is always known; root 0 never is; history spans calls | `PoolInvariants.invariant_currentRootKnown`; `test_rootHistorySpansCalls` |
| P6 | Exits are never paused (withdraw, unshield, unbundle, unlock-by-time) | `test_withdrawWorksUnderPauseAndRedeemOnly`, `test_lockupReleasesAtUntil`, `test_incomePauseFreezesIndexButNotExit` |
| P7 | Only the depositor can take a pending deposit back | `test_onlyOriginUnshields` |

## Income index (ActionEngine)

| # | Invariant | Test |
|---|---|---|
| I1 | The index j never rises (≤ 1e36, non-increasing) | `ActionEngineInvariants.invariant_indexNeverRises`, `afterInvariant` |
| I2 | Checkpoint timestamps strictly increase | `ActionEngineInvariants.invariant_checkpointTimesIncrease` |
| I3 | While income is paused the index is frozen | `ActionEngineInvariants.invariant_pausedIndexFrozen`; `test_incomePauseFreezesIndexButNotExit` |
| I4 | A split is never income; unexplained jumps > 5% are held | `test_unscheduledSplitIsHeldNotIncome`, `test_splitIsNotIncome` |
| I5 | PRINCIPAL + INCOME payouts never exceed the bundle, and PRINCIPAL keeps its value | `BundleVerifier.t.sol` `testFuzz_incomeInvariant`, `test_incomeClaimAndPrincipalSumToBundle` |
| I6 | Income is never paid twice: unbundle needs income claimed no later than its proof time | `test_unbundleCannotReuseClaimedIncome` |

## Encumbrances

| # | Invariant | Test |
|---|---|---|
| E1 | Released and enforced are mutually exclusive | `EncumbranceInvariants.invariant_releasedAndEnforcedExclusive` |
| E2 | Enforced ⇒ defaulted; defaulted ⇒ never released; a LOCKUP never defaults | `EncumbranceInvariants.invariant_stateMachine`; `test_releaseAfterDefaultIsRefused` |
| E3 | No forbidden transition ever succeeds | `EncumbranceInvariants.invariant_noIllegalTransition` |
| E4 | Every enforce/unlock output is openable by its owner (derived blindings) | `test_lienWaterfallOrder` |
| E5 | Empty notes cannot settle an encumbrance | `test_zeroRawDecoyCannotEnforce` |

## DvP

| # | Invariant | Test |
|---|---|---|
| D1 | A trade settles only on terms both traders proved (notes, amounts, receiver, class, minimum, expiry) | `DvPSettler.t.sol` `test_sequencerCannotRedirectAnOrder`, `test_wantMinBindsTheFill`, `test_expiredOrderCannotProve`, `test_orderNeedsTheOwnersKey` |
| D2 | Each side nets within tolerance at the pinned prices | `test_tradeThatDoesNotNetCannotProve`, `test_badTradeExcludedBatchStillSettles` |
| D3 | One price per (asset, kind) per batch | `test_duplicatePriceRejected` |
| D4 | Every trader can rebuild its new notes from the chain | `packages/sdk/src/matcher.test.ts` "rebuilds its new note from the published memos" |

## Staking

| # | Invariant | Test |
|---|---|---|
| S1 | CRDN balance = totalStaked = Σ stakes | `StakingInvariants.invariant_crdnBacksStake` |
| S2 | workers + treasury + burn sink + Σ claimed + contract balance = fees received; Σ claimable ≤ booked (rest is rounding dust) | `StakingInvariants.invariant_feesConserved`, `testFuzz_stakingConservesFees` |
| S3 | The contract always covers what stakers can claim | `StakingInvariants.invariant_stakingCoversClaims` |
| S4 | A new stake shares no fees that accrued before it (every stake sweeps the pool's fees first) | `test_justInTimeStakeCannotLeave` |

## Access

Every external state-changing function has a wrong-caller or invalid-input test; the
mapping table is at the top of `contracts/test/Negative.t.sol` (54 / 54).
