import { readFile } from "node:fs/promises";

import { Contract, JsonRpcProvider, keccak256 } from "ethers";

type Deployment = {
  chainId: number;
  address: string;
  transactionHash: string;
  runtimeBytecodeHash: string;
  minimumBond?: string;
  sourceVaultFactory?: string;
  verified: boolean;
};

type Evidence = {
  source: Deployment;
  destination: Deployment;
};

async function main() {
  const evidence = JSON.parse(await readFile("config/v2-deployments.json", "utf8")) as Evidence;
  const sourceArtifact = JSON.parse(
    await readFile("contracts/out/SourceReserveVaultFactoryV2.sol/SourceReserveVaultFactoryV2.json", "utf8"),
  );
  const destinationArtifact = JSON.parse(
    await readFile("contracts/out/IssuerFactoryV2.sol/IssuerFactoryV2.json", "utf8"),
  );
  const sourceProvider = new JsonRpcProvider("https://ethereum-sepolia-rpc.publicnode.com");
  const destinationProvider = new JsonRpcProvider("https://rpc.cc3-testnet.creditcoin.network");

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
    throw new Error(`${label} failed after ${attempts} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }

  function pass(label: string, detail: string | number | bigint) {
    console.log(`PASS ${label}: ${detail}`);
  }

  function requireEqual(label: string, actual: unknown, expected: unknown) {
    if (String(actual).toLowerCase() !== String(expected).toLowerCase()) {
      throw new Error(`${label}: expected ${expected}, received ${actual}`);
    }
    pass(label, String(actual));
  }

  function maskImmutables(bytecode: string, references: Record<string, Array<{ start: number; length: number }>>) {
    let masked = bytecode.slice(2);
    for (const locations of Object.values(references)) {
      for (const location of locations) {
        masked = `${masked.slice(0, location.start * 2)}${"0".repeat(location.length * 2)}${masked.slice((location.start + location.length) * 2)}`;
      }
    }
    return `0x${masked}`;
  }

  requireEqual("Sepolia chain", (await retry("Sepolia network read", () => sourceProvider.getNetwork())).chainId, BigInt(evidence.source.chainId));
  requireEqual("Creditcoin chain", (await retry("Creditcoin network read", () => destinationProvider.getNetwork())).chainId, BigInt(evidence.destination.chainId));

  const sourceReceipt = await retry("Sepolia deployment receipt", () => sourceProvider.getTransactionReceipt(evidence.source.transactionHash));
  if (!sourceReceipt) throw new Error("Sepolia V2 factory receipt is unavailable");
  requireEqual("Sepolia deployment status", sourceReceipt.status, 1);
  requireEqual("Sepolia receipt contract", sourceReceipt.contractAddress, evidence.source.address);

  const destinationReceipt = await retry("Creditcoin deployment receipt", () => destinationProvider.getTransactionReceipt(evidence.destination.transactionHash));
  if (!destinationReceipt) throw new Error("Creditcoin V2 factory receipt is unavailable");
  requireEqual("Creditcoin deployment status", destinationReceipt.status, 1);
  requireEqual("Creditcoin receipt contract", destinationReceipt.contractAddress, evidence.destination.address);

  const sourceCode = await retry("Sepolia factory bytecode", () => sourceProvider.getCode(evidence.source.address));
  requireEqual("Sepolia factory bytecode hash", keccak256(sourceCode), evidence.source.runtimeBytecodeHash);
  requireEqual("Sepolia factory artifact", keccak256(sourceCode), keccak256(sourceArtifact.deployedBytecode.object));

  const destinationCode = await retry("Creditcoin factory bytecode", () => destinationProvider.getCode(evidence.destination.address));
  requireEqual("Creditcoin factory bytecode hash", keccak256(destinationCode), evidence.destination.runtimeBytecodeHash);
  const immutableReferences = destinationArtifact.deployedBytecode.immutableReferences;
  requireEqual(
    "Creditcoin factory artifact excluding constructor immutables",
    keccak256(maskImmutables(destinationCode, immutableReferences)),
    keccak256(maskImmutables(destinationArtifact.deployedBytecode.object, immutableReferences)),
  );

  const destinationFactory = new Contract(
    evidence.destination.address,
    ["function minimumIssuerBond() view returns (uint256)", "function SOURCE_VAULT_FACTORY() view returns (address)"],
    destinationProvider,
  );
  requireEqual(
    "V2 minimum activation stake",
    await retry("V2 minimum activation stake", () => destinationFactory.minimumIssuerBond()),
    evidence.destination.minimumBond,
  );
  requireEqual(
    "V2 canonical source factory",
    await retry("V2 canonical source factory", () => destinationFactory.SOURCE_VAULT_FACTORY()),
    evidence.destination.sourceVaultFactory,
  );

  const verificationChecks = [
    ["Sepolia source verification", "https://eth-sepolia.blockscout.com/api/v2/smart-contracts/", evidence.source],
    [
      "Creditcoin source verification",
      "https://creditcoin-testnet.blockscout.com/api/v2/smart-contracts/",
      evidence.destination,
    ],
  ] as const;
  for (const [label, endpoint, deployment] of verificationChecks) {
    const response = await fetch(`${endpoint}${deployment.address}`);
    if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
    const contract = (await response.json()) as { is_verified?: boolean; compiler_version?: string };
    requireEqual(label, contract.is_verified, deployment.verified);
    pass(`${label} compiler`, contract.compiler_version || "unknown");
  }

  pass("V2 factory evidence", "verified");
}

void main().catch((error: unknown) => {
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
