// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { EvmV1Decoder } from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";
import { INativeQueryVerifier } from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import { IssuerController } from "../src/IssuerController.sol";
import { IssuerFactory } from "../src/IssuerFactory.sol";
import { IssuerToken } from "../src/IssuerToken.sol";

contract IssuerMockQueryVerifier {
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

contract IssuerFactoryTest is Test {
    address internal constant VERIFIER_PRECOMPILE = 0x0000000000000000000000000000000000000FD2;
    bytes32 internal constant ISSUER_ID = keccak256("issuer:alpha");
    bytes32 internal constant DEPOSIT_ID = keccak256("issuer:alpha:deposit:1");
    uint64 internal constant SOURCE_CHAIN_KEY = 1;
    uint64 internal constant BLOCK_HEIGHT = 11_667_800;
    uint256 internal constant AMOUNT = 7_500_000;

    address internal administrator = makeAddr("issuer administrator");
    address internal sourceVault = address(0xBEEF);
    address internal sourceExecutor = address(0xE7EC0702);
    address internal reserveAsset = address(0xA55E7);
    address internal depositor = makeAddr("reserve depositor");
    address internal beneficiary = makeAddr("token beneficiary");

    IssuerFactory internal factory;

    function setUp() external {
        IssuerMockQueryVerifier verifier = new IssuerMockQueryVerifier();
        vm.etch(VERIFIER_PRECOMPILE, address(verifier).code);
        factory = new IssuerFactory();
    }

    function testCreatesDeterministicIsolatedIssuerPair() external {
        IssuerFactory.IssuerParameters memory parameters = _parameters();
        address predictedController = factory.predictController(parameters, administrator);

        vm.prank(administrator);
        (address controllerAddress, address tokenAddress) = factory.createIssuer(parameters);

        assertEq(controllerAddress, predictedController);
        IssuerController controller = IssuerController(controllerAddress);
        IssuerToken token = IssuerToken(tokenAddress);
        assertEq(address(controller.token()), tokenAddress);
        assertEq(controller.administrator(), administrator);
        assertEq(controller.SOURCE_CHAIN_KEY(), SOURCE_CHAIN_KEY);
        assertEq(controller.SOURCE_VAULT(), sourceVault);
        assertEq(controller.SOURCE_EXECUTOR(), sourceExecutor);
        assertEq(controller.RESERVE_ASSET(), reserveAsset);
        assertEq(controller.ISSUER_ID(), ISSUER_ID);
        assertEq(controller.reserveDecimals(), 6);
        assertEq(token.controller(), controllerAddress);
        assertEq(token.name(), "Resyvr USD Alpha");
        assertEq(token.symbol(), "rvUSDA");
        assertEq(token.decimals(), 6);

        (
            address recordedAdministrator,
            uint64 recordedChainKey,
            address recordedVault,
            address recordedExecutor,
            address recordedReserve,
            address recordedController,
            address recordedToken,
            uint8 recordedDecimals
        ) = factory.issuers(ISSUER_ID);
        assertEq(recordedAdministrator, administrator);
        assertEq(recordedChainKey, SOURCE_CHAIN_KEY);
        assertEq(recordedVault, sourceVault);
        assertEq(recordedExecutor, sourceExecutor);
        assertEq(recordedReserve, reserveAsset);
        assertEq(recordedController, controllerAddress);
        assertEq(recordedToken, tokenAddress);
        assertEq(recordedDecimals, 6);
    }

    function testVerifiedDepositMintsExactAmountToEventBeneficiary() external {
        (IssuerController controller, IssuerToken token) = _createIssuer();

        _executeDeposit(controller, _encodedDepositTransaction(DEPOSIT_ID, beneficiary, depositor, AMOUNT));

        assertEq(controller.totalVerifiedReserve(), AMOUNT);
        assertEq(controller.verifiedBalance(beneficiary), AMOUNT);
        assertEq(token.totalSupply(), AMOUNT);
        assertEq(token.balanceOf(beneficiary), AMOUNT);
    }

    function testOnlyControllerCanMint() external {
        (, IssuerToken token) = _createIssuer();

        vm.expectRevert(IssuerToken.OnlyController.selector);
        vm.prank(administrator);
        token.mint(administrator, 1);
    }

    function testAdministratorCanPauseAndUnpauseIssuance() external {
        (IssuerController controller, IssuerToken token) = _createIssuer();
        vm.prank(administrator);
        controller.setIssuancePaused(true);

        vm.expectRevert(IssuerController.IssuanceIsPaused.selector);
        _executeDeposit(controller, _encodedDepositTransaction(DEPOSIT_ID, beneficiary, depositor, AMOUNT));

        assertFalse(controller.verifiedDepositIds(DEPOSIT_ID));
        assertEq(token.totalSupply(), 0);

        vm.prank(administrator);
        controller.setIssuancePaused(false);
        _executeDeposit(controller, _encodedDepositTransaction(DEPOSIT_ID, beneficiary, depositor, AMOUNT));
        assertEq(token.totalSupply(), AMOUNT);
    }

    function testUnauthorizedAccountCannotPauseIssuance() external {
        (IssuerController controller,) = _createIssuer();

        vm.expectRevert(IssuerController.OnlyAdministrator.selector);
        vm.prank(makeAddr("attacker"));
        controller.setIssuancePaused(true);
    }

    function testRejectsDuplicateIssuerId() external {
        IssuerFactory.IssuerParameters memory parameters = _parameters();
        vm.startPrank(administrator);
        factory.createIssuer(parameters);

        vm.expectRevert(abi.encodeWithSelector(IssuerFactory.IssuerAlreadyExists.selector, ISSUER_ID));
        factory.createIssuer(parameters);
        vm.stopPrank();
    }

    function testRejectsInvalidIssuerConfiguration() external {
        IssuerFactory.IssuerParameters memory parameters = _parameters();
        parameters.decimals = 19;

        vm.expectRevert(IssuerFactory.InvalidIssuerConfiguration.selector);
        vm.prank(administrator);
        factory.createIssuer(parameters);
    }

    function _createIssuer() internal returns (IssuerController controller, IssuerToken token) {
        vm.prank(administrator);
        (address controllerAddress, address tokenAddress) = factory.createIssuer(_parameters());
        controller = IssuerController(controllerAddress);
        token = IssuerToken(tokenAddress);
    }

    function _parameters() internal view returns (IssuerFactory.IssuerParameters memory) {
        return IssuerFactory.IssuerParameters({
            issuerId: ISSUER_ID,
            sourceChainKey: SOURCE_CHAIN_KEY,
            sourceVault: sourceVault,
            sourceExecutor: sourceExecutor,
            reserveAsset: reserveAsset,
            decimals: 6,
            tokenName: "Resyvr USD Alpha",
            tokenSymbol: "rvUSDA"
        });
    }

    function _executeDeposit(IssuerController controller, bytes memory encodedTransaction) internal {
        controller.executeDeposit(
            SOURCE_CHAIN_KEY,
            BLOCK_HEIGHT,
            encodedTransaction,
            bytes32(uint256(BLOCK_HEIGHT)),
            new INativeQueryVerifier.MerkleProofEntry[](0),
            bytes32(0),
            new bytes32[](0)
        );
    }

    function _encodedDepositTransaction(bytes32 depositId, address recipient, address from, uint256 amount)
        internal
        view
        returns (bytes memory)
    {
        bytes32[] memory topics = new bytes32[](4);
        topics[0] = keccak256("ReserveDeposited(bytes32,bytes32,address,address,uint256)");
        topics[1] = ISSUER_ID;
        topics[2] = depositId;
        topics[3] = bytes32(uint256(uint160(recipient)));

        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](1);
        logs[0] = EvmV1Decoder.LogEntryTuple({ address_: sourceVault, topics: topics, data: abi.encode(from, amount) });

        bytes[] memory chunks = new bytes[](3);
        chunks[0] = abi.encode(
            uint64(1),
            uint64(150_000),
            from,
            false,
            sourceVault,
            uint256(0),
            abi.encodeWithSelector(bytes4(keccak256("deposit(bytes32,address,uint256)")), depositId, recipient, amount)
        );
        EvmV1Decoder.AccessListEntryBytes32[] memory accessList = new EvmV1Decoder.AccessListEntryBytes32[](0);
        chunks[1] = abi.encode(
            uint64(11155111), uint128(1 gwei), uint128(2 gwei), accessList, uint8(0), bytes32(0), bytes32(0)
        );
        chunks[2] = abi.encode(uint8(1), uint64(100_000), logs, bytes(""));
        return abi.encode(uint8(2), chunks);
    }
}
