// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title StockroomToken
/// @notice A minimal, standard ERC-20 for tokens deployed through the Stockroom
/// launchpad. This contract is intentionally a thin wrapper around OpenZeppelin's
/// audited ERC20 implementation and adds nothing beyond a one-time, fixed-supply
/// mint at deployment.
///
/// @dev Constructor parameters:
///  - name_                   ERC-20 `name`.
///  - symbol_                 ERC-20 `symbol`.
///  - totalSupply_             Total number of tokens (in the smallest unit, i.e.
///                             already scaled by 10**decimals()) minted exactly
///                             once, at construction. There is no other mint
///                             path anywhere in this contract.
///  - initialRecipient_       Address that receives `totalSupply_ - treasuryAllocation`.
///  - treasury_               Optional second recipient for a treasury carve-out.
///                             Pass `address(0)` (with `treasuryAllocationBps_ == 0`)
///                             to skip a treasury allocation entirely.
///  - treasuryAllocationBps_  Portion of `totalSupply_` sent to `treasury_`,
///                             expressed in basis points (0-10,000, i.e. 0%-100%).
///                             Must be 0 if `treasury_` is `address(0)`.
///  - initialOwner_           Owner recorded via OpenZeppelin `Ownable`. This is
///                             informational only: `Ownable` is included so the
///                             deployed token has a clear, standard, on-chain
///                             owner record for potential future non-mint admin
///                             actions (e.g. off-chain metadata, front-end
///                             listings). The owner role grants NO special
///                             power over token balances, minting, transfers, or
///                             any other ERC-20 mechanic in this contract.
///
/// Explicitly NOT included, by design, per project safety rules:
///  - No post-deploy or owner-gated minting (no `mint` function exists at all).
///  - No transfer taxes or fees.
///  - No blacklist/whitelist/allowlist mechanics.
///  - No pausable / honeypot-style transfer blocking.
///  - No owner ability to seize, freeze, or move user funds.
///  - No proxy/upgradeability pattern (this is a plain, non-upgradeable contract).
///
/// Decimals: hardcoded to the ERC-20 standard 18 (OpenZeppelin's `ERC20.decimals()`
/// default). Not configurable via constructor — 18 is the near-universal norm for
/// ERC-20s, and making it configurable would add a parameter with no real benefit
/// while risking integrator confusion (many integrations implicitly assume 18).
contract StockroomToken is ERC20, Ownable {
    /// @notice Basis-point denominator used to interpret `treasuryAllocationBps_`.
    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// @notice The amount of `totalSupply_` minted to `treasury_` at deployment.
    /// Recorded for transparency; has no effect on contract behavior.
    uint256 public immutable treasuryAllocation;

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 totalSupply_,
        address initialRecipient_,
        address treasury_,
        uint256 treasuryAllocationBps_,
        address initialOwner_
    ) ERC20(name_, symbol_) Ownable(initialOwner_) {
        require(initialRecipient_ != address(0), "StockroomToken: initial recipient is zero address");
        require(totalSupply_ > 0, "StockroomToken: total supply is zero");
        require(treasuryAllocationBps_ <= BPS_DENOMINATOR, "StockroomToken: treasury allocation exceeds 100%");
        require(
            treasuryAllocationBps_ == 0 || treasury_ != address(0),
            "StockroomToken: treasury allocation requires a treasury address"
        );
        require(
            treasury_ == address(0) || treasuryAllocationBps_ > 0,
            "StockroomToken: treasury address requires a nonzero allocation"
        );

        uint256 treasuryAmount = (totalSupply_ * treasuryAllocationBps_) / BPS_DENOMINATOR;
        uint256 recipientAmount = totalSupply_ - treasuryAmount;

        treasuryAllocation = treasuryAmount;

        if (recipientAmount > 0) {
            _mint(initialRecipient_, recipientAmount);
        }
        if (treasuryAmount > 0) {
            _mint(treasury_, treasuryAmount);
        }
    }

    // No mint, pause, blacklist, fee, or upgrade functions exist anywhere in
    // this contract. Supply is fixed forever at the amount minted above.
}
