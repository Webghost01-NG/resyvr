import assert from "node:assert/strict";
import { Interface } from "ethers";

import {
  encodeApprove,
  encodeCreateIssuer,
  encodeDeposit,
  encodeExecuteDeposit,
  parseUnits,
} from "../dashboard/encoding.mjs";

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

assert.equal(parseUnits("5.125", 6), 5_125_000n);
assert.throws(() => parseUnits("0", 6), /greater than zero/);
assert.throws(() => parseUnits("1.0000001", 6), /at most 6/);

console.log("PASS dashboard ABI encoders match ethers");
