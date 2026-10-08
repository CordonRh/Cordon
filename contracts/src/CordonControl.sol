// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// Governance switches for everything around the immutable pool (spec §3.9).
/// Owner = 24h TimelockController run by the 2-of-3 Safe. The guardian can only pause
/// deposits, bundle, DvP and encumber; exits have no switch here at all.
contract CordonControl is Ownable2Step {
    uint8 public constant DEPOSITS = 1;
    uint8 public constant BUNDLE = 2;
    uint8 public constant DVP = 4;
    uint8 public constant ENCUMBER = 8;

    address public guardian;
    address public feeRecipient;
    address public sequencer; // TEE DvP sequencer (attested enclave key)
    uint8 public paused;
    mapping(address => bool) public isEngine;
    mapping(address => bool) public isKeeper;

    /// Emitted when pause flags are set.
    event Paused(uint8 flags);
    /// Emitted when pause flags are cleared.
    event Unpaused(uint8 flags);
    /// Emitted when an engine is added or removed.
    event EngineSet(address engine, bool enabled);
    /// Emitted when a keeper is added or removed.
    event KeeperSet(address keeper, bool enabled);
    /// Emitted when the guardian changes.
    event GuardianSet(address guardian);
    /// Emitted when the fee recipient changes.
    event FeeRecipientSet(address recipient);
    /// Emitted when the sequencer changes.
    event SequencerSet(address sequencer);

    error NotGuardian();
    error ZeroAddress();
    error IsPaused(uint8 flag);

    constructor(address owner_, address guardian_, address feeRecipient_) Ownable(owner_) {
        if (guardian_ == address(0)) revert ZeroAddress();
        guardian = guardian_;
        feeRecipient = feeRecipient_;
    }

    /// Pauses the given flags (DEPOSITS, BUNDLE, DVP, ENCUMBER); other bits are ignored.
    /// The guardian or the owner may call. Reverts with NotGuardian for any other caller.
    function pause(uint8 flags) external {
        if (msg.sender != guardian && msg.sender != owner()) revert NotGuardian();
        paused |= flags & 15;
        emit Paused(flags);
    }

    /// Clears the given pause flags. Only the owner (the timelock) may call.
    function unpause(uint8 flags) external onlyOwner {
        paused &= ~flags;
        emit Unpaused(flags);
    }

    /// Reverts with IsPaused if `flag` is paused. Engines call it before they act.
    function requireActive(uint8 flag) external view {
        if (paused & flag != 0) revert IsPaused(flag);
    }

    /// Adds or removes a servicing engine that may spend and create pool notes.
    /// Only the owner may call. Reverts on the zero address.
    function setEngine(address engine, bool enabled) external onlyOwner {
        if (engine == address(0)) revert ZeroAddress();
        isEngine[engine] = enabled;
        emit EngineSet(engine, enabled);
    }

    /// Adds or removes a keeper (index, splits, screening, defaults).
    /// Only the owner may call. Reverts on the zero address.
    function setKeeper(address keeper, bool enabled) external onlyOwner {
        if (keeper == address(0)) revert ZeroAddress();
        isKeeper[keeper] = enabled;
        emit KeeperSet(keeper, enabled);
    }

    /// Replaces the guardian. Only the owner may call. Reverts on the zero address.
    function setGuardian(address guardian_) external onlyOwner {
        if (guardian_ == address(0)) revert ZeroAddress();
        guardian = guardian_;
        emit GuardianSet(guardian_);
    }

    /// Sets the TEE sequencer that may submit DvP batches.
    /// Only the owner may call. Reverts on the zero address.
    function setSequencer(address sequencer_) external onlyOwner {
        if (sequencer_ == address(0)) revert ZeroAddress();
        sequencer = sequencer_;
        emit SequencerSet(sequencer_);
    }

    /// Sets the address that receives collected pool fees. Only the owner may call.
    /// The zero address stops fee collection.
    function setFeeRecipient(address recipient) external onlyOwner {
        feeRecipient = recipient;
        emit FeeRecipientSet(recipient);
    }
}
