// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script } from "forge-std/Script.sol";
import { IssuerFactoryV2 } from "../src/IssuerFactoryV2.sol";

contract DeployIssuerFactoryV2 is Script {
    function run() external returns (IssuerFactoryV2 factory) {
        uint256 minimumBond = vm.envUint("RESYVR_MINIMUM_CTC_BOND");
        address sourceVaultFactory = vm.envAddress("RESYVR_SOURCE_VAULT_FACTORY_V2");

        vm.startBroadcast();
        factory = new IssuerFactoryV2(minimumBond, sourceVaultFactory);
        vm.stopBroadcast();
    }
}
