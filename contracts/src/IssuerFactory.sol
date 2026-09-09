// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";
import { IssuerController } from "./IssuerController.sol";

/// @title IssuerFactory
/// @notice Creates and records immutable, isolated Resyvr issuer pairs.
contract IssuerFactory {
    error IssuerAlreadyExists(bytes32 issuerId);
    error InvalidIssuerConfiguration();
    error OnlyIssuerAdministrator();

    uint256 public immutable minimumIssuerBond;

    struct IssuerParameters {
        bytes32 issuerId;
        uint64 sourceChainKey;
        address sourceVault;
        address sourceExecutor;
        address reserveAsset;
        uint8 decimals;
        string tokenName;
        string tokenSymbol;
    }

    struct IssuerRecord {
        address administrator;
        uint64 sourceChainKey;
        address sourceVault;
        address sourceExecutor;
        address reserveAsset;
        address controller;
        address token;
        address bondVault;
        uint8 decimals;
        uint256 minimumBond;
    }

    mapping(bytes32 issuerId => IssuerRecord record) public issuers;

    constructor(uint256 minimumIssuerBond_) {
        if (minimumIssuerBond_ == 0) revert InvalidIssuerConfiguration();
        minimumIssuerBond = minimumIssuerBond_;
    }

    event IssuerCreated(
        bytes32 indexed issuerId,
        address indexed administrator,
        address indexed controller,
        address token,
        uint64 sourceChainKey,
        address sourceVault,
        address sourceExecutor,
        address reserveAsset,
        uint8 decimals,
        uint256 minimumBond,
        address bondVault
    );

    function createIssuer(IssuerParameters calldata parameters)
        external
        returns (address controllerAddress, address tokenAddress)
    {
        _validateParameters(parameters);
        if (issuers[parameters.issuerId].controller != address(0)) {
            revert IssuerAlreadyExists(parameters.issuerId);
        }

        bytes32 salt = _salt(parameters.issuerId, msg.sender);
        IssuerController controller = new IssuerController{ salt: salt }(
            parameters.sourceChainKey,
            parameters.sourceVault,
            parameters.sourceExecutor,
            parameters.reserveAsset,
            parameters.issuerId,
            msg.sender,
            parameters.tokenName,
            parameters.tokenSymbol,
            parameters.decimals,
            minimumIssuerBond
        );
        controllerAddress = address(controller);
        tokenAddress = address(controller.token());

        issuers[parameters.issuerId] = IssuerRecord({
            administrator: msg.sender,
            sourceChainKey: parameters.sourceChainKey,
            sourceVault: parameters.sourceVault,
            sourceExecutor: parameters.sourceExecutor,
            reserveAsset: parameters.reserveAsset,
            controller: controllerAddress,
            token: tokenAddress,
            bondVault: address(controller.bondVault()),
            decimals: parameters.decimals,
            minimumBond: minimumIssuerBond
        });

        emit IssuerCreated(
            parameters.issuerId,
            msg.sender,
            controllerAddress,
            tokenAddress,
            parameters.sourceChainKey,
            parameters.sourceVault,
            parameters.sourceExecutor,
            parameters.reserveAsset,
            parameters.decimals,
            minimumIssuerBond,
            address(controller.bondVault())
        );
    }

    function predictController(IssuerParameters calldata parameters, address administrator)
        external
        view
        returns (address)
    {
        if (administrator == address(0)) revert OnlyIssuerAdministrator();
        bytes memory creationCode = abi.encodePacked(
            type(IssuerController).creationCode,
            abi.encode(
                parameters.sourceChainKey,
                parameters.sourceVault,
                parameters.sourceExecutor,
                parameters.reserveAsset,
                parameters.issuerId,
                administrator,
                parameters.tokenName,
                parameters.tokenSymbol,
                parameters.decimals,
                minimumIssuerBond
            )
        );
        return Create2.computeAddress(_salt(parameters.issuerId, administrator), keccak256(creationCode));
    }

    function _validateParameters(IssuerParameters calldata parameters) private pure {
        if (
            parameters.issuerId == bytes32(0) || parameters.sourceChainKey == 0 || parameters.sourceVault == address(0)
                || parameters.reserveAsset == address(0) || parameters.decimals > 18
                || bytes(parameters.tokenName).length == 0 || bytes(parameters.tokenSymbol).length == 0
        ) revert InvalidIssuerConfiguration();
    }

    function _salt(bytes32 issuerId, address administrator) private pure returns (bytes32) {
        return keccak256(abi.encode(issuerId, administrator));
    }
}
