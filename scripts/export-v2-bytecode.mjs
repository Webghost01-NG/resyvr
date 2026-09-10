import { readFile, writeFile } from "node:fs/promises";

import { keccak256 } from "ethers";

const contracts = [
  {
    name: "SourceReserveVaultFactoryV2",
    artifact: "contracts/out/SourceReserveVaultFactoryV2.sol/SourceReserveVaultFactoryV2.json",
  },
  {
    name: "IssuerFactoryV2",
    artifact: "contracts/out/IssuerFactoryV2.sol/IssuerFactoryV2.json",
  },
];

const output = { schemaVersion: 1, contracts: {} };
for (const contract of contracts) {
  const artifact = JSON.parse(await readFile(contract.artifact, "utf8"));
  const creationBytecode = artifact.bytecode?.object;
  if (!/^0x[0-9a-f]+$/i.test(creationBytecode || "")) {
    throw new Error(`${contract.artifact} does not contain deployable creation bytecode`);
  }
  output.contracts[contract.name] = {
    creationBytecode,
    creationBytecodeHash: keccak256(creationBytecode),
    compiler: artifact.metadata?.compiler?.version || "0.8.30",
  };
}

await writeFile("config/v2-deployment-bytecode.json", `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log("Wrote config/v2-deployment-bytecode.json");
