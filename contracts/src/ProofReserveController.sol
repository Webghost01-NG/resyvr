// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { EvmV1Decoder } from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";
import {
    INativeQueryVerifier,
    NativeQueryVerifierLib
} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";

/// @title ProofReserveController
/// @notice Verifies one source-vault deposit proof and records exact reserve credit on Creditcoin.
/// @dev This Phase 1 controller records proof-bounded state. Token minting is introduced only after
///      this real proof path passes. Source-chain configuration is immutable and checked before the
///      native verifier is called.
contract ProofReserveController {
    error DepositAlreadyVerified(bytes32 depositId);
    error InvalidAmount();
    error InvalidBeneficiary();
    error InvalidChainKey(uint64 actual, uint64 expected);
    error InvalidConfiguration();
    error InvalidDepositCalldata();
    error InvalidDepositLog();
    error InvalidIssuer(bytes32 actual, bytes32 expected);
    error InvalidReceiptStatus(uint8 status);
    error InvalidSourceTransaction();
    error InvalidTransactionType(uint8 transactionType);
    error MultipleDepositLogs();
    error NoDepositLog();
    error ProofVerificationFailed();
    error QueryAlreadyProcessed(bytes32 queryId);

    bytes32 public constant DEPOSIT_EVENT_SIGNATURE =
        keccak256("ReserveDeposited(bytes32,bytes32,address,address,uint256)");
    bytes4 public constant DEPOSIT_SELECTOR = bytes4(keccak256("deposit(bytes32,address,uint256)"));

    INativeQueryVerifier public immutable VERIFIER;
    uint64 public immutable SOURCE_CHAIN_KEY;
    address public immutable SOURCE_VAULT;
    address public immutable SOURCE_EXECUTOR;
    address public immutable RESERVE_ASSET;
    bytes32 public immutable ISSUER_ID;

    uint256 public totalVerifiedReserve;
    mapping(address beneficiary => uint256 amount) public verifiedBalance;
    mapping(bytes32 depositId => bool verified) public verifiedDepositIds;
    mapping(bytes32 queryId => bool processed) public processedQueries;

    event ReserveDepositVerified(
        bytes32 indexed queryId,
        bytes32 indexed depositId,
        address indexed beneficiary,
        address depositor,
        uint256 amount,
        uint64 sourceBlockHeight
    );

    struct DepositRecord {
        bytes32 depositId;
        address beneficiary;
        address depositor;
        uint256 amount;
    }

    constructor(
        uint64 sourceChainKey,
        address sourceVault,
        address sourceExecutor,
        address reserveAsset,
        bytes32 issuerId
    ) {
        if (sourceChainKey == 0 || sourceVault == address(0) || reserveAsset == address(0) || issuerId == bytes32(0)) {
            revert InvalidConfiguration();
        }

        VERIFIER = NativeQueryVerifierLib.getVerifier();
        SOURCE_CHAIN_KEY = sourceChainKey;
        SOURCE_VAULT = sourceVault;
        SOURCE_EXECUTOR = sourceExecutor;
        RESERVE_ASSET = reserveAsset;
        ISSUER_ID = issuerId;
    }

    /// @notice Verify and consume one Attestcoin proof for a direct or configured routed deposit.
    function executeDeposit(
        uint64 chainKey,
        uint64 blockHeight,
        bytes calldata encodedTransaction,
        bytes32 merkleRoot,
        INativeQueryVerifier.MerkleProofEntry[] calldata siblings,
        bytes32 lowerEndpointDigest,
        bytes32[] calldata continuityRoots
    ) external returns (bytes32 queryId) {
        if (chainKey != SOURCE_CHAIN_KEY) {
            revert InvalidChainKey(chainKey, SOURCE_CHAIN_KEY);
        }

        INativeQueryVerifier.MerkleProof memory merkleProof =
            INativeQueryVerifier.MerkleProof({ root: merkleRoot, siblings: siblings });
        uint64 transactionIndex = VERIFIER.calculateTxIndex(merkleProof);
        queryId = _computeQueryId(chainKey, blockHeight, transactionIndex);
        if (processedQueries[queryId]) revert QueryAlreadyProcessed(queryId);

        INativeQueryVerifier.ContinuityProof memory continuityProof =
            INativeQueryVerifier.ContinuityProof({ lowerEndpointDigest: lowerEndpointDigest, roots: continuityRoots });
        bool verified = VERIFIER.verifyAndEmit(chainKey, blockHeight, encodedTransaction, merkleProof, continuityProof);
        if (!verified) revert ProofVerificationFailed();

        DepositRecord memory depositRecord = _decodeAndValidateDeposit(encodedTransaction);
        if (verifiedDepositIds[depositRecord.depositId]) {
            revert DepositAlreadyVerified(depositRecord.depositId);
        }

        processedQueries[queryId] = true;
        verifiedDepositIds[depositRecord.depositId] = true;
        totalVerifiedReserve += depositRecord.amount;
        verifiedBalance[depositRecord.beneficiary] += depositRecord.amount;
        _afterDepositVerified(depositRecord);

        emit ReserveDepositVerified(
            queryId,
            depositRecord.depositId,
            depositRecord.beneficiary,
            depositRecord.depositor,
            depositRecord.amount,
            blockHeight
        );
    }

    function _afterDepositVerified(DepositRecord memory) internal virtual { }

    function _decodeAndValidateDeposit(bytes memory encodedTransaction)
        internal
        view
        returns (DepositRecord memory depositRecord)
    {
        uint8 transactionType = EvmV1Decoder.getTransactionType(encodedTransaction);
        if (!EvmV1Decoder.isValidTransactionType(transactionType)) {
            revert InvalidTransactionType(transactionType);
        }

        EvmV1Decoder.CommonTxFields memory transaction = EvmV1Decoder.decodeCommonTxFields(encodedTransaction);
        bool directDeposit = !transaction.toIsNull && transaction.to == SOURCE_VAULT;
        bool routedDeposit = !transaction.toIsNull && SOURCE_EXECUTOR != address(0) && transaction.to == SOURCE_EXECUTOR;
        if ((!directDeposit && !routedDeposit) || transaction.value != 0) {
            revert InvalidSourceTransaction();
        }

        bytes32 callDepositId;
        address callBeneficiary;
        uint256 callAmount;
        if (directDeposit) {
            (callDepositId, callBeneficiary, callAmount) = _decodeDepositCalldata(transaction.data);
        }

        EvmV1Decoder.ReceiptFields memory receipt = EvmV1Decoder.decodeReceiptFields(encodedTransaction);
        if (receipt.receiptStatus != 1) revert InvalidReceiptStatus(receipt.receiptStatus);

        bool found;
        uint256 logCount = receipt.receiptLogs.length;
        for (uint256 i; i < logCount; ++i) {
            EvmV1Decoder.LogEntry memory logEntry = receipt.receiptLogs[i];
            if (
                logEntry.address_ != SOURCE_VAULT || logEntry.topics.length == 0
                    || logEntry.topics[0] != DEPOSIT_EVENT_SIGNATURE
            ) continue;
            if (found) revert MultipleDepositLogs();
            found = true;
            depositRecord = _decodeDepositLog(logEntry);
        }
        if (!found) revert NoDepositLog();

        if (depositRecord.depositor != transaction.from) revert InvalidDepositLog();
        if (
            directDeposit
                && (depositRecord.depositId != callDepositId
                    || depositRecord.beneficiary != callBeneficiary
                    || depositRecord.amount != callAmount)
        ) revert InvalidDepositLog();
        if (depositRecord.beneficiary == address(0)) revert InvalidBeneficiary();
        if (depositRecord.amount == 0) revert InvalidAmount();
    }

    function _decodeDepositCalldata(bytes memory data)
        internal
        pure
        returns (bytes32 depositId, address beneficiary, uint256 amount)
    {
        if (data.length != 100) revert InvalidDepositCalldata();

        bytes4 selector;
        assembly {
            selector := mload(add(data, 32))
            depositId := mload(add(data, 36))
            beneficiary := mload(add(data, 68))
            amount := mload(add(data, 100))
        }
        if (selector != DEPOSIT_SELECTOR) revert InvalidDepositCalldata();
    }

    function _decodeDepositLog(EvmV1Decoder.LogEntry memory logEntry)
        internal
        view
        returns (DepositRecord memory depositRecord)
    {
        if (logEntry.topics.length != 4 || logEntry.data.length != 64) revert InvalidDepositLog();

        bytes32 eventIssuerId = logEntry.topics[1];
        if (eventIssuerId != ISSUER_ID) revert InvalidIssuer(eventIssuerId, ISSUER_ID);

        depositRecord.depositId = logEntry.topics[2];
        depositRecord.beneficiary = address(uint160(uint256(logEntry.topics[3])));
        (depositRecord.depositor, depositRecord.amount) = abi.decode(logEntry.data, (address, uint256));
    }

    function _computeQueryId(uint64 chainKey, uint64 blockHeight, uint64 transactionIndex)
        internal
        pure
        returns (bytes32 queryId)
    {
        assembly {
            let ptr := mload(0x40)
            mstore(ptr, chainKey)
            mstore(add(ptr, 32), shl(192, blockHeight))
            mstore(add(ptr, 40), transactionIndex)
            queryId := keccak256(ptr, 72)
        }
    }
}
