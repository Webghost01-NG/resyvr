// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";
import { IssuerControllerV2 } from "./IssuerControllerV2.sol";
import { SourceReserveVaultV2 } from "./SourceReserveVaultV2.sol";

/// @title IssuerFactoryV2
/// @notice Creates isolated issuers with proof-finalized redemption support.
contract IssuerFactoryV2 {
    error IssuerAlreadyExists(bytes32 issuerId);
    error InvalidIssuerConfiguration();
    error OnlyIssuerAdministrator();
    error UnrecognizedSourceVault(address actual, address expected);

    uint256 public immutable minimumIssuerBond;
    address public immutable SOURCE_VAULT_FACTORY;

    struct IssuerParameters {
        bytes32 issuerId;
        uint64 sourceChainKey;
        address sourceVault;
        address sourceExecutor;
        address sourcePayoutOperator;
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
        address sourcePayoutOperator;
        address reserveAsset;
        address controller;
        address token;
        address bondVault;
        uint8 decimals;
        uint256 minimumBond;
    }

    mapping(bytes32 issuerId => IssuerRecord record) public issuers;

    event IssuerCreatedV2(
        bytes32 indexed issuerId,
        address indexed administrator,
        address indexed controller,
        address token,
        address sourceVault,
        address sourcePayoutOperator,
        address bondVault
    );

    constructor(uint256 minimumIssuerBond_, address sourceVaultFactory_) {
        if (minimumIssuerBond_ == 0 || sourceVaultFactory_ == address(0)) revert InvalidIssuerConfiguration();
        minimumIssuerBond = minimumIssuerBond_;
        SOURCE_VAULT_FACTORY = sourceVaultFactory_;
    }

    function createIssuer(IssuerParameters calldata parameters)
        external
        returns (address controllerAddress, address tokenAddress)
    {
        _validateParameters(parameters, msg.sender);
        if (issuers[parameters.issuerId].controller != address(0)) {
            revert IssuerAlreadyExists(parameters.issuerId);
        }

        bytes32 salt = _salt(parameters.issuerId, msg.sender);
        IssuerControllerV2 controller = new IssuerControllerV2{ salt: salt }(
            parameters.sourceChainKey,
            parameters.sourceVault,
            parameters.sourceExecutor,
            parameters.sourcePayoutOperator,
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
            sourcePayoutOperator: parameters.sourcePayoutOperator,
            reserveAsset: parameters.reserveAsset,
            controller: controllerAddress,
            token: tokenAddress,
            bondVault: address(controller.bondVault()),
            decimals: parameters.decimals,
            minimumBond: minimumIssuerBond
        });

        emit IssuerCreatedV2(
            parameters.issuerId,
            msg.sender,
            controllerAddress,
            tokenAddress,
            parameters.sourceVault,
            parameters.sourcePayoutOperator,
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
            type(IssuerControllerV2).creationCode,
            abi.encode(
                parameters.sourceChainKey,
                parameters.sourceVault,
                parameters.sourceExecutor,
                parameters.sourcePayoutOperator,
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

    function predictSourceVault(IssuerParameters calldata parameters, address administrator)
        public
        view
        returns (address)
    {
        if (administrator == address(0)) revert OnlyIssuerAdministrator();
        bytes32 salt = keccak256(abi.encode(parameters.issuerId, administrator));
        bytes32 creationCodeHash = keccak256(
            abi.encodePacked(
                type(SourceReserveVaultV2).creationCode,
                abi.encode(parameters.reserveAsset, parameters.issuerId, administrator)
            )
        );
        return Create2.computeAddress(salt, creationCodeHash, SOURCE_VAULT_FACTORY);
    }

    function _validateParameters(IssuerParameters calldata parameters, address administrator) private view {
        if (
            parameters.issuerId == bytes32(0) || parameters.sourceChainKey == 0 || parameters.sourceVault == address(0)
                || parameters.sourcePayoutOperator == address(0) || parameters.reserveAsset == address(0)
                || parameters.decimals > 18 || bytes(parameters.tokenName).length == 0
                || bytes(parameters.tokenSymbol).length == 0
        ) revert InvalidIssuerConfiguration();
        address expectedVault = predictSourceVault(parameters, administrator);
        if (parameters.sourceVault != expectedVault || parameters.sourcePayoutOperator != administrator) {
            revert UnrecognizedSourceVault(parameters.sourceVault, expectedVault);
        }
    }

    function _salt(bytes32 issuerId, address administrator) private pure returns (bytes32) {
        return keccak256(abi.encode(issuerId, administrator));
    }
}
