// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IPoseidon2} from "poseidon2-evm/IPoseidon2.sol";

/// Poseidon2 (BN254) through a deployed Poseidon2Yul_BN254, matching circuits/lib.
library Poseidon {
    uint256 internal constant FIELD = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001;

    /// Poseidon2 hash of two field elements.
    function h2(IPoseidon2 p, uint256 a, uint256 b) internal pure returns (uint256) {
        return p.hash_2(a, b);
    }

    /// Poseidon2 hash of three field elements.
    function h3(IPoseidon2 p, uint256 a, uint256 b, uint256 c) internal pure returns (uint256) {
        return p.hash_3(a, b, c);
    }
}
