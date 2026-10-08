// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

// Unauthorized-caller / invalid-input coverage for every external state-changing function
// in contracts/src/*.sol (src/verifiers excluded). "N:" = this file,
// otherwise the existing test that already asserts the revert. 54 / 54 covered.
//
// | #  | Contract.function                | Negative case(s)                                    | Test(s)                                                       |
// |----|----------------------------------|-----------------------------------------------------|---------------------------------------------------------------|
// |  1 | CordonPool.deposit               | AssetNotActive x2, BadAmount x3, NotField, IsPaused | N: test_pool_deposit_*                                        |
// |  2 | CordonPool.clear                 | InStandby, DepositFlagged, out-of-range id          | CordonPool.t: test_clearWaitsForStandby, test_flaggedDeposit… ; N: test_pool_clear_unknownId |
// |  3 | CordonPool.unshieldToOrigin      | NotOrigin, DepositSettled, out-of-range id          | CordonPool.t: test_onlyOriginUnshields, test_unshieldToOriginInStandby ; N: test_pool_unshield_unknownId |
// |  4 | CordonPool.transact              | InvalidProof, UnknownRoot, StaleProof, Spent, NotField, over-withdraw | N: test_pool_transact_* ; CordonPool.t: test_depositSplitAndWithdraw |
// |  5 | CordonPool.applyOp               | NotEngine, UnknownRoot, Spent                       | CordonPool.t: test_onlyEnginesApplyOps ; N: test_pool_applyOp_* |
// |  6 | CordonPool.creditFee             | NotEngine, more than owed                           | N: test_pool_creditFee_*                                      |
// |  7 | CordonPool.collectFees           | NoFeeRecipient                                      | Deploy.t: _withoutCrdn ; N: test_pool_collectFees_noRecipient |
// |  8 | BundleVerifier.bundle            | AssetNotActive, IsPaused, StaleProof, InvalidProof, NotEngine | BundleVerifier.t: test_redeemOnly…, test_guardianPause… ; N: test_bundle_bundle_* |
// |  9 | BundleVerifier.unbundle          | UnknownAsset, StaleProof, InvalidProof              | N: test_bundle_unbundle_*                                     |
// | 10 | BundleVerifier.term              | IsPaused, StaleProof, InvalidProof                  | N: test_bundle_term_*                                         |
// | 11 | BundleVerifier.claimIncome       | UnknownAsset, StaleProof, InvalidProof              | N: test_bundle_claimIncome_*                                  |
// | 12 | DvPSettler.submitBatch           | NotSequencer, IsPaused, DuplicatePrice, StaleOracle, StaleProof, NoFeed, bad proof / tolerance excluded | DvPSettler.t: test_onlySequencerAndPause, test_duplicatePriceRejected, test_staleOracleDefersBatch ; N: test_dvp_* |
// | 13 | EncumbranceRegistry.encumber     | TemplateNotAllowed x2, AssetNotActive, IsPaused, Exists, InvalidProof | EncumbranceRegistry.t: test_templateMustBeAllowed ; N: test_enc_encumber_* |
// | 14 | EncumbranceRegistry.release      | WrongSecret, AlreadySettled x2, Unknown             | EncumbranceRegistry.t: test_pledgeReleasedByHolderSecret, test_releaseAfterDefaultIsRefused ; N: test_enc_release_* |
// | 15 | EncumbranceRegistry.declareDefault | NotKeeper, Unknown, AlreadySettled x2             | EncumbranceRegistry.t: test_pledgeEnforceNeedsDefault ; N: test_enc_declareDefault_* |
// | 16 | EncumbranceRegistry.unlock       | NotReleased, InvalidProof x2                        | EncumbranceRegistry.t: test_lockupReleasesAtUntil ; N: test_enc_unlock_* |
// | 17 | EncumbranceRegistry.enforce      | NotDefaulted, Unknown, AlreadySettled, InvalidProof x2 | EncumbranceRegistry.t: test_pledgeEnforceNeedsDefault ; N: test_enc_enforce_* |
// | 18 | NavAttestor.registerVault        | OwnableUnauthorizedAccount                          | N: test_nav_registerVault_notOwner                            |
// | 19 | NavAttestor.attest               | NotManager, StaleOracle, LiabilityOmitted, UnknownVault, WrongEpoch, TooEarly, HoldingSpent, DuplicateHolding, DuplicatePrice, NoFeed, InvalidProof x2 | NavAttestor.t: test_onlyManagerAndFreshOracle, test_omittedLiabilityRejected ; N: test_nav_attest_* |
// | 20 | ActionEngine.sync                | UnknownAsset, NoIndex                               | N: test_actions_sync_*                                        |
// | 21 | ActionEngine.scheduleSplit       | NotKeeper, BadSplit x4                              | BundleVerifier.t: test_onlyKeeperResolvesSteps ; N: test_actions_scheduleSplit_bad |
// | 22 | ActionEngine.confirmStep         | NotKeeper                                           | BundleVerifier.t: test_onlyKeeperResolvesSteps                |
// | 23 | ActionEngine.setIncomePaused     | NotKeeper                                           | BundleVerifier.t: test_onlyKeeperResolvesSteps                |
// | 24 | CordonControl.pause              | NotGuardian                                         | N: test_control_pause_notGuardian                             |
// | 25 | CordonControl.unpause            | OwnableUnauthorizedAccount (stranger, guardian)     | N: test_control_onlyOwner                                     |
// | 26 | CordonControl.setEngine          | OwnableUnauthorizedAccount, ZeroAddress             | N: test_control_onlyOwner, test_control_zeroAddress           |
// | 27 | CordonControl.setKeeper          | OwnableUnauthorizedAccount, ZeroAddress             | N: test_control_onlyOwner, test_control_zeroAddress           |
// | 28 | CordonControl.setGuardian        | OwnableUnauthorizedAccount, ZeroAddress             | N: test_control_onlyOwner, test_control_zeroAddress           |
// | 29 | CordonControl.setSequencer       | OwnableUnauthorizedAccount, ZeroAddress             | N: test_control_onlyOwner, test_control_zeroAddress           |
// | 30 | CordonControl.setFeeRecipient    | OwnableUnauthorizedAccount                          | N: test_control_onlyOwner                                     |
// | 31 | AssetGate.register               | OwnableUnauthorizedAccount, BadMask x3, AlreadyRegistered | N: test_gate_register_*                                 |
// | 32 | AssetGate.setTemplates           | OwnableUnauthorizedAccount, UnknownAsset, BadMask   | N: test_gate_setTemplates_*                                   |
// | 33 | AssetGate.setMode                | OwnableUnauthorizedAccount, UnknownAsset x2         | N: test_gate_setMode_*                                        |
// | 34 | PriceOracle.setFeed              | OwnableUnauthorizedAccount, BadFeed x3              | N: test_oracle_setFeed_*                                      |
// | 35 | ScreeningGate.flag               | NotScreener                                         | N: test_screening_flag_notKeeper                              |
// | 36 | SolvencyVerifier.attest          | TooEarly, Deficit, UnknownAsset                     | SolvencyAndStaking.t: test_solventHourly, test_injectedDeficitFails ; N: test_solvency_attest_unknownAsset |
// | 37 | CrdnStaking.stake                | ERC20InsufficientAllowance (constructor: ZeroAddress x3) | N: test_staking_stake_noAllowance, test_staking_constructor_zeroAddress |
// | 38 | CrdnStaking.unstake              | Locked, more than staked                            | SolvencyAndStaking.t: test_votersLockedUntilVoteEnds ; N: test_staking_unstake_moreThanStaked |
// | 39 | CrdnStaking.distribute           | NotFeeToken (unlisted, CRDN)                        | SolvencyAndStaking.t: test_onlyListedAssetsAreFeeTokens       |
// | 40 | CrdnStaking.claim                | SafeERC20FailedOperation, second claim pays 0       | N: test_staking_claim_*                                       |
// | 41 | CrdnStaking.propose              | NoStake                                             | N: test_staking_propose_noStake                               |
// | 42 | CrdnStaking.vote                 | NoStake, AlreadyVoted, VotingClosed, unknown id     | N: test_staking_vote_*                                        |
// | 43-46 | {CordonControl, AssetGate, PriceOracle, NavAttestor}.transferOwnership (Ownable2Step) | OwnableUnauthorizedAccount | N: test_ownable_transferOwnership |
// | 47-50 | {…}.acceptOwnership                                                                    | OwnableUnauthorizedAccount (no / other pending owner) | N: test_ownable_acceptOwnership |
// | 51-54 | {…}.renounceOwnership                                                                  | OwnableUnauthorizedAccount | N: test_ownable_renounceOwnership |

