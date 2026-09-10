// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script } from "forge-std/Script.sol";
import { SourceReserveVaultFactoryV2 } from "../src/SourceReserveVaultFactoryV2.sol";

contract DeploySourceReserveVaultFactoryV2 is Script {
    function run() external returns (SourceReserveVaultFactoryV2 factory) {
        vm.startBroadcast();
        factory = new SourceReserveVaultFactoryV2();
        vm.stopBroadcast();
    }
}
