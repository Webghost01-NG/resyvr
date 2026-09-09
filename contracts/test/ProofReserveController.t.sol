// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { EvmV1Decoder } from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";
import { INativeQueryVerifier } from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import { ProofReserveController } from "../src/ProofReserveController.sol";

contract MockQueryVerifier {
    function calculateTxIndex(INativeQueryVerifier.MerkleProof calldata) external pure returns (uint64) {
        return 7;
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

contract RejectingQueryVerifier {
    function calculateTxIndex(INativeQueryVerifier.MerkleProof calldata) external pure returns (uint64) {
        return 7;
    }

    function verifyAndEmit(
        uint64,
        uint64,
        bytes calldata,
        INativeQueryVerifier.MerkleProof calldata,
        INativeQueryVerifier.ContinuityProof calldata
    ) external pure returns (bool) {
        return false;
    }
}

contract ProofReserveControllerTest is Test {
    address internal constant VERIFIER_PRECOMPILE = 0x0000000000000000000000000000000000000FD2;
    uint64 internal constant SOURCE_CHAIN_KEY = 1;
    uint64 internal constant BLOCK_HEIGHT = 11_667_500;
    bytes32 internal constant ISSUER_ID = keccak256("resyvr:pilot:rusd:v1");
    bytes32 internal constant DEPOSIT_ID = keccak256("deposit:pilot:1");
    uint256 internal constant AMOUNT = 5_000_000;

    address internal sourceVault = address(0xBEEF);
    address internal sourceExecutor = address(0xE7EC0702);
    address internal reserveAsset = address(0xA55E7);
    address internal depositor = address(0xD3305170);
    address internal beneficiary = address(0xB3E3F1C1A4);
    ProofReserveController internal controller;

    function setUp() external {
        MockQueryVerifier mockVerifier = new MockQueryVerifier();
        vm.etch(VERIFIER_PRECOMPILE, address(mockVerifier).code);
        controller = new ProofReserveController(SOURCE_CHAIN_KEY, sourceVault, sourceExecutor, reserveAsset, ISSUER_ID);
    }

    function testAcceptsExactDepositAndUpdatesAccounting() external {
        bytes memory encodedTransaction = _encodedDepositTransaction(
            sourceVault,
            sourceVault,
            ISSUER_ID,
            DEPOSIT_ID,
            beneficiary,
            beneficiary,
            depositor,
            depositor,
            AMOUNT,
            AMOUNT,
            1,
            1
        );

        bytes32 queryId = _execute(encodedTransaction, BLOCK_HEIGHT);

        assertTrue(controller.processedQueries(queryId));
        assertTrue(controller.verifiedDepositIds(DEPOSIT_ID));
        assertEq(controller.totalVerifiedReserve(), AMOUNT);
        assertEq(controller.verifiedBalance(beneficiary), AMOUNT);
    }

    function testRejectsWrongSourceChainBeforeProofProcessing() external {
        bytes memory encodedTransaction = _validTransaction();

        vm.expectRevert(
            abi.encodeWithSelector(ProofReserveController.InvalidChainKey.selector, uint64(2), SOURCE_CHAIN_KEY)
        );
        _executeWithChain(encodedTransaction, 2, BLOCK_HEIGHT);
    }

    function testRejectsProofWhenNativeVerifierReturnsFalse() external {
        RejectingQueryVerifier rejectingVerifier = new RejectingQueryVerifier();
        vm.etch(VERIFIER_PRECOMPILE, address(rejectingVerifier).code);

        vm.expectRevert(ProofReserveController.ProofVerificationFailed.selector);
        _execute(_validTransaction(), BLOCK_HEIGHT);

        assertFalse(controller.processedQueries(_expectedQueryId(BLOCK_HEIGHT)));
    }

    function testAcceptsDepositRoutedThroughConfiguredSmartAccountExecutor() external {
        bytes memory encodedTransaction = _encodedDepositTransaction(
            sourceExecutor,
            sourceVault,
            ISSUER_ID,
            DEPOSIT_ID,
            address(0xCA11DA7A),
            beneficiary,
            depositor,
            depositor,
            999,
            AMOUNT,
            1,
            1
        );

        bytes32 queryId = _execute(encodedTransaction, BLOCK_HEIGHT);

        assertTrue(controller.processedQueries(queryId));
        assertTrue(controller.verifiedDepositIds(DEPOSIT_ID));
        assertEq(controller.totalVerifiedReserve(), AMOUNT);
        assertEq(controller.verifiedBalance(beneficiary), AMOUNT);
    }

    function testRejectsFailedSourceReceipt() external {
        bytes memory encodedTransaction = _encodedDepositTransaction(
            sourceVault,
            sourceVault,
            ISSUER_ID,
            DEPOSIT_ID,
            beneficiary,
            beneficiary,
            depositor,
            depositor,
            AMOUNT,
            AMOUNT,
            0,
            1
        );

        vm.expectRevert(abi.encodeWithSelector(ProofReserveController.InvalidReceiptStatus.selector, uint8(0)));
        _execute(encodedTransaction, BLOCK_HEIGHT);
    }

    function testRejectsTransactionSentToDifferentContract() external {
        bytes memory encodedTransaction = _encodedDepositTransaction(
            address(0xBAD),
            sourceVault,
            ISSUER_ID,
            DEPOSIT_ID,
            beneficiary,
            beneficiary,
            depositor,
            depositor,
            AMOUNT,
            AMOUNT,
            1,
            1
        );

        vm.expectRevert(ProofReserveController.InvalidSourceTransaction.selector);
        _execute(encodedTransaction, BLOCK_HEIGHT);
    }

    function testRejectsSpoofedDepositEmitter() external {
        bytes memory encodedTransaction = _encodedDepositTransaction(
            sourceVault,
            address(0xBAD),
            ISSUER_ID,
            DEPOSIT_ID,
            beneficiary,
            beneficiary,
            depositor,
            depositor,
            AMOUNT,
            AMOUNT,
            1,
            1
        );

        vm.expectRevert(ProofReserveController.NoDepositLog.selector);
        _execute(encodedTransaction, BLOCK_HEIGHT);
    }

    function testRejectsWrongIssuer() external {
        bytes32 wrongIssuerId = keccak256("other-issuer");
        bytes memory encodedTransaction = _encodedDepositTransaction(
            sourceVault,
            sourceVault,
            wrongIssuerId,
            DEPOSIT_ID,
            beneficiary,
            beneficiary,
            depositor,
            depositor,
            AMOUNT,
            AMOUNT,
            1,
            1
        );

        vm.expectRevert(abi.encodeWithSelector(ProofReserveController.InvalidIssuer.selector, wrongIssuerId, ISSUER_ID));
        _execute(encodedTransaction, BLOCK_HEIGHT);
    }

    function testRejectsEventThatDoesNotMatchCalldata() external {
        bytes memory encodedTransaction = _encodedDepositTransaction(
            sourceVault,
            sourceVault,
            ISSUER_ID,
            DEPOSIT_ID,
            beneficiary,
            address(0xCAFE),
            depositor,
            depositor,
            AMOUNT,
            AMOUNT,
            1,
            1
        );

        vm.expectRevert(ProofReserveController.InvalidDepositLog.selector);
        _execute(encodedTransaction, BLOCK_HEIGHT);
    }

    function testRejectsEventDepositorThatDoesNotMatchTransactionSender() external {
        bytes memory encodedTransaction = _encodedDepositTransaction(
            sourceVault,
            sourceVault,
            ISSUER_ID,
            DEPOSIT_ID,
            beneficiary,
            beneficiary,
            depositor,
            address(0xCAFE),
            AMOUNT,
            AMOUNT,
            1,
            1
        );

        vm.expectRevert(ProofReserveController.InvalidDepositLog.selector);
        _execute(encodedTransaction, BLOCK_HEIGHT);
    }

    function testRejectsMultipleRecognizedDepositLogs() external {
        bytes memory encodedTransaction = _encodedDepositTransaction(
            sourceVault,
            sourceVault,
            ISSUER_ID,
            DEPOSIT_ID,
            beneficiary,
            beneficiary,
            depositor,
            depositor,
            AMOUNT,
            AMOUNT,
            1,
            2
        );

        vm.expectRevert(ProofReserveController.MultipleDepositLogs.selector);
        _execute(encodedTransaction, BLOCK_HEIGHT);
    }

    function testRejectsQueryReplay() external {
        bytes memory encodedTransaction = _validTransaction();
        bytes32 queryId = _execute(encodedTransaction, BLOCK_HEIGHT);

        vm.expectRevert(abi.encodeWithSelector(ProofReserveController.QueryAlreadyProcessed.selector, queryId));
        _execute(encodedTransaction, BLOCK_HEIGHT);
    }

    function testRejectsDepositIdReplayAcrossDifferentQueries() external {
        bytes memory encodedTransaction = _validTransaction();
        _execute(encodedTransaction, BLOCK_HEIGHT);

        vm.expectRevert(abi.encodeWithSelector(ProofReserveController.DepositAlreadyVerified.selector, DEPOSIT_ID));
        _execute(encodedTransaction, BLOCK_HEIGHT + 1);
    }

    function testRejectedProofDoesNotConsumeQuery() external {
        bytes memory invalidTransaction = _encodedDepositTransaction(
            sourceVault,
            address(0xBAD),
            ISSUER_ID,
            DEPOSIT_ID,
            beneficiary,
            beneficiary,
            depositor,
            depositor,
            AMOUNT,
            AMOUNT,
            1,
            1
        );
        bytes32 expectedQueryId = _expectedQueryId(BLOCK_HEIGHT);

        vm.expectRevert(ProofReserveController.NoDepositLog.selector);
        _execute(invalidTransaction, BLOCK_HEIGHT);

        assertFalse(controller.processedQueries(expectedQueryId));
        assertFalse(controller.verifiedDepositIds(DEPOSIT_ID));
    }

    function testConstructorRejectsInvalidConfiguration() external {
        vm.expectRevert(ProofReserveController.InvalidConfiguration.selector);
        new ProofReserveController(0, sourceVault, sourceExecutor, reserveAsset, ISSUER_ID);

        vm.expectRevert(ProofReserveController.InvalidConfiguration.selector);
        new ProofReserveController(SOURCE_CHAIN_KEY, address(0), sourceExecutor, reserveAsset, ISSUER_ID);

        vm.expectRevert(ProofReserveController.InvalidConfiguration.selector);
        new ProofReserveController(SOURCE_CHAIN_KEY, sourceVault, sourceExecutor, address(0), ISSUER_ID);

        vm.expectRevert(ProofReserveController.InvalidConfiguration.selector);
        new ProofReserveController(SOURCE_CHAIN_KEY, sourceVault, sourceExecutor, reserveAsset, bytes32(0));
    }

    function _validTransaction() internal view returns (bytes memory) {
        return _encodedDepositTransaction(
            sourceVault,
            sourceVault,
            ISSUER_ID,
            DEPOSIT_ID,
            beneficiary,
            beneficiary,
            depositor,
            depositor,
            AMOUNT,
            AMOUNT,
            1,
            1
        );
    }

    function _encodedDepositTransaction(
        address transactionTarget,
        address eventEmitter,
        bytes32 eventIssuerId,
        bytes32 callDepositId,
        address callBeneficiary,
        address eventBeneficiary,
        address transactionSender,
        address eventDepositor,
        uint256 callAmount,
        uint256 eventAmount,
        uint8 receiptStatus,
        uint256 matchingLogCount
    ) internal pure returns (bytes memory encodedTransaction) {
        bytes32[] memory topics = new bytes32[](4);
        topics[0] = keccak256("ReserveDeposited(bytes32,bytes32,address,address,uint256)");
        topics[1] = eventIssuerId;
        topics[2] = callDepositId;
        topics[3] = bytes32(uint256(uint160(eventBeneficiary)));

        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](matchingLogCount);
        for (uint256 i; i < matchingLogCount; ++i) {
            logs[i] = EvmV1Decoder.LogEntryTuple({
                address_: eventEmitter, topics: topics, data: abi.encode(eventDepositor, eventAmount)
            });
        }

        bytes[] memory chunks = new bytes[](3);
        chunks[0] = abi.encode(
            uint64(24),
            uint64(150_000),
            transactionSender,
            false,
            transactionTarget,
            uint256(0),
            abi.encodeWithSelector(
                bytes4(keccak256("deposit(bytes32,address,uint256)")), callDepositId, callBeneficiary, callAmount
            )
        );
        EvmV1Decoder.AccessListEntryBytes32[] memory accessList = new EvmV1Decoder.AccessListEntryBytes32[](0);
        chunks[1] = abi.encode(
            uint64(11155111), uint128(1 gwei), uint128(2 gwei), accessList, uint8(0), bytes32(0), bytes32(0)
        );
        chunks[2] = abi.encode(receiptStatus, uint64(100_000), logs, bytes(""));

        encodedTransaction = abi.encode(uint8(2), chunks);
    }

    function _execute(bytes memory encodedTransaction, uint64 blockHeight) internal returns (bytes32) {
        return _executeWithChain(encodedTransaction, SOURCE_CHAIN_KEY, blockHeight);
    }

    function _executeWithChain(bytes memory encodedTransaction, uint64 chainKey, uint64 blockHeight)
        internal
        returns (bytes32)
    {
        return controller.executeDeposit(
            chainKey,
            blockHeight,
            encodedTransaction,
            bytes32(uint256(blockHeight)),
            new INativeQueryVerifier.MerkleProofEntry[](0),
            bytes32(0),
            new bytes32[](0)
        );
    }

    function _expectedQueryId(uint64 blockHeight) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(uint256(SOURCE_CHAIN_KEY), blockHeight, uint256(7)));
    }
}
