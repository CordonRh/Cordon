# Security

Cordon is unaudited by a third party. The testnet deployment (Robinhood Chain Testnet,
46630) holds faucet tokens only. Do not deposit real assets until an external audit of
`contracts/` and `circuits/` is complete.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting on this repository (Security → Report a
vulnerability). Please include the affected file, a description, and a proof of concept
if you have one. We acknowledge within 72 hours. Do not open public issues for
security reports.

## Privileged functions and who holds them

Every contract except `CordonPool` has an owner or role. The pool itself has no owner
and no admin functions; exits (`transact` withdrawals, `unshieldToOrigin`) can never be
paused.

| Contract | Function | Who may call | Effect |
|---|---|---|---|
| CordonControl | `pause` | guardian, owner | Pauses deposits / bundle / DvP / encumber (never exits) |
| CordonControl | `unpause`, `setEngine`, `setKeeper`, `setGuardian`, `setSequencer`, `setFeeRecipient`, `transferOwnership` | owner = TimelockController (24h) | Engine set decides who may call `CordonPool.applyOp` |
| AssetGate | `register` (once per asset), `setMode`, `setTemplates` | owner = timelock | Lists assets; class and claim mask are fixed at listing |
| PriceOracle | `setFeed` (heartbeat 1 min – 1 day, non-zero feed) | owner = timelock | Chainlink feed per asset |
| NavAttestor | `registerVault` | owner = timelock | Registers a vault manager |
| NavAttestor | `attest` | the vault's manager | Publishes a proven NAV |
| ActionEngine | `scheduleSplit`, `confirmStep`, `setIncomePaused` (max 3 days) | keeper | Resolves held index steps; freezes the income index |
| ScreeningGate | `flag` | keeper | Keeps a deposit in standby (its owner can still take it back) |
| EncumbranceRegistry | `declareDefault` | keeper | Lets the holder enforce a PLEDGE / LIEN |
| DvPSettler | `submitBatch` | sequencer | Settles trades; every order is bound by its trader's own proof |
| CordonPool | `applyOp`, `creditFee` | registered engines | Spends / creates notes after the engine verified a proof |
| TimelockController | `schedule`, `execute`, `cancel` | mainnet: 2-of-3 Safe; testnet: admin EOA | 24h delay on everything above marked "timelock" |
| TestnetStockToken / TestnetPriceFeed (testnet only) | `setMultiplier`, `setAnswer` | testnet admin EOA | Simulate dividends, splits and prices |

Off-chain keys:

| Key | Holds | Where | Can do |
|---|---|---|---|
| Keeper | CordonControl keeper role | Supabase function secret `KEEPER_PRIVATE_KEY` | The keeper functions above |
| Relayer | no role | Supabase function secret `RELAYER_PRIVATE_KEY` | Pays gas for users' proof-carrying calls (allow-listed targets, 60 per client IP per hour). When it refuses, the app submits the same call from the user's wallet, so exits never depend on it |
| Sequencer | CordonControl sequencer | Vercel env (testnet) / Nitro enclave (mainnet) | `submitBatch` |
| Sequencer seal seed | — | Vercel env (testnet) / enclave memory (mainnet) | Reads sealed orders (amounts, note openings; never spending keys) |
| Testnet admin | timelock proposer/executor (testnet only) | Supabase function secret `ADMIN_PRIVATE_KEY` | Schedules / executes vault registrations; unset on mainnet |
| Supabase service role | database | Vercel + Supabase secrets | Bypasses RLS; never exposed to browsers |

## Monitoring and incident response

`supabase/functions/monitor` runs every 5 minutes and alerts (table `public.alerts`,
plus the `ALERT_WEBHOOK_URL` webhook when set) on: governance and role events
(timelock schedule/execute/cancel, engine/keeper/guardian/sequencer/fee changes, asset
and feed changes), pauses, held income-index steps, withdrawals above 10% of an asset's
pool balance, failing or stale oracle feeds, and keeper / relayer / sequencer / admin
balances below 0.002 ETH.

Alerts page the on-call operator over Telegram (`ALERT_WEBHOOK_URL` is a bot
`sendMessage` URL). Contacts: security reports go through GitHub private vulnerability
reporting (above); operational alerts go to the on-call operator. An alert that fails to
deliver stays `notified = false` and is retried on the next run.

Runbook:
1. **Suspected exploit or bad engine:** the guardian calls `CordonControl.pause(15)`
   (deposits, bundle, DvP, encumber). Exits stay open by design. Then cancel any
   suspicious timelock operation (`cancel`) with the Safe.
2. **Held index step (`StepHeld`):** check the token's `newUIMultiplier`/`effectiveAt`.
   A split → keeper `scheduleSplit(asset, num, den, now)`; a genuine large distribution →
   keeper `confirmStep(asset)`.
3. **Oracle stale / failing:** DvP and NAV fail closed by themselves; nothing on the exit
   path reads the oracle. Fix or replace the feed through a timelock `setFeed`.
4. **Low gas:** top up the key from the treasury.
5. **Key compromise:** keeper → timelock `setKeeper(old, false)` and `setKeeper(new,
   true)`; sequencer → `setSequencer(new)`; relayer → rotate the secret (no role);
   then rotate the Supabase/Vercel secret.

