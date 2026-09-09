import { readFile, writeFile } from "node:fs/promises";

import { keccak256 } from "ethers";

const artifactPath = "contracts/out/IssuerFactory.sol/IssuerFactory.json";
const outputPath = "config/factory-deployment.json";
const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
const creationBytecode = artifact.bytecode?.object;
if (!/^0x[0-9a-f]+$/i.test(creationBytecode || "")) {
  throw new Error(`${artifactPath} does not contain deployable creation bytecode`);
}
const output = {
  schemaVersion: 1,
  contract: "IssuerFactory",
  fullyQualifiedName: "src/IssuerFactory.sol:IssuerFactory",
  compiler: artifact.metadata?.compiler?.version || "0.8.30",
  creationBytecodeHash: keccak256(creationBytecode),
  creationBytecode,
};
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`Wrote ${outputPath} (${(creationBytecode.length - 2) / 2} bytes)`);
