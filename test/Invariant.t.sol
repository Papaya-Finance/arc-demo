// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.30;
import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Papaya, IERC20} from "../src/Papaya.sol";
import {MockUSDC} from "./Papaya.t.sol";

contract StreamHandler is Test {
    Papaya public p;
    MockUSDC public token;
    address[] public actors;
    address public creator = address(0xcafe);
    address public keeper = address(0xbee);

    constructor() {
        token = MockUSDC(0x3600000000000000000000000000000000000000);
        MockUSDC implementation = new MockUSDC();
        vm.etch(address(token), address(implementation).code);
        vm.fee(20 gwei);
        p = new Papaya(address(this));
        p.claimProjectId(address(this));
        p.setDefaultFee(100, 0);
        actors.push(address(0xa11ce));
        actors.push(address(0xb0b));
        for (uint256 i; i < 2; i++) {
            token.mint(actors[i], 100e6);
            vm.prank(actors[i]);
            token.approve(address(p), 100e6);
        }
    }

    function actor(uint256 seed) internal view returns (address) {
        return actors[seed % 2];
    }

    function deposit(uint256 seed, uint64 value) external {
        vm.prank(actor(seed));
        p.deposit(bound(value, 1, 50_000), false);
    }

    function subscribe(uint256 seed, uint64 value) external {
        vm.prank(actor(seed));
        p.subscribe(creator, uint96(bound(value, 4e9, 12e9)), 0);
    }

    function stop(uint256 seed) external {
        vm.prank(actor(seed));
        p.unsubscribe(creator);
    }

    function withdraw(uint256 seed, uint64 value) external {
        vm.prank(actor(seed));
        p.withdraw(bound(value, 1, 20_000) * 1e12);
    }

    function approval(uint256 seed, bool sufficient) external {
        vm.prank(actor(seed));
        token.approve(address(p), sufficient ? 100e6 : 0);
    }

    function advance(uint32 elapsed) external {
        vm.warp(vm.getBlockTimestamp() + bound(elapsed, 1, 1 hours));
        vm.fee(20 gwei);
        for (uint256 i; i < 2; i++) {
            vm.prank(keeper);
            try p.liquidate(actors[i]) {} catch {}
        }
    }
}

contract PapayaInvariantTest is StdInvariant, Test {
    StreamHandler h;

    function setUp() public {
        h = new StreamHandler();
        targetContract(address(h));
    }

    function invariantBackingAndConservationWithTimelyKeeper() public view {
        Papaya p = h.p();
        address[5] memory all = [h.actors(0), h.actors(1), h.creator(), h.keeper(), address(h)];
        uint256 sum;
        for (uint256 i; i < all.length; i++) {
            (int256 b, int256 inc, int256 out, uint256 updated) = p.users(all[i]);
            int256 live = b + (inc - out) * int256(block.timestamp - updated);
            assertGe(live, 0, "timely keeper must prevent debt");
            sum += uint256(live);
        }
        assertEq(sum, p.totalSupply());
        assertGe(h.token().balanceOf(address(p)) * 1e12, sum);
    }
}
