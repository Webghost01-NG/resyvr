// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { EvmV1Decoder } from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";
import { INativeQueryVerifier } from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import { CTCBondVaultV2 } from "./CTCBondVaultV2.sol";
import { IssuerTokenV2 } from "./IssuerTokenV2.sol";
import { ProofReserveController } from "./ProofReserveController.sol";

/// @title IssuerControllerV2
/// @notice Adds proof-finalized redemption to proof-bounded issuance.
contract IssuerControllerV2 is ProofReserveController {
    error EscrowTransferFailed();
    error InvalidAdministrator();
    error InvalidPayoutCalldata();
    error InvalidPayoutLog();
    error InvalidPayoutOperator(address actual, address expected);
    error InvalidPayoutTransaction();
    error IssuanceIsInactive();
    error IssuanceIsPaused();
    error MultiplePayoutLogs();
    error NoPayoutLog();
    error OnlyAdministrator();
    error RedemptionAlreadyFinalized(bytes32 redemptionId);
    error RedemptionIsPaused();
    error RedemptionNotPending(bytes32 redemptionId);
    error RedemptionTermsMismatch(bytes32 redemptionId);
    error RedeemedReserveExceedsVerifiedReserve(uint256 verifiedReserve, uint256 redeemedReserve);

    bytes32 public constant PAYOUT_EVENT_SIGNATURE =
        keccak256("ReservePaidOut(bytes32,bytes32,address,address,uint256)");
    bytes4 public constant PAYOUT_SELECTOR = bytes4(keccak256("payout(bytes32,address,uint256)"));

    enum RedemptionStatus {
        None,
        Pending,
        Completed
    }

    struct RedemptionRequest {
        address holder;
        address recipient;
        uint256 amount;
        RedemptionStatus status;
    }

    struct PayoutRecord {
        bytes32 redemptionId;
        address recipient;
        address operator;
        uint256 amount;
    }

    address public immutable administrator;
    address public immutable SOURCE_PAYOUT_OPERATOR;
    CTCBondVaultV2 public immutable bondVault;
    IssuerTokenV2 public immutable token;
    uint8 public immutable reserveDecimals;

    bool public issuancePaused;
    bool public redemptionPaused;
    uint256 public redemptionNonce;
    uint256 public totalPendingRedemption;
    uint256 public totalRedeemed;
    mapping(bytes32 redemptionId => RedemptionRequest request) public redemptions;
    mapping(bytes32 redemptionId => bool verified) public verifiedPayoutIds;

    event IssuancePauseChanged(bool paused, address indexed administrator);
    event RedemptionPauseChanged(bool paused, address indexed administrator);
    event RedemptionRequested(
        bytes32 indexed redemptionId, address indexed holder, address indexed recipient, uint256 amount
    );
    event RedemptionFinalized(
        bytes32 indexed queryId,
        bytes32 indexed redemptionId,
        address indexed holder,
        address recipient,
        uint256 amount,
        uint64 sourceBlockHeight
    );

    constructor(
        uint64 sourceChainKey,
        address sourceVault,
        address sourceExecutor,
        address sourcePayoutOperator,
        address reserveAsset,
        bytes32 issuerId,
        address administrator_,
        string memory tokenName,
        string memory tokenSymbol,
        uint8 decimals_,
        uint256 minimumBond
    ) ProofReserveController(sourceChainKey, sourceVault, sourceExecutor, reserveAsset, issuerId) {
        if (administrator_ == address(0) || sourcePayoutOperator == address(0)) revert InvalidAdministrator();
        administrator = administrator_;
        SOURCE_PAYOUT_OPERATOR = sourcePayoutOperator;
        reserveDecimals = decimals_;
        token = new IssuerTokenV2(tokenName, tokenSymbol, decimals_);
        bondVault = new CTCBondVaultV2(administrator_, minimumBond);
    }

    function setIssuancePaused(bool paused) external {
        if (msg.sender != administrator) revert OnlyAdministrator();
        issuancePaused = paused;
        emit IssuancePauseChanged(paused, msg.sender);
    }

    /// @notice Pauses new requests only; existing payout proofs remain finalizable.
    function setRedemptionPaused(bool paused) external {
        if (msg.sender != administrator) revert OnlyAdministrator();
        redemptionPaused = paused;
        emit RedemptionPauseChanged(paused, msg.sender);
    }

    /// @notice Escrows holder tokens and creates the ID the Sepolia payout must reference.
    function requestRedemption(uint256 amount, address recipient) external returns (bytes32 redemptionId) {
        if (redemptionPaused) revert RedemptionIsPaused();
        if (amount == 0) revert InvalidAmount();
        if (recipient == address(0)) revert InvalidBeneficiary();

        uint256 nonce = ++redemptionNonce;
        redemptionId = keccak256(abi.encode(address(this), block.chainid, nonce, msg.sender, recipient, amount));
        redemptions[redemptionId] = RedemptionRequest({
            holder: msg.sender, recipient: recipient, amount: amount, status: RedemptionStatus.Pending
        });
        totalPendingRedemption += amount;

        if (!token.transferFrom(msg.sender, address(this), amount)) revert EscrowTransferFailed();
        emit RedemptionRequested(redemptionId, msg.sender, recipient, amount);
    }

    /// @notice Verifies a Sepolia vault payout, consumes it once, and burns the escrowed tokens.
    function executePayout(
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
        queryId = _computePayoutQueryId(chainKey, blockHeight, transactionIndex);
        if (processedQueries[queryId]) revert QueryAlreadyProcessed(queryId);

        INativeQueryVerifier.ContinuityProof memory continuityProof =
            INativeQueryVerifier.ContinuityProof({ lowerEndpointDigest: lowerEndpointDigest, roots: continuityRoots });
        bool verified = VERIFIER.verifyAndEmit(chainKey, blockHeight, encodedTransaction, merkleProof, continuityProof);
        if (!verified) revert ProofVerificationFailed();

        PayoutRecord memory payout = _decodeAndValidatePayout(encodedTransaction);
        RedemptionRequest storage request = redemptions[payout.redemptionId];
        if (request.status == RedemptionStatus.Completed) revert RedemptionAlreadyFinalized(payout.redemptionId);
        if (request.status != RedemptionStatus.Pending) revert RedemptionNotPending(payout.redemptionId);
        if (request.recipient != payout.recipient || request.amount != payout.amount) {
            revert RedemptionTermsMismatch(payout.redemptionId);
        }

        uint256 redeemedAfter = totalRedeemed + payout.amount;
        if (redeemedAfter > totalVerifiedReserve) {
            revert RedeemedReserveExceedsVerifiedReserve(totalVerifiedReserve, redeemedAfter);
        }

        processedQueries[queryId] = true;
        verifiedPayoutIds[payout.redemptionId] = true;
        request.status = RedemptionStatus.Completed;
        totalPendingRedemption -= payout.amount;
        totalRedeemed = redeemedAfter;
        token.burnEscrowed(payout.amount);

        emit RedemptionFinalized(
            queryId, payout.redemptionId, request.holder, payout.recipient, payout.amount, blockHeight
        );
    }

    function netVerifiedReserve() external view returns (uint256) {
        return totalVerifiedReserve - totalRedeemed;
    }

    /// @notice A V2 bond remains locked until every issued token has been redeemed.
    function canReleaseBond() external view returns (bool) {
        return token.totalSupply() == 0 && totalPendingRedemption == 0;
    }

    function _afterDepositVerified(DepositRecord memory depositRecord) internal override {
        if (issuancePaused) revert IssuanceIsPaused();
        if (!bondVault.active()) revert IssuanceIsInactive();
        token.mint(depositRecord.beneficiary, depositRecord.amount);
    }

    function _decodeAndValidatePayout(bytes memory encodedTransaction)
        internal
        view
        returns (PayoutRecord memory payout)
    {
        uint8 transactionType = EvmV1Decoder.getTransactionType(encodedTransaction);
        if (!EvmV1Decoder.isValidTransactionType(transactionType)) {
            revert InvalidTransactionType(transactionType);
        }

        EvmV1Decoder.CommonTxFields memory transaction = EvmV1Decoder.decodeCommonTxFields(encodedTransaction);
        if (
            transaction.toIsNull || transaction.to != SOURCE_VAULT || transaction.from != SOURCE_PAYOUT_OPERATOR
                || transaction.value != 0
        ) revert InvalidPayoutTransaction();

        (bytes32 callRedemptionId, address callRecipient, uint256 callAmount) = _decodePayoutCalldata(transaction.data);
        EvmV1Decoder.ReceiptFields memory receipt = EvmV1Decoder.decodeReceiptFields(encodedTransaction);
        if (receipt.receiptStatus != 1) revert InvalidReceiptStatus(receipt.receiptStatus);

        bool found;
        for (uint256 i; i < receipt.receiptLogs.length; ++i) {
            EvmV1Decoder.LogEntry memory logEntry = receipt.receiptLogs[i];
            if (
                logEntry.address_ != SOURCE_VAULT || logEntry.topics.length == 0
                    || logEntry.topics[0] != PAYOUT_EVENT_SIGNATURE
            ) continue;
            if (found) revert MultiplePayoutLogs();
            found = true;
            payout = _decodePayoutLog(logEntry);
        }
        if (!found) revert NoPayoutLog();
        if (payout.redemptionId != callRedemptionId || payout.recipient != callRecipient || payout.amount != callAmount)
        {
            revert InvalidPayoutLog();
        }
        if (payout.operator != transaction.from) revert InvalidPayoutLog();
    }

    function _decodePayoutCalldata(bytes memory data)
        internal
        pure
        returns (bytes32 redemptionId, address recipient, uint256 amount)
    {
        if (data.length != 100) revert InvalidPayoutCalldata();
        bytes4 selector;
        assembly {
            selector := mload(add(data, 32))
            redemptionId := mload(add(data, 36))
            recipient := mload(add(data, 68))
            amount := mload(add(data, 100))
        }
        if (selector != PAYOUT_SELECTOR) revert InvalidPayoutCalldata();
    }

    function _decodePayoutLog(EvmV1Decoder.LogEntry memory logEntry)
        internal
        view
        returns (PayoutRecord memory payout)
    {
        if (logEntry.topics.length != 4 || logEntry.data.length != 64) {
            revert InvalidPayoutLog();
        }
        bytes32 eventIssuerId = logEntry.topics[1];
        if (eventIssuerId != ISSUER_ID) revert InvalidIssuer(eventIssuerId, ISSUER_ID);

        payout.redemptionId = logEntry.topics[2];
        payout.recipient = address(uint160(uint256(logEntry.topics[3])));
        (payout.operator, payout.amount) = abi.decode(logEntry.data, (address, uint256));
        if (payout.operator != SOURCE_PAYOUT_OPERATOR) {
            revert InvalidPayoutOperator(payout.operator, SOURCE_PAYOUT_OPERATOR);
        }
    }

    function _computePayoutQueryId(uint64 chainKey, uint64 blockHeight, uint64 transactionIndex)
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