import {Test, stdError} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPoseidon2} from "poseidon2-evm/IPoseidon2.sol";
import {Poseidon2Yul_BN254} from "poseidon2-evm/bn254/yul/Poseidon2Yul.sol";
import {ActionEngine} from "../src/ActionEngine.sol";
import {AssetGate} from "../src/AssetGate.sol";
import {BundleVerifier} from "../src/BundleVerifier.sol";
import {CordonControl} from "../src/CordonControl.sol";
import {CordonPool} from "../src/CordonPool.sol";
import {CrdnStaking} from "../src/CrdnStaking.sol";
import {DvPSettler} from "../src/DvPSettler.sol";
import {EncumbranceRegistry} from "../src/EncumbranceRegistry.sol";
import {NavAttestor} from "../src/NavAttestor.sol";
import {PriceOracle} from "../src/PriceOracle.sol";
import {ScreeningGate} from "../src/ScreeningGate.sol";
import {SolvencyVerifier} from "../src/SolvencyVerifier.sol";
import {AggregatorV3Interface} from "../src/interfaces/AggregatorV3Interface.sol";
import {IProofVerifier} from "../src/interfaces/IProofVerifier.sol";
import {MockStock} from "./Base.t.sol";
import {MockFeed} from "./DvPSettler.t.sol";

/// Accepts every proof until told otherwise, so tests reach each check on either side.
contract FlagVerifier is IProofVerifier {
    bool public ok = true;

    function set(bool ok_) external {
        ok = ok_;
    }

    function verify(bytes calldata, bytes32[] calldata) external view returns (bool) {
        return ok;
    }
}

/// Burns 1 unit on every transfer: the pool must not credit what it did not receive.
contract TaxToken is MockStock {
    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (from != address(0) && to != address(0)) _burn(to, 1);
    }
}

