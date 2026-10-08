// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {CordonPool} from "../src/CordonPool.sol";
import {DvPSettler} from "../src/DvPSettler.sol";
import {PriceOracle} from "../src/PriceOracle.sol";
import {IProofVerifier} from "../src/interfaces/IProofVerifier.sol";
import {DvpHonkVerifier} from "../src/verifiers/DvpHonkVerifier.sol";
import {OrderHonkVerifier} from "../src/verifiers/OrderHonkVerifier.sol";

/// Deploys a new DvPSettler (with its verifiers) next to an existing deployment. It only
/// spends notes once governance runs CordonControl.setEngine(settler, true) through the
/// timelock; retire the old one with setEngine(old, false) in the same batch.
///   POOL=<pool> ORACLE=<priceOracle> forge script script/UpgradeDvP.s.sol --rpc-url <rpc> --broadcast
contract UpgradeDvP is Script {
    function run() external returns (DvPSettler settler) {
        vm.startBroadcast();
        settler = new DvPSettler(
            CordonPool(vm.envAddress("POOL")),
            PriceOracle(vm.envAddress("ORACLE")),
            IProofVerifier(address(new DvpHonkVerifier())),
            IProofVerifier(address(new OrderHonkVerifier()))
        );
        vm.stopBroadcast();
        console.log("DvPSettler", address(settler));
    }
}
