// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {CordonControl} from "./CordonControl.sol";

/// Deposit screening during the 15-minute standby. A flagged deposit never enters the
/// note tree; its depositor can still take it back with `unshieldToOrigin`.
contract ScreeningGate {
    CordonControl public immutable control;
    mapping(uint256 => bool) public flagged;

    /// Emitted when a keeper flags a deposit.
    event Flagged(uint256 indexed depositId);

    error NotScreener();

    constructor(CordonControl control_) {
        control = control_;
    }

    // ponytail: screener keepers flag by hand; wire a PPOI proof check here when the
    // screening provider for 4663 is chosen.
    /// Flags a deposit so it cannot enter the note tree. Only a keeper may call.
    function flag(uint256 depositId) external {
        if (!control.isKeeper(msg.sender)) revert NotScreener();
        flagged[depositId] = true;
        emit Flagged(depositId);
    }
}
