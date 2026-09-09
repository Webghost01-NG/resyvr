// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { StdInvariant } from "forge-std/StdInvariant.sol";
import { Test } from "forge-std/Test.sol";
import { EvmV1Decoder } from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";
import { INativeQueryVerifier } from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import { CTCBondVault } from "../src/CTCBondVault.sol";
import { IssuerController } from "../src/IssuerController.sol";
import { IssuerFactory } from "../src/IssuerFactory.sol";
import { IssuerToken } from "../src/IssuerToken.sol";
import { ProofReserveController } from "../src/ProofReserveController.sol";

contract InvariantMockQueryVerifier {
    function calculateTxIndex(INativeQueryVerifier.MerkleProof calldata) external pure returns (uint64) {
        return 2;
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

contract IssuerInvariantHandler is Test {
    bytes32 internal constant DEPOSIT_EVENT_SIGNATURE =
        keccak256("ReserveDeposited(bytes32,bytes32,address,address,uint256)");
    uint64 internal constant SOURCE_CHAIN_KEY = 1;
    uint64 internal constant START_BLOCK_HEIGHT = 11_667_800;

    IssuerController public immutable controller;
    IssuerToken public immutable token;
    CTCBondVault public immutable bondVault;
    bytes32 public immutable issuerId;
    address public immutable sourceVault;
    address public immutable depositor;

    uint64 public nonce;
    uint256 public ghostVerifiedAmount;
    bool public replaySucceeded;
    bool public unauthorizedMutationSucceeded;

    bytes internal latestTransaction;
    uint64 internal latestBlockHeight;

    constructor(IssuerController controller_, address sourceVault_, address depositor_) {
        controller = controller_;
        token = controller_.token();
        bondVault = controller_.bondVault();
        issuerId = controller_.ISSUER_ID();
        sourceVault = sourceVault_;
        depositor = depositor_;
    }

    function submitDeposit(uint128 amountSeed, address beneficiary) external {
        uint256 amount = uint256(amountSeed) + 1;
        if (beneficiary == address(0)) beneficiary = address(1);

        nonce++;
        bytes32 depositId = keccak256(abi.encode("invariant deposit", nonce));
        uint64 blockHeight = START_BLOCK_HEIGHT + nonce;
        bytes memory encodedTransaction = _encodedDepositTransaction(depositId, beneficiary, amount);

        _executeDeposit(blockHeight, encodedTransaction);
        ghostVerifiedAmount += amount;
        latestTransaction = encodedTransaction;
        latestBlockHeight = blockHeight;
    }

    function attemptLatestReplay() external {
        if (latestTransaction.length == 0) return;
        (bool success,) = address(controller).call(_executeDepositCalldata(latestBlockHeight, latestTransaction));
        replaySucceeded = replaySucceeded || success;
    }

    function attemptUnauthorizedMutations(uint128 amountSeed, bool paused) external {
        uint256 amount = uint256(amountSeed) + 1;
        (bool mintSucceeded,) = address(token).call(abi.encodeCall(IssuerToken.mint, (address(this), amount)));
        (bool pauseSucceeded,) = address(controller).call(abi.encodeCall(IssuerController.setIssuancePaused, (paused)));
        (bool roleChangeSucceeded,) =
            address(controller).call(abi.encodeWithSignature("setAdministrator(address)", address(this)));
        (bool deactivateSucceeded,) = address(bondVault).call(abi.encodeCall(CTCBondVault.deactivateIssuance, ()));
        (bool withdrawalSucceeded,) =
            address(bondVault).call(abi.encodeCall(CTCBondVault.withdrawBond, (amount, payable(address(this)))));

        unauthorizedMutationSucceeded = unauthorizedMutationSucceeded || mintSucceeded || pauseSucceeded
            || roleChangeSucceeded || deactivateSucceeded || withdrawalSucceeded;
    }

    function _executeDeposit(uint64 blockHeight, bytes memory encodedTransaction) internal {
        (bool success, bytes memory returnData) =
            address(controller).call(_executeDepositCalldata(blockHeight, encodedTransaction));
        if (!success) {
            assembly ("memory-safe") {
                revert(add(returnData, 0x20), mload(returnData))
            }
        }
    }

    function _executeDepositCalldata(uint64 blockHeight, bytes memory encodedTransaction)
        internal
        view
        returns (bytes memory)
    {
        return abi.encodeCall(
            ProofReserveController.executeDeposit,
            (
                SOURCE_CHAIN_KEY,
                blockHeight,
                encodedTransaction,
                bytes32(uint256(blockHeight)),
                new INativeQueryVerifier.MerkleProofEntry[](0),
                bytes32(0),
                new bytes32[](0)
            )
        );
    }

    function _encodedDepositTransaction(bytes32 depositId, address beneficiary, uint256 amount)
        internal
        view
        returns (bytes memory)
    {
        bytes32[] memory topics = new bytes32[](4);
        topics[0] = DEPOSIT_EVENT_SIGNATURE;
        topics[1] = issuerId;
        topics[2] = depositId;
        topics[3] = bytes32(uint256(uint160(beneficiary)));

        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](1);
        logs[0] =
            EvmV1Decoder.LogEntryTuple({ address_: sourceVault, topics: topics, data: abi.encode(depositor, amount) });

        bytes[] memory chunks = new bytes[](3);
        chunks[0] = abi.encode(
            uint64(1),
            uint64(150_000),
            depositor,
            false,
            sourceVault,
            uint256(0),
            abi.encodeWithSelector(
                bytes4(keccak256("deposit(bytes32,address,uint256)")), depositId, beneficiary, amount
            )
        );
        EvmV1Decoder.AccessListEntryBytes32[] memory accessList = new EvmV1Decoder.AccessListEntryBytes32[](0);
        chunks[1] = abi.encode(
            uint64(11155111), uint128(1 gwei), uint128(2 gwei), accessList, uint8(0), bytes32(0), bytes32(0)
        );
        chunks[2] = abi.encode(uint8(1), uint64(100_000), logs, bytes(""));
        return abi.encode(uint8(2), chunks);
    }
}

contract IssuerInvariantTest is StdInvariant, Test {
    address internal constant VERIFIER_PRECOMPILE = 0x0000000000000000000000000000000000000FD2;
    bytes32 internal constant ISSUER_ID = keccak256("issuer:invariant");
    uint256 internal constant MINIMUM_BOND = 100 ether;

    address internal administrator = makeAddr("invariant administrator");
    address internal sourceVault = address(0xBEEF);
    address internal sourceExecutor = address(0xE7EC0702);
    address internal reserveAsset = address(0xA55E7);
    address internal depositor = makeAddr("invariant reserve depositor");

    IssuerController internal controller;
    IssuerToken internal token;
    CTCBondVault internal bondVault;
    IssuerInvariantHandler internal handler;

    function setUp() external {
        InvariantMockQueryVerifier verifier = new InvariantMockQueryVerifier();
        vm.etch(VERIFIER_PRECOMPILE, address(verifier).code);

        IssuerFactory factory = new IssuerFactory(MINIMUM_BOND);
        IssuerFactory.IssuerParameters memory parameters = IssuerFactory.IssuerParameters({
            issuerId: ISSUER_ID,
            sourceChainKey: 1,
            sourceVault: sourceVault,
            sourceExecutor: sourceExecutor,
            reserveAsset: reserveAsset,
            decimals: 6,
            tokenName: "Invariant Reserve",
            tokenSymbol: "rvINV"
        });
        vm.prank(administrator);
        (address controllerAddress, address tokenAddress) = factory.createIssuer(parameters);
        controller = IssuerController(controllerAddress);
        token = IssuerToken(tokenAddress);
        bondVault = controller.bondVault();

        vm.deal(administrator, MINIMUM_BOND);
        vm.startPrank(administrator);
        bondVault.depositBond{ value: MINIMUM_BOND }();
        bondVault.activateIssuance();
        vm.stopPrank();

        handler = new IssuerInvariantHandler(controller, sourceVault, depositor);
        targetContract(address(handler));
    }

    function invariantSupplyEqualsVerifiedReserve() external view {
        assertEq(token.totalSupply(), controller.totalVerifiedReserve());
        assertEq(token.totalSupply(), handler.ghostVerifiedAmount());
    }

    function invariantReplayAndUnauthorizedCallsNeverSucceed() external view {
        assertFalse(handler.replaySucceeded());
        assertFalse(handler.unauthorizedMutationSucceeded());
    }

    function invariantIssuerBindingsAndBondRemainIntact() external view {
        assertEq(token.controller(), address(controller));
        assertEq(controller.administrator(), administrator);
        assertEq(address(bondVault).balance, MINIMUM_BOND);
        assertEq(bondVault.minimumBond(), MINIMUM_BOND);
        assertTrue(bondVault.active());
        assertFalse(controller.issuancePaused());
    }
}
