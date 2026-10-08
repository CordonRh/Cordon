// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AssetGate} from "./AssetGate.sol";
import {CordonPool} from "./CordonPool.sol";

/// $CRDN staking (spec §3.8): protocol fees arrive here (CordonControl.feeRecipient) and
/// each fresh amount is split 80/10/5/5: workers (the operators who prove, relay and
/// register), treasury, stakers pro rata, and the burn sink. Fees are Stock Tokens and USDG,
/// never CRDN, so the burn share goes to `burnSink`, which buys back and burns CRDN.
/// $CRDN is an access and utility token: stakers vote on asset classes and encumbrance
/// templates only; results are signals the timelock executes.
/// Only listed assets count as fee tokens (an open list would let anyone grow the
/// settle loop until unstake runs out of gas). Every stake first sweeps the pool's fees
/// and distributes them, so a new stake never shares fees that accrued before it; stake
/// also stays at least MIN_STAKE_PERIOD.
contract CrdnStaking is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Workers take the rest of each split: WORKER_BPS plus rounding dust.
    uint256 public constant WORKER_BPS = 8000;
    uint256 public constant TREASURY_BPS = 1000;
    uint256 public constant STAKER_BPS = 500;
    uint256 public constant BURN_BPS = 500;
    uint256 public constant VOTING_PERIOD = 5 days;
    uint256 public constant MIN_STAKE_PERIOD = 7 days;
    uint256 internal constant ACC = 1e36;

    IERC20 public immutable crdn;
    address public immutable workers; // operators who prove, relay and register
    address public immutable treasury;
    address public immutable burnSink; // buys back and burns CRDN
    AssetGate public immutable assetGate;
    CordonPool public immutable pool;

    uint256 public totalStaked;
    mapping(address => uint256) public staked;
    mapping(address => uint64) public lockedUntil; // until voting ends, or MIN_STAKE_PERIOD after staking

    // Per fee token: reward per staked unit so far, and the balance already accounted for.
    mapping(address => uint256) public accPerStake;
    mapping(address => uint256) public booked;
    mapping(address => mapping(address => uint256)) public paid; // token => staker => acc at last settle
    mapping(address => mapping(address => uint256)) public owed; // token => staker => claimable
    address[] public feeTokens;
    mapping(address => bool) internal known;

    enum Subject {
        ASSET_CLASS,
        TEMPLATE
    }

    struct Proposal {
        Subject subject;
        bytes32 detailHash; // e.g. keccak256(abi.encode(asset, class, claimMask))
        uint64 ends;
        uint256 forVotes;
        uint256 againstVotes;
    }

    Proposal[] public proposals;
    mapping(uint256 => mapping(address => bool)) public voted;

    /// Emitted when CRDN is staked.
    event Staked(address indexed who, uint256 amount);
    /// Emitted when CRDN is unstaked.
    event Unstaked(address indexed who, uint256 amount);
    /// Emitted when new fees are split. The four amounts sum to the fresh fees.
    event FeesDistributed(
        address indexed token, uint256 toWorkers, uint256 toTreasury, uint256 toStakers, uint256 toBurn
    );
    /// Emitted when a staker claims fees.
    event Claimed(address indexed who, address indexed token, uint256 amount);
    /// Emitted when a proposal opens. Voting ends at `ends`.
    event Proposed(uint256 indexed id, Subject subject, bytes32 detailHash, uint64 ends);
    /// Emitted when a staker votes. `weight` is the voter's stake.
    event Voted(uint256 indexed id, address indexed who, bool support, uint256 weight);

    error Locked();
    error VotingClosed();
    error AlreadyVoted();
    error NoStake();
    error NotFeeToken(address token);
    error ZeroAddress();
    error BadSplit();

    /// Reverts with ZeroAddress if a fee recipient is the zero address (a transfer to it
    /// would revert and block every stake), and with BadSplit unless the shares sum to 100%.
    constructor(IERC20 crdn_, address workers_, address treasury_, address burnSink_, CordonPool pool_) {
        if (WORKER_BPS + TREASURY_BPS + STAKER_BPS + BURN_BPS != 10_000) revert BadSplit();
        if (workers_ == address(0) || treasury_ == address(0) || burnSink_ == address(0)) revert ZeroAddress();
        crdn = crdn_;
        workers = workers_;
        treasury = treasury_;
        burnSink = burnSink_;
        pool = pool_;
        assetGate = pool_.assetGate();
    }

    // ---------------------------------------------------------------- stake

    /// Stakes `amount` CRDN from the caller. Anyone may call.
    /// The stake stays locked for at least MIN_STAKE_PERIOD.
    function stake(uint256 amount) external nonReentrant {
        _sweep();
        _settleAll(msg.sender);
        crdn.safeTransferFrom(msg.sender, address(this), amount);
        staked[msg.sender] += amount;
        totalStaked += amount;
        uint64 until = uint64(block.timestamp + MIN_STAKE_PERIOD);
        if (until > lockedUntil[msg.sender]) lockedUntil[msg.sender] = until;
        emit Staked(msg.sender, amount);
    }

    /// Returns `amount` staked CRDN to the caller. Reverts with Locked before the caller's lock ends.
    function unstake(uint256 amount) external nonReentrant {
        if (block.timestamp < lockedUntil[msg.sender]) revert Locked();
        _settleAll(msg.sender);
        staked[msg.sender] -= amount;
        totalStaked -= amount;
        crdn.safeTransfer(msg.sender, amount);
        emit Unstaked(msg.sender, amount);
    }

    // ---------------------------------------------------------------- fees

    /// Splits whatever `token` arrived since the last call 80/10/5/5 between workers,
    /// treasury, stakers and the burn sink. Anyone may call. Reverts with NotFeeToken for
    /// CRDN or an unlisted token.
    function distribute(address token) external nonReentrant {
        if (token == address(crdn) || !assetGate.isKnown(token)) revert NotFeeToken(token);
        _distribute(token);
    }

    /// Pulls every listed asset's fees from the pool and splits them, so the stakers' share
    /// goes to the current stakers only. Bounded by the governance-listed asset count.
    function _sweep() internal {
        uint256 n = assetGate.assetCount();
        for (uint256 i; i < n; ++i) {
            address token = assetGate.assetList(i);
            if (token == address(crdn)) continue;
            // Fees reach this contract only when it is the fee recipient; never block a stake on it.
            if (pool.fees(token) != 0 && pool.control().feeRecipient() == address(this)) {
                try pool.collectFees(token) {} catch {}
            }
            _distribute(token);
        }
    }

    function _distribute(address token) internal {
        if (!known[token]) {
            known[token] = true;
            feeTokens.push(token);
        }
        uint256 balance = IERC20(token).balanceOf(address(this));
        uint256 fresh = balance - booked[token];
        if (fresh == 0) return;
        uint256 toTreasury = fresh * TREASURY_BPS / 10_000;
        uint256 toBurn = fresh * BURN_BPS / 10_000;
        // Nobody staked: the stakers' share goes to workers too, never to whoever stakes next.
        uint256 toStakers = totalStaked == 0 ? 0 : fresh * STAKER_BPS / 10_000;
        // Workers take the rest (at least 80%, never 0), so the parts always sum to `fresh`.
        uint256 toWorkers = fresh - toTreasury - toBurn - toStakers;
        if (toStakers != 0) accPerStake[token] += toStakers * ACC / totalStaked;
        booked[token] += toStakers;
        IERC20(token).safeTransfer(workers, toWorkers);
        // Small amounts round these to 0; skip them for tokens that refuse 0-transfers.
        if (toTreasury != 0) IERC20(token).safeTransfer(treasury, toTreasury);
        if (toBurn != 0) IERC20(token).safeTransfer(burnSink, toBurn);
        emit FeesDistributed(token, toWorkers, toTreasury, toStakers, toBurn);
    }

    /// Sends the caller's accrued share of fee token `token`. Any staker may call.
    function claim(address token) external nonReentrant {
        _settle(msg.sender, token);
        uint256 amount = owed[token][msg.sender];
        owed[token][msg.sender] = 0;
        booked[token] -= amount;
        IERC20(token).safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, token, amount);
    }

    /// Returns the amount of `token` that `who` can claim now, including rewards not yet settled.
    function claimable(address who, address token) external view returns (uint256) {
        return owed[token][who] + staked[who] * (accPerStake[token] - paid[token][who]) / ACC;
    }

    // ---------------------------------------------------------------- votes

    /// Opens a vote of VOTING_PERIOD on an asset class or template change. Any staker may call.
    /// The result is only a signal for the timelock. Reverts with NoStake if the caller has no stake.
    function propose(Subject subject, bytes32 detailHash) external returns (uint256 id) {
        if (staked[msg.sender] == 0) revert NoStake();
        id = proposals.length;
        uint64 ends = uint64(block.timestamp + VOTING_PERIOD);
        proposals.push(Proposal(subject, detailHash, ends, 0, 0));
        emit Proposed(id, subject, detailHash, ends);
    }

    /// Votes on proposal `id` with the caller's whole stake. Each staker may vote once, and the
    /// stake stays locked until the vote ends. Reverts if voting closed, the caller already
    /// voted, or the caller has no stake.
    function vote(uint256 id, bool support) external {
        Proposal storage p = proposals[id];
        if (block.timestamp >= p.ends) revert VotingClosed();
        if (voted[id][msg.sender]) revert AlreadyVoted();
        uint256 weight = staked[msg.sender];
        if (weight == 0) revert NoStake();
        voted[id][msg.sender] = true;
        if (p.ends > lockedUntil[msg.sender]) lockedUntil[msg.sender] = p.ends;
        if (support) p.forVotes += weight;
        else p.againstVotes += weight;
        emit Voted(id, msg.sender, support, weight);
    }

    /// Returns the number of proposals.
    function proposalCount() external view returns (uint256) {
        return proposals.length;
    }

    // ---------------------------------------------------------------- internal

    function _settleAll(address who) internal {
        for (uint256 i; i < feeTokens.length; ++i) {
            _settle(who, feeTokens[i]);
        }
    }

    function _settle(address who, address token) internal {
        uint256 acc = accPerStake[token];
        owed[token][who] += staked[who] * (acc - paid[token][who]) / ACC;
        paid[token][who] = acc;
    }
}
