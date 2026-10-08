// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// Shape of the bb-generated UltraHonk verifiers in src/verifiers.
interface IProofVerifier {
    /// Checks `proof` against `publicInputs` and returns true if it is valid.
    function verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool);
}
