// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script } from "forge-std/Script.sol";
import { ProofReserveController } from "../src/ProofReserveController.sol";

contract DeployProofReserveController is Script {
    function run() external returns (ProofReserveController controller) {
        uint64 sourceChainKey = uint64(vm.envUint("RESYVR_SOURCE_CHAIN_KEY"));
        address sourceVault = vm.envAddress("RESYVR_SOURCE_VAULT");
        address sourceExecutor = vm.envAddress("RESYVR_SOURCE_EXECUTOR");
        address reserveAsset = vm.envAddress("RESYVR_RESERVE_ASSET");
        bytes32 issuerId = vm.envBytes32("RESYVR_ISSUER_ID");

        vm.startBroadcast();
        controller = new ProofReserveController(sourceChainKey, sourceVault, sourceExecutor, reserveAsset, issuerId);
        vm.stopBroadcast();
    }
}
