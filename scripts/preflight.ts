import 'dotenv/config';

import { chainInfo } from '@gluwa/usc-sdk';
import { Contract, JsonRpcProvider, formatEther, formatUnits } from 'ethers';

import { loadConfig } from '../src/config';

type Result = { name: string; ok: boolean; detail: string };

const tokenAbi = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

function result(name: string, ok: boolean, detail: string): Result {
  return { name, ok, detail };
}

async function checkRpc(
  name: string,
  provider: JsonRpcProvider,
  expectedChainId: bigint,
): Promise<Result> {
  try {
    const [network, blockNumber] = await Promise.all([
      provider.getNetwork(),
      provider.getBlockNumber(),
    ]);
    const ok = network.chainId === expectedChainId;
    return result(name, ok, `chainId=${network.chainId} block=${blockNumber}`);
  } catch (error) {
    return result(name, false, error instanceof Error ? error.message : String(error));
  }
}

async function checkProofBuilder(url: string): Promise<Result> {
  try {
    const response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(15_000) });
    const reachable = response.ok || response.status === 404 || response.status === 405;
    return result('proof builder', reachable, `HTTP ${response.status}`);
  } catch (error) {
    return result('proof builder', false, error instanceof Error ? error.message : String(error));
  }
}

async function checkVerifier(provider: JsonRpcProvider, address: string): Promise<Result> {
  try {
    const response = await provider.call({ to: address, data: '0x' });
    return result('Block Prover 0xFD2', false, `unexpected empty response ${response}`);
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    return result('Block Prover 0xFD2', code === 'CALL_EXCEPTION', `probe reverted (${String(code)})`);
  }
}

async function checkAttestation(
  provider: JsonRpcProvider,
  chainKey: number,
): Promise<Result> {
  try {
    const info = new chainInfo.PrecompileChainInfoProvider(provider);
    const latest = await info.getLatestAttestedHeightAndHash(chainKey);
    return result('Sepolia attestation', latest.height > 0, `chainKey=${chainKey} height=${latest.height}`);
  } catch (error) {
    return result('Sepolia attestation', false, error instanceof Error ? error.message : String(error));
  }
}

async function checkReserveAsset(
  provider: JsonRpcProvider,
  address: string,
  expectedSymbol: string,
  expectedDecimals: number,
  walletAddress?: string,
): Promise<Result> {
  try {
    const token = new Contract(address, tokenAbi, provider);
    const [symbol, decimals, code] = await Promise.all([
      token.symbol() as Promise<string>,
      token.decimals() as Promise<bigint>,
      provider.getCode(address),
    ]);
    let detail = `address=${address} symbol=${symbol} decimals=${decimals}`;
    if (walletAddress) {
      const balance = (await token.balanceOf(walletAddress)) as bigint;
      detail += ` walletBalance=${formatUnits(balance, decimals)}`;
    }
    const ok = code !== '0x' && symbol === expectedSymbol && decimals === BigInt(expectedDecimals);
    return result('Sepolia reserve asset', ok, detail);
  } catch (error) {
    return result('Sepolia reserve asset', false, error instanceof Error ? error.message : String(error));
  }
}

async function checkWalletBalances(
  source: JsonRpcProvider,
  destination: JsonRpcProvider,
  walletAddress?: string,
): Promise<Result> {
  if (!walletAddress) {
    return result('wallet gas balances', true, 'wallet address omitted; read-only checks remain available');
  }
  try {
    const [sourceBalance, destinationBalance] = await Promise.all([
      source.getBalance(walletAddress),
      destination.getBalance(walletAddress),
    ]);
    return result(
      'wallet gas balances',
      sourceBalance > 0n && destinationBalance > 0n,
      `Sepolia=${formatEther(sourceBalance)} ETH CC3=${formatEther(destinationBalance)} CTC`,
    );
  } catch (error) {
    return result('wallet gas balances', false, error instanceof Error ? error.message : String(error));
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const sourceProvider = new JsonRpcProvider(config.source.rpcUrl, Number(config.source.chainId), {
    staticNetwork: true,
  });
  const destinationProvider = new JsonRpcProvider(
    config.destination.rpcUrl,
    Number(config.destination.chainId),
    { staticNetwork: true },
  );

  // Keep the live checks sequential. Public endpoints may rate-limit a burst
  // even when each individual dependency is healthy.
  const checks = [
    await checkRpc('Sepolia RPC', sourceProvider, config.source.chainId),
    await checkRpc('Creditcoin RPC', destinationProvider, config.destination.chainId),
    await checkProofBuilder(config.destination.proofBuilderUrl),
    await checkVerifier(destinationProvider, config.destination.verifierPrecompile),
    await checkAttestation(destinationProvider, config.source.chainKey),
    await checkReserveAsset(
      sourceProvider,
      config.source.reserveAsset.address,
      config.source.reserveAsset.symbol,
      config.source.reserveAsset.decimals,
      config.walletAddress,
    ),
    await checkWalletBalances(sourceProvider, destinationProvider, config.walletAddress),
  ];

  for (const check of checks) {
    console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}: ${check.detail}`);
  }

  if (checks.some((check) => !check.ok)) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
