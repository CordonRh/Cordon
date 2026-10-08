// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AssetGate} from "../src/AssetGate.sol";
import {NavAttestor} from "../src/NavAttestor.sol";
import {PriceOracle} from "../src/PriceOracle.sol";
import {CordonTest} from "./Base.t.sol";
import {MockFeed, MockUsd} from "./DvPSettler.t.sol";

contract NavAttestorTest is CordonTest {
    bytes32 internal constant VAULT = keccak256("cordon-vault-1");
    address internal manager = makeAddr("manager");

    // $1,500 of holdings - $100 queue owed, over 1,000 shares = $1.40 per share.
    uint256 internal constant SHARES = 1000e18;
    uint256 internal constant LIAB = 100e27;
    uint256 internal constant NAV = 1.4e18;

    PriceOracle internal oracle;
    NavAttestor internal nav;
    MockFeed internal stockFeed;
    MockFeed internal usdFeed;
    MockUsd internal usdg;

    function setUp() public override {
        super.setUp();
        oracle = new PriceOracle(gov, gate);
        nav = new NavAttestor(gov, pool, oracle, _verifier("Nav"));
        stockFeed = new MockFeed();
        usdFeed = new MockFeed();
        usdg = new MockUsd();
        usdg.mint(alice, 1e24);
        (uint8 all, uint8 templates) = (gate.ALL_CLAIMS(), gate.ALL_TEMPLATES());
        vm.startPrank(gov);
        gate.register(address(usdg), AssetGate.Class.TREASURY, all, templates);
        oracle.setFeed(address(stock), stockFeed, 1 days);
        oracle.setFeed(address(usdg), usdFeed, 1 days);
        nav.registerVault(VAULT, manager, ownerPk); // the test key doubles as the vault key
        vm.stopPrank();
    }

    function _prices() internal view returns (NavAttestor.Price[16] memory p) {
        p[0] = NavAttestor.Price(address(stock), 1);
        p[1] = NavAttestor.Price(address(usdg), 1);
    }

    /// 10 shares of stock at $100 + 500 USDG.
    function _holdings() internal returns (Note[2] memory h) {
        h[0] = _depositNote(10e18, 1);
        h[1] = _depositFor(address(usdg), 500e6, 2, ownerPk);
        stockFeed.set(100e8);
        usdFeed.set(1e8);
    }

    function _holdingToml(Note memory n, uint256 priceIdx) internal view returns (string memory t) {
        uint256 i = _indexOf(n);
        t = string.concat("{ active = true, note = ", _noteToml(n), ", index = ", _s(i));
        t = string.concat(t, ", path = ", _pathToml(_path(i)), ", price_idx = ", _s(priceIdx), " }");
    }

    function _zeros(uint256 n) internal pure returns (string memory t) {
        for (uint256 i; i < n; ++i) {
            t = string.concat(t, ", \"0\"");
        }
    }

    function _navToml(Note[2] memory h, uint256 navPs, uint256 liab, uint256 stockPrice)
        internal
        view
        returns (string memory t)
    {
        t = string.concat(_kv("root", pool.currentRoot()), _kv("vault_pk", ownerPk), _kv("epoch", 1));
        t = string.concat(t, _kv("nav_per_share", navPs), _kv("total_shares", SHARES), _kv("liabilities", liab));
        t = string.concat(t, "price_asset = [", _s(uint160(address(stock))), ", ", _s(uint160(address(usdg))));
        t = string.concat(t, _zeros(14), "]\nprice = [", _s(stockPrice));
        t = string.concat(t, ", ", _s(oracle.rawPrice(address(usdg), 1)), _zeros(14), "]\n");
        t = string.concat(t, _kv("sk", sk), "holdings = [", _holdingToml(h[0], 0));
        t = string.concat(t, ", ", _holdingToml(h[1], 1));
        Note memory empty;
        uint256[DEPTH] memory noPath;
        string memory off = string.concat("{ active = false, note = ", _noteToml(empty), ", index = \"0\", path = ");
        off = string.concat(off, _pathToml(noPath), ", price_idx = \"0\" }");
        for (uint256 i = 2; i < 16; ++i) {
            t = string.concat(t, ", ", off);
        }
        t = string.concat(t, "]\n");
    }

    function _attestation(bytes32[] memory pub, uint256 navPs, uint256 liab)
        internal
        pure
        returns (NavAttestor.Attestation memory a)
    {
        a.epoch = 1;
        a.navPerShare18 = navPs;
        a.totalShares = SHARES;
        a.liabilities = liab;
        a.queueUsdg = 100e6;
        a.root = uint256(pub[0]);
        a.holdingsRoot = uint256(pub[38]);
        for (uint256 i; i < 16; ++i) {
            a.nullifiers[i] = uint256(pub[39 + i]);
        }
    }

    function test_attestNav() public {
        Note[2] memory h = _holdings();
        uint256 p = oracle.rawPrice(address(stock), 1);
        (bytes memory proof, bytes32[] memory pub) = _prove("nav", _navToml(h, NAV, LIAB, p));
        vm.prank(manager);
        nav.attest(VAULT, _attestation(pub, NAV, LIAB), _prices(), proof);

        (,, uint64 epoch,, uint256 navPs, uint256 shares,,) = nav.vaults(VAULT);
        assertEq(epoch, 1);
        assertEq(navPs, NAV);
        assertEq(shares, SHARES);
        (uint256 q,) = nav.redeemQueue(VAULT);
        assertEq(q, 100e6, "queue depth is public");
    }

    function test_wrongNavCannotProve() public {
        Note[2] memory h = _holdings();
        uint256 p = oracle.rawPrice(address(stock), 1);
        (int256 code,) = _tryProve("nav", _navToml(h, 1.5e18, LIAB, p));
        assertTrue(code != 0, "ignoring liabilities overstates NAV");
    }

    function test_mispricedHoldingRejected() public {
        Note[2] memory h = _holdings();
        uint256 marked = oracle.rawPrice(address(stock), 1) * 2; // manager marks the stock at $200
        (bytes memory proof, bytes32[] memory pub) = _prove("nav", _navToml(h, 2.4e18, LIAB, marked));
        NavAttestor.Attestation memory a = _attestation(pub, 2.4e18, LIAB);
        NavAttestor.Price[16] memory prices = _prices();
        vm.prank(manager);
        vm.expectRevert(); // the verifier itself rejects the proof (SumcheckFailed)
        nav.attest(VAULT, a, prices, proof);
    }

    function test_omittedLiabilityRejected() public {
        Note[2] memory h = _holdings();
        uint256 p = oracle.rawPrice(address(stock), 1);
        (bytes memory proof, bytes32[] memory pub) = _prove("nav", _navToml(h, 1.5e18, 0, p));
        NavAttestor.Attestation memory a = _attestation(pub, 1.5e18, 0);
        NavAttestor.Price[16] memory prices = _prices();
        vm.prank(manager);
        vm.expectRevert(NavAttestor.LiabilityOmitted.selector);
        nav.attest(VAULT, a, prices, proof);
    }

    function test_onlyManagerAndFreshOracle() public {
        Note[2] memory h = _holdings();
        uint256 p = oracle.rawPrice(address(stock), 1);
        (bytes memory proof, bytes32[] memory pub) = _prove("nav", _navToml(h, NAV, LIAB, p));
        NavAttestor.Attestation memory a = _attestation(pub, NAV, LIAB);
        NavAttestor.Price[16] memory prices = _prices();

        vm.expectRevert(NavAttestor.NotManager.selector);
        nav.attest(VAULT, a, prices, proof);

        vm.warp(block.timestamp + 2 days);
        vm.prank(manager);
        vm.expectRevert(abi.encodeWithSelector(PriceOracle.StaleOracle.selector, address(stock), 1));
        nav.attest(VAULT, a, prices, proof);
    }
}