## Accepted risks

| Id | Severity | Why it is accepted |
|---|---|---|
| nav-nullifier-precommit | Medium | A vault that attests NAV publishes its holdings' nullifiers so the contract can check they are unspent; its later spends are therefore linkable to the vault. Vaults opt in to public NAV; individual users never attest. Removing it needs a nullifier non-membership accumulator. Decision (2026-10-07): mainnet launches with NAV vaults off: no `registerVault` proposal goes through the timelock, and the vault-registrar worker cannot run there (`ADMIN_PRIVATE_KEY` unset), until the accumulator ships. |
| attestation-not-bound-or-checked | Low | The enclave sequencer is not deployed; the hosted testnet sequencer is documented as unattested. Binding the attestation to the seal key and verifying it in the browser is a mainnet launch item. |
| exact-amount-deposit-withdraw-link | Low | A note withdrawn whole carries its deposit amount and links the two. Partial withdrawal is the default: `withdraw()` refuses the note's full amount unless the caller passes `"whole"`, and the dashboard does so only after an explicit confirmation under the linkability warning (2026-10-08). A near-whole amount is not blocked and is almost as linkable; avoiding it is the user's choice, inherent to arbitrary-amount pools (`docs/THREAT_MODEL.md`). |
| anon-auto-approved-default | Low | Testnet only: with the `testnet_auto_default` setting on, any default request is approved at once so testers can try enforcement; anyone can therefore push a testnet pledge into default (faucet tokens only). The setting is off by default and stays off on mainnet, where the keeper reviews each request. |

## Rate limits and anonymous writes

Anonymous writes (relay jobs, DvP orders, inbox boxes, default requests) are accepted
only by the app server, which keys limits on Vercel's own client-IP header (IPv6 by /64)
and writes with the service role; direct database access for them is revoked
(`supabase/tests/database/privacy_rls.test.sql`). Per client per hour: relay 60, DvP
orders 30, inbox 120, default requests 10; vault requests 3 per wallet and 10 per client
per day. There are no global ceilings, which anyone could exhaust to lock everyone out;
storage is bounded by the 12 KB box cap and pruning. DvP orders whose notes are not in
the tree close after 10 minutes. Keeper jobs use their own queue and key, and the keeper
worker refuses to run without `KEEPER_PRIVATE_KEY` rather than fall back to the relayer.

## Static analysis

CI runs Slither (`contracts/slither.config.json`), Semgrep and gitleaks on every push.
Well-known public test keys (Anvil defaults) in unit tests are marked `gitleaks:allow`
inline; there are no other exceptions. Excluded
Slither detectors are triaged false positives: `uninitialized-state`
(`ActionEngine.history` is filled through a storage reference), `divide-before-multiply`
(`PriceOracle.rawPrice` divides exactly, `CrdnStaking` rounds in the protocol's favour),
`incorrect-equality` / `timestamp` (intended exact checks and time windows),
reentrancy-benign/events and calls-loop (engines call only the immutable pool and
registered verifiers). The generated `*HonkVerifier.sol` files are excluded; CI instead
checks they are exactly what the pinned toolchain produces from the circuits.

## Audit scope

The reviewed version is the release tag `v0.1.0`. Its `contracts/src` matches the testnet
deployment (`packages/shared/deployments/46630.json`), except `CrdnStaking.sol`, which is
not deployed.

In scope: code that holds or moves funds or keys, authenticates users, or decides
settlement. Out of scope: UI code under `src/views`, `src/components` and styles; tests;
generated verifiers (CI checks they match the circuits); `contracts/lib` (pinned
third-party code, installed by `contracts/install.sh`); testnet-only mocks under
`contracts/src/testnet` (behaviour only).

- **Contracts** (`contracts/src`, Solidity 0.8.30): `CordonPool`, `BundleVerifier`,
  `DvPSettler`, `EncumbranceRegistry`, `ActionEngine`, `NavAttestor`, `SolvencyVerifier`,
  `ScreeningGate`, `CordonControl`, `AssetGate`, `PriceOracle`, `CrdnStaking`,
  `libraries/Poseidon.sol`, `interfaces/IERC8056.sol`; scripts `Deploy.s.sol`,
  `UpgradeDvP.s.sol`, `PostDeployCheck.s.sol`.
- **Circuits** (`circuits/`, Noir 1.0.0-beta.22, UltraHonk via bb 5.0.0-nightly.20260522):
  `lib`, `transfer`, `bundle`, `unbundle`, `term`, `income`, `encumber`, `unlock`,
  `enforce`, `order`, `dvp`, `nav`.
- **Off-chain** (TypeScript): `packages/sdk/src`; `src/server`, `src/lib/cordon.ts`,
  `src/lib/workspace-crypto.ts`; `supabase/functions/*` and `supabase/migrations/*`;
  `services/*`; `scripts/register-vaults.ts`, `scripts/swap-settler.ts`.

## Audit history

- 2026-10-05 to 2026-10-08: AI-assisted security reviews of the contracts, circuits and
  off-chain code, with every finding fixed or listed under Accepted risks above. The
  reviews added mutation testing, Halmos symbolic checks, fork tests against Robinhood
  Chain mainnet and stateful invariant suites, all of which run in CI.
- No external audit yet.
