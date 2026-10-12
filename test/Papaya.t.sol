// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Papaya} from "../src/Papaya.sol";
import {IPapaya} from "../src/interfaces/IPapaya.sol";
import {UserLib} from "../src/library/UserLib.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

abstract contract PapayaScenarios is Test {
    address constant USDC = 0x3600000000000000000000000000000000000000;
    uint96 constant RATE = 8_000_000_000; // 0.020736 USDC / 30 days
    uint256 constant SCALE = 1e12;
    Papaya internal p;
    IERC20 internal token = IERC20(USDC);
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal creator = makeAddr("creator");
    address internal scooter = makeAddr("scooter");
    address internal keeper = makeAddr("keeper");

    function fund(address who, uint256 microUSDC) internal virtual;

    function initialize() internal {
        vm.fee(20 gwei);
        p = new Papaya(address(this));
        p.claimProjectId(address(this));
        p.setDefaultFee(100, 0); // one percent; no second hidden protocol fee
        fund(alice, 10e6);
        fund(bob, 10e6);
        fund(keeper, 10e6);
        deposit(alice, 20_000);
    }

    function deposit(address who, uint256 amount) internal {
        vm.startPrank(who);
        token.approve(address(p), amount);
        p.deposit(amount, false);
        vm.stopPrank();
    }

    function start(address who, address to, uint96 rate) internal {
        vm.prank(who);
        p.subscribe(to, rate, 0);
    }

    function backing() internal view {
        assertGe(token.balanceOf(address(p)) * SCALE, p.totalSupply());
        address[6] memory actors = [alice, bob, creator, scooter, keeper, address(this)];
        int256 sum;
        for (uint256 i; i < actors.length; i++) {
            (int256 b, int256 inc, int256 out, uint256 updated) = p.users(actors[i]);
            sum += b + (inc - out) * int256(block.timestamp - updated);
        }
        assertEq(sum, int256(p.totalSupply()), "signed liabilities conserved");
    }

    function makeLiquidatable() internal {
        start(alice, creator, RATE);
        vm.warp(vm.getBlockTimestamp() + 24 days); // balance .0034112, threshold .0040912
        vm.fee(20 gwei);
    }

    function testDeploymentConfiguration() public view {
        assertEq(address(p.TOKEN()), USDC);
        assertEq(p.DECIMALS_SCALE(), SCALE);
        assertEq(p.decimals(), 18);
        assertEq(p.owner(), address(this));
        assertEq(p.projectOwners(0), address(this));
        assertEq(p.defaultFeeSettings(0), 100);
        backing();
    }

    function testDepositApprovalAndSafetyReserve() public {
        assertEq(token.allowance(alice, address(p)), 0);
        vm.expectRevert();
        vm.prank(alice);
        p.deposit(1, false);
        start(alice, creator, RATE);
        vm.expectRevert(UserLib.ReduceTheAmount.selector);
        vm.prank(alice);
        p.withdraw(0.019 ether);
        backing();
    }

    function testImmediateRefillAfterIncomeStops() public {
        start(alice, bob, RATE * 2);
        start(bob, scooter, RATE);
        uint256 monthly = (uint256(RATE) * 30 days + SCALE - 1) / SCALE;
        vm.prank(bob);
        token.approve(address(p), monthly);
        vm.prank(alice);
        p.unsubscribe(bob);
        vm.prank(keeper);
        p.liquidate(bob);
        (bool active,) = p.subscriptions(bob, scooter);
        assertTrue(active);
        assertGt(p.balanceOf(bob), 0);
        assertEq(token.allowance(bob, address(p)), 0);
        backing();
    }

    function testFractionalRefillCreditsOnlyActuallyTransferredUSDC() public {
        start(alice, creator, RATE + 1);
        vm.warp(vm.getBlockTimestamp() + 24 days);
        uint256 quote = p.refillQuote(alice);
        uint256 held = token.balanceOf(address(p));
        uint256 supply = p.totalSupply();
        vm.prank(alice);
        token.approve(address(p), quote);
        vm.prank(keeper);
        p.liquidate(alice);
        assertEq(token.balanceOf(address(p)) - held, quote);
        assertEq(p.totalSupply() - supply, quote * SCALE);
        backing();
    }

    function testRejectUnsupportedPermitAndInvalidSubscriptions() public {
        vm.expectRevert(IPapaya.NotLegal.selector);
        vm.prank(alice);
        p.deposit(1, true);
        vm.expectRevert(IPapaya.NotLegal.selector);
        vm.prank(alice);
        p.subscribe(alice, RATE, 0);
        vm.expectRevert(IPapaya.NotLegal.selector);
        vm.prank(alice);
        p.subscribe(address(0), RATE, 0);
        vm.expectRevert(IPapaya.NotLegal.selector);
        vm.prank(alice);
        p.subscribe(creator, 0, 0);
        backing();
    }

    function testProjectIdEqualLengthIsInvalid() public {
        vm.expectRevert(abi.encodeWithSelector(IPapaya.InvalidProjectId.selector, 1));
        vm.prank(alice);
        p.subscribe(creator, RATE, 1);
        vm.expectRevert(abi.encodeWithSelector(IPapaya.InvalidProjectId.selector, 1));
        p.setDefaultFee(1, 1);
    }

    function testDepositWithdrawUnitsAndRounding() public {
        assertEq(p.balanceOf(alice), 0.02 ether);
        vm.prank(alice);
        p.withdraw(0.005 ether + 123);
        assertEq(p.balanceOf(alice), 0.015 ether);
        assertEq(token.balanceOf(address(p)), 15_000);
        backing();
    }

    function testCreatorRateChangeStopAndFees() public {
        start(alice, creator, RATE);
        vm.warp(vm.getBlockTimestamp() + 60);
        assertEq(p.balanceOf(alice), 0.02 ether - uint256(RATE) * 60);
        assertEq(p.balanceOf(creator), uint256(RATE) * 99 / 100 * 60);
        assertEq(p.balanceOf(address(this)), uint256(RATE) / 100 * 60);
        start(alice, creator, RATE * 2);
        vm.warp(vm.getBlockTimestamp() + 120);
        vm.prank(alice);
        p.unsubscribe(creator);
        uint256 paid = uint256(RATE) * 300;
        assertEq(p.balanceOf(alice), 0.02 ether - paid);
        assertEq(p.balanceOf(creator), paid * 99 / 100);
        (bool active,) = p.subscriptions(alice, creator);
        assertFalse(active);
        vm.warp(vm.getBlockTimestamp() + 1 days);
        assertEq(p.balanceOf(alice), 0.02 ether - paid);
        backing();
    }

    function testScooterAndConcurrentUsers() public {
        deposit(bob, 20_000);
        start(alice, scooter, RATE);
        start(bob, scooter, RATE);
        vm.warp(vm.getBlockTimestamp() + 300);
        vm.prank(alice);
        p.unsubscribe(scooter);
        vm.warp(vm.getBlockTimestamp() + 300);
        vm.prank(bob);
        p.unsubscribe(scooter);
        assertEq(p.balanceOf(scooter), uint256(RATE) * 900 * 99 / 100);
        backing();
    }

    function testRefillAllowanceSupplyRewardAndWithdraw() public {
        makeLiquidatable();
        uint256 quote = p.refillQuote(alice);
        uint256 beforeBalance = p.balanceOf(alice);
        uint256 supply = p.totalSupply();
        vm.prank(alice);
        token.approve(address(p), quote);
        vm.prank(keeper);
        p.liquidate(alice);
        assertEq(token.allowance(alice, address(p)), 0);
        assertEq(p.totalSupply(), supply + quote * SCALE);
        assertEq(p.balanceOf(keeper), 20 gwei * 120_000);
        assertEq(p.balanceOf(alice), beforeBalance + quote * SCALE - p.balanceOf(keeper));
        (bool active,) = p.subscriptions(alice, creator);
        assertTrue(active);
        vm.expectRevert(IPapaya.NotLiquidatable.selector);
        vm.prank(keeper);
        p.liquidate(alice);
        uint256 rewardBalance = p.balanceOf(keeper);
        vm.prank(keeper);
        p.withdraw(rewardBalance);
        backing();
    }

    function testInsufficientAllowanceLiquidates() public {
        makeLiquidatable();
        uint256 allowanceAmount = p.refillQuote(alice) - 1;
        vm.prank(alice);
        token.approve(address(p), allowanceAmount);
        uint256 remaining = p.balanceOf(alice);
        vm.prank(keeper);
        p.liquidate(alice);
        (bool active,) = p.subscriptions(alice, creator);
        assertFalse(active);
        assertEq(p.balanceOf(alice), 0);
        assertEq(p.balanceOf(keeper), remaining);
        backing();
    }

    function testInsufficientExternalBalanceLiquidates() public {
        makeLiquidatable();
        vm.startPrank(alice);
        token.approve(address(p), p.refillQuote(alice));
        token.transfer(bob, token.balanceOf(alice));
        vm.stopPrank();
        vm.prank(keeper);
        p.liquidate(alice);
        (bool active,) = p.subscriptions(alice, creator);
        assertFalse(active);
        backing();
    }

    function testRescueCannotTakeBackingOrNative() public {
        vm.expectRevert(IPapaya.WrongToken.selector);
        p.rescueFunds(token, 1);
        vm.expectRevert(IPapaya.WrongToken.selector);
        p.rescueFunds(IERC20(address(0)), 1);
        vm.prank(alice);
        token.transfer(address(p), 7);
        vm.expectRevert(IPapaya.WrongToken.selector);
        p.rescueFunds(token, 7);
        backing();
    }

    function testOnlyUnrelatedERC20CanBeRescued() public {
        MockUSDC unrelated = new MockUSDC();
        unrelated.mint(address(p), 123);
        vm.expectRevert();
        vm.prank(alice);
        p.rescueFunds(IERC20(address(unrelated)), 123);
        p.rescueFunds(IERC20(address(unrelated)), 123);
        assertEq(unrelated.balanceOf(address(this)), 123);
        assertEq(unrelated.balanceOf(address(p)), 0);
        backing();
    }

    function testUSDCRescueForbiddenWithSignedDebt() public {
        start(alice, creator, RATE);
        vm.warp(vm.getBlockTimestamp() + 31 days);
        vm.prank(alice);
        token.transfer(address(p), 7);
        vm.expectRevert(IPapaya.WrongToken.selector);
        p.rescueFunds(token, 7);
        vm.expectRevert(IPapaya.WrongToken.selector);
        p.rescueFunds(IERC20(address(0)), 7e12);
        backing();
    }

    function testTinyRefillClosesInsteadOfRewardLoop() public {
        start(alice, creator, 1);
        vm.fee(1e12); // gas spike makes user eligible; monthly refill cannot pay reward
        vm.prank(alice);
        token.approve(address(p), 100);
        vm.prank(keeper);
        p.liquidate(alice);
        assertEq(token.allowance(alice, address(p)), 100);
        (bool active,) = p.subscriptions(alice, creator);
        assertFalse(active);
        backing();
    }

    function testReceiverCannotBlockUnsubscribeAndImmediateKeeper() public {
        start(alice, bob, RATE * 2);
        start(bob, scooter, RATE); // covered by incoming stream, zero deposit
        vm.prank(alice);
        p.unsubscribe(bob);
        vm.prank(keeper);
        p.liquidate(bob);
        (bool active,) = p.subscriptions(bob, scooter);
        assertFalse(active);
        backing();
    }

    function testLateLiquidationNeedsFundedKeeper() public {
        start(alice, creator, RATE);
        vm.warp(vm.getBlockTimestamp() + 31 days);
        vm.fee(20 gwei);
        vm.expectRevert(UserLib.TopUpBalance.selector);
        vm.prank(keeper);
        p.liquidate(alice);
        deposit(keeper, 10_000);
        vm.prank(keeper);
        p.liquidate(alice);
        backing();
    }

    function testUserFeeAndMaxFee() public {
        p.setFeeForUser(creator, 200, 0);
        start(alice, creator, RATE);
        vm.warp(vm.getBlockTimestamp() + 100);
        assertEq(p.balanceOf(creator), uint256(RATE) * 98);
        vm.expectRevert(IPapaya.WrongPercent.selector);
        p.setDefaultFee(2001, 0);
        backing();
    }

    function testFuzzOracleCancellationAndRefillRounding(uint96 rate, uint64 gasPrice) public {
        rate = uint96(bound(rate, 1, 100_000_000_000));
        gasPrice = uint64(bound(gasPrice, 1, 1e13));
        // Pnative == Ptoken: (gas * gasPrice * Pnative) / Ptoken == gas * gasPrice.
        vm.fee(gasPrice);
        assertEq(p.executionPrice(address(0)), uint256(gasPrice) * 120_000);
        assertEq(p.executionPrice(address(0)), uint256(gasPrice) * 120_000 * 100_000_000 / 100_000_000);
        vm.fee(20 gwei);
        deposit(alice, 1e6);
        start(alice, creator, rate);
        uint256 exact = uint256(rate) * 30 days;
        uint256 credited = p.refillQuote(alice) * SCALE;
        assertGe(credited, exact);
        assertLt(credited - exact, SCALE);
        backing();
    }
}

contract PapayaUnitTest is PapayaScenarios {
    function setUp() public {
        MockUSDC implementation = new MockUSDC();
        vm.etch(USDC, address(implementation).code);
        initialize();
    }

    function fund(address who, uint256 amount) internal override {
        MockUSDC(USDC).mint(who, amount);
    }
}

contract ArcForkTest is PapayaScenarios {
    function setUp() public {
        vm.skip(!vm.envOr("RUN_ARC_FORK", false));
        vm.createSelectFork(vm.envString("ARC_RPC_URL"), vm.envUint("ARC_FORK_BLOCK"));
        assertEq(block.chainid, 5042);
        assertGt(USDC.code.length, 0);
        initialize();
    }

    function fund(address who, uint256 amount) internal override {
        vm.deal(who, amount * SCALE);
    }

    function testArcNativeAndERC20AreSameBacking() public {
        assertEq(address(p).balance, token.balanceOf(address(p)) * SCALE);
        uint256 beforeNative = alice.balance;
        vm.prank(alice);
        p.withdraw(0.001 ether);
        assertEq(alice.balance, beforeNative + 0.001 ether);
        assertEq(address(p).balance, p.totalSupply());
        backing();
    }
}
