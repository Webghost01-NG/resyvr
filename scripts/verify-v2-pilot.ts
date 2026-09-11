import { Contract, Interface, JsonRpcProvider, getAddress } from "ethers";

import networks from "../config/networks.json";
import pilot from "../config/v2-pilot.json";

type Check = { name: string; detail: string };
type TxEvidence = { transactionHash: string; blockNumber: number; gasUsed: string; queryId?: string };

const sourceFactoryAbi = [
  "function predictVault(address reserveAsset,bytes32 issuerId,address administrator) view returns(address)",
];
const vaultAbi = [
  "function reserveAsset() view returns(address)",
  "function issuerId() view returns(bytes32)",
  "function administrator() view returns(address)",
  "function totalDeposited() view returns(uint256)",
  "function totalPaidOut() view returns(uint256)",
  "function recognizedReserve() view returns(uint256)",
  "function reserveBalance() view returns(uint256)",
];
const controllerAbi = [
  "function SOURCE_CHAIN_KEY() view returns(uint64)",
  "function SOURCE_VAULT() view returns(address)",
  "function SOURCE_EXECUTOR() view returns(address)",
  "function SOURCE_PAYOUT_OPERATOR() view returns(address)",
  "function RESERVE_ASSET() view returns(address)",
  "function ISSUER_ID() view returns(bytes32)",
  "function administrator() view returns(address)",
  "function token() view returns(address)",
  "function bondVault() view returns(address)",
  "function totalVerifiedReserve() view returns(uint256)",
  "function totalRedeemed() view returns(uint256)",
  "function totalPendingRedemption() view returns(uint256)",
  "function netVerifiedReserve() view returns(uint256)",
  "function verifiedDepositIds(bytes32) view returns(bool)",
  "function verifiedPayoutIds(bytes32) view returns(bool)",
  "function processedQueries(bytes32) view returns(bool)",
  "function canReleaseBond() view returns(bool)",
  "function redemptions(bytes32) view returns(address holder,address recipient,uint256 amount,uint8 status)",
];
const tokenAbi = [
  "function name() view returns(string)",
  "function symbol() view returns(string)",
  "function decimals() view returns(uint8)",
  "function totalSupply() view returns(uint256)",
  "function balanceOf(address) view returns(uint256)",
];
const bondAbi = [
  "function active() view returns(bool)",
  "function minimumBond() view returns(uint256)",
  "function administrator() view returns(address)",
  "function controller() view returns(address)",
];
const reserveAbi = ["function balanceOf(address) view returns(uint256)"];
const vaultEvents = new Interface([
  "event ReserveDeposited(bytes32 indexed issuerId,bytes32 indexed depositId,address indexed beneficiary,address depositor,uint256 amount)",
  "event ReservePaidOut(bytes32 indexed issuerId,bytes32 indexed redemptionId,address indexed recipient,address operator,uint256 amount)",
]);
const controllerEvents = new Interface([
  "event ReserveDepositVerified(bytes32 indexed queryId,bytes32 indexed depositId,address indexed beneficiary,address depositor,uint256 amount,uint64 sourceBlockHeight)",
  "event RedemptionRequested(bytes32 indexed redemptionId,address indexed holder,address indexed recipient,uint256 amount)",
  "event RedemptionFinalized(bytes32 indexed queryId,bytes32 indexed redemptionId,address indexed holder,address recipient,uint256 amount,uint64 sourceBlockHeight)",
]);

function sameAddress(actual: string, expected: string) {
  return getAddress(actual) === getAddress(expected);
}

function expect(condition: unknown, name: string, detail: string, checks: Check[]) {
  if (!condition) throw new Error(`${name}: ${detail}`);
  checks.push({ name, detail });
}

