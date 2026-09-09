import { Contract, Interface, JsonRpcProvider, getAddress } from 'ethers';

import creditcoin from '../docs/deployments/creditcoin.json';
import sepolia from '../docs/deployments/sepolia.json';
import networks from '../config/networks.json';
import pilot from '../config/pilot.json';
import issuance from '../config/issuance.json';

type Check = { name: string; detail: string };

const sourceVaultAbi = [
  'function reserveAsset() view returns (address)',
  'function issuerId() view returns (bytes32)',
  'function totalDeposited() view returns (uint256)',
];
const erc20Abi = [
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function decimals() view returns (uint8)',
];
const controllerAbi = [
  'function SOURCE_CHAIN_KEY() view returns (uint64)',
  'function SOURCE_VAULT() view returns (address)',
  'function SOURCE_EXECUTOR() view returns (address)',
  'function RESERVE_ASSET() view returns (address)',
  'function ISSUER_ID() view returns (bytes32)',
  'function totalVerifiedReserve() view returns (uint256)',
  'function verifiedBalance(address) view returns (uint256)',
  'function verifiedDepositIds(bytes32) view returns (bool)',
  'function processedQueries(bytes32) view returns (bool)',
  'function token() view returns (address)',
  'function bondVault() view returns (address)',
];
const factoryAbi = ['function minimumIssuerBond() view returns (uint256)'];
const bondAbi = [
  'function administrator() view returns (address)',
  'function controller() view returns (address)',
  'function minimumBond() view returns (uint256)',
  'function active() view returns (bool)',
];
const depositEvents = new Interface([
  'event ReserveDeposited(bytes32 indexed issuerId,bytes32 indexed depositId,address indexed beneficiary,address depositor,uint256 amount)',
]);

function equalAddress(actual: string, expected: string): boolean {
  return getAddress(actual) === getAddress(expected);
}

function expect(condition: unknown, name: string, detail: string, checks: Check[]): void {
  if (!condition) throw new Error(`${name}: ${detail}`);
  checks.push({ name, detail });
}

async function requireCode(
  provider: JsonRpcProvider,
  address: string,
  name: string,
  checks: Check[],
): Promise<void> {
  const code = await provider.getCode(address);
  expect(code !== '0x', name, `${address} has ${Math.max(0, (code.length - 2) / 2)} runtime bytes`, checks);
}

async function requireSuccessfulReceipt(
  provider: JsonRpcProvider,
  hash: string,
  expectedBlock: number,
  name: string,
  checks: Check[],
) {
  const receipt = await provider.getTransactionReceipt(hash);
  expect(receipt?.status === 1, name, `status=1 hash=${hash}`, checks);
  expect(receipt!.blockNumber === expectedBlock, `${name} block`, `block=${receipt!.blockNumber}`, checks);
  return receipt!;
}

