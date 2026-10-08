// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ActionEngine} from "../src/ActionEngine.sol";
import {AssetGate} from "../src/AssetGate.sol";
import {CordonControl} from "../src/CordonControl.sol";
import {CordonPool} from "../src/CordonPool.sol";
import {CrdnStaking} from "../src/CrdnStaking.sol";
import {PriceOracle} from "../src/PriceOracle.sol";
import {AggregatorV3Interface} from "../src/interfaces/AggregatorV3Interface.sol";

/// Chainlink-style feed with one round (id 1); round 2 does not exist, so the oracle's
/// "replaced by a later round" check reads the latest round and finds round 1.
contract HFeed {
    int256 public ans;
    uint8 public decimals;

    function set(int256 a, uint8 d) external {
        ans = a;
        decimals = d;
    }

    function getRoundData(uint80 id) external view returns (uint80, int256, uint256, uint256, uint80) {
        require(id == 1, "No data present");
        return (1, ans, block.timestamp, block.timestamp, 1);
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, ans, block.timestamp, block.timestamp, 1);
    }
}

/// One mock for every asset shape the oracle and the index read: ERC-20 decimals,
/// ERC-8056 multiplier (no pending action) and ERC-4626 assets-per-share.
contract HAsset {
    uint8 public decimals;
    uint256 public uiMultiplier;
    uint256 public perShare;
    address public asset;

    function set(uint8 d, uint256 m) external {
        decimals = d;
        uiMultiplier = m;
    }

    function setVault(address underlying, uint256 assetsPerShare) external {
        asset = underlying;
        perShare = assetsPerShare;
    }

    function newUIMultiplier() external view returns (uint256) {
        return uiMultiplier;
    }

    function effectiveAt() external pure returns (uint256) {
        return 0;
    }

    function convertToAssets(uint256) external view returns (uint256) {
        return perShare;
    }
}

contract HToken is ERC20 {
    constructor() ERC20("H", "H") {}

    function mint(address to, uint256 raw) external {
        _mint(to, raw);
    }
}

/// The only CordonPool surface CrdnStaking touches: its asset gate and (zero) pool fees.
contract HPool {
    AssetGate public immutable assetGate;

    constructor(AssetGate g) {
        assetGate = g;
    }

    function fees(address) external pure returns (uint256) {
        return 0;
    }
}

