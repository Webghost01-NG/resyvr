// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";
import { SourceReserveVaultV2 } from "./SourceReserveVaultV2.sol";

/// @title SourceReserveVaultFactoryV2
/// @notice Canonical CREATE2 deployer for source vaults recognized by Resyvr V2.
contract SourceReserveVaultFactoryV2 {
    error InvalidVaultConfiguration();
    error VaultAlreadyExists(bytes32 issuerId, address administrator);

    mapping(bytes32 deploymentKey => address vault) public vaults;

    event CanonicalVaultCreated(
        bytes32 indexed issuerId,
        address indexed administrator,
        address indexed vault,
        address reserveAsset,
        bytes32 runtimeCodeHash
    );

    function createVault(address reserveAsset, bytes32 issuerId) external returns (address vaultAddress) {
        if (reserveAsset == address(0) || reserveAsset.code.length == 0 || issuerId == bytes32(0)) {
            revert InvalidVaultConfiguration();
        }

        bytes32 deploymentKey = keccak256(abi.encode(issuerId, msg.sender));
        if (vaults[deploymentKey] != address(0)) revert VaultAlreadyExists(issuerId, msg.sender);

        SourceReserveVaultV2 vault = new SourceReserveVaultV2{ salt: deploymentKey }(reserveAsset, issuerId, msg.sender);
        vaultAddress = address(vault);
        vaults[deploymentKey] = vaultAddress;
        emit CanonicalVaultCreated(issuerId, msg.sender, vaultAddress, reserveAsset, vaultAddress.codehash);
    }

    function predictVault(address reserveAsset, bytes32 issuerId, address administrator) public view returns (address) {
        if (reserveAsset == address(0) || issuerId == bytes32(0) || administrator == address(0)) {
            revert InvalidVaultConfiguration();
        }
        bytes32 salt = keccak256(abi.encode(issuerId, administrator));
        bytes32 creationCodeHash = keccak256(
            abi.encodePacked(type(SourceReserveVaultV2).creationCode, abi.encode(reserveAsset, issuerId, administrator))
        );
        return Create2.computeAddress(salt, creationCodeHash, address(this));
    }
}
