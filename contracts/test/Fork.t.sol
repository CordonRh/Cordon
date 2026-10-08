// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IPoseidon2} from "poseidon2-evm/IPoseidon2.sol";
import {Poseidon2Yul_BN254} from "poseidon2-evm/bn254/yul/Poseidon2Yul.sol";
import {ActionEngine} from "../src/ActionEngine.sol";
import {AssetGate} from "../src/AssetGate.sol";
import {CordonControl} from "../src/CordonControl.sol";
import {CordonPool} from "../src/CordonPool.sol";
import {PerShareFeed} from "../src/PerShareFeed.sol";
import {PriceOracle} from "../src/PriceOracle.sol";
import {ScreeningGate} from "../src/ScreeningGate.sol";
import {SolvencyVerifier} from "../src/SolvencyVerifier.sol";
import {IERC8056} from "../src/interfaces/IERC8056.sol";
import {IProofVerifier} from "../src/interfaces/IProofVerifier.sol";
import {AggregatorV3Interface} from "../src/interfaces/AggregatorV3Interface.sol";
import {MockVerifier} from "./Invariants.t.sol";

/// The Robinhood Stock Token surface Cordon depends on, beyond ERC-20 and ERC-8056
/// (verified source of the `Stock` implementation behind the beacon proxy).
interface IRobinhoodStock {
    function ACCESS_CONTROLLED_REGISTRY() external view returns (address);
    function paused() external view returns (bool);
    function updateMultiplier(uint256 newMultiplier, uint256 effectiveAt_) external;
}

interface IStockRegistry {
    function isBlocked(address account) external view returns (bool);
    function paused() external view returns (bool);
}

interface IFeedProxy {
    function description() external view returns (string memory);
}

