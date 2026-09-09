// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { SourceReserveVault } from "../src/SourceReserveVault.sol";

contract MockReserveToken {
    string public constant name = "Mock USD Coin";
    string public constant symbol = "mUSDC";
    uint8 public constant decimals = 6;

    mapping(address account => uint256 amount) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    uint256 public feeBps;
    bool public returnsFalse;

    function setFeeBps(uint256 feeBps_) external {
        feeBps = feeBps_;
    }

    function setReturnsFalse(bool returnsFalse_) external {
        returnsFalse = returnsFalse_;
    }

    function mint(address account, uint256 amount) external {
        balanceOf[account] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (returnsFalse) return false;

        uint256 permitted = allowance[from][msg.sender];
        require(permitted >= amount, "insufficient allowance");
        allowance[from][msg.sender] = permitted - amount;
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) private {
        require(balanceOf[from] >= amount, "insufficient balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount - ((amount * feeBps) / 10_000);
    }
}

contract SourceReserveVaultTest is Test {
    bytes32 internal constant ISSUER_ID = keccak256("resyvr:pilot:rusd:v1");
    bytes32 internal constant DEPOSIT_ID = keccak256("deposit:1");
    uint256 internal constant DEPOSIT_AMOUNT = 5_000_000;

    MockReserveToken internal reserve;
    SourceReserveVault internal vault;
    address internal depositor;
    address internal beneficiary;

    event ReserveDeposited(
        bytes32 indexed issuerId,
        bytes32 indexed depositId,
        address indexed beneficiary,
        address depositor,
        uint256 amount
    );

    function setUp() external {
        depositor = makeAddr("depositor");
        beneficiary = makeAddr("beneficiary");
        reserve = new MockReserveToken();
        vault = new SourceReserveVault(address(reserve), ISSUER_ID);

        reserve.mint(depositor, 100_000_000);
        vm.prank(depositor);
        reserve.approve(address(vault), type(uint256).max);
    }

    function testDepositLocksExactReserveAndRecordsId() external {
        vm.expectEmit(true, true, true, true, address(vault));
        emit ReserveDeposited(ISSUER_ID, DEPOSIT_ID, beneficiary, depositor, DEPOSIT_AMOUNT);

        vm.prank(depositor);
        vault.deposit(DEPOSIT_ID, beneficiary, DEPOSIT_AMOUNT);

        assertTrue(vault.usedDepositIds(DEPOSIT_ID));
        assertEq(vault.totalDeposited(), DEPOSIT_AMOUNT);
        assertEq(vault.reserveBalance(), DEPOSIT_AMOUNT);
        assertEq(reserve.balanceOf(depositor), 95_000_000);
    }

    function testRejectsDuplicateDepositId() external {
        vm.startPrank(depositor);
        vault.deposit(DEPOSIT_ID, beneficiary, DEPOSIT_AMOUNT);

        vm.expectRevert(abi.encodeWithSelector(SourceReserveVault.DepositIdAlreadyUsed.selector, DEPOSIT_ID));
        vault.deposit(DEPOSIT_ID, beneficiary, DEPOSIT_AMOUNT);
        vm.stopPrank();
    }

    function testRejectsFeeOnTransferReserve() external {
        reserve.setFeeBps(100);

        vm.expectRevert(
            abi.encodeWithSelector(SourceReserveVault.ReserveAmountMismatch.selector, DEPOSIT_AMOUNT, 4_950_000)
        );
        vm.prank(depositor);
        vault.deposit(DEPOSIT_ID, beneficiary, DEPOSIT_AMOUNT);

        assertFalse(vault.usedDepositIds(DEPOSIT_ID));
        assertEq(vault.totalDeposited(), 0);
        assertEq(vault.reserveBalance(), 0);
    }

    function testRejectsTokenReturningFalse() external {
        reserve.setReturnsFalse(true);

        vm.expectRevert(SourceReserveVault.TransferFromFailed.selector);
        vm.prank(depositor);
        vault.deposit(DEPOSIT_ID, beneficiary, DEPOSIT_AMOUNT);

        assertFalse(vault.usedDepositIds(DEPOSIT_ID));
    }

    function testDirectTransferDoesNotCreateRecognizedDeposit() external {
        vm.prank(depositor);
        reserve.transfer(address(vault), DEPOSIT_AMOUNT);

        assertEq(vault.reserveBalance(), DEPOSIT_AMOUNT);
        assertEq(vault.totalDeposited(), 0);
        assertFalse(vault.usedDepositIds(DEPOSIT_ID));
    }

    function testRejectsInvalidDepositArguments() external {
        vm.startPrank(depositor);

        vm.expectRevert(SourceReserveVault.InvalidDepositId.selector);
        vault.deposit(bytes32(0), beneficiary, DEPOSIT_AMOUNT);

        vm.expectRevert(SourceReserveVault.InvalidBeneficiary.selector);
        vault.deposit(DEPOSIT_ID, address(0), DEPOSIT_AMOUNT);

        vm.expectRevert(SourceReserveVault.ZeroAmount.selector);
        vault.deposit(DEPOSIT_ID, beneficiary, 0);

        vm.stopPrank();
    }

    function testConstructorRejectsInvalidConfiguration() external {
        vm.expectRevert(SourceReserveVault.InvalidReserveAsset.selector);
        new SourceReserveVault(address(0), ISSUER_ID);

        vm.expectRevert(SourceReserveVault.InvalidReserveAsset.selector);
        new SourceReserveVault(makeAddr("not-a-contract"), ISSUER_ID);

        vm.expectRevert(SourceReserveVault.InvalidIssuerId.selector);
        new SourceReserveVault(address(reserve), bytes32(0));
    }

    function testFuzzDepositPreservesAccounting(uint128 rawAmount, bytes32 depositId) external {
        uint256 amount = bound(uint256(rawAmount), 1, 100_000_000);
        vm.assume(depositId != bytes32(0));

        vm.prank(depositor);
        vault.deposit(depositId, beneficiary, amount);

        assertEq(vault.totalDeposited(), amount);
        assertEq(vault.reserveBalance(), amount);
        assertTrue(vault.usedDepositIds(depositId));
    }
}
