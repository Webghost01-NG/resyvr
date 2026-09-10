import assert from "node:assert/strict";
import { AbiCoder, Interface } from "ethers";

import {
  encodeApprove,
  encodeCreateIssuer,
  encodeCreateIssuerV2,
  encodeCreateVaultV2,
  encodeDeposit,
  encodeExecuteDeposit,
  encodeExecutePayout,
  encodeFactoryDeployment,
  encodePayout,
  encodeRequestRedemption,
  encodeSourceVaultDeployment,
  parseUnits,
} from "../dashboard/encoding.mjs";

const sampleBytecode = "0x60006000f3";
assert.equal(
  encodeFactoryDeployment(sampleBytecode, 1_000_000_000_000_000_000n),
  `${sampleBytecode}${AbiCoder.defaultAbiCoder().encode(["uint256"], [1_000_000_000_000_000_000n]).slice(2)}`,
  "factory initcode differs from ethers constructor encoding",
);

assert.equal(
  encodeSourceVaultDeployment(sampleBytecode, `0x${"22".repeat(20)}`, `0x${"11".repeat(32)}`),
  `${sampleBytecode}${AbiCoder.defaultAbiCoder().encode(
    ["address", "bytes32"],
    [`0x${"22".repeat(20)}`, `0x${"11".repeat(32)}`],
  ).slice(2)}`,
  "source vault initcode differs from ethers constructor encoding",
);

const issuerParameters = {
  issuerId: `0x${"11".repeat(32)}`,
  sourceChainKey: 1,
  sourceVault: `0x${"22".repeat(20)}`,
  sourceExecutor: `0x${"33".repeat(20)}`,
  reserveAsset: `0x${"44".repeat(20)}`,
  decimals: 6,
  tokenName: "Resyvr USD",
  tokenSymbol: "rvUSD",
};

const sourceFactoryV2 = new Interface([
  "function createVault(address reserveAsset,bytes32 issuerId)",
]);
assert.equal(
  encodeCreateVaultV2(issuerParameters.reserveAsset, issuerParameters.issuerId),
  sourceFactoryV2.encodeFunctionData("createVault", [issuerParameters.reserveAsset, issuerParameters.issuerId]),
  "V2 source vault factory calldata differs from ethers ABI encoding",
);

const issuerParametersV2 = {
  ...issuerParameters,
  sourcePayoutOperator: `0x${"55".repeat(20)}`,
};
const factoryV2 = new Interface([
  "function createIssuer((bytes32 issuerId,uint64 sourceChainKey,address sourceVault,address sourceExecutor,address sourcePayoutOperator,address reserveAsset,uint8 decimals,string tokenName,string tokenSymbol) parameters)",
]);
assert.equal(
  encodeCreateIssuerV2(issuerParametersV2),
  factoryV2.encodeFunctionData("createIssuer", [issuerParametersV2]),
  "V2 issuer factory calldata differs from ethers ABI encoding",
);

const redemption = new Interface([
  "function requestRedemption(uint256 amount,address recipient)",
  "function payout(bytes32 redemptionId,address recipient,uint256 amount)",
]);
assert.equal(
  encodeRequestRedemption(5_000_000n, issuerParameters.sourceExecutor),
  redemption.encodeFunctionData("requestRedemption", [5_000_000n, issuerParameters.sourceExecutor]),
);
assert.equal(
  encodePayout(issuerParameters.issuerId, issuerParameters.sourceExecutor, 5_000_000n),
  redemption.encodeFunctionData("payout", [issuerParameters.issuerId, issuerParameters.sourceExecutor, 5_000_000n]),
);

const factory = new Interface([
  "function createIssuer((bytes32 issuerId,uint64 sourceChainKey,address sourceVault,address sourceExecutor,address reserveAsset,uint8 decimals,string tokenName,string tokenSymbol) parameters)",
]);
assert.equal(
  encodeCreateIssuer(issuerParameters),
  factory.encodeFunctionData("createIssuer", [issuerParameters]),
  "factory calldata differs from ethers ABI encoding",
);

const reserve = new Interface([
  "function approve(address spender,uint256 amount)",
  "function deposit(bytes32 depositId,address beneficiary,uint256 amount)",
]);
assert.equal(encodeApprove(issuerParameters.sourceVault, 5_000_000n), reserve.encodeFunctionData("approve", [issuerParameters.sourceVault, 5_000_000n]));
assert.equal(
  encodeDeposit(issuerParameters.issuerId, issuerParameters.sourceExecutor, 5_000_000n),
  reserve.encodeFunctionData("deposit", [issuerParameters.issuerId, issuerParameters.sourceExecutor, 5_000_000n]),
);

const proof = {
  chainKey: 1,
  headerNumber: 123,
  txBytes: "0x123456",
  merkleProof: {
    root: `0x${"55".repeat(32)}`,
    siblings: [
      { hash: `0x${"66".repeat(32)}`, isLeft: true },
      { hash: `0x${"77".repeat(32)}`, isLeft: false },
    ],
  },
  continuityProof: {
    lowerEndpointDigest: `0x${"88".repeat(32)}`,
    roots: [`0x${"99".repeat(32)}`, `0x${"aa".repeat(32)}`],
  },
};
const controller = new Interface([
  "function executeDeposit(uint64 chainKey,uint64 blockHeight,bytes encodedTransaction,bytes32 merkleRoot,(bytes32 hash,bool isLeft)[] siblings,bytes32 lowerEndpointDigest,bytes32[] continuityRoots)",
]);
assert.equal(
  encodeExecuteDeposit(proof),
  controller.encodeFunctionData("executeDeposit", [
    proof.chainKey,
    proof.headerNumber,
    proof.txBytes,
    proof.merkleProof.root,
    proof.merkleProof.siblings,
    proof.continuityProof.lowerEndpointDigest,
    proof.continuityProof.roots,
  ]),
  "proof calldata differs from ethers ABI encoding",
);

const payoutController = new Interface([
  "function executePayout(uint64 chainKey,uint64 blockHeight,bytes encodedTransaction,bytes32 merkleRoot,(bytes32 hash,bool isLeft)[] siblings,bytes32 lowerEndpointDigest,bytes32[] continuityRoots)",
]);
assert.equal(
  encodeExecutePayout(proof),
  payoutController.encodeFunctionData("executePayout", [
    proof.chainKey,
    proof.headerNumber,
    proof.txBytes,
    proof.merkleProof.root,
    proof.merkleProof.siblings,
    proof.continuityProof.lowerEndpointDigest,
    proof.continuityProof.roots,
  ]),
  "payout proof calldata differs from ethers ABI encoding",
);

assert.equal(parseUnits("5.125", 6), 5_125_000n);
assert.throws(() => parseUnits("0", 6), /greater than zero/);
assert.throws(() => parseUnits("1.0000001", 6), /at most 6/);

console.log("PASS dashboard ABI encoders match ethers");
