// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { EvmV1Decoder } from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";
import { INativeQueryVerifier } from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import { CTCBondVaultV2 } from "../src/CTCBondVaultV2.sol";
import { IssuerControllerV2 } from "../src/IssuerControllerV2.sol";
import { IssuerFactoryV2 } from "../src/IssuerFactoryV2.sol";
import { IssuerTokenV2 } from "../src/IssuerTokenV2.sol";
import { ProofReserveController } from "../src/ProofReserveController.sol";
import { SourceReserveVaultV2 } from "../src/SourceReserveVaultV2.sol";
import { SourceReserveVaultFactoryV2 } from "../src/SourceReserveVaultFactoryV2.sol";

contract RedemptionMockQueryVerifier {
    function calculateTxIndex(INativeQueryVerifier.MerkleProof calldata) external pure returns (uint64) {
        return 9;
    }

    function verifyAndEmit(
        uint64,
        uint64,
        bytes calldata,
        INativeQueryVerifier.MerkleProof calldata,
        INativeQueryVerifier.ContinuityProof calldata
    ) external pure returns (bool) {
        return true;
    }
}

contract RedemptionMockReserveToken {
    mapping(address account => uint256 amount) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;
    uint256 public feeBps;
    bool public returnsFalse;

    function mint(address account, uint256 amount) external {
        balanceOf[account] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function setFeeBps(uint256 feeBps_) external {
        feeBps = feeBps_;
    }

    function setReturnsFalse(bool returnsFalse_) external {
        returnsFalse = returnsFalse_;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (returnsFalse) return false;
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

contract SourceReserveVaultV2Test is Test {
    bytes32 internal constant ISSUER_ID = keccak256("issuer:v2");
    bytes32 internal constant DEPOSIT_ID = keccak256("deposit:v2:1");
    bytes32 internal constant REDEMPTION_ID = keccak256("redemption:v2:1");
    uint256 internal constant AMOUNT = 5_000_000;

    address internal administrator = makeAddr("source administrator");
    address internal depositor = makeAddr("source depositor");
    address internal beneficiary = makeAddr("creditcoin beneficiary");
    address internal recipient = makeAddr("source recipient");
    RedemptionMockReserveToken internal reserve;
    SourceReserveVaultV2 internal vault;

    function setUp() external {
        reserve = new RedemptionMockReserveToken();
        vault = new SourceReserveVaultV2(address(reserve), ISSUER_ID, administrator);
        reserve.mint(depositor, AMOUNT);
        vm.prank(depositor);
        reserve.approve(address(vault), AMOUNT);
        vm.prank(depositor);
        vault.deposit(DEPOSIT_ID, beneficiary, AMOUNT);
    }

    function testAdministratorPaysExactRecognizedReserveOnce() external {
        vm.prank(administrator);
        vault.payout(REDEMPTION_ID, recipient, 2_000_000);

        assertTrue(vault.usedRedemptionIds(REDEMPTION_ID));
        assertEq(vault.totalPaidOut(), 2_000_000);
        assertEq(vault.recognizedReserve(), 3_000_000);
        assertEq(vault.reserveBalance(), 3_000_000);
        assertEq(reserve.balanceOf(recipient), 2_000_000);

        vm.expectRevert(abi.encodeWithSelector(SourceReserveVaultV2.RedemptionIdAlreadyUsed.selector, REDEMPTION_ID));
        vm.prank(administrator);
        vault.payout(REDEMPTION_ID, recipient, 1);
    }

    function testUnauthorizedPayoutAndExcessPayoutRevert() external {
        vm.expectRevert(SourceReserveVaultV2.OnlyAdministrator.selector);
        vm.prank(makeAddr("attacker"));
        vault.payout(REDEMPTION_ID, recipient, 1_000_000);

        vm.expectRevert(
            abi.encodeWithSelector(SourceReserveVaultV2.InsufficientRecognizedReserve.selector, AMOUNT, AMOUNT + 1)
        );
        vm.prank(administrator);
        vault.payout(REDEMPTION_ID, recipient, AMOUNT + 1);
    }

    function testFeeOnTransferPayoutCannotConsumeRedemptionId() external {
        reserve.setFeeBps(100);
        vm.expectRevert(abi.encodeWithSelector(SourceReserveVaultV2.ReserveAmountMismatch.selector, 1_000_000, 990_000));
        vm.prank(administrator);
        vault.payout(REDEMPTION_ID, recipient, 1_000_000);

        assertFalse(vault.usedRedemptionIds(REDEMPTION_ID));
        assertEq(vault.totalPaidOut(), 0);
        assertEq(vault.reserveBalance(), AMOUNT);
    }

    function testTokenReturningFalseCannotConsumeRedemptionId() external {
        reserve.setReturnsFalse(true);
        vm.expectRevert(SourceReserveVaultV2.TransferFailed.selector);
        vm.prank(administrator);
        vault.payout(REDEMPTION_ID, recipient, 1_000_000);
        assertFalse(vault.usedRedemptionIds(REDEMPTION_ID));
    }

    function testCanonicalFactoryDeploysOnlyOnePredictableVaultPerIssuerAndAdministrator() external {
        SourceReserveVaultFactoryV2 canonicalFactory = new SourceReserveVaultFactoryV2();
        bytes32 secondIssuerId = keccak256("issuer:v2:canonical");
        address predicted = canonicalFactory.predictVault(address(reserve), secondIssuerId, administrator);

        vm.prank(administrator);
        address deployed = canonicalFactory.createVault(address(reserve), secondIssuerId);
        assertEq(deployed, predicted);
        assertGt(deployed.code.length, 0);

        vm.expectRevert(
            abi.encodeWithSelector(
                SourceReserveVaultFactoryV2.VaultAlreadyExists.selector, secondIssuerId, administrator
            )
        );
        vm.prank(administrator);
        canonicalFactory.createVault(address(reserve), secondIssuerId);
    }
}

contract IssuerRedemptionV2Test is Test {
    address internal constant VERIFIER_PRECOMPILE = 0x0000000000000000000000000000000000000FD2;
    uint64 internal constant SOURCE_CHAIN_KEY = 1;
    uint64 internal constant DEPOSIT_BLOCK = 11_700_000;
    uint64 internal constant PAYOUT_BLOCK = 11_700_010;
    bytes32 internal constant ISSUER_ID = keccak256("issuer:redemption:v2");
    bytes32 internal constant DEPOSIT_ID = keccak256("deposit:redemption:v2");
    uint256 internal constant AMOUNT = 5_000_000;
    uint256 internal constant MINIMUM_BOND = 100 ether;

    address internal administrator = makeAddr("issuer administrator v2");
    address internal sourceVault;
    address internal sourceExecutor = address(0xE7EC2026);
    address internal payoutOperator;
    address internal reserveAsset;
    address internal holder = makeAddr("token holder");
    address internal recipient = makeAddr("source payout recipient");

    IssuerFactoryV2 internal factory;
    IssuerControllerV2 internal controller;
    IssuerTokenV2 internal token;
    SourceReserveVaultFactoryV2 internal sourceFactory;
    RedemptionMockReserveToken internal sourceReserve;

    function setUp() external {
        RedemptionMockQueryVerifier verifier = new RedemptionMockQueryVerifier();
        vm.etch(VERIFIER_PRECOMPILE, address(verifier).code);
        sourceReserve = new RedemptionMockReserveToken();
        reserveAsset = address(sourceReserve);
        payoutOperator = administrator;
        sourceFactory = new SourceReserveVaultFactoryV2();
        vm.prank(administrator);
        sourceVault = sourceFactory.createVault(reserveAsset, ISSUER_ID);
        factory = new IssuerFactoryV2(MINIMUM_BOND, address(sourceFactory));

        IssuerFactoryV2.IssuerParameters memory parameters = _parameters();
        address predicted = factory.predictController(parameters, administrator);
        vm.prank(administrator);
        (address controllerAddress, address tokenAddress) = factory.createIssuer(parameters);
        assertEq(controllerAddress, predicted);
        controller = IssuerControllerV2(controllerAddress);
        token = IssuerTokenV2(tokenAddress);

        vm.deal(administrator, MINIMUM_BOND);
        vm.startPrank(administrator);
        controller.bondVault().depositBond{ value: MINIMUM_BOND }();
        controller.bondVault().activateIssuance();
        vm.stopPrank();
        _executeDeposit();
    }

    function testCompleteRedemptionPaysThenBurnsExactEscrow() external {
        bytes32 redemptionId = _requestRedemption(AMOUNT);

        assertEq(token.balanceOf(holder), 0);
        assertEq(token.balanceOf(address(controller)), AMOUNT);
        assertEq(controller.totalPendingRedemption(), AMOUNT);

        bytes32 queryId =
            _executePayout(_encodedPayout(redemptionId, recipient, payoutOperator, AMOUNT, 1), PAYOUT_BLOCK);
        (
            address recordedHolder,
            address recordedRecipient,
            uint256 recordedAmount,
            IssuerControllerV2.RedemptionStatus status
        ) = controller.redemptions(redemptionId);

        assertTrue(controller.processedQueries(queryId));
        assertTrue(controller.verifiedPayoutIds(redemptionId));
        assertEq(recordedHolder, holder);
        assertEq(recordedRecipient, recipient);
        assertEq(recordedAmount, AMOUNT);
        assertEq(uint8(status), uint8(IssuerControllerV2.RedemptionStatus.Completed));
        assertEq(controller.totalPendingRedemption(), 0);
        assertEq(controller.totalRedeemed(), AMOUNT);
        assertEq(controller.netVerifiedReserve(), 0);
        assertEq(token.totalSupply(), 0);
        assertEq(token.balanceOf(address(controller)), 0);
    }

    function testAcceptsPayoutRoutedThroughConfiguredExecutor() external {
        bytes32 redemptionId = _requestRedemption(AMOUNT);
        bytes memory payout = _encodedPayoutTo(redemptionId, recipient, payoutOperator, AMOUNT, 1, sourceExecutor);

        _executePayout(payout, PAYOUT_BLOCK);
        assertEq(controller.totalPendingRedemption(), 0);
        assertEq(controller.totalRedeemed(), AMOUNT);
        assertEq(controller.netVerifiedReserve(), 0);
        assertEq(token.totalSupply(), 0);
    }

    function testPayoutMustMatchPendingRecipientAndAmount() external {
        bytes32 redemptionId = _requestRedemption(AMOUNT);
        address wrongRecipient = makeAddr("wrong recipient");

        vm.expectRevert(abi.encodeWithSelector(IssuerControllerV2.RedemptionTermsMismatch.selector, redemptionId));
        _executePayout(_encodedPayout(redemptionId, wrongRecipient, payoutOperator, AMOUNT, 1), PAYOUT_BLOCK);

        vm.expectRevert(abi.encodeWithSelector(IssuerControllerV2.RedemptionTermsMismatch.selector, redemptionId));
        _executePayout(_encodedPayout(redemptionId, recipient, payoutOperator, AMOUNT - 1, 1), PAYOUT_BLOCK);

        assertEq(controller.totalPendingRedemption(), AMOUNT);
        assertEq(token.totalSupply(), AMOUNT);
    }

    function testRejectsWrongPayoutOperatorAndFailedReceipt() external {
        bytes32 redemptionId = _requestRedemption(AMOUNT);

        vm.expectRevert(IssuerControllerV2.InvalidPayoutTransaction.selector);
        _executePayout(_encodedPayout(redemptionId, recipient, makeAddr("wrong operator"), AMOUNT, 1), PAYOUT_BLOCK);

        vm.expectRevert(abi.encodeWithSelector(ProofReserveController.InvalidReceiptStatus.selector, uint8(0)));
        _executePayout(_encodedPayout(redemptionId, recipient, payoutOperator, AMOUNT, 0), PAYOUT_BLOCK);
        assertFalse(controller.processedQueries(_expectedQueryId(PAYOUT_BLOCK)));
    }

    function testCannotReplayPayoutProofOrRedemptionId() external {
        bytes32 redemptionId = _requestRedemption(AMOUNT);
        bytes memory payout = _encodedPayout(redemptionId, recipient, payoutOperator, AMOUNT, 1);
        bytes32 queryId = _executePayout(payout, PAYOUT_BLOCK);

        vm.expectRevert(abi.encodeWithSelector(ProofReserveController.QueryAlreadyProcessed.selector, queryId));
        _executePayout(payout, PAYOUT_BLOCK);

        vm.expectRevert(abi.encodeWithSelector(IssuerControllerV2.RedemptionAlreadyFinalized.selector, redemptionId));
        _executePayout(payout, PAYOUT_BLOCK + 1);
    }

    function testPauseBlocksNewRequestButCannotBlockExistingFinalization() external {
        bytes32 redemptionId = _requestRedemption(AMOUNT);
        vm.prank(administrator);
        controller.setRedemptionPaused(true);

        vm.expectRevert(IssuerControllerV2.RedemptionIsPaused.selector);
        vm.prank(holder);
        controller.requestRedemption(1, recipient);

        _executePayout(_encodedPayout(redemptionId, recipient, payoutOperator, AMOUNT, 1), PAYOUT_BLOCK);
        assertEq(token.totalSupply(), 0);
    }

    function testBondCannotDeactivateUntilAllSupplyIsRedeemed() external {
        CTCBondVaultV2 bondVault = controller.bondVault();
        vm.expectRevert(CTCBondVaultV2.BondHasOutstandingLiability.selector);
        vm.prank(administrator);
        bondVault.deactivateIssuance();

        bytes32 redemptionId = _requestRedemption(AMOUNT);
        vm.expectRevert(CTCBondVaultV2.BondHasOutstandingLiability.selector);
        vm.prank(administrator);
        bondVault.deactivateIssuance();

        _executePayout(_encodedPayout(redemptionId, recipient, payoutOperator, AMOUNT, 1), PAYOUT_BLOCK);
        vm.prank(administrator);
        bondVault.deactivateIssuance();
        assertFalse(bondVault.active());
    }

    function testOnlyControllerCanBurnEscrowedTokens() external {
        vm.expectRevert(IssuerTokenV2.OnlyController.selector);
        vm.prank(administrator);
        token.burnEscrowed(1);
    }

    function testFuzzPartialRedemptionPreservesSupplyToNetReserveEquality(uint96 amountSeed) external {
        uint256 amount = bound(uint256(amountSeed), 1, AMOUNT);
        bytes32 redemptionId = _requestRedemption(amount);
        _executePayout(_encodedPayout(redemptionId, recipient, payoutOperator, amount, 1), PAYOUT_BLOCK);

        assertEq(token.totalSupply(), AMOUNT - amount);
        assertEq(controller.netVerifiedReserve(), AMOUNT - amount);
        assertEq(controller.totalPendingRedemption(), 0);
    }

    function testFactoryRejectsArbitraryOrWrongAdministratorVault() external {
        bytes32 secondIssuerId = keccak256("issuer:redemption:v2:malicious");
        IssuerFactoryV2.IssuerParameters memory parameters = _parameters();
        parameters.issuerId = secondIssuerId;
        parameters.sourceVault = makeAddr("fake source vault");
        address expected = factory.predictSourceVault(parameters, administrator);

        vm.expectRevert(
            abi.encodeWithSelector(IssuerFactoryV2.UnrecognizedSourceVault.selector, parameters.sourceVault, expected)
        );
        vm.prank(administrator);
        factory.createIssuer(parameters);

        parameters.sourceVault = expected;
        parameters.sourcePayoutOperator = makeAddr("different payout operator");
        vm.expectRevert(
            abi.encodeWithSelector(IssuerFactoryV2.UnrecognizedSourceVault.selector, parameters.sourceVault, expected)
        );
        vm.prank(administrator);
        factory.createIssuer(parameters);
    }

    function testCanonicalVaultAddressMatchesBothFactories() external view {
        IssuerFactoryV2.IssuerParameters memory parameters = _parameters();
        assertEq(sourceFactory.predictVault(reserveAsset, ISSUER_ID, administrator), sourceVault);
        assertEq(factory.predictSourceVault(parameters, administrator), sourceVault);
        assertGt(sourceVault.code.length, 0);
    }

    function _parameters() internal view returns (IssuerFactoryV2.IssuerParameters memory) {
        return IssuerFactoryV2.IssuerParameters({
            issuerId: ISSUER_ID,
            sourceChainKey: SOURCE_CHAIN_KEY,
            sourceVault: sourceVault,
            sourceExecutor: sourceExecutor,
            sourcePayoutOperator: payoutOperator,
            reserveAsset: reserveAsset,
            decimals: 6,
            tokenName: "Resyvr Redeemable USD",
            tokenSymbol: "rvUSD2"
        });
    }

    function _executeDeposit() internal {
        controller.executeDeposit(
            SOURCE_CHAIN_KEY,
            DEPOSIT_BLOCK,
            _encodedDeposit(),
            bytes32(uint256(DEPOSIT_BLOCK)),
            new INativeQueryVerifier.MerkleProofEntry[](0),
            bytes32(0),
            new bytes32[](0)
        );
        assertEq(token.balanceOf(holder), AMOUNT);
    }

    function _requestRedemption(uint256 amount) internal returns (bytes32 redemptionId) {
        vm.startPrank(holder);
        token.approve(address(controller), amount);
        redemptionId = controller.requestRedemption(amount, recipient);
        vm.stopPrank();
    }

    function _executePayout(bytes memory encodedTransaction, uint64 blockHeight) internal returns (bytes32) {
        return controller.executePayout(
            SOURCE_CHAIN_KEY,
            blockHeight,
            encodedTransaction,
            bytes32(uint256(blockHeight)),
            new INativeQueryVerifier.MerkleProofEntry[](0),
            bytes32(0),
            new bytes32[](0)
        );
    }

    function _encodedDeposit() internal view returns (bytes memory) {
        bytes32[] memory topics = new bytes32[](4);
        topics[0] = keccak256("ReserveDeposited(bytes32,bytes32,address,address,uint256)");
        topics[1] = ISSUER_ID;
        topics[2] = DEPOSIT_ID;
        topics[3] = bytes32(uint256(uint160(holder)));
        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](1);
        logs[0] = EvmV1Decoder.LogEntryTuple({
            address_: sourceVault, topics: topics, data: abi.encode(payoutOperator, AMOUNT)
        });
        return _encodedTransaction(
            payoutOperator,
            abi.encodeWithSelector(bytes4(keccak256("deposit(bytes32,address,uint256)")), DEPOSIT_ID, holder, AMOUNT),
            logs,
            1
        );
    }

    function _encodedPayout(
        bytes32 redemptionId,
        address payoutRecipient,
        address operator,
        uint256 amount,
        uint8 receiptStatus
    ) internal view returns (bytes memory) {
        return _encodedPayoutTo(redemptionId, payoutRecipient, operator, amount, receiptStatus, sourceVault);
    }

    function _encodedPayoutTo(
        bytes32 redemptionId,
        address payoutRecipient,
        address operator,
        uint256 amount,
        uint8 receiptStatus,
        address transactionTarget
    ) internal view returns (bytes memory) {
        bytes32[] memory topics = new bytes32[](4);
        topics[0] = keccak256("ReservePaidOut(bytes32,bytes32,address,address,uint256)");
        topics[1] = ISSUER_ID;
        topics[2] = redemptionId;
        topics[3] = bytes32(uint256(uint160(payoutRecipient)));
        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](1);
        logs[0] =
            EvmV1Decoder.LogEntryTuple({ address_: sourceVault, topics: topics, data: abi.encode(operator, amount) });
        return _encodedTransactionTo(
            operator,
            abi.encodeWithSelector(
                bytes4(keccak256("payout(bytes32,address,uint256)")), redemptionId, payoutRecipient, amount
            ),
            logs,
            receiptStatus,
            transactionTarget
        );
    }

    function _encodedTransaction(
        address from,
        bytes memory callData,
        EvmV1Decoder.LogEntryTuple[] memory logs,
        uint8 receiptStatus
    ) internal view returns (bytes memory) {
        return _encodedTransactionTo(from, callData, logs, receiptStatus, sourceVault);
    }

    function _encodedTransactionTo(
        address from,
        bytes memory callData,
        EvmV1Decoder.LogEntryTuple[] memory logs,
        uint8 receiptStatus,
        address transactionTarget
    ) internal pure returns (bytes memory) {
        bytes[] memory chunks = new bytes[](3);
        chunks[0] = abi.encode(uint64(1), uint64(150_000), from, false, transactionTarget, uint256(0), callData);
        EvmV1Decoder.AccessListEntryBytes32[] memory accessList = new EvmV1Decoder.AccessListEntryBytes32[](0);
        chunks[1] = abi.encode(
            uint64(11155111), uint128(1 gwei), uint128(2 gwei), accessList, uint8(0), bytes32(0), bytes32(0)
        );
        chunks[2] = abi.encode(receiptStatus, uint64(100_000), logs, bytes(""));
        return abi.encode(uint8(2), chunks);
    }

    function _expectedQueryId(uint64 blockHeight) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(bytes32(uint256(SOURCE_CHAIN_KEY)), bytes8(blockHeight), bytes8(uint64(9))));
    }
}