async function retry<T>(label: string, action: () => Promise<T>, attempts = 4): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
    }
  }
  throw new Error(`${label}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function requireReceipt(provider: JsonRpcProvider, tx: TxEvidence, label: string, checks: Check[]) {
  const value = await retry(label, () => provider.getTransactionReceipt(tx.transactionHash));
  expect(value?.status === 1, `${label} status`, tx.transactionHash, checks);
  expect(value!.blockNumber === tx.blockNumber, `${label} block`, String(value!.blockNumber), checks);
  expect(value!.gasUsed === BigInt(tx.gasUsed), `${label} gas`, value!.gasUsed.toString(), checks);
  return value!;
}

function requireEvent(
  receipt: Awaited<ReturnType<typeof requireReceipt>>,
  parser: Interface,
  eventName: string,
  address: string,
) {
  for (const log of receipt.logs) {
    if (!sameAddress(log.address, address)) continue;
    try {
      const parsed = parser.parseLog(log);
      if (parsed?.name === eventName) return parsed;
    } catch {
      // Ignore unrelated logs.
    }
  }
  throw new Error(`${eventName} event was not found`);
}

async function requireProof(
  hash: string,
  expected: (typeof pilot.proofs)["deposit"],
  label: string,
  checks: Check[],
) {
  const proof = await retry(label, async () => {
    const response = await fetch(
      `${networks.destination.proofBuilderUrl}/api/v1/proof-by-tx/${expected.chainKey}/${hash}`,
      { cache: "no-store", signal: AbortSignal.timeout(30_000) },
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json() as Promise<{
      txHash: string;
      chainKey: number;
      headerNumber: number;
      merkleProof: { siblings: unknown[] };
      continuityProof: { roots: unknown[] };
    }>;
  });
  expect(proof.txHash.toLowerCase() === hash.toLowerCase(), `${label} hash`, proof.txHash, checks);
  expect(proof.chainKey === expected.chainKey, `${label} chain`, String(proof.chainKey), checks);
  expect(proof.headerNumber === expected.sourceBlock, `${label} block`, String(proof.headerNumber), checks);
  expect(proof.merkleProof.siblings.length === expected.merkleSiblings, `${label} Merkle proof`, String(proof.merkleProof.siblings.length), checks);
  expect(
    proof.continuityProof.roots.length >= expected.continuityRoots,
    `${label} continuity proof`,
    `${proof.continuityProof.roots.length} current roots; ${expected.continuityRoots} captured at submission`,
    checks,
  );
}

async function main() {
  const checks: Check[] = [];
  const source = new JsonRpcProvider(networks.source.rpcUrl, networks.source.chainId, { staticNetwork: true });
  const destination = new JsonRpcProvider(networks.destination.rpcUrl, networks.destination.chainId, { staticNetwork: true });

  const sourceReceipts = await Promise.all([
    requireReceipt(source, pilot.source.createVault, "Canonical vault creation", checks),
    requireReceipt(source, pilot.source.approveReserve, "Reserve approval", checks),
    requireReceipt(source, pilot.source.depositReserve, "Reserve deposit", checks),
    requireReceipt(source, pilot.source.payout, "Reserve payout", checks),
  ]);
  const destinationReceipts = await Promise.all([
    requireReceipt(destination, pilot.destination.createIssuer, "V2 issuer creation", checks),
    requireReceipt(destination, pilot.destination.depositBond, "Activation stake deposit", checks),
    requireReceipt(destination, pilot.destination.activate, "Issuance activation", checks),
    requireReceipt(destination, pilot.destination.mint, "Deposit proof mint", checks),
    requireReceipt(destination, pilot.destination.approveRedemption, "Redemption approval", checks),
    requireReceipt(destination, pilot.destination.requestRedemption, "Redemption request", checks),
    requireReceipt(destination, pilot.destination.finalizeRedemption, "Payout proof finalization", checks),
  ]);

  const deposit = requireEvent(sourceReceipts[2], vaultEvents, "ReserveDeposited", pilot.source.vault);
  expect(deposit.args.issuerId === pilot.issuerId, "Deposit issuer", deposit.args.issuerId, checks);
  expect(deposit.args.depositId === pilot.source.depositId, "Deposit ID", deposit.args.depositId, checks);
  expect(sameAddress(deposit.args.beneficiary, pilot.administrator), "Deposit beneficiary", deposit.args.beneficiary, checks);
  expect(deposit.args.amount === BigInt(pilot.amount), "Deposit amount", pilot.amount, checks);

  const mint = requireEvent(destinationReceipts[3], controllerEvents, "ReserveDepositVerified", pilot.destination.controller);
  expect(mint.args.queryId === pilot.destination.mint.queryId, "Deposit query", mint.args.queryId, checks);
  expect(mint.args.depositId === pilot.source.depositId, "Mint deposit ID", mint.args.depositId, checks);
  expect(mint.args.amount === BigInt(pilot.amount), "Mint amount", pilot.amount, checks);

  const request = requireEvent(destinationReceipts[5], controllerEvents, "RedemptionRequested", pilot.destination.controller);
  expect(request.args.redemptionId === pilot.source.redemptionId, "Redemption ID", request.args.redemptionId, checks);
  expect(request.args.amount === BigInt(pilot.amount), "Redemption amount", pilot.amount, checks);

  const payout = requireEvent(sourceReceipts[3], vaultEvents, "ReservePaidOut", pilot.source.vault);
  expect(payout.args.redemptionId === pilot.source.redemptionId, "Payout redemption ID", payout.args.redemptionId, checks);
  expect(sameAddress(payout.args.recipient, pilot.administrator), "Payout recipient", payout.args.recipient, checks);
  expect(payout.args.amount === BigInt(pilot.amount), "Payout amount", pilot.amount, checks);

  const finalized = requireEvent(destinationReceipts[6], controllerEvents, "RedemptionFinalized", pilot.destination.controller);
  expect(finalized.args.queryId === pilot.destination.finalizeRedemption.queryId, "Payout query", finalized.args.queryId, checks);
  expect(finalized.args.redemptionId === pilot.source.redemptionId, "Final redemption ID", finalized.args.redemptionId, checks);
  expect(finalized.args.amount === BigInt(pilot.amount), "Finalized amount", pilot.amount, checks);

  const sourceFactory = new Contract(networks.source.canonicalVaultFactoryV2, sourceFactoryAbi, source);
  const vault = new Contract(pilot.source.vault, vaultAbi, source);
  const reserve = new Contract(networks.source.reserveAsset.address, reserveAbi, source);
  const controller = new Contract(pilot.destination.controller, controllerAbi, destination);
  const token = new Contract(pilot.destination.token, tokenAbi, destination);
  const bond = new Contract(pilot.destination.bondVault, bondAbi, destination);

  const predictedVault = await retry("Canonical vault", () => sourceFactory.predictVault(
    networks.source.reserveAsset.address,
    pilot.issuerId,
    pilot.administrator,
  ) as Promise<string>);
  expect(sameAddress(predictedVault, pilot.source.vault), "Canonical vault provenance", predictedVault, checks);

  const sourceState = await retry("Source state", () => Promise.all([
    vault.reserveAsset() as Promise<string>, vault.issuerId() as Promise<string>, vault.administrator() as Promise<string>,
    vault.totalDeposited() as Promise<bigint>, vault.totalPaidOut() as Promise<bigint>,
    vault.recognizedReserve() as Promise<bigint>, vault.reserveBalance() as Promise<bigint>,
    reserve.balanceOf(pilot.source.vault) as Promise<bigint>,
  ]));
  expect(sameAddress(sourceState[0], networks.source.reserveAsset.address), "Vault reserve asset", sourceState[0], checks);
  expect(sourceState[1] === pilot.issuerId, "Vault issuer", sourceState[1], checks);
  expect(sameAddress(sourceState[2], pilot.administrator), "Vault administrator", sourceState[2], checks);
  expect(sourceState[3] === BigInt(pilot.amount), "Total deposited", sourceState[3].toString(), checks);
  expect(sourceState[4] === BigInt(pilot.amount), "Total paid out", sourceState[4].toString(), checks);
  expect(sourceState[5] === BigInt(pilot.finalState.sourceRecognizedReserve), "Recognized reserve", sourceState[5].toString(), checks);
  expect(sourceState[6] === BigInt(pilot.finalState.sourceReserveBalance), "Reported vault balance", sourceState[6].toString(), checks);
  expect(sourceState[7] === BigInt(pilot.finalState.sourceReserveBalance), "Actual vault balance", sourceState[7].toString(), checks);

  const destinationState = await retry("Destination state", () => Promise.all([
    controller.SOURCE_CHAIN_KEY() as Promise<bigint>, controller.SOURCE_VAULT() as Promise<string>,
    controller.SOURCE_EXECUTOR() as Promise<string>, controller.SOURCE_PAYOUT_OPERATOR() as Promise<string>,
    controller.RESERVE_ASSET() as Promise<string>, controller.ISSUER_ID() as Promise<string>,
    controller.administrator() as Promise<string>, controller.token() as Promise<string>, controller.bondVault() as Promise<string>,
    controller.totalVerifiedReserve() as Promise<bigint>, controller.totalRedeemed() as Promise<bigint>,
    controller.totalPendingRedemption() as Promise<bigint>, controller.netVerifiedReserve() as Promise<bigint>,
    controller.verifiedDepositIds(pilot.source.depositId) as Promise<boolean>,
    controller.verifiedPayoutIds(pilot.source.redemptionId) as Promise<boolean>,
    controller.processedQueries(pilot.destination.mint.queryId) as Promise<boolean>,
    controller.processedQueries(pilot.destination.finalizeRedemption.queryId) as Promise<boolean>,
    controller.canReleaseBond() as Promise<boolean>,
    controller.redemptions(pilot.source.redemptionId) as Promise<[string, string, bigint, bigint]>,
  ]));
  expect(destinationState[0] === BigInt(networks.source.attestcoinChainKey), "Controller source chain", destinationState[0].toString(), checks);
  expect(sameAddress(destinationState[1], pilot.source.vault), "Controller source vault", destinationState[1], checks);
  expect(sameAddress(destinationState[2], networks.source.transactionExecutor), "Controller executor", destinationState[2], checks);
  expect(sameAddress(destinationState[3], pilot.administrator), "Controller payout operator", destinationState[3], checks);
  expect(sameAddress(destinationState[4], networks.source.reserveAsset.address), "Controller reserve asset", destinationState[4], checks);
  expect(destinationState[5] === pilot.issuerId, "Controller issuer", destinationState[5], checks);
  expect(sameAddress(destinationState[6], pilot.administrator), "Controller administrator", destinationState[6], checks);
  expect(sameAddress(destinationState[7], pilot.destination.token), "Controller token", destinationState[7], checks);
  expect(sameAddress(destinationState[8], pilot.destination.bondVault), "Controller stake vault", destinationState[8], checks);
  expect(destinationState[9] === BigInt(pilot.finalState.totalVerifiedReserve), "Verified reserve", destinationState[9].toString(), checks);
  expect(destinationState[10] === BigInt(pilot.finalState.totalRedeemed), "Redeemed reserve", destinationState[10].toString(), checks);
  expect(destinationState[11] === BigInt(pilot.finalState.pendingRedemption), "Pending redemption", destinationState[11].toString(), checks);
  expect(destinationState[12] === BigInt(pilot.finalState.netVerifiedReserve), "Net reserve", destinationState[12].toString(), checks);
  expect(destinationState[13] && destinationState[14] && destinationState[15] && destinationState[16], "Replay protection", "deposit, redemption, and both proof queries consumed", checks);
  expect(destinationState[17] === pilot.finalState.bondCanRelease, "Stake release condition", String(destinationState[17]), checks);
  expect(destinationState[18][2] === BigInt(pilot.amount) && destinationState[18][3] === 2n, "Completed redemption", `amount=${destinationState[18][2]} status=${destinationState[18][3]}`, checks);

  const tokenState = await retry("Token state", () => Promise.all([
    token.name() as Promise<string>, token.symbol() as Promise<string>, token.decimals() as Promise<bigint>,
    token.totalSupply() as Promise<bigint>, token.balanceOf(pilot.administrator) as Promise<bigint>,
  ]));
  expect(tokenState[0] === pilot.tokenName, "Token name", tokenState[0], checks);
  expect(tokenState[1] === pilot.tokenSymbol, "Token symbol", tokenState[1], checks);
  expect(Number(tokenState[2]) === pilot.decimals, "Token decimals", tokenState[2].toString(), checks);
  expect(tokenState[3] === BigInt(pilot.finalState.tokenSupply), "Token supply", tokenState[3].toString(), checks);
  expect(tokenState[4] === BigInt(pilot.finalState.holderBalance), "Holder balance", tokenState[4].toString(), checks);

  const bondState = await retry("Stake state", () => Promise.all([
    bond.active() as Promise<boolean>, bond.minimumBond() as Promise<bigint>, bond.administrator() as Promise<string>,
    bond.controller() as Promise<string>, destination.getBalance(pilot.destination.bondVault),
  ]));
  expect(bondState[0], "Stake active", String(bondState[0]), checks);
  expect(bondState[1] === BigInt(pilot.finalState.bondBalance), "Minimum stake", bondState[1].toString(), checks);
  expect(sameAddress(bondState[2], pilot.administrator), "Stake administrator", bondState[2], checks);
  expect(sameAddress(bondState[3], pilot.destination.controller), "Stake controller", bondState[3], checks);
  expect(bondState[4] === BigInt(pilot.finalState.bondBalance), "Stake balance", bondState[4].toString(), checks);

  await Promise.all([
    requireProof(pilot.source.depositReserve.transactionHash, pilot.proofs.deposit, "Deposit proof", checks),
    requireProof(pilot.source.payout.transactionHash, pilot.proofs.payout, "Payout proof", checks),
  ]);

  for (const check of checks) console.log(`PASS ${check.name}: ${check.detail}`);
  console.log(`PASS V2 lifecycle evidence: ${checks.length} independent checks`);
}

void main().catch((error: unknown) => {
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
