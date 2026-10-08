// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// TESTNET ONLY. Stand-in for a Robinhood Stock Token: ERC-20 + ERC-8056 multiplier.
/// Anyone can mint from the faucet; the admin moves the multiplier to simulate
/// reinvested dividends and splits.
contract TestnetStockToken is ERC20 {
    uint8 private immutable dec;
    address public immutable admin;
    uint256 public uiMultiplier = 1e18;
    uint256 public newUIMultiplier = 1e18;
    uint256 public effectiveAt;

    constructor(string memory name_, string memory symbol_, uint8 decimals_, address admin_) ERC20(name_, symbol_) {
        dec = decimals_;
        admin = admin_;
    }

    /// Returns the decimals set at deployment.
    function decimals() public view override returns (uint8) {
        return dec;
    }

    /// Faucet: up to 1,000 whole tokens per call.
    function mint(address to, uint256 amount) external {
        require(amount <= 1000 * 10 ** dec, "faucet limit");
        _mint(to, amount);
    }

    /// Sets the ERC-8056 multiplier to `m` (1e18 = 1x), effective now. Only the admin may call.
    function setMultiplier(uint256 m) external {
        require(msg.sender == admin, "admin only");
        uiMultiplier = m;
        newUIMultiplier = m;
        effectiveAt = block.timestamp;
    }
}
