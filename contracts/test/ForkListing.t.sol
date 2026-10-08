// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {AssetGate} from "../src/AssetGate.sol";
import {PerShareFeed} from "../src/PerShareFeed.sol";
import {PriceOracle} from "../src/PriceOracle.sol";
import {IERC8056} from "../src/interfaces/IERC8056.sol";
import {AggregatorV3Interface} from "../src/interfaces/AggregatorV3Interface.sol";
import {ListAssets} from "../script/ListAssets.s.sol";
import {MainnetAssets} from "../script/MainnetAssets.sol";

/// The mainnet listing against the REAL 4663 deployment, tokens and Chainlink feeds: the
/// batch goes Safe -> timelock -> AssetGate/PriceOracle exactly as the Safe proposal will,
/// and every asset prices one raw unit at its feed's per-token answer. Skipped offline;
/// run with FORK_RPC_URL=https://rpc.mainnet.chain.robinhood.com/rpc (see Fork.t.sol).
contract ForkListingTest is Test {
    AssetGate internal gate;
    PriceOracle internal oracle;
    TimelockController internal timelock;
    address internal safe;
    MainnetAssets.Asset[] internal stocks;
    address[] internal adapters;

    function setUp() public {
        if (block.chainid != 4663) {
            string memory url = vm.envOr("FORK_RPC_URL", string(""));
            if (bytes(url).length == 0) {
                vm.skip(true);
                return;
            }
            vm.createSelectFork(url);
        }
        string memory d = vm.readFile("../packages/shared/deployments/4663.json");
        gate = AssetGate(vm.parseJsonAddress(d, ".assetGate"));
        oracle = PriceOracle(vm.parseJsonAddress(d, ".priceOracle"));
        timelock = TimelockController(payable(vm.parseJsonAddress(d, ".timelock")));
        safe = vm.parseJsonAddress(d, ".safe");
        MainnetAssets.Asset[] memory s = MainnetAssets.stocks();
        for (uint256 i; i < s.length; ++i) {
            stocks.push(s[i]);
            adapters.push(address(new PerShareFeed(AggregatorV3Interface(s[i].feed), IERC8056(s[i].token))));
        }
    }

    function test_fork_tokensAndFeedsMatchTheListing() public view {
        for (uint256 i; i < stocks.length; ++i) {
            assertEq(IERC20Metadata(stocks[i].token).symbol(), stocks[i].symbol);
            assertEq(IERC20Metadata(stocks[i].token).decimals(), 18);
            assertGt(IERC8056(stocks[i].token).uiMultiplier(), 0);
            assertEq(AggregatorV3Interface(stocks[i].feed).decimals(), 8);
        }
        assertEq(IERC20Metadata(MainnetAssets.USDG).symbol(), "USDG");
        assertEq(IERC20Metadata(MainnetAssets.USDG).decimals(), 6);
        assertEq(AggregatorV3Interface(MainnetAssets.USDG_USD).decimals(), 8);
    }

    function test_fork_batchListsThroughSafeAndTimelock() public {
        (address[] memory targets, bytes[] memory calls) = new ListAssets().batch(gate, oracle, adapters);
        uint256[] memory values = new uint256[](targets.length);
        bytes32 salt = keccak256("cordon.listing.v1");
        uint256 delay = timelock.getMinDelay();
        vm.prank(safe);
        timelock.scheduleBatch(targets, values, calls, bytes32(0), salt, delay);
        vm.expectRevert(); // not before the 24 h delay
        vm.prank(safe);
        timelock.executeBatch(targets, values, calls, bytes32(0), salt);
        vm.warp(block.timestamp + delay);
        vm.prank(safe);
        timelock.executeBatch(targets, values, calls, bytes32(0), salt);

        for (uint256 i; i < stocks.length; ++i) {
            assertEq(uint8(gate.classOf(stocks[i].token)), uint8(AssetGate.Class.STOCK8056));
            (AggregatorV3Interface f, uint32 hb) = oracle.feeds(stocks[i].token);
            assertEq(address(f), adapters[i]);
            assertEq(hb, 1 days);
        }
        assertEq(uint8(gate.classOf(MainnetAssets.USDG)), uint8(AssetGate.Class.TREASURY));
        (AggregatorV3Interface usdFeed,) = oracle.feeds(MainnetAssets.USDG);
        assertEq(address(usdFeed), MainnetAssets.USDG_USD);
    }

    /// One raw unit is worth the feed's answer per token (1e27 = 1 USD): x10 for an 8-decimal
    /// answer on an 18-decimal Stock Token, x1e13 for USDG's 6 decimals. Each asset is priced
    /// inside its latest round's heartbeat (24/5 feeds hold over market closes).
    function test_fork_everyAssetPricesAtTheFeedAnswer() public {
        (address[] memory targets, bytes[] memory calls) = new ListAssets().batch(gate, oracle, adapters);
        vm.startPrank(address(timelock));
        for (uint256 i; i < targets.length; ++i) {
            (bool ok, bytes memory err) = targets[i].call(calls[i]);
            assertTrue(ok, string(err));
        }
        vm.stopPrank();

        uint256 t0 = block.timestamp;
        for (uint256 i; i < stocks.length; ++i) {
            (uint80 id, int256 answer,, uint256 updatedAt,) = AggregatorV3Interface(stocks[i].feed).latestRoundData();
            vm.warp(updatedAt + 1 minutes > t0 ? t0 : updatedAt + 1 minutes);
            // The adapter's floor costs at most one multiplier unit: a few wei at 1e27 scale.
            assertApproxEqAbs(oracle.rawPrice(stocks[i].token, id), uint256(answer) * 10, 100, stocks[i].symbol);
        }
        (uint80 uid, int256 usd,, uint256 uat,) = AggregatorV3Interface(MainnetAssets.USDG_USD).latestRoundData();
        vm.warp(uat + 1 minutes > t0 ? t0 : uat + 1 minutes);
        assertEq(oracle.rawPrice(MainnetAssets.USDG, uid), uint256(usd) * 1e13);
    }
}
