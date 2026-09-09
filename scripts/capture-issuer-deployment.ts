import { writeFile } from 'node:fs/promises';

import { Contract, Interface, JsonRpcProvider, getAddress } from 'ethers';

import factoryDeployment from '../config/factory-deployment.json';
import issuance from '../config/issuance.json';
import networks from '../config/networks.json';
import pilot from '../config/pilot.json';

type ExplorerTransaction = {
  contractAddress: string;
  hash: string;
  input: string;
  isError: string;
  to: string;
};

const factoryAbi = ['function minimumIssuerBond() view returns (uint256)'];
const factoryEvents = new Interface([
  'event IssuerCreated(bytes32 indexed issuerId,address indexed administrator,address indexed controller,address token,uint64 sourceChainKey,address sourceVault,address sourceExecutor,address reserveAsset,uint8 decimals,uint256 minimumBond,address bondVault)',
]);
const controllerEvents = new Interface([
  'event ReserveDepositVerified(bytes32 indexed queryId,bytes32 indexed depositId,address indexed beneficiary,address depositor,uint256 amount,uint64 sourceBlockHeight)',
]);
const selectors = {
  createIssuer: '0x3db42169',
  depositBond: '0x741b3c39',
  activateIssuance: '0x1de54f6b',
  executeDeposit: '0x083eb8c8',
};

function isTo(transaction: ExplorerTransaction, address: string): boolean {
  return Boolean(transaction.to) && getAddress(transaction.to) === getAddress(address);
}

function hasSelector(transaction: ExplorerTransaction, selector: string): boolean {
  return transaction.input.slice(0, 10).toLowerCase() === selector;
}

async function transactionsFor(wallet: string): Promise<ExplorerTransaction[]> {
  const url = new URL('/api', networks.destination.explorerUrl);
  url.searchParams.set('module', 'account');
  url.searchParams.set('action', 'txlist');
  url.searchParams.set('address', wallet);
  url.searchParams.set('sort', 'desc');
  url.searchParams.set('page', '1');
  url.searchParams.set('offset', '100');
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Creditcoin explorer returned HTTP ${response.status}`);
  const payload = (await response.json()) as { status: string; message: string; result: ExplorerTransaction[] | string };
  if (payload.status !== '1' || !Array.isArray(payload.result)) {
    throw new Error(`Creditcoin explorer transaction query failed: ${payload.message}`);
  }
  return payload.result.filter((transaction) => transaction.isError === '0');
}

async function main(): Promise<void> {
  const wallet = getAddress(process.argv[2] ?? pilot.beneficiary);
  const provider = new JsonRpcProvider(networks.destination.rpcUrl, networks.destination.chainId, {
    staticNetwork: true,
  });
  const transactions = await transactionsFor(wallet);
  const factoryCreation = transactions.find(
    (transaction) =>
      !transaction.to
      && Boolean(transaction.contractAddress)
      && transaction.input.toLowerCase().startsWith(factoryDeployment.creationBytecode.toLowerCase()),
  );
  if (!factoryCreation) throw new Error(`No Resyvr IssuerFactory deployment found for ${wallet}`);
  const factory = getAddress(factoryCreation.contractAddress);
  const factoryContract = new Contract(factory, factoryAbi, provider);
  const minimumBond = (await factoryContract.minimumIssuerBond()) as bigint;
  if (minimumBond !== BigInt(issuance.minimumBondWei)) throw new Error('factory minimum bond does not match config');

  const createIssuer = transactions.find(
    (transaction) => isTo(transaction, factory) && hasSelector(transaction, selectors.createIssuer),
  );
  if (!createIssuer) throw new Error(`No successful createIssuer call found for ${factory}`);
  const creationReceipt = await provider.getTransactionReceipt(createIssuer.hash);
  if (!creationReceipt || creationReceipt.status !== 1) throw new Error('issuer creation receipt is unavailable');
  const issuerLog = creationReceipt.logs
    .map((log) => {
      try {
        return factoryEvents.parseLog(log);
      } catch {
        return null;
      }
    })
    .find(Boolean);
  if (!issuerLog) throw new Error('IssuerCreated event was not found');
  if (issuerLog.args.issuerId.toLowerCase() !== pilot.issuerId.toLowerCase()) throw new Error('wrong issuer ID');
  if (getAddress(issuerLog.args.administrator) !== wallet) throw new Error('wrong issuer administrator');

  const controller = getAddress(issuerLog.args.controller);
  const token = getAddress(issuerLog.args.token);
  const bondVault = getAddress(issuerLog.args.bondVault);
  const bondDeposit = transactions.find(
    (transaction) => isTo(transaction, bondVault) && hasSelector(transaction, selectors.depositBond),
  );
  const activation = transactions.find(
    (transaction) => isTo(transaction, bondVault) && hasSelector(transaction, selectors.activateIssuance),
  );
  const proof = transactions.find(
    (transaction) => isTo(transaction, controller) && hasSelector(transaction, selectors.executeDeposit),
  );
  if (!bondDeposit || !activation) {
    throw new Error('successful bond deposit or activation is missing');
  }
  const [factoryReceipt, bondReceipt, activationReceipt, proofReceipt] = await Promise.all([
    provider.getTransactionReceipt(factoryCreation.hash),
    provider.getTransactionReceipt(bondDeposit.hash),
    provider.getTransactionReceipt(activation.hash),
    proof ? provider.getTransactionReceipt(proof.hash) : Promise.resolve(null),
  ]);
  if (!factoryReceipt || !bondReceipt || !activationReceipt) throw new Error('a deployment receipt is unavailable');
  const proofLog = proofReceipt
    ? proofReceipt.logs
        .map((log) => {
          try {
            return controllerEvents.parseLog(log);
          } catch {
            return null;
          }
        })
        .find(Boolean)
    : null;
  if (proofReceipt && (!proofLog || proofLog.args.depositId.toLowerCase() !== pilot.depositId.toLowerCase())) {
    throw new Error('proof receipt does not contain the pilot deposit');
  }
  for (const address of [factory, controller, token, bondVault]) {
    if ((await provider.getCode(address)) === '0x') throw new Error(`no live code at ${address}`);
  }

  const transactionRecord = (transaction: ExplorerTransaction, receipt: NonNullable<typeof factoryReceipt>) => ({
    transactionHash: transaction.hash.toLowerCase(),
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    explorer: `${networks.destination.explorerUrl}/tx/${transaction.hash}`,
  });
  const record = {
    ...issuance,
    factory,
    issuerController: controller,
    token,
    bondVault,
    administrator: wallet,
    factoryDeployment: transactionRecord(factoryCreation, factoryReceipt),
    issuerCreation: transactionRecord(createIssuer, creationReceipt),
    bondDeposit: transactionRecord(bondDeposit, bondReceipt),
    bondActivation: transactionRecord(activation, activationReceipt),
    proofSubmission:
      proof && proofReceipt && proofLog
        ? { ...transactionRecord(proof, proofReceipt), queryId: proofLog.args.queryId }
        : null,
  };
  await writeFile('config/issuance.json', `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  console.log(`Captured factory ${factory}`);
  console.log(`Captured issuer controller ${controller}`);
  console.log(`Proof submission ${proof ? 'captured' : 'pending'}`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