/// Fork tests against REAL dependencies on Robinhood Chain mainnet (4663): Robinhood's
/// TSLA Stock Token (ERC-20 + ERC-8056 scaled UI, issuer blocklist and pause) and the
/// Chainlink "Robinhood TSLA / USD" data feed. Cordon is deployed fresh on the fork; only
/// the proof verifier is stubbed (the token/feed integration is under test, not the circuits).
///
/// Offline `forge test` skips this suite. Run it with either
///   FORK_RPC_URL=https://rpc.mainnet.chain.robinhood.com/rpc forge test --match-path test/Fork.t.sol
///   forge test --match-path test/Fork.t.sol --fork-url https://rpc.mainnet.chain.robinhood.com/rpc
/// FORK_BLOCK pins the block, which needs an archive RPC: the public endpoint only serves
/// recent state, so without FORK_BLOCK the suite runs at the latest block and asserts
/// relations (price per token = answer, staleness windows) rather than fixed values.
contract ForkTest is Test {
    uint256 internal constant ROBINHOOD = 4663;
    address internal constant TSLA = 0x322F0929c4625eD5bAd873c95208D54E1c003b2d;
    address internal constant TSLA_USD = 0x4A1166a659A55625345e9515b32adECea5547C38;
    bytes32 internal constant MULTIPLIER_UPDATER_ROLE = keccak256("MULTIPLIER_UPDATER_ROLE");

    address internal gov = makeAddr("timelock");
    address internal keeper = makeAddr("keeper");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    AggregatorV3Interface internal feed = AggregatorV3Interface(TSLA_USD);
    IERC20 internal tsla = IERC20(TSLA);
    address internal registry;

    CordonControl internal control;
    AssetGate internal gate;
    CordonPool internal pool;
    ActionEngine internal actions;
    PriceOracle internal oracle;
    SolvencyVerifier internal solvency;
    uint256 internal salt;

    function setUp() public {
        if (block.chainid != ROBINHOOD) {
            string memory url = vm.envOr("FORK_RPC_URL", string(""));
            if (bytes(url).length == 0) {
                vm.skip(true);
                return;
            }
            uint256 blk = vm.envOr("FORK_BLOCK", uint256(0));
            if (blk == 0) vm.createSelectFork(url);
            else vm.createSelectFork(url, blk);
        }
        assertEq(block.chainid, ROBINHOOD, "fork is Robinhood Chain mainnet");
        registry = IRobinhoodStock(TSLA).ACCESS_CONTROLLED_REGISTRY();

        control = new CordonControl(gov, makeAddr("guardian"), makeAddr("feeSink"));
        gate = new AssetGate(gov);
        ScreeningGate screening = new ScreeningGate(control);
        IPoseidon2 hasher = IPoseidon2(address(new Poseidon2Yul_BN254()));
        pool = new CordonPool(hasher, gate, control, screening, IProofVerifier(address(new MockVerifier())));
        actions = new ActionEngine(gate, control);
        oracle = new PriceOracle(gov, gate);
        solvency = new SolvencyVerifier(pool);

        // The normal listing path: the timelock registers the asset and its feed.
        vm.startPrank(gov);
        control.setKeeper(keeper, true);
        gate.register(TSLA, AssetGate.Class.STOCK8056, gate.ALL_CLAIMS(), gate.ALL_TEMPLATES());
        // Chainlink lists this feed with a 86400 s heartbeat; its answer already includes the
        // multiplier, so the oracle reads it through PerShareFeed.
        oracle.setFeed(TSLA, new PerShareFeed(feed, IERC8056(TSLA)), 1 days);
        vm.stopPrank();

        deal(TSLA, alice, 100e18);
        vm.prank(alice);
        tsla.approve(address(pool), type(uint256).max);
    }

    // ------------------------------------------------------------ real dependencies

    function test_fork_realTokenAndFeedShape() public view {
        assertEq(IERC20Metadata(TSLA).symbol(), "TSLA");
        assertEq(IERC20Metadata(TSLA).decimals(), 18);
        assertFalse(IRobinhoodStock(TSLA).paused(), "token live at the fork block");
        assertGt(tsla.totalSupply(), 0);
        // ERC-8056 surface the protocol reads.
        IERC8056 s = IERC8056(TSLA);
        assertGt(s.uiMultiplier(), 0);
        assertGt(s.newUIMultiplier(), 0);
        s.effectiveAt();

        assertEq(feed.decimals(), 8);
        assertEq(IFeedProxy(TSLA_USD).description(), "RHTSLA / USD");
        (uint80 id, int256 answer,, uint256 updatedAt, uint80 answeredIn) = feed.latestRoundData();
        assertGt(answer, 0);
        assertGt(updatedAt, 0);
        assertLe(updatedAt, block.timestamp);
        assertEq(answeredIn, id);
        assertGt(id >> 64, 0, "Chainlink phase id in the top bits of the round id");
    }

    // ------------------------------------------------------------ oracle

    function _latest() internal view returns (uint80 id, int256 answer, uint256 updatedAt) {
        (id, answer,, updatedAt,) = feed.latestRoundData();
    }

    /// Price per raw unit (1e27 = 1 USD) from the real 8-decimal answer and the real 18-decimal
    /// token: the answer is already per token (multiplier included), so the price is the answer
    /// itself, up to the adapter's rounding. The fork may land on a market close (24/5 feed), so
    /// the clock is set inside the round's heartbeat first.
    function test_fork_oraclePricesRealRound() public {
        (uint80 id, int256 answer, uint256 updatedAt) = _latest();
        vm.warp(updatedAt + 1 minutes);
        assertApproxEqAbs(oracle.rawPrice(TSLA, id), uint256(answer) * 10, 100);
        assertTrue(oracle.ok(TSLA, id));
    }

    function test_fork_oracleFailsClosedOnRealFeed() public {
        (uint80 id,, uint256 updatedAt) = _latest();
        vm.warp(updatedAt + 1 minutes);
        // A round published after the reference time cannot price it.
        vm.expectRevert(abi.encodeWithSelector(PriceOracle.StaleOracle.selector, TSLA, id));
        oracle.rawPriceAt(TSLA, id, updatedAt - 1);
        // The previous round is replaced by the latest one, so it is never picked "now".
        vm.expectRevert(abi.encodeWithSelector(PriceOracle.StaleOracle.selector, TSLA, id - 1));
        oracle.rawPrice(TSLA, id - 1);
        // Past the heartbeat the latest round is stale.
        vm.warp(updatedAt + 1 days + 1);
        vm.expectRevert(abi.encodeWithSelector(PriceOracle.StaleOracle.selector, TSLA, id));
        oracle.rawPrice(TSLA, id);
        assertFalse(oracle.ok(TSLA, id));
    }

    // ------------------------------------------------------------ shield / unshield

    function _deposit(uint256 raw) internal returns (uint256 id) {
        vm.prank(alice);
        id = pool.deposit(TSLA, raw, _fresh());
    }

    function _clear(uint256 id) internal {
        vm.warp(block.timestamp + pool.STANDBY());
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        pool.clear(ids);
    }

    function _tx(uint256 raw, address to) internal returns (CordonPool.Transfer memory) {
        uint256[2] memory nf = [_fresh(), _fresh()];
        uint256[2] memory none;
        return CordonPool.Transfer(pool.currentRoot(), block.timestamp, TSLA, raw, to, nf, none);
    }

    /// Mock-verified withdrawal of `raw` to `to` (proof bytes are ignored by the stub).
    function _withdraw(uint256 raw, address to) internal {
        pool.transact("", _tx(raw, to));
    }

    function _fresh() internal returns (uint256) {
        return uint256(keccak256(abi.encode(++salt))) % 2 ** 250;
    }

    function test_fork_depositAndWithdrawRealToken() public {
        uint256 id = _deposit(10e18);
        assertEq(tsla.balanceOf(address(pool)), 10e18);
        assertEq(tsla.balanceOf(alice), 90e18);
        assertEq(pool.owed(TSLA), 10e18);
        _clear(id);
        assertEq(pool.nextLeaf(), 1);
        solvency.attest(TSLA);

        _withdraw(4e18, bob);
        assertEq(tsla.balanceOf(bob), 4e18);
        assertEq(tsla.balanceOf(address(pool)), 6e18);
        assertEq(pool.owed(TSLA), 6e18);
    }

    function test_fork_unshieldToOriginRealToken() public {
        uint256 id = _deposit(3e18);
        vm.prank(alice);
        pool.unshieldToOrigin(id);
        assertEq(tsla.balanceOf(alice), 100e18);
        assertEq(pool.owed(TSLA), 0);
    }

    // ------------------------------------------------------------ issuer controls
    // Robinhood's token checks its AccessControlsRegistry on every transfer. The registry
    // answer is mocked; the token's own transfer code is the real deployed one.

    function _block(address who) internal {
        vm.mockCall(registry, abi.encodeCall(IStockRegistry.isBlocked, (who)), abi.encode(true));
    }

    /// If Robinhood blocks the pool, nothing moves: deposits AND exits revert. This is an
    /// issuer-level risk Cordon cannot design around; the tokens stay in the pool, solvent.
    function test_fork_issuerBlocksPool_freezesDepositsAndExits() public {
        uint256 pending = _deposit(2e18);
        uint256 id = _deposit(5e18);
        _clear(id);
        _block(address(pool));

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("Blocked(address)", address(pool)));
        pool.deposit(TSLA, 1e18, _fresh());
        CordonPool.Transfer memory t = _tx(1e18, bob);
        vm.expectRevert(abi.encodeWithSignature("Blocked(address)", address(pool)));
        pool.transact("", t);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("Blocked(address)", address(pool)));
        pool.unshieldToOrigin(pending);

        vm.warp(block.timestamp + solvency.EPOCH());
        solvency.attest(TSLA);
        assertEq(pool.owed(TSLA), 7e18);
    }

    /// A blocked recipient only fails its own withdrawal; the note stays unspent and can
    /// exit to another address (the recipient is bound in the proof, so it is re-proved).
    function test_fork_blockedRecipient_otherRecipientStillExits() public {
        _clear(_deposit(5e18));
        address sanctioned = makeAddr("sanctioned");
        _block(sanctioned);
        CordonPool.Transfer memory t = _tx(5e18, sanctioned);
        vm.expectRevert(abi.encodeWithSignature("Blocked(address)", sanctioned));
        pool.transact("", t);
        _withdraw(5e18, bob);
        assertEq(tsla.balanceOf(bob), 5e18);
    }

    /// A global registry pause stops every transfer, so deposits and exits wait it out.
    function test_fork_issuerPause_haltsTransfers() public {
        _clear(_deposit(5e18));
        vm.mockCall(registry, abi.encodeCall(IStockRegistry.paused, ()), abi.encode(true));
        assertTrue(IRobinhoodStock(TSLA).paused());
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("IsPaused()"));
        pool.deposit(TSLA, 1e18, _fresh());
        CordonPool.Transfer memory t = _tx(1e18, bob);
        vm.expectRevert(abi.encodeWithSignature("IsPaused()"));
        pool.transact("", t);

        vm.clearMockedCalls();
        _withdraw(1e18, bob);
        assertEq(tsla.balanceOf(bob), 1e18);
    }

    // ------------------------------------------------------------ ERC-8056 multiplier
    // The multiplier is set through the token's real `updateMultiplier`; only the role
    // check in the registry is mocked to admit our updater.

    function _scheduleMultiplier(uint256 m, uint256 at) internal {
        address updater = makeAddr("multiplierUpdater");
        vm.mockCall(
            registry, abi.encodeCall(IAccessControl.hasRole, (MULTIPLIER_UPDATER_ROLE, updater)), abi.encode(true)
        );
        vm.prank(updater);
        IRobinhoodStock(TSLA).updateMultiplier(m, at);
    }

    /// A scheduled 1% reinvested dividend: priced at the old multiplier until it takes effect,
    /// booked into the income index after, and a round older than the action is refused.
    function test_fork_scheduledDividend_indexAndOracle() public {
        (uint80 id, int256 answer, uint256 updatedAt) = _latest();
        vm.warp(updatedAt + 1 minutes);
        uint256 m0 = IERC8056(TSLA).uiMultiplier();
        (, uint256 j0) = actions.sync(TSLA);
        assertEq(j0, 1e36);

        uint256 m1 = m0 * 101 / 100;
        uint256 at = block.timestamp + 1 hours;
        _scheduleMultiplier(m1, at);
        assertEq(IERC8056(TSLA).newUIMultiplier(), m1);
        assertEq(IERC8056(TSLA).effectiveAt(), at);
        assertEq(actions.multiplier(TSLA), m0, "not yet effective");
        assertApproxEqAbs(oracle.rawPrice(TSLA, id), uint256(answer) * 10, 100);

        vm.warp(at);
        assertEq(IERC8056(TSLA).uiMultiplier(), m1, "token switches at effectiveAt");
        assertEq(actions.multiplier(TSLA), m1);
        (, uint256 j1) = actions.sync(TSLA);
        assertEq(j1, 1e36 * m0 / m1);
        // The latest round predates the action: never paired with the new multiplier.
        vm.expectRevert(abi.encodeWithSelector(PriceOracle.StaleOracle.selector, TSLA, id));
        oracle.rawPrice(TSLA, id);
    }

    /// A 2:1 split nobody scheduled is held, not booked as income, until the keeper says so.
    function test_fork_unscheduledSplit_isHeld() public {
        actions.sync(TSLA);
        uint256 m0 = IERC8056(TSLA).uiMultiplier();
        _scheduleMultiplier(m0 * 2, block.timestamp);
        (, uint256 j) = actions.sync(TSLA);
        assertEq(j, 1e36, "held");

        vm.prank(keeper);
        actions.scheduleSplit(TSLA, 2, 1, uint64(block.timestamp));
        vm.warp(block.timestamp + 1);
        (, j) = actions.sync(TSLA);
        assertEq(j, 1e36, "split, not income");
    }
}
