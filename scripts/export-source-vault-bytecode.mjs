import { readFile, writeFile } from "node:fs/promises";

import { keccak256 } from "ethers";

const artifactPath = "contracts/out/SourceReserveVault.sol/SourceReserveVault.json";
const outputPath = "config/source-vault-deployment.json";
const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
const creationBytecode = artifact.bytecode?.object;
if (!/^0x[0-9a-f]+$/i.test(creationBytecode || "")) {
  throw new Error(`${artifactPath} does not contain deployable creation bytecode`);
}
const output = {
  schemaVersion: 1,
  contract: "SourceReserveVault",
  fullyQualifiedName: "src/SourceReserveVault.sol:SourceReserveVault",
  compiler: artifact.metadata?.compiler?.version || "0.8.30",
  creationBytecodeHash: keccak256(creationBytecode),
  creationBytecode,
};
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`Wrote ${outputPath} (${(creationBytecode.length - 2) / 2} bytes)`);
