// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IBondReleaseController {
    function canReleaseBond() external view returns (bool);
}

/// @title CTCBondVaultV2
/// @notice Keeps the issuer bond locked while issued supply or redemptions remain.
contract CTCBondVaultV2 is ReentrancyGuard {
    error BondBelowMinimum(uint256 balance, uint256 minimum);
    error BondHasOutstandingLiability();
    error InsufficientBond(uint256 balance, uint256 requested);
    error InvalidBondConfiguration();
    error IssuanceIsActive();
    error OnlyAdministrator();
    error TransferFailed();

    address public immutable administrator;
    address public immutable controller;
    uint256 public immutable minimumBond;
    bool public active;

    event BondDeposited(address indexed administrator, uint256 amount, uint256 balance);
    event BondWithdrawn(address indexed administrator, address indexed recipient, uint256 amount, uint256 balance);
    event IssuanceActivationChanged(bool active, uint256 bondBalance);

    constructor(address administrator_, uint256 minimumBond_) {
        if (administrator_ == address(0) || minimumBond_ == 0) revert InvalidBondConfiguration();
        administrator = administrator_;
        controller = msg.sender;
        minimumBond = minimumBond_;
    }

    function depositBond() external payable {
        if (msg.sender != administrator) revert OnlyAdministrator();
        if (msg.value == 0) revert InvalidBondConfiguration();
        emit BondDeposited(msg.sender, msg.value, address(this).balance);
    }

    function activateIssuance() external {
        if (msg.sender != administrator) revert OnlyAdministrator();
        uint256 balance = address(this).balance;
        if (balance < minimumBond) revert BondBelowMinimum(balance, minimumBond);
        active = true;
        emit IssuanceActivationChanged(true, balance);
    }

    function deactivateIssuance() external {
        if (msg.sender != administrator) revert OnlyAdministrator();
        if (!IBondReleaseController(controller).canReleaseBond()) revert BondHasOutstandingLiability();
        active = false;
        emit IssuanceActivationChanged(false, address(this).balance);
    }

    function withdrawBond(uint256 amount, address payable recipient) external nonReentrant {
        if (msg.sender != administrator) revert OnlyAdministrator();
        if (active) revert IssuanceIsActive();
        if (!IBondReleaseController(controller).canReleaseBond()) revert BondHasOutstandingLiability();
        if (recipient == address(0) || amount == 0) revert InvalidBondConfiguration();

        uint256 balance = address(this).balance;
        if (amount > balance) revert InsufficientBond(balance, amount);
        (bool success,) = recipient.call{ value: amount }("");
        if (!success) revert TransferFailed();
        emit BondWithdrawn(msg.sender, recipient, amount, address(this).balance);
    }
}
