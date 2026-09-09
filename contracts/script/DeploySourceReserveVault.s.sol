// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script } from "forge-std/Script.sol";
import { SourceReserveVault } from "../src/SourceReserveVault.sol";

contract DeploySourceReserveVault is Script {
    function run() external returns (SourceReserveVault vault) {
        address reserveAsset = vm.envAddress("RESYVR_RESERVE_ASSET");
        bytes32 issuerId = vm.envBytes32("RESYVR_ISSUER_ID");

        vm.startBroadcast();
        vault = new SourceReserveVault(reserveAsset, issuerId);
        vm.stopBroadcast();
    }
}
