// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// Registry of claimable assets (spec §3.7): asset class, which claim types a bundle
/// of it produces, which encumbrance templates it allows, and ACTIVE / REDEEM_ONLY.
contract AssetGate is Ownable2Step {
    enum Class {
        STOCK8056,
        TREASURY,
        VAULT4626
    }
    enum Mode {
        NONE,
        ACTIVE,
        REDEEM_ONLY
    }

    // Claim mask bit k = claim kind k+1: PRINCIPAL, INCOME, VOTE, REDEEM, CONTROL.
    uint8 public constant ALL_CLAIMS = 31;
    uint8 public constant NO_VOTE = 27;
    // Template mask bits: LOCKUP, PLEDGE, LIEN.
    uint8 public constant ALL_TEMPLATES = 7;

    struct Asset {
        Class class;
        Mode mode;
        uint8 claimMask;
        uint8 templateMask;
    }

    mapping(address => Asset) public assets;
    address[] public assetList;

    /// Emitted when the owner lists a new asset.
    event AssetRegistered(address indexed asset, Class class, uint8 claimMask, uint8 templateMask);
    /// Emitted when the owner changes the mode of an asset.
    event ModeSet(address indexed asset, Mode mode);
    /// Emitted when the owner changes the encumbrance templates of an asset.
    event TemplatesSet(address indexed asset, uint8 templateMask);

    error BadMask();
    error UnknownAsset(address asset);
    error AlreadyRegistered(address asset);

    constructor(address owner_) Ownable(owner_) {}

    /// Lists an asset once. Its class and claim mask never change afterwards: existing
    /// bundles were split under them and must recombine under the same ones.
    function register(address asset, Class class, uint8 claims, uint8 templates) external onlyOwner {
        // A bundle always splits into at least PRINCIPAL and INCOME.
        if (claims & 3 != 3 || claims > ALL_CLAIMS || templates > ALL_TEMPLATES) revert BadMask();
        if (assets[asset].mode != Mode.NONE) revert AlreadyRegistered(asset);
        assetList.push(asset);
        assets[asset] = Asset(class, Mode.ACTIVE, claims, templates);
        emit AssetRegistered(asset, class, claims, templates);
    }

    /// Encumbrance templates only gate new encumbrances, so they may change.
    function setTemplates(address asset, uint8 templates) external onlyOwner {
        if (assets[asset].mode == Mode.NONE) revert UnknownAsset(asset);
        if (templates > ALL_TEMPLATES) revert BadMask();
        assets[asset].templateMask = templates;
        emit TemplatesSet(asset, templates);
    }

    /// Delisting / registry removal: unbundle and withdraw keep working, nothing new enters.
    function setMode(address asset, Mode mode) external onlyOwner {
        if (assets[asset].mode == Mode.NONE || mode == Mode.NONE) revert UnknownAsset(asset);
        assets[asset].mode = mode;
        emit ModeSet(asset, mode);
    }

    /// True if `asset` is listed and ACTIVE, so it accepts new deposits, bundles and encumbrances.
    function isActive(address asset) external view returns (bool) {
        return assets[asset].mode == Mode.ACTIVE;
    }

    /// True if `asset` is listed, in any mode.
    function isKnown(address asset) external view returns (bool) {
        return assets[asset].mode != Mode.NONE;
    }

    /// Returns the claim mask of `asset`. Bit k set means the bundle issues claim kind k+1.
    function claimMask(address asset) external view returns (uint8) {
        return assets[asset].claimMask;
    }

    /// Returns the asset class of `asset`. An unlisted asset reads as STOCK8056.
    function classOf(address asset) external view returns (Class) {
        return assets[asset].class;
    }

    /// Returns the number of listed assets.
    function assetCount() external view returns (uint256) {
        return assetList.length;
    }
}
