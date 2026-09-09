// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script } from "forge-std/Script.sol";
import { IssuerFactory } from "../src/IssuerFactory.sol";

contract DeployIssuerFactory is Script {
    function run() external returns (IssuerFactory factory) {
        uint256 minimumBond = vm.envUint("RESYVR_MINIMUM_CTC_BOND");

        vm.startBroadcast();
        factory = new IssuerFactory(minimumBond);
        vm.stopBroadcast();
    }
}
