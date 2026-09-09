import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { proofProvider } from '@gluwa/usc-sdk';
import { Interface, JsonRpcProvider, getAddress } from 'ethers';

import pilotConfig from '../config/pilot.json';
import { loadConfig } from '../src/config.js';

const depositInterface = new Interface([
  'event ReserveDeposited(bytes32 indexed issuerId, bytes32 indexed depositId, address indexed beneficiary, address depositor, uint256 amount)',
]);
const controllerInterface = new Interface([
  'function executeDeposit(uint64 chainKey,uint64 blockHeight,bytes encodedTransaction,bytes32 merkleRoot,(bytes32 hash,bool isLeft)[] siblings,bytes32 lowerEndpointDigest,bytes32[] continuityRoots) returns (bytes32 queryId)',
]);

function normalizeHash(value: string, label: string): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${label} must be a 32-byte hex value`);
  return value.toLowerCase();
}

function requireEqual(actual: string, expected: string, label: string): void {
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`${label} mismatch: received ${actual}, expected ${expected}`);
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const transactionHash = normalizeHash(process.argv[2] ?? pilotConfig.depositTransactionHash, 'transaction hash');
  const sourceProvider = new JsonRpcProvider(config.source.rpcUrl, config.source.chainId, { staticNetwork: true });
  const receipt = await sourceProvider.getTransactionReceipt(transactionHash);
  const transaction = await sourceProvider.getTransaction(transactionHash);
  if (!receipt || !transaction) throw new Error(`Sepolia transaction ${transactionHash} was not found`);
  if (receipt.status !== 1) throw new Error('source transaction did not succeed');
  if (transaction.value !== 0n) throw new Error('source transaction transferred native value');

  const allowedTargets = [pilotConfig.sourceVault, pilotConfig.sourceExecutor].map((value) => getAddress(value));
  const transactionTarget = transaction.to ? getAddress(transaction.to) : undefined;
  if (!transactionTarget || !allowedTargets.includes(transactionTarget)) {
    throw new Error(`source transaction target ${transaction.to ?? 'contract creation'} is not configured`);
  }

  const depositLogs = receipt.logs.filter(
    (log) =>
      log.address.toLowerCase() === pilotConfig.sourceVault.toLowerCase() &&
      log.topics[0]?.toLowerCase() === depositInterface.getEvent('ReserveDeposited')!.topicHash.toLowerCase(),
  );
  if (depositLogs.length !== 1) throw new Error(`expected one reserve deposit log, received ${depositLogs.length}`);
  const parsed = depositInterface.parseLog(depositLogs[0]);
  if (!parsed) throw new Error('reserve deposit log could not be decoded');

  requireEqual(parsed.args.issuerId, pilotConfig.issuerId, 'issuer ID');
  requireEqual(parsed.args.depositId, pilotConfig.depositId, 'deposit ID');
  requireEqual(parsed.args.beneficiary, pilotConfig.beneficiary, 'beneficiary');
  requireEqual(parsed.args.depositor, pilotConfig.depositor, 'depositor');
  requireEqual(transaction.from, pilotConfig.depositor, 'transaction sender');
  if (parsed.args.amount !== BigInt(pilotConfig.amount)) throw new Error('deposit amount mismatch');
  if (receipt.blockNumber !== pilotConfig.depositBlockNumber) throw new Error('deposit block mismatch');

  const builder = new proofProvider.service.ProofBuilder(config.source.chainKey, config.destination.proofBuilderUrl, 30_000);
  process.stdout.write(
    `Waiting for Attestcoin proof availability at Sepolia block ${receipt.blockNumber} (up to 20 minutes)...\n`,
  );
  await builder.waitUntilHeightAttested(config.source.chainKey, receipt.blockNumber, 15_000, 1_200_000, 5_000);
  const result = await builder.getProof(transactionHash);
  if (!result.success || !result.data) throw new Error(result.error ?? 'proof builder returned no proof');

  const proof = result.data;
  const calldata = controllerInterface.encodeFunctionData('executeDeposit', [
    proof.chainKey,
    proof.headerNumber,
    proof.txBytes,
    proof.merkleProof.root,
    proof.merkleProof.siblings,
    proof.continuityProof.lowerEndpointDigest,
    proof.continuityProof.roots,
  ]);
  const artifact = {
    generatedAt: new Date().toISOString(),
    source: {
      transactionHash,
      blockNumber: receipt.blockNumber,
      transactionIndex: receipt.index,
      transactionTarget,
      vault: getAddress(pilotConfig.sourceVault),
      executor: getAddress(pilotConfig.sourceExecutor),
      issuerId: pilotConfig.issuerId,
      depositId: pilotConfig.depositId,
      depositor: getAddress(parsed.args.depositor),
      beneficiary: getAddress(parsed.args.beneficiary),
      amount: parsed.args.amount.toString(),
    },
    proof: {
      chainKey: proof.chainKey,
      headerNumber: proof.headerNumber,
      txIndex: proof.txIndex,
      txHash: proof.txHash,
      txBytes: proof.txBytes,
      merkleProof: proof.merkleProof,
      continuityProof: proof.continuityProof,
      cached: proof.cached,
    },
    controllerCalldata: calldata,
  };

  const outputDirectory = path.join(process.cwd(), 'artifacts', 'proofs');
  const outputPath = path.join(outputDirectory, `${transactionHash}.json`);
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  process.stdout.write(
    `Proof ready: ${outputPath}\nTransaction bytes: ${(proof.txBytes.length - 2) / 2}\nMerkle siblings: ${proof.merkleProof.siblings.length}\nContinuity roots: ${proof.continuityProof.roots.length}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
