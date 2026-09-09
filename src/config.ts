import networkConfig from '../config/networks.json';

export type Address = `0x${string}`;

export interface RuntimeConfig {
  walletAddress?: Address;
  source: {
    chainId: bigint;
    chainKey: number;
    rpcUrl: string;
    reserveAsset: {
      address: Address;
      decimals: number;
      symbol: string;
    };
  };
  destination: {
    chainId: bigint;
    rpcUrl: string;
    proofBuilderUrl: string;
    verifierPrecompile: Address;
    chainInfoPrecompile: Address;
    evmV1Decoder: Address;
  };
}

function requiredUrl(value: string, label: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`${label} must use HTTPS`);
  }
  return parsed.toString().replace(/\/$/, '');
}

function optionalAddress(value: string | undefined): Address | undefined {
  if (!value) return undefined;
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error('RESYVR_WALLET_ADDRESS must be a 20-byte EVM address');
  }
  return value as Address;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  return {
    walletAddress: optionalAddress(env.RESYVR_WALLET_ADDRESS),
    source: {
      chainId: BigInt(networkConfig.source.chainId),
      chainKey: networkConfig.source.attestcoinChainKey,
      rpcUrl: requiredUrl(env.SOURCE_CHAIN_RPC_URL ?? networkConfig.source.rpcUrl, 'SOURCE_CHAIN_RPC_URL'),
      reserveAsset: {
        address: networkConfig.source.reserveAsset.address as Address,
        decimals: networkConfig.source.reserveAsset.decimals,
        symbol: networkConfig.source.reserveAsset.symbol,
      },
    },
    destination: {
      chainId: BigInt(networkConfig.destination.chainId),
      rpcUrl: requiredUrl(
        env.CREDITCOIN_RPC_URL ?? networkConfig.destination.rpcUrl,
        'CREDITCOIN_RPC_URL',
      ),
      proofBuilderUrl: requiredUrl(
        env.PROOF_BUILDER_URL ?? networkConfig.destination.proofBuilderUrl,
        'PROOF_BUILDER_URL',
      ),
      verifierPrecompile: networkConfig.destination.verifierPrecompile as Address,
      chainInfoPrecompile: networkConfig.destination.chainInfoPrecompile as Address,
      evmV1Decoder: networkConfig.destination.evmV1Decoder as Address,
    },
  };
}
