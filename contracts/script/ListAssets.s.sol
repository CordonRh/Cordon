// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {AssetGate} from "../src/AssetGate.sol";
import {PerShareFeed} from "../src/PerShareFeed.sol";
import {PriceOracle} from "../src/PriceOracle.sol";
import {IERC8056} from "../src/interfaces/IERC8056.sol";
import {AggregatorV3Interface} from "../src/interfaces/AggregatorV3Interface.sol";
import {MainnetAssets} from "./MainnetAssets.sol";

/// Lists the MainnetAssets on the 4663 deployment. Broadcasts only the PerShareFeed adapters
/// (one per Stock Token; USDG is priced by its feed directly), then writes the timelock batch
/// (AssetGate.register + PriceOracle.setFeed per asset) and the Safe's scheduleBatch /
/// executeBatch calldata to ../packages/shared/deployments/4663.listing.json.
///   forge script script/ListAssets.s.sol --rpc-url $RPC_URL_4663 --broadcast --private-key $DEPLOYER_KEY
contract ListAssets is Script {
    uint32 internal constant HEARTBEAT = 1 days; // the feeds' 86400 s heartbeat
    uint8 internal constant CASH_CLAIMS = 27; // no VOTE claim on a dollar

    function run() external {
        string memory deployment = vm.readFile("../packages/shared/deployments/4663.json");
        AssetGate gate = AssetGate(vm.parseJsonAddress(deployment, ".assetGate"));
        PriceOracle oracle = PriceOracle(vm.parseJsonAddress(deployment, ".priceOracle"));
        TimelockController timelock = TimelockController(payable(vm.parseJsonAddress(deployment, ".timelock")));

        MainnetAssets.Asset[] memory s = MainnetAssets.stocks();
        address[] memory adapters = new address[](s.length);
        vm.startBroadcast();
        for (uint256 i; i < s.length; ++i) {
            adapters[i] = address(new PerShareFeed(AggregatorV3Interface(s[i].feed), IERC8056(s[i].token)));
        }
        vm.stopBroadcast();

        (address[] memory targets, bytes[] memory calls) = batch(gate, oracle, adapters);
        uint256[] memory values = new uint256[](targets.length);
        bytes32 salt = keccak256("cordon.listing.v1");
        uint256 delay = timelock.getMinDelay();

        string memory k = "listing";
        string memory a = "adapters";
        string memory aj;
        for (uint256 i; i < s.length; ++i) {
            aj = vm.serializeAddress(a, s[i].symbol, adapters[i]);
        }
        vm.serializeString(k, "adapters", aj);
        vm.serializeAddress(k, "timelock", address(timelock));
        vm.serializeBytes(
            k, "scheduleCalldata", abi.encodeCall(TimelockController.scheduleBatch, (targets, values, calls, bytes32(0), salt, delay))
        );
        string memory json = vm.serializeBytes(
            k, "executeCalldata", abi.encodeCall(TimelockController.executeBatch, (targets, values, calls, bytes32(0), salt))
        );
        vm.writeJson(json, "../packages/shared/deployments/4663.listing.json");
        console.log("listing batch written:", targets.length, "calls");
    }

    /// register + setFeed for every stock (through its adapter), then USDG.
    function batch(AssetGate gate, PriceOracle oracle, address[] memory adapters)
        public
        view
        returns (address[] memory targets, bytes[] memory calls)
    {
        MainnetAssets.Asset[] memory s = MainnetAssets.stocks();
        targets = new address[](2 * s.length + 2);
        calls = new bytes[](targets.length);
        for (uint256 i; i < s.length; ++i) {
            (targets[2 * i], calls[2 * i]) = (
                address(gate),
                abi.encodeCall(AssetGate.register, (s[i].token, AssetGate.Class.STOCK8056, gate.ALL_CLAIMS(), gate.ALL_TEMPLATES()))
            );
            (targets[2 * i + 1], calls[2 * i + 1]) =
                (address(oracle), abi.encodeCall(PriceOracle.setFeed, (s[i].token, AggregatorV3Interface(adapters[i]), HEARTBEAT)));
        }
        uint256 n = 2 * s.length;
        (targets[n], calls[n]) = (
            address(gate),
            abi.encodeCall(AssetGate.register, (MainnetAssets.USDG, AssetGate.Class.TREASURY, CASH_CLAIMS, gate.ALL_TEMPLATES()))
        );
        (targets[n + 1], calls[n + 1]) = (
            address(oracle), abi.encodeCall(PriceOracle.setFeed, (MainnetAssets.USDG, AggregatorV3Interface(MainnetAssets.USDG_USD), HEARTBEAT))
        );
    }
}
