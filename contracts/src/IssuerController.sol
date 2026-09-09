// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { CTCBondVault } from "./CTCBondVault.sol";
import { IssuerToken } from "./IssuerToken.sol";
import { ProofReserveController } from "./ProofReserveController.sol";

/// @title IssuerController
/// @notice Connects one immutable proof configuration to one isolated issuer token.
contract IssuerController is ProofReserveController {
    error InvalidAdministrator();
    error IssuanceIsInactive();
    error IssuanceIsPaused();
    error OnlyAdministrator();

    address public immutable administrator;
    CTCBondVault public immutable bondVault;
    IssuerToken public immutable token;
    uint8 public immutable reserveDecimals;
    bool public issuancePaused;

    event IssuancePauseChanged(bool paused, address indexed administrator);

    constructor(
        uint64 sourceChainKey,
        address sourceVault,
        address sourceExecutor,
        address reserveAsset,
        bytes32 issuerId,
        address administrator_,
        string memory tokenName,
        string memory tokenSymbol,
        uint8 decimals_,
        uint256 minimumBond
    ) ProofReserveController(sourceChainKey, sourceVault, sourceExecutor, reserveAsset, issuerId) {
        if (administrator_ == address(0)) revert InvalidAdministrator();
        administrator = administrator_;
        reserveDecimals = decimals_;
        token = new IssuerToken(tokenName, tokenSymbol, decimals_);
        bondVault = new CTCBondVault(administrator_, minimumBond);
    }

    function setIssuancePaused(bool paused) external {
        if (msg.sender != administrator) revert OnlyAdministrator();
        issuancePaused = paused;
        emit IssuancePauseChanged(paused, msg.sender);
    }

    function _afterDepositVerified(DepositRecord memory depositRecord) internal override {
        if (issuancePaused) revert IssuanceIsPaused();
        if (!bondVault.active()) revert IssuanceIsInactive();
        token.mint(depositRecord.beneficiary, depositRecord.amount);
    }
}
