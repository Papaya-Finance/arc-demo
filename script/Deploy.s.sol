// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.30;
import {Script} from "forge-std/Script.sol";
import {Papaya} from "../src/Papaya.sol";

contract Deploy is Script {
    function run() public returns (Papaya papaya) {
        require(block.chainid == 5042, "Arc Mainnet only");
        address deployer = vm.envAddress("DEPLOYER_ADDRESS");
        require(deployer != address(0), "Missing deployer");
        vm.startBroadcast(deployer);
        papaya = new Papaya(deployer);
        papaya.claimProjectId(deployer);
        papaya.setDefaultFee(100, 0);
        vm.stopBroadcast();
        require(papaya.owner() == deployer && papaya.projectOwners(0) == deployer, "Bad ownership");
        require(papaya.defaultFeeSettings(0) == 100, "Bad fee");
    }
}