async function main(): Promise<void> {
  const checks: Check[] = [];
  const source = new JsonRpcProvider(networks.source.rpcUrl, networks.source.chainId, { staticNetwork: true });
  const destination = new JsonRpcProvider(networks.destination.rpcUrl, networks.destination.chainId, {
    staticNetwork: true,
  });

  const [sourceNetwork, destinationNetwork] = await Promise.all([source.getNetwork(), destination.getNetwork()]);
  expect(sourceNetwork.chainId === BigInt(networks.source.chainId), 'Sepolia chain', `chainId=${sourceNetwork.chainId}`, checks);
  expect(
    destinationNetwork.chainId === BigInt(networks.destination.chainId),
    'Creditcoin chain',
    `chainId=${destinationNetwork.chainId}`,
    checks,
  );

  await requireCode(source, sepolia.address, 'Source vault bytecode', checks);
  await requireCode(destination, creditcoin.address, 'Proof controller bytecode', checks);
  const depositReceipt = await requireSuccessfulReceipt(
    source,
    pilot.depositTransactionHash,
    pilot.depositBlockNumber,
    'Reserve deposit receipt',
    checks,
  );
  await requireSuccessfulReceipt(
    destination,
    creditcoin.proof.submissionTransactionHash,
    creditcoin.proof.submissionBlockNumber,
    'Proof submission receipt',
    checks,
  );

  const depositLog = depositReceipt.logs
    .filter((log) => equalAddress(log.address, pilot.sourceVault))
    .map((log) => {
      try {
        return depositEvents.parseLog(log);
      } catch {
        return null;
      }
    })
    .find(Boolean);
  expect(Boolean(depositLog), 'Reserve deposit event', `depositId=${pilot.depositId}`, checks);
  expect(depositLog!.args.issuerId === pilot.issuerId, 'Deposit issuer', pilot.issuerId, checks);
  expect(depositLog!.args.depositId === pilot.depositId, 'Deposit ID', pilot.depositId, checks);
  expect(equalAddress(depositLog!.args.beneficiary, pilot.beneficiary), 'Deposit beneficiary', pilot.beneficiary, checks);
  expect(depositLog!.args.amount === BigInt(pilot.amount), 'Deposit amount', pilot.amount, checks);

  const vault = new Contract(sepolia.address, sourceVaultAbi, source);
  const reserveAsset = new Contract(networks.source.reserveAsset.address, erc20Abi, source);
  const [vaultAsset, vaultIssuer, deposited, reserveBalance] = await Promise.all([
    vault.reserveAsset() as Promise<string>,
    vault.issuerId() as Promise<string>,
    vault.totalDeposited() as Promise<bigint>,
    reserveAsset.balanceOf(sepolia.address) as Promise<bigint>,
  ]);
  expect(equalAddress(vaultAsset, networks.source.reserveAsset.address), 'Vault reserve asset', vaultAsset, checks);
  expect(vaultIssuer === pilot.issuerId, 'Vault issuer ID', vaultIssuer, checks);
  expect(deposited === BigInt(pilot.amount), 'Vault deposited total', deposited.toString(), checks);
  expect(reserveBalance === BigInt(pilot.amount), 'Vault token balance', reserveBalance.toString(), checks);

  const controller = new Contract(creditcoin.address, controllerAbi, destination);
  const [chainKey, sourceVault, sourceExecutor, controllerAsset, issuerId, verifiedReserve, beneficiaryBalance, depositUsed, queryUsed] =
    await Promise.all([
      controller.SOURCE_CHAIN_KEY() as Promise<bigint>,
      controller.SOURCE_VAULT() as Promise<string>,
      controller.SOURCE_EXECUTOR() as Promise<string>,
      controller.RESERVE_ASSET() as Promise<string>,
      controller.ISSUER_ID() as Promise<string>,
      controller.totalVerifiedReserve() as Promise<bigint>,
      controller.verifiedBalance(pilot.beneficiary) as Promise<bigint>,
      controller.verifiedDepositIds(pilot.depositId) as Promise<boolean>,
      controller.processedQueries(pilot.queryId) as Promise<boolean>,
    ]);
  expect(chainKey === BigInt(networks.source.attestcoinChainKey), 'Proof source chain', chainKey.toString(), checks);
  expect(equalAddress(sourceVault, pilot.sourceVault), 'Proof source vault', sourceVault, checks);
  expect(equalAddress(sourceExecutor, pilot.sourceExecutor), 'Proof source executor', sourceExecutor, checks);
  expect(equalAddress(controllerAsset, networks.source.reserveAsset.address), 'Proof reserve asset', controllerAsset, checks);
  expect(issuerId === pilot.issuerId, 'Proof issuer ID', issuerId, checks);
  expect(verifiedReserve === BigInt(pilot.amount), 'Verified reserve', verifiedReserve.toString(), checks);
  expect(beneficiaryBalance === BigInt(pilot.amount), 'Verified beneficiary balance', beneficiaryBalance.toString(), checks);
  expect(depositUsed, 'Deposit replay guard', `consumed=${depositUsed}`, checks);
  expect(queryUsed, 'Query replay guard', `consumed=${queryUsed}`, checks);

  if (issuance.factory && issuance.issuerController && issuance.token && issuance.bondVault) {
    await Promise.all([
      requireCode(destination, issuance.factory, 'Issuer factory bytecode', checks),
      requireCode(destination, issuance.issuerController, 'Issuer controller bytecode', checks),
      requireCode(destination, issuance.token, 'Issuer token bytecode', checks),
      requireCode(destination, issuance.bondVault, 'Bond vault bytecode', checks),
    ]);
    const factory = new Contract(issuance.factory, factoryAbi, destination);
    const issuerController = new Contract(issuance.issuerController, controllerAbi, destination);
    const token = new Contract(issuance.token, erc20Abi, destination);
    const bond = new Contract(issuance.bondVault, bondAbi, destination);
    const [factoryMinimum, linkedToken, linkedBond, issuerReserve, supply, tokenBalance, decimals, administrator, bondController, bondMinimum, active, bondBalance] =
      await Promise.all([
        factory.minimumIssuerBond() as Promise<bigint>,
        issuerController.token() as Promise<string>,
        issuerController.bondVault() as Promise<string>,
        issuerController.totalVerifiedReserve() as Promise<bigint>,
        token.totalSupply() as Promise<bigint>,
        token.balanceOf(pilot.beneficiary) as Promise<bigint>,
        token.decimals() as Promise<bigint>,
        bond.administrator() as Promise<string>,
        bond.controller() as Promise<string>,
        bond.minimumBond() as Promise<bigint>,
        bond.active() as Promise<boolean>,
        destination.getBalance(issuance.bondVault),
      ]);
    const minimumBond = BigInt(issuance.minimumBondWei);
    expect(factoryMinimum === minimumBond, 'Factory minimum bond', factoryMinimum.toString(), checks);
    expect(equalAddress(linkedToken, issuance.token), 'Controller token link', linkedToken, checks);
    expect(equalAddress(linkedBond, issuance.bondVault), 'Controller bond link', linkedBond, checks);
    expect(issuerReserve === BigInt(pilot.amount), 'Issuer verified reserve', issuerReserve.toString(), checks);
    expect(supply === issuerReserve, 'Proof-bounded token supply', supply.toString(), checks);
    expect(tokenBalance === supply, 'Beneficiary token balance', tokenBalance.toString(), checks);
    expect(decimals === BigInt(networks.source.reserveAsset.decimals), 'Issuer token decimals', decimals.toString(), checks);
    expect(equalAddress(administrator, pilot.beneficiary), 'Bond administrator', administrator, checks);
    expect(equalAddress(bondController, issuance.issuerController), 'Bond controller', bondController, checks);
    expect(bondMinimum === minimumBond, 'Bond minimum', bondMinimum.toString(), checks);
    expect(active, 'Bond activation', `active=${active}`, checks);
    expect(bondBalance >= minimumBond, 'Bond balance', bondBalance.toString(), checks);
  } else {
    checks.push({ name: 'Issuer deployment', detail: 'pending; base proof deployment remains fully verified' });
  }

  for (const check of checks) console.log(`PASS ${check.name}: ${check.detail}`);
  console.log(`PASS evidence summary: ${checks.length} checks`);
}

void main().catch((error: unknown) => {
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