/// Halmos symbolic properties (`halmos --match-contract HalmosTest`). Every check drives the
/// real PriceOracle / ActionEngine / CrdnStaking code; the mocks only supply inputs.
/// `check_` functions are not run by `forge test`.
contract HalmosTest is Test {
    uint256 internal constant SCALE = 1e27;
    uint256 internal constant J = 1e36;
    address internal constant KEEPER = address(0xBEEF);
    address internal constant WORKERS = address(0x0505);
    address internal constant TREASURY = address(0x7EA5);
    address internal constant BURN = address(0xB042);
    address internal constant A = address(0xA11CE);
    address internal constant B = address(0xB0B);
    uint256 internal constant T0 = 1_800_000_000;

    AssetGate internal gate;
    CordonControl internal control;
    PriceOracle internal oracle;
    ActionEngine internal actions;
    CrdnStaking internal staking;
    HFeed internal feed;
    HAsset internal stock;
    HAsset internal bill;
    HAsset internal vault;
    HAsset internal underlying;
    HToken internal crdn;
    HToken internal feeToken;

    function setUp() public {
        vm.warp(T0);
        gate = new AssetGate(address(this));
        control = new CordonControl(address(this), address(this), address(0));
        control.setKeeper(KEEPER, true);
        oracle = new PriceOracle(address(this), gate);
        actions = new ActionEngine(gate, control);
        feed = new HFeed();
        stock = new HAsset();
        bill = new HAsset();
        vault = new HAsset();
        underlying = new HAsset();
        vault.setVault(address(underlying), 0);
        gate.register(address(stock), AssetGate.Class.STOCK8056, 31, 7);
        gate.register(address(bill), AssetGate.Class.TREASURY, 31, 7);
        gate.register(address(vault), AssetGate.Class.VAULT4626, 31, 7);
        AggregatorV3Interface f = AggregatorV3Interface(address(feed));
        oracle.setFeed(address(stock), f, 1 days);
        oracle.setFeed(address(bill), f, 1 days);
        oracle.setFeed(address(vault), f, 1 days);

        crdn = new HToken();
        feeToken = new HToken();
        // Its own gate: CrdnStaking sweeps every listed asset as a fee token.
        AssetGate feeGate = new AssetGate(address(this));
        feeGate.register(address(feeToken), AssetGate.Class.TREASURY, 31, 7);
        staking = new CrdnStaking(crdn, WORKERS, TREASURY, BURN, CordonPool(address(new HPool(feeGate))));
    }

    /// 6, 8 or 18: the decimals of USDC-style tokens, Chainlink USD feeds and most ERC-20s.
    function _dec(uint8 sel) internal pure returns (uint8) {
        uint8 s = sel % 3;
        return s == 0 ? 6 : s == 1 ? 8 : 18;
    }

    // ------------------------------------------------------------ oracle price scaling
    // The rounding checks run on every path where rawPrice returns; overflow freedom is
    // checked separately at the bounds (check_oracleNoOverflowAtBounds). Assertions run
    // unchecked: the bounds keep every product below 2^256 (noted per check), and a checked
    // overflow in the test itself would revert, which Halmos does not count as a failure.

    /// TREASURY: price == floor(answer * 1e27 / 10^(feedDec + tokenDec)) exactly — never above
    /// the exact value, less than one unit below it — for every 6/8/18 feed x token pair and
    /// any price up to $1e12 per token (products < 1e58).
    function check_oracleTreasuryFloorExact(uint256 answer, uint8 fs, uint8 ts) public {
        uint8 fd = _dec(fs);
        uint8 td = _dec(ts);
        vm.assume(answer != 0 && answer <= 1e12 * 10 ** fd);
        feed.set(int256(answer), fd);
        bill.set(td, 0);
        uint256 p = oracle.rawPrice(address(bill), 1);
        unchecked {
            uint256 den = 10 ** (uint256(fd) + td);
            assert(p * den <= answer * SCALE);
            assert(answer * SCALE < (p + 1) * den);
        }
    }

    /// A whole-dollar price scales with no loss for every 6/8/18 feed x token pair:
    /// usd per token -> usd * 1e27 / 10^tokenDec per raw unit, for TREASURY and an
    /// unadjusted (1x) Stock Token alike.
    function check_oracleWholePriceExact(uint40 usd, uint8 fs, uint8 ts, bool asStock) public {
        vm.assume(usd != 0);
        uint8 fd = _dec(fs);
        uint8 td = _dec(ts);
        feed.set(int256(uint256(usd) * 10 ** fd), fd);
        HAsset a = asStock ? stock : bill;
        a.set(td, 1e18);
        assert(oracle.rawPrice(address(a), 1) == uint256(usd) * 10 ** (27 - uint256(td)));
    }

    /// STOCK8056 (8-decimal Chainlink feed, 6/8/18-decimal token): price x multiplier is exactly
    /// floor(answer * 1e27 * mult / (1e8 * 1e18 * 10^td)) — never above the exact value, less
    /// than one raw unit below it (no extra loss from the two divisions) — for any answer < 2^64
    /// ($1.8e11) and multiplier < 2^80 (1.2e6x); products < 2^208. The first assert shows
    /// answer * 1e27 / 1e8 == answer * 1e19 (1e8 divides 1e27), so exactNum is the exact
    /// numerator; it keeps the contract's perToken * mult shape so the solver sees one
    /// symbolic product (written answer * 1e19 * mult, the query times out).
    function check_oracleStockRoundsDown(uint64 answer, uint80 mult, uint8 ts) public {
        uint8 td = _dec(ts);
        vm.assume(answer != 0 && mult != 0);
        feed.set(int256(uint256(answer)), 8);
        stock.set(td, mult);
        uint256 p = oracle.rawPrice(address(stock), 1);
        unchecked {
            uint256 perToken = uint256(answer) * SCALE / 1e8;
            assert(perToken == uint256(answer) * 1e19);
            uint256 u = 1e18 * 10 ** uint256(td);
            uint256 exactNum = perToken * mult;
            assert(p * u <= exactNum && exactNum < (p + 1) * u);
        }
    }

    /// VAULT4626 (8-decimal feed, 6/8/18-decimal vault and underlying): price per share is
    /// exactly floor(answer * 1e27 * perShare / (1e8 * 10^ud * 10^vd)) for any answer < 2^64
    /// and assets-per-share < 2^80 (exactNum as in check_oracleStockRoundsDown).
    function check_oracleVaultRoundsDown(uint64 answer, uint80 perShare, uint8 vs, uint8 us) public {
        uint8 vd = _dec(vs);
        uint8 ud = _dec(us);
        vm.assume(answer != 0 && perShare != 0);
        feed.set(int256(uint256(answer)), 8);
        vault.set(vd, 0);
        underlying.set(ud, 0);
        vault.setVault(address(underlying), perShare);
        uint256 p = oracle.rawPrice(address(vault), 1);
        unchecked {
            uint256 perToken = uint256(answer) * SCALE / 1e8;
            assert(perToken == uint256(answer) * 1e19);
            uint256 den = 10 ** (uint256(ud) + vd);
            uint256 exactNum = perToken * perShare;
            assert(p * den <= exactNum && exactNum < (p + 1) * den);
        }
    }

    /// No overflow inside the documented bounds: rawPrice succeeds at the largest answer
    /// ($1e12 per token at any 6/8/18-decimal feed) and multiplier / assets-per-share (2^80)
    /// for every class and decimals pair. Every step of rawPriceAt is a product or quotient
    /// of non-negative values that is monotone in these inputs, so success at the maximum
    /// covers every smaller input.
    function check_oracleNoOverflowAtBounds(uint8 fs, uint8 ts, uint8 us) public {
        uint8 fd = _dec(fs);
        uint8 td = _dec(ts);
        uint8 ud = _dec(us);
        uint256 maxMult = 2 ** 80 - 1;
        feed.set(int256(1e12 * 10 ** uint256(fd)), fd);
        bill.set(td, 0);
        stock.set(td, maxMult);
        vault.set(td, 0);
        underlying.set(ud, 0);
        vault.setVault(address(underlying), maxMult);
        try oracle.rawPrice(address(bill), 1) returns (uint256) {} catch { assert(false); }
        try oracle.rawPrice(address(stock), 1) returns (uint256) {} catch { assert(false); }
        try oracle.rawPrice(address(vault), 1) returns (uint256) {} catch { assert(false); }
    }

    // ------------------------------------------------------------ income index

    /// Multipliers from 1e-6x to 1e12x (1e18 = 1x).
    function _boundMult(uint256 m) internal pure {
        vm.assume(m >= 1e12 && m <= 1e30);
    }

    /// The index starts at exactly 1e36, never rises, and never falls more than MAX_STEP_BPS
    /// (5%) in one unconfirmed sync, over any two multiplier moves.
    function check_indexMonotonic(uint256 m0, uint256 m1, uint256 m2) public {
        _boundMult(m0);
        _boundMult(m1);
        _boundMult(m2);
        stock.set(18, m0);
        (, uint256 j0) = actions.sync(address(stock));
        assert(j0 == J);

        vm.warp(T0 + 60);
        stock.set(18, m1);
        (, uint256 j1) = actions.sync(address(stock));
        vm.warp(T0 + 120);
        stock.set(18, m2);
        (, uint256 j2) = actions.sync(address(stock));

        assert(j1 <= j0 && j2 <= j1);
        assert(j1 >= j0 * 9_500 / 10_000 && j2 >= j1 * 9_500 / 10_000);
    }

    /// A booked index step is exactly floor(1e36 * m0 / m1): never above the exact value
    /// (INCOME, paid as raw * (j_start - j_end) / j_b, is never overpaid by rounding) and
    /// less than one index unit below it. The first sync's j0 == 1e36 is asserted first as a
    /// lemma (proved on its own, then on the path); without it the floor query times out.
    function check_indexFloor(uint256 m0, uint256 m1) public {
        _boundMult(m0);
        _boundMult(m1);
        stock.set(18, m0);
        (, uint256 j0) = actions.sync(address(stock));
        assert(j0 == J);
        vm.warp(T0 + 60);
        stock.set(18, m1);
        (, uint256 j1) = actions.sync(address(stock));
        if (j1 < J) {
            unchecked {
                assert(j1 * m1 <= J * m0 && J * m0 < (j1 + 1) * m1); // < 1e67
            }
        }
    }

    /// A scheduled num:den split never books income, whatever the rounding of the new
    /// multiplier: the split-adjusted multiplier never exceeds the old one. (j0 == 1e36 is
    /// asserted first as a lemma, as in check_indexFloor; without it the query times out.)
    function check_splitBooksNoIncome(uint256 m0, uint64 num, uint64 den) public {
        _boundMult(m0);
        vm.assume(num != 0 && den != 0 && num <= 1000 && den <= 1000);
        stock.set(18, m0);
        (, uint256 j0) = actions.sync(address(stock));
        assert(j0 == J);
        vm.prank(KEEPER);
        actions.scheduleSplit(address(stock), num, den, uint64(T0 + 60));
        vm.warp(T0 + 60);
        uint256 m1;
        unchecked {
            m1 = m0 * num / den; // < 1e33
        }
        vm.assume(m1 != 0);
        stock.set(18, m1);
        (, uint256 j) = actions.sync(address(stock));
        assert(j == J);
    }

    // ------------------------------------------------------------ fee split and per-share accrual

    function _stake(address who, uint256 amount) internal {
        crdn.mint(who, amount);
        vm.startPrank(who);
        crdn.approve(address(staking), amount);
        staking.stake(amount);
        vm.stopPrank();
    }

    /// part == floor(f * bps / 1e4), stated without division.
    function _isFloor(uint256 part, uint256 f, uint256 bps) internal pure returns (bool) {
        return part * 10_000 <= f * bps && f * bps < (part + 1) * 10_000;
    }

    /// 80/10/5/5 fee split: treasury, stakers and burn sink each get exactly floor(fresh * bps
    /// / 1e4), workers get the rest, and the four parts sum to `fresh`: nothing is created or
    /// lost. (Workers >= 80% follows from the three floors; asserting it directly times out.)
    function check_feeSplitFloor(uint96 stake, uint96 fresh) public {
        vm.assume(stake != 0 && fresh != 0);
        _stake(A, stake);
        feeToken.mint(address(staking), fresh);
        staking.distribute(address(feeToken));
        uint256 f = fresh;
        uint256 toWorkers = feeToken.balanceOf(WORKERS);
        uint256 toTreasury = feeToken.balanceOf(TREASURY);
        uint256 toStakers = staking.booked(address(feeToken));
        uint256 toBurn = feeToken.balanceOf(BURN);
        assert(toWorkers + toTreasury + toStakers + toBurn == f);
        assert(_isFloor(toTreasury, f, 1_000));
        assert(_isFloor(toStakers, f, 500));
        assert(_isFloor(toBurn, f, 500));
    }

    /// Per-share accrual never over-pays: two stakers' claimable amounts sum to at most
    /// the stakers' share (dust under 3 units stays booked), and both claims succeed.
    function check_accrualNeverOverpays(uint96 a, uint96 b, uint96 fresh) public {
        vm.assume(a != 0 && b != 0 && fresh != 0);
        _stake(A, a);
        _stake(B, b);
        feeToken.mint(address(staking), fresh);
        staking.distribute(address(feeToken));
        uint256 booked = staking.booked(address(feeToken));
        uint256 ca = staking.claimable(A, address(feeToken));
        uint256 cb = staking.claimable(B, address(feeToken));
        assert(ca + cb <= booked);
        assert(booked - (ca + cb) < 3);
        vm.prank(A);
        staking.claim(address(feeToken));
        vm.prank(B);
        staking.claim(address(feeToken));
        assert(feeToken.balanceOf(A) == ca && feeToken.balanceOf(B) == cb);
    }

    /// A staker who joins after a distribution gets none of it, and the joiner does not
    /// dilute what earlier stakers already accrued (stake sweeps and settles first).
    function check_lateStakerNoDilution(uint96 a, uint96 b, uint96 f1) public {
        vm.assume(a != 0 && b != 0 && f1 != 0);
        _stake(A, a);
        feeToken.mint(address(staking), f1);
        staking.distribute(address(feeToken));
        uint256 c1 = staking.claimable(A, address(feeToken));
        _stake(B, b);
        assert(staking.claimable(B, address(feeToken)) == 0);
        assert(staking.claimable(A, address(feeToken)) == c1);
    }

    /// Claims only grow as the per-share index accrues, and one distribution's growth never
    /// exceeds the stakers' share of it.
    function check_accrualMonotonic(uint96 a, uint96 f1, uint96 f2) public {
        vm.assume(a != 0 && f1 != 0);
        _stake(A, a);
        feeToken.mint(address(staking), f1);
        staking.distribute(address(feeToken));
        uint256 c1 = staking.claimable(A, address(feeToken));
        uint256 booked1 = staking.booked(address(feeToken));
        feeToken.mint(address(staking), f2);
        staking.distribute(address(feeToken));
        uint256 c2 = staking.claimable(A, address(feeToken));
        assert(c2 >= c1);
        assert(c2 - c1 <= staking.booked(address(feeToken)) - booked1);
    }
}