contract NegativeTest is Test {
    uint8 internal constant DEPOSITS = 1;
    uint8 internal constant BUNDLE = 2;
    uint8 internal constant ENCUMBER = 8;
    uint256 internal constant FIELD = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001;
    bytes32 internal constant VAULT = keccak256("vault");

    address internal gov = makeAddr("timelock");
    address internal guardian = makeAddr("guardian");
    address internal keeper = makeAddr("keeper");
    address internal sequencer = makeAddr("tee");
    address internal manager = makeAddr("manager");
    address internal workers = makeAddr("workers");
    address internal treasury = makeAddr("treasury");
    address internal burnSink = makeAddr("burnSink");
    address internal alice = makeAddr("alice");
    address internal stranger = makeAddr("stranger");
    address internal junk = makeAddr("junk-asset");

    IPoseidon2 internal hasher;
    FlagVerifier internal v;
    CordonControl internal control;
    AssetGate internal gate;
    ScreeningGate internal screening;
    CordonPool internal pool;
    ActionEngine internal actions;
    BundleVerifier internal bundler;
    PriceOracle internal oracle;
    DvPSettler internal settler;
    EncumbranceRegistry internal registry;
    NavAttestor internal nav;
    SolvencyVerifier internal solvency;
    CrdnStaking internal staking;
    MockStock internal stock;
    MockStock internal crdn;
    MockFeed internal feed;
    uint256 internal root0;
    uint256 internal nonce = 1000;

    function setUp() public {
        vm.warp(1_800_000_000);
        hasher = IPoseidon2(address(new Poseidon2Yul_BN254()));
        v = new FlagVerifier();
        control = new CordonControl(gov, guardian, makeAddr("feeSink"));
        gate = new AssetGate(gov);
        screening = new ScreeningGate(control);
        pool = new CordonPool(hasher, gate, control, screening, v);
        actions = new ActionEngine(gate, control);
        bundler = new BundleVerifier(pool, actions, v, v, v, v);
        oracle = new PriceOracle(gov, gate);
        settler = new DvPSettler(pool, oracle, v, v);
        registry = new EncumbranceRegistry(pool, v, v, v);
        nav = new NavAttestor(gov, pool, oracle, v);
        solvency = new SolvencyVerifier(pool);
        stock = new MockStock();
        crdn = new MockStock();
        staking = new CrdnStaking(crdn, workers, treasury, burnSink, pool);
        feed = new MockFeed();
        feed.set(100e8);

        vm.startPrank(gov);
        control.setEngine(address(bundler), true);
        control.setEngine(address(settler), true);
        control.setEngine(address(registry), true);
        control.setKeeper(keeper, true);
        control.setSequencer(sequencer);
        gate.register(address(stock), AssetGate.Class.STOCK8056, 31, 7);
        oracle.setFeed(address(stock), feed, 1 days);
        nav.registerVault(VAULT, manager, 1);
        vm.stopPrank();
        actions.sync(address(stock));

        stock.mint(alice, 1e24);
        vm.prank(alice);
        stock.approve(address(pool), type(uint256).max);
        root0 = pool.currentRoot();
    }

    function _next() internal returns (uint256) {
        return ++nonce;
    }

    function _notOwner(address who) internal {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, who));
    }

    // =============================================================== CordonPool

    function test_pool_deposit_unknownOrRedeemOnlyAsset() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CordonPool.AssetNotActive.selector, junk));
        pool.deposit(junk, 1, 1);

        vm.prank(gov);
        gate.setMode(address(stock), AssetGate.Mode.REDEEM_ONLY);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CordonPool.AssetNotActive.selector, address(stock)));
        pool.deposit(address(stock), 1, 1);
    }

    function test_pool_deposit_badAmount() public {
        vm.startPrank(alice);
        vm.expectRevert(CordonPool.BadAmount.selector);
        pool.deposit(address(stock), 0, 1);
        vm.expectRevert(CordonPool.BadAmount.selector);
        pool.deposit(address(stock), 2 ** 120, 1);
        vm.stopPrank();
    }

    function test_pool_deposit_feeOnTransferToken() public {
        TaxToken tax = new TaxToken();
        vm.prank(gov);
        gate.register(address(tax), AssetGate.Class.STOCK8056, 31, 7);
        tax.mint(alice, 100);
        vm.startPrank(alice);
        tax.approve(address(pool), 100);
        vm.expectRevert(CordonPool.BadAmount.selector);
        pool.deposit(address(tax), 100, 1);
        vm.stopPrank();
    }

    function test_pool_deposit_npkNotField() public {
        vm.prank(alice);
        vm.expectRevert(CordonPool.NotField.selector);
        pool.deposit(address(stock), 1, FIELD);
    }

    function test_pool_deposit_paused() public {
        vm.prank(guardian);
        control.pause(DEPOSITS);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CordonControl.IsPaused.selector, DEPOSITS));
        pool.deposit(address(stock), 1, 1);
    }

    function test_pool_clear_unknownId() public {
        uint256[] memory ids = new uint256[](1);
        ids[0] = 7;
        vm.expectRevert(stdError.indexOOBError);
        pool.clear(ids);
    }

    function test_pool_unshield_unknownId() public {
        vm.prank(alice);
        vm.expectRevert(stdError.indexOOBError);
        pool.unshieldToOrigin(7);
    }

    function _tx(uint256 withdrawRaw) internal returns (CordonPool.Transfer memory t) {
        t = CordonPool.Transfer(root0, block.timestamp, address(stock), withdrawRaw, alice, [_next(), _next()], [uint256(0), 0]);
    }

    function test_pool_transact_invalidProof() public {
        CordonPool.Transfer memory t = _tx(0);
        v.set(false);
        vm.expectRevert(CordonPool.InvalidProof.selector);
        pool.transact("", t);
    }

    function test_pool_transact_unknownRoot() public {
        CordonPool.Transfer memory t = _tx(0);
        t.root = 12345;
        vm.expectRevert(CordonPool.UnknownRoot.selector);
        pool.transact("", t);
        t.root = 0;
        vm.expectRevert(CordonPool.UnknownRoot.selector);
        pool.transact("", t);
    }

    function test_pool_transact_staleProof() public {
        CordonPool.Transfer memory t = _tx(0);
        t.now_ = block.timestamp + 1;
        vm.expectRevert(CordonPool.StaleProof.selector);
        pool.transact("", t);
        t.now_ = block.timestamp - pool.MAX_PROOF_AGE() - 1;
        vm.expectRevert(CordonPool.StaleProof.selector);
        pool.transact("", t);
    }

    function test_pool_transact_spentNullifier() public {
        CordonPool.Transfer memory t = _tx(0);
        t.nullifiers[1] = t.nullifiers[0];
        vm.expectRevert(abi.encodeWithSelector(CordonPool.Spent.selector, t.nullifiers[0]));
        pool.transact("", t);

        t = _tx(0);
        pool.transact("", t);
        vm.expectRevert(abi.encodeWithSelector(CordonPool.Spent.selector, t.nullifiers[0]));
        pool.transact("", t);
    }

    function test_pool_transact_commitNotField() public {
        CordonPool.Transfer memory t = _tx(0);
        t.commits[0] = FIELD;
        vm.expectRevert(CordonPool.NotField.selector);
        pool.transact("", t);
    }

    /// Even a forged proof cannot take more than the pool owes for the asset.
    function test_pool_transact_overWithdraw() public {
        vm.prank(alice);
        pool.deposit(address(stock), 100, 1);
        CordonPool.Transfer memory t = _tx(101);
        vm.expectRevert(stdError.arithmeticError);
        pool.transact("", t);
    }

    function test_pool_applyOp_unknownRootAndSpent() public {
        uint256[] memory none = new uint256[](0);
        vm.prank(address(bundler));
        vm.expectRevert(CordonPool.UnknownRoot.selector);
        pool.applyOp(12345, none, none);

        uint256[] memory twice = new uint256[](2);
        (twice[0], twice[1]) = (5, 5);
        vm.prank(address(bundler));
        vm.expectRevert(abi.encodeWithSelector(CordonPool.Spent.selector, 5));
        pool.applyOp(root0, twice, none);
    }

    function test_pool_creditFee_notEngineOrMoreThanOwed() public {
        vm.prank(stranger);
        vm.expectRevert(CordonPool.NotEngine.selector);
        pool.creditFee(address(stock), 1);

        vm.prank(address(bundler));
        vm.expectRevert(stdError.arithmeticError);
        pool.creditFee(address(stock), 1);
    }

    function test_pool_collectFees_noRecipient() public {
        vm.prank(gov);
        control.setFeeRecipient(address(0));
        vm.expectRevert(CordonPool.NoFeeRecipient.selector);
        pool.collectFees(address(stock));
    }

    // =============================================================== BundleVerifier

    function _bundleArgs() internal returns (BundleVerifier.Bundle memory b) {
        b.root = root0;
        b.now_ = block.timestamp;
        b.asset = address(stock);
        b.nullifier = _next();
    }

    function test_bundle_bundle_unknownAsset() public {
        BundleVerifier.Bundle memory b = _bundleArgs();
        b.asset = junk;
        vm.expectRevert(abi.encodeWithSelector(BundleVerifier.AssetNotActive.selector, junk));
        bundler.bundle("", b);
    }

    function test_bundle_bundle_staleProof() public {
        BundleVerifier.Bundle memory b = _bundleArgs();
        b.now_ = block.timestamp + 1;
        vm.expectRevert(BundleVerifier.StaleProof.selector);
        bundler.bundle("", b);
        b.now_ = block.timestamp - 1 hours - 1;
        vm.expectRevert(BundleVerifier.StaleProof.selector);
        bundler.bundle("", b);
    }

    function test_bundle_bundle_invalidProof() public {
        BundleVerifier.Bundle memory b = _bundleArgs();
        v.set(false);
        vm.expectRevert(BundleVerifier.InvalidProof.selector);
        bundler.bundle("", b);
    }

    /// A de-registered engine cannot touch the pool even with a valid proof.
    function test_bundle_bundle_engineRemoved() public {
        BundleVerifier.Bundle memory b = _bundleArgs();
        vm.prank(gov);
        control.setEngine(address(bundler), false);
        vm.expectRevert(CordonPool.NotEngine.selector);
        bundler.bundle("", b);
    }

    function _unbundleArgs() internal returns (BundleVerifier.Unbundle memory u) {
        u.root = root0;
        u.now_ = block.timestamp;
        u.asset = address(stock);
        u.nullifiers[0] = _next();
        u.commit = _next();
    }

    function test_bundle_unbundle_unknownAsset() public {
        BundleVerifier.Unbundle memory u = _unbundleArgs();
        u.asset = junk;
        vm.expectRevert(abi.encodeWithSelector(BundleVerifier.UnknownAsset.selector, junk));
        bundler.unbundle("", u);
    }

    function test_bundle_unbundle_staleProof() public {
        BundleVerifier.Unbundle memory u = _unbundleArgs();
        u.now_ = block.timestamp + 1;
        vm.expectRevert(BundleVerifier.StaleProof.selector);
        bundler.unbundle("", u);
    }

    function test_bundle_unbundle_invalidProof() public {
        BundleVerifier.Unbundle memory u = _unbundleArgs();
        v.set(false);
        vm.expectRevert(BundleVerifier.InvalidProof.selector);
        bundler.unbundle("", u);
    }

    function _termArgs() internal returns (BundleVerifier.Term memory t) {
        t.root = root0;
        t.now_ = block.timestamp;
        t.nullifier = _next();
        t.commits = [_next(), _next()];
    }

    function test_bundle_term_paused() public {
        BundleVerifier.Term memory t = _termArgs();
        vm.prank(guardian);
        control.pause(BUNDLE);
        vm.expectRevert(abi.encodeWithSelector(CordonControl.IsPaused.selector, BUNDLE));
        bundler.term("", t);
    }

    function test_bundle_term_staleProof() public {
        BundleVerifier.Term memory t = _termArgs();
        t.now_ = block.timestamp - 1 hours - 1;
        vm.expectRevert(BundleVerifier.StaleProof.selector);
        bundler.term("", t);
    }

    function test_bundle_term_invalidProof() public {
        BundleVerifier.Term memory t = _termArgs();
        v.set(false);
        vm.expectRevert(BundleVerifier.InvalidProof.selector);
        bundler.term("", t);
    }

    function _claimArgs() internal returns (BundleVerifier.Claim memory c) {
        c = BundleVerifier.Claim(root0, address(stock), block.timestamp, block.timestamp, _next(), _next(), _next());
    }

    function test_bundle_claimIncome_unknownAsset() public {
        BundleVerifier.Claim memory c = _claimArgs();
        c.asset = junk;
        vm.expectRevert(abi.encodeWithSelector(ActionEngine.UnknownAsset.selector, junk));
        bundler.claimIncome("", c);
    }

    function test_bundle_claimIncome_futureEnd() public {
        BundleVerifier.Claim memory c = _claimArgs();
        c.tEnd = block.timestamp + 1;
        vm.expectRevert(BundleVerifier.StaleProof.selector);
        bundler.claimIncome("", c);
    }

    function test_bundle_claimIncome_invalidProof() public {
        BundleVerifier.Claim memory c = _claimArgs();
        v.set(false);
        vm.expectRevert(BundleVerifier.InvalidProof.selector);
        bundler.claimIncome("", c);
    }

    // =============================================================== DvPSettler

    function test_dvp_staleBatchTime() public {
        DvPSettler.Price[16] memory p;
        DvPSettler.Trade[] memory none = new DvPSettler.Trade[](0);
        uint256 maxAge = settler.MAX_PROOF_AGE();
        vm.prank(sequencer);
        vm.expectRevert(DvPSettler.StaleProof.selector);
        settler.submitBatch(block.timestamp + 1, p, none);
        vm.prank(sequencer);
        vm.expectRevert(DvPSettler.StaleProof.selector);
        settler.submitBatch(block.timestamp - maxAge - 1, p, none);
    }

    function test_dvp_unpricedAsset() public {
        DvPSettler.Price[16] memory p;
        p[0] = DvPSettler.Price(junk, 0, 1, 0);
        vm.prank(sequencer);
        vm.expectRevert(abi.encodeWithSelector(PriceOracle.NoFeed.selector, junk));
        settler.submitBatch(block.timestamp, p, new DvPSettler.Trade[](0));
    }

    function _oneTrade(uint256 tolerance) internal returns (DvPSettler.Trade[] memory trades) {
        trades = new DvPSettler.Trade[](1);
        trades[0].root = root0;
        trades[0].toleranceBps = tolerance;
        trades[0].orders[0].nullifiers[0] = _next();
        trades[0].orders[1].nullifiers[0] = _next();
        trades[0].commits[0] = _next();
    }

    /// A trade whose proof fails is excluded (no revert) and spends nothing.
    function test_dvp_invalidProofExcluded() public {
        DvPSettler.Price[16] memory p;
        DvPSettler.Trade[] memory trades = _oneTrade(10);
        v.set(false);
        vm.expectEmit(address(settler));
        emit DvPSettler.TradeExcluded(0, 0);
        vm.prank(sequencer);
        settler.submitBatch(block.timestamp, p, trades);
        assertFalse(pool.nullified(trades[0].orders[0].nullifiers[0]));
        assertEq(pool.nextLeaf(), 0);
    }

    function test_dvp_toleranceTooWideExcluded() public {
        DvPSettler.Price[16] memory p;
        DvPSettler.Trade[] memory trades = _oneTrade(settler.MAX_TOLERANCE_BPS() + 1);
        vm.expectEmit(address(settler));
        emit DvPSettler.TradeExcluded(0, 0);
        vm.prank(sequencer);
        settler.submitBatch(block.timestamp, p, trades);
        assertFalse(pool.nullified(trades[0].orders[0].nullifiers[0]));
    }

    // =============================================================== EncumbranceRegistry

    function _encArgs(uint8 kind, uint64 until, uint256 secret, uint256 enc)
        internal
        returns (EncumbranceRegistry.Encumber memory)
    {
        return EncumbranceRegistry.Encumber(
            root0, address(stock), kind, until, hasher.hash_1(secret), _next(), _next(), enc
        );
    }

    function _enc(uint8 kind, uint64 until, uint256 secret) internal returns (uint256 enc) {
        enc = _next();
        registry.encumber("", _encArgs(kind, until, secret, enc));
    }

    function _spend(uint256 enc, uint256 outs) internal returns (EncumbranceRegistry.Spend memory s) {
        uint256[] memory cs = new uint256[](outs);
        for (uint256 i; i < outs; ++i) {
            cs[i] = _next();
        }
        s = EncumbranceRegistry.Spend(pool.currentRoot(), enc, _next(), cs);
    }

    function _pledgeDefaulted() internal returns (uint256 enc) {
        enc = _enc(1, uint64(block.timestamp + 1 days), 42);
        vm.prank(keeper);
        registry.declareDefault(enc);
    }

    function test_enc_encumber_unknownAsset() public {
        EncumbranceRegistry.Encumber memory e = _encArgs(0, 0, 1, _next());
        e.asset = junk;
        vm.expectRevert(abi.encodeWithSelector(EncumbranceRegistry.AssetNotActive.selector, junk));
        registry.encumber("", e);
    }

    function test_enc_encumber_paused() public {
        EncumbranceRegistry.Encumber memory e = _encArgs(0, 0, 1, _next());
        vm.prank(guardian);
        control.pause(ENCUMBER);
        vm.expectRevert(abi.encodeWithSelector(CordonControl.IsPaused.selector, ENCUMBER));
        registry.encumber("", e);
    }

    function test_enc_encumber_unknownKind() public {
        EncumbranceRegistry.Encumber memory e = _encArgs(3, 0, 1, _next());
        vm.expectRevert(abi.encodeWithSelector(EncumbranceRegistry.TemplateNotAllowed.selector, address(stock), 3));
        registry.encumber("", e);
    }

    function test_enc_encumber_exists() public {
        uint256 enc = _enc(0, 0, 1);
        EncumbranceRegistry.Encumber memory e = _encArgs(0, 0, 1, enc);
        vm.expectRevert(EncumbranceRegistry.Exists.selector);
        registry.encumber("", e);
    }

    function test_enc_encumber_invalidProof() public {
        EncumbranceRegistry.Encumber memory e = _encArgs(0, 0, 1, _next());
        v.set(false);
        vm.expectRevert(EncumbranceRegistry.InvalidProof.selector);
        registry.encumber("", e);
    }

    function test_enc_release_unknown() public {
        vm.expectRevert(EncumbranceRegistry.Unknown.selector);
        registry.release(123, 1);
    }

    function test_enc_release_afterEnforce() public {
        uint256 enc = _pledgeDefaulted();
        registry.enforce("", _spend(enc, 5));
        vm.expectRevert(EncumbranceRegistry.AlreadySettled.selector);
        registry.release(enc, 42);
    }

    function test_enc_declareDefault_unknown() public {
        vm.prank(keeper);
        vm.expectRevert(EncumbranceRegistry.Unknown.selector);
        registry.declareDefault(123);
    }

    function test_enc_declareDefault_lockupOrReleased() public {
        uint256 lockup = _enc(0, uint64(block.timestamp + 1 days), 1);
        vm.prank(keeper);
        vm.expectRevert(EncumbranceRegistry.AlreadySettled.selector);
        registry.declareDefault(lockup);

        uint256 pledge = _enc(1, uint64(block.timestamp + 1 days), 2);
        registry.release(pledge, 2);
        vm.prank(keeper);
        vm.expectRevert(EncumbranceRegistry.AlreadySettled.selector);
        registry.declareDefault(pledge);
    }

    function test_enc_unlock_invalidProof() public {
        uint256 enc = _enc(0, uint64(block.timestamp), 1); // LOCKUP already expired
        EncumbranceRegistry.Spend memory s = _spend(enc, 2);
        vm.expectRevert(EncumbranceRegistry.InvalidProof.selector); // wrong output count
        registry.unlock("", s);
        s = _spend(enc, 1);
        v.set(false);
        vm.expectRevert(EncumbranceRegistry.InvalidProof.selector);
        registry.unlock("", s);
    }

    function test_enc_enforce_unknown() public {
        EncumbranceRegistry.Spend memory s = _spend(123, 5);
        vm.expectRevert(EncumbranceRegistry.Unknown.selector);
        registry.enforce("", s);
    }

    function test_enc_enforce_twice() public {
        uint256 enc = _pledgeDefaulted();
        registry.enforce("", _spend(enc, 5));
        EncumbranceRegistry.Spend memory s = _spend(enc, 5);
        vm.expectRevert(EncumbranceRegistry.AlreadySettled.selector);
        registry.enforce("", s);
    }

    function test_enc_enforce_invalidProof() public {
        uint256 enc = _pledgeDefaulted();
        EncumbranceRegistry.Spend memory s = _spend(enc, 4);
        vm.expectRevert(EncumbranceRegistry.InvalidProof.selector); // wrong output count
        registry.enforce("", s);
        s = _spend(enc, 5);
        v.set(false);
        vm.expectRevert(EncumbranceRegistry.InvalidProof.selector);
        registry.enforce("", s);
    }

    // =============================================================== NavAttestor

    function _att(uint64 epoch) internal view returns (NavAttestor.Attestation memory a) {
        a.epoch = epoch;
        a.root = root0;
    }

    function _attest(NavAttestor.Attestation memory a, NavAttestor.Price[16] memory p) internal {
        vm.prank(manager);
        nav.attest(VAULT, a, p, "");
    }

    function test_nav_registerVault_notOwner() public {
        vm.prank(stranger);
        _notOwner(stranger);
        nav.registerVault(keccak256("x"), stranger, 1);
    }

    function test_nav_attest_unknownVault() public {
        NavAttestor.Price[16] memory p;
        NavAttestor.Attestation memory a = _att(1);
        vm.prank(manager);
        vm.expectRevert(NavAttestor.UnknownVault.selector);
        nav.attest(keccak256("nope"), a, p, "");
    }

    function test_nav_attest_wrongEpochAndTooEarly() public {
        NavAttestor.Price[16] memory p;
        vm.expectRevert(NavAttestor.WrongEpoch.selector);
        _attest(_att(2), p);
        _attest(_att(1), p);
        vm.expectRevert(NavAttestor.WrongEpoch.selector);
        _attest(_att(1), p);
        vm.expectRevert(NavAttestor.TooEarly.selector);
        _attest(_att(2), p);
    }

    function test_nav_attest_liabilityOmitted() public {
        NavAttestor.Price[16] memory p;
        NavAttestor.Attestation memory a = _att(1);
        a.queueUsdg = 1;
        vm.expectRevert(NavAttestor.LiabilityOmitted.selector);
        _attest(a, p);
    }

    function test_nav_attest_spentHolding() public {
        CordonPool.Transfer memory t = _tx(0);
        pool.transact("", t);
        NavAttestor.Price[16] memory p;
        NavAttestor.Attestation memory a = _att(1);
        a.nullifiers[3] = t.nullifiers[0];
        vm.expectRevert(abi.encodeWithSelector(NavAttestor.HoldingSpent.selector, t.nullifiers[0]));
        _attest(a, p);
    }

    function test_nav_attest_duplicateHolding() public {
        NavAttestor.Price[16] memory p;
        NavAttestor.Attestation memory a = _att(1);
        (a.nullifiers[0], a.nullifiers[5]) = (9, 9);
        vm.expectRevert(NavAttestor.DuplicateHolding.selector);
        _attest(a, p);
    }

    function test_nav_attest_duplicatePrice() public {
        NavAttestor.Price[16] memory p;
        p[0] = NavAttestor.Price(address(stock), 1);
        p[2] = p[0];
        vm.expectRevert(abi.encodeWithSelector(NavAttestor.DuplicatePrice.selector, 2));
        _attest(_att(1), p);
    }

    function test_nav_attest_unpricedAsset() public {
        NavAttestor.Price[16] memory p;
        p[0] = NavAttestor.Price(junk, 1);
        vm.expectRevert(abi.encodeWithSelector(PriceOracle.NoFeed.selector, junk));
        _attest(_att(1), p);
    }

    function test_nav_attest_invalidProof() public {
        NavAttestor.Price[16] memory p;
        NavAttestor.Attestation memory a = _att(1);
        a.root = 12345; // not a pool root
        vm.expectRevert(NavAttestor.InvalidProof.selector);
        _attest(a, p);
        v.set(false);
        vm.expectRevert(NavAttestor.InvalidProof.selector);
        _attest(_att(1), p);
    }

    // =============================================================== ActionEngine

    function test_actions_sync_unknownAsset() public {
        vm.expectRevert(abi.encodeWithSelector(ActionEngine.UnknownAsset.selector, junk));
        actions.sync(junk);
    }

    /// A broken (zero) multiplier before any checkpoint has no index to fall back on.
    function test_actions_sync_noIndex() public {
        MockStock broken = new MockStock();
        broken.setMultiplier(0);
        vm.prank(gov);
        gate.register(address(broken), AssetGate.Class.STOCK8056, 31, 7);
        vm.expectRevert(abi.encodeWithSelector(ActionEngine.NoIndex.selector, address(broken), block.timestamp));
        actions.sync(address(broken));
    }

    function test_actions_scheduleSplit_bad() public {
        uint64 now_ = uint64(block.timestamp);
        vm.startPrank(keeper);
        vm.expectRevert(ActionEngine.BadSplit.selector);
        actions.scheduleSplit(address(stock), 0, 1, now_);
        vm.expectRevert(ActionEngine.BadSplit.selector);
        actions.scheduleSplit(address(stock), 2, 0, now_);
        vm.expectRevert(ActionEngine.BadSplit.selector);
        actions.scheduleSplit(address(stock), 2, 1, now_ - 1);
        actions.scheduleSplit(address(stock), 2, 1, now_ + 1 days);
        vm.expectRevert(ActionEngine.BadSplit.selector); // never overwrites a pending split
        actions.scheduleSplit(address(stock), 3, 1, now_ + 2 days);
        vm.stopPrank();
    }

    // =============================================================== CordonControl

    function test_control_pause_notGuardian() public {
        vm.prank(stranger);
        vm.expectRevert(CordonControl.NotGuardian.selector);
        control.pause(1);
    }

    function test_control_onlyOwner() public {
        address[2] memory callers = [stranger, guardian]; // the guardian can pause, nothing else
        for (uint256 i; i < 2; ++i) {
            address c = callers[i];
            vm.startPrank(c);
            _notOwner(c);
            control.unpause(1);
            _notOwner(c);
            control.setEngine(c, true);
            _notOwner(c);
            control.setKeeper(c, true);
            _notOwner(c);
            control.setGuardian(c);
            _notOwner(c);
            control.setSequencer(c);
            _notOwner(c);
            control.setFeeRecipient(c);
            vm.stopPrank();
        }
    }

    function test_control_zeroAddress() public {
        vm.startPrank(gov);
        vm.expectRevert(CordonControl.ZeroAddress.selector);
        control.setEngine(address(0), true);
        vm.expectRevert(CordonControl.ZeroAddress.selector);
        control.setKeeper(address(0), true);
        vm.expectRevert(CordonControl.ZeroAddress.selector);
        control.setGuardian(address(0));
        vm.expectRevert(CordonControl.ZeroAddress.selector);
        control.setSequencer(address(0));
        vm.stopPrank();
        vm.expectRevert(CordonControl.ZeroAddress.selector);
        new CordonControl(gov, address(0), address(0));
    }

    // =============================================================== AssetGate

    function test_gate_register_notOwner() public {
        vm.prank(stranger);
        _notOwner(stranger);
        gate.register(junk, AssetGate.Class.STOCK8056, 31, 7);
    }

    function test_gate_register_badMaskOrDuplicate() public {
        vm.startPrank(gov);
        vm.expectRevert(AssetGate.BadMask.selector);
        gate.register(junk, AssetGate.Class.STOCK8056, 1, 7); // no INCOME
        vm.expectRevert(AssetGate.BadMask.selector);
        gate.register(junk, AssetGate.Class.STOCK8056, 63, 7);
        vm.expectRevert(AssetGate.BadMask.selector);
        gate.register(junk, AssetGate.Class.STOCK8056, 31, 8);
        vm.expectRevert(abi.encodeWithSelector(AssetGate.AlreadyRegistered.selector, address(stock)));
        gate.register(address(stock), AssetGate.Class.TREASURY, 3, 0);
        vm.stopPrank();
    }

    function test_gate_setTemplates_bad() public {
        vm.prank(stranger);
        _notOwner(stranger);
        gate.setTemplates(address(stock), 0);
        vm.startPrank(gov);
        vm.expectRevert(abi.encodeWithSelector(AssetGate.UnknownAsset.selector, junk));
        gate.setTemplates(junk, 1);
        vm.expectRevert(AssetGate.BadMask.selector);
        gate.setTemplates(address(stock), 8);
        vm.stopPrank();
    }

    function test_gate_setMode_bad() public {
        vm.prank(stranger);
        _notOwner(stranger);
        gate.setMode(address(stock), AssetGate.Mode.REDEEM_ONLY);
        vm.startPrank(gov);
        vm.expectRevert(abi.encodeWithSelector(AssetGate.UnknownAsset.selector, junk));
        gate.setMode(junk, AssetGate.Mode.ACTIVE);
        vm.expectRevert(abi.encodeWithSelector(AssetGate.UnknownAsset.selector, address(stock)));
        gate.setMode(address(stock), AssetGate.Mode.NONE);
        vm.stopPrank();
    }

    // =============================================================== PriceOracle

    function test_oracle_setFeed_bad() public {
        vm.prank(stranger);
        _notOwner(stranger);
        oracle.setFeed(address(stock), feed, 1 days);
        vm.startPrank(gov);
        vm.expectRevert(PriceOracle.BadFeed.selector);
        oracle.setFeed(address(stock), AggregatorV3Interface(address(0)), 1 days);
        vm.expectRevert(PriceOracle.BadFeed.selector);
        oracle.setFeed(address(stock), feed, 1 minutes - 1);
        vm.expectRevert(PriceOracle.BadFeed.selector);
        oracle.setFeed(address(stock), feed, 1 days + 1);
        vm.stopPrank();
    }

    // =============================================================== ScreeningGate / SolvencyVerifier

    function test_screening_flag_notKeeper() public {
        vm.prank(stranger);
        vm.expectRevert(ScreeningGate.NotScreener.selector);
        screening.flag(0);
    }

    function test_solvency_attest_unknownAsset() public {
        vm.expectRevert(abi.encodeWithSelector(SolvencyVerifier.UnknownAsset.selector, junk));
        solvency.attest(junk);
    }

    // =============================================================== CrdnStaking

    function _staked(address who, uint256 amount) internal {
        crdn.mint(who, amount);
        vm.startPrank(who);
        crdn.approve(address(staking), amount);
        staking.stake(amount);
        vm.stopPrank();
    }

    /// A zero fee recipient would make every split (and so every stake) revert.
    function test_staking_constructor_zeroAddress() public {
        vm.expectRevert(CrdnStaking.ZeroAddress.selector);
        new CrdnStaking(crdn, address(0), treasury, burnSink, pool);
        vm.expectRevert(CrdnStaking.ZeroAddress.selector);
        new CrdnStaking(crdn, workers, address(0), burnSink, pool);
        vm.expectRevert(CrdnStaking.ZeroAddress.selector);
        new CrdnStaking(crdn, workers, treasury, address(0), pool);
    }

    function test_staking_stake_noAllowance() public {
        crdn.mint(stranger, 1);
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(staking), 0, 1)
        );
        staking.stake(1);
    }

    function test_staking_unstake_moreThanStaked() public {
        _staked(alice, 10);
        vm.warp(block.timestamp + staking.MIN_STAKE_PERIOD());
        vm.prank(alice);
        vm.expectRevert(stdError.arithmeticError);
        staking.unstake(11);
    }

    function test_staking_claim_notAToken() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, junk));
        staking.claim(junk);
    }

    function test_staking_claim_secondClaimPaysNothing() public {
        _staked(alice, 10);
        stock.mint(address(staking), 1000);
        staking.distribute(address(stock));
        vm.startPrank(alice);
        staking.claim(address(stock));
        uint256 got = stock.balanceOf(alice);
        staking.claim(address(stock));
        vm.stopPrank();
        assertEq(stock.balanceOf(alice), got);
    }

    function test_staking_propose_noStake() public {
        vm.prank(stranger);
        vm.expectRevert(CrdnStaking.NoStake.selector);
        staking.propose(CrdnStaking.Subject.TEMPLATE, bytes32(0));
    }

    function test_staking_vote_bad() public {
        _staked(alice, 10);
        vm.prank(alice);
        uint256 id = staking.propose(CrdnStaking.Subject.ASSET_CLASS, bytes32(0));

        vm.prank(stranger);
        vm.expectRevert(CrdnStaking.NoStake.selector);
        staking.vote(id, true);

        vm.prank(alice);
        staking.vote(id, true);
        vm.prank(alice);
        vm.expectRevert(CrdnStaking.AlreadyVoted.selector);
        staking.vote(id, false);

        vm.prank(alice);
        vm.expectRevert(stdError.indexOOBError);
        staking.vote(id + 1, true);

        _staked(stranger, 5);
        vm.warp(block.timestamp + staking.VOTING_PERIOD());
        vm.prank(stranger);
        vm.expectRevert(CrdnStaking.VotingClosed.selector);
        staking.vote(id, true);
    }

    // =============================================================== Ownable2Step (inherited)

    function _owned() internal view returns (Ownable2Step[4] memory) {
        return [
            Ownable2Step(address(control)),
            Ownable2Step(address(gate)),
            Ownable2Step(address(oracle)),
            Ownable2Step(address(nav))
        ];
    }

    function test_ownable_transferOwnership() public {
        Ownable2Step[4] memory o = _owned();
        for (uint256 i; i < 4; ++i) {
            vm.prank(stranger);
            _notOwner(stranger);
            o[i].transferOwnership(stranger);
        }
    }

    function test_ownable_acceptOwnership() public {
        Ownable2Step[4] memory o = _owned();
        address heir = makeAddr("heir");
        for (uint256 i; i < 4; ++i) {
            vm.prank(stranger);
            _notOwner(stranger); // nothing pending
            o[i].acceptOwnership();
            vm.prank(gov);
            o[i].transferOwnership(heir);
            vm.prank(stranger);
            _notOwner(stranger); // pending for someone else
            o[i].acceptOwnership();
        }
    }

    function test_ownable_renounceOwnership() public {
        Ownable2Step[4] memory o = _owned();
        for (uint256 i; i < 4; ++i) {
            vm.prank(stranger);
            _notOwner(stranger);
            o[i].renounceOwnership();
        }
    }
}
