import { readFile } from "node:fs/promises";
import { keccak256 } from "ethers";

const [html, app, wallet, sourceVaultArtifact, networks, pilot] = await Promise.all([
  readFile(new URL("../dashboard/index.html", import.meta.url), "utf8"),
  readFile(new URL("../dashboard/app.js", import.meta.url), "utf8"),
  readFile(new URL("../dashboard/wallet.js", import.meta.url), "utf8"),
  readFile(new URL("../config/source-vault-deployment.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../config/networks.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../config/pilot.json", import.meta.url), "utf8").then(JSON.parse),
]);

const definedIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
const referencedIds = new Set(
  [...`${app}\n${wallet}`.matchAll(/(?:byId|setText|setLink|setPendingLink)\("([^"]+)"/g)].map((match) => match[1]),
);
const duplicateIds = [...definedIds].filter((id) => html.match(new RegExp(`\\bid="${id}"`, "g"))?.length !== 1);
const missingIds = [...referencedIds].filter((id) => !definedIds.has(id));

if (duplicateIds.length > 0) throw new Error(`Duplicate dashboard IDs: ${duplicateIds.join(", ")}`);
if (missingIds.length > 0) throw new Error(`Missing dashboard IDs: ${missingIds.join(", ")}`);

for (const path of ["../config/networks.json", "../config/pilot.json", "../docs/deployments/creditcoin.json", "../config/issuance.json", "../config/source-vault-deployment.json"]) {
  if (!`${app}\n${wallet}`.includes(`fetchJson("${path}")`)) throw new Error(`Dashboard does not load ${path}`);
}

if (!wallet.includes('fetchJson("../config/issuance.json")')) throw new Error("Wallet flow does not load issuance config");
if (!wallet.includes("networks.source.transactionExecutor")) throw new Error("Wallet flow does not configure the supported source executor");
if (!wallet.includes("SOURCE_EXECUTOR_SELECTOR")) throw new Error("Wallet flow does not verify the controller source executor");
if (!wallet.includes('publicRpc(rpcUrl, "eth_estimateGas"')) throw new Error("Wallet transactions do not use bounded public-RPC gas estimates");
if (!wallet.includes('publicRpc(networks.destination.rpcUrl, "eth_getLogs"')) throw new Error("Issuer portfolio does not read factory logs");
if (!/^0x[0-9a-f]{40}$/i.test(networks.source.transactionExecutor || "")) {
  throw new Error("Source transaction executor is not a valid address");
}
if (networks.source.transactionExecutor.toLowerCase() !== pilot.sourceExecutor.toLowerCase()) {
  throw new Error("New issuers do not use the routed executor proven by the pilot");
}
if (sourceVaultArtifact.contract !== "SourceReserveVault") throw new Error("Dashboard source-vault artifact names the wrong contract");
if (!/^0x[0-9a-f]+$/i.test(sourceVaultArtifact.creationBytecode || "")) throw new Error("Dashboard source-vault artifact has no deployable bytecode");
if (keccak256(sourceVaultArtifact.creationBytecode) !== sourceVaultArtifact.creationBytecodeHash) {
  throw new Error("Dashboard source-vault bytecode hash does not match its payload");
}

console.log(`PASS dashboard structure: ${definedIds.size} unique IDs, ${referencedIds.size} scripted targets`);
