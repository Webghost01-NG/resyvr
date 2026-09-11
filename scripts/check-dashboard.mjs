import { readFile } from "node:fs/promises";
import { keccak256 } from "ethers";

const [html, v2Html, evidenceHtml, app, wallet, sourceVaultArtifact, networks, pilot, v2Pilot, evidenceApp, v2Deployments] = await Promise.all([
  readFile(new URL("../dashboard/index.html", import.meta.url), "utf8"),
  readFile(new URL("../dashboard/v2-pilot.html", import.meta.url), "utf8"),
  readFile(new URL("../dashboard/judge-evidence.html", import.meta.url), "utf8"),
  readFile(new URL("../dashboard/app.js", import.meta.url), "utf8"),
  readFile(new URL("../dashboard/wallet.js", import.meta.url), "utf8"),
  readFile(new URL("../config/source-vault-deployment.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../config/networks.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../config/pilot.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../dashboard/v2-pilot.js", import.meta.url), "utf8"),
  readFile(new URL("../dashboard/judge-evidence.js", import.meta.url), "utf8"),
  readFile(new URL("../config/v2-deployments.json", import.meta.url), "utf8").then(JSON.parse),
]);

const definedIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
const referencedIds = new Set(
  [...`${app}\n${wallet}`.matchAll(/(?:byId|setText|setLink|setPendingLink|setInternalLink|setPlainText)\("([^"]+)"/g)].map((match) => match[1]),
);
const duplicateIds = [...definedIds].filter((id) => html.match(new RegExp(`\\bid="${id}"`, "g"))?.length !== 1);
const missingIds = [...referencedIds].filter((id) => !definedIds.has(id));

if (duplicateIds.length > 0) throw new Error(`Duplicate dashboard IDs: ${duplicateIds.join(", ")}`);
if (missingIds.length > 0) throw new Error(`Missing dashboard IDs: ${missingIds.join(", ")}`);

const v2ReferencedIds = new Set(
  [...v2Pilot.matchAll(/byId\("([^"]+)"/g)].map((match) => match[1]),
);
const v2StandaloneIds = new Set([...v2Html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
const missingStandaloneIds = [...v2ReferencedIds].filter((id) => !v2StandaloneIds.has(id));
if (missingStandaloneIds.length > 0) throw new Error(`Missing standalone V2 IDs: ${missingStandaloneIds.join(", ")}`);

const evidenceIds = new Set([...evidenceHtml.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
const evidenceReferences = new Set([...evidenceApp.matchAll(/byId\("([^"]+)"/g)].map((match) => match[1]));
const missingEvidenceIds = [...evidenceReferences].filter((id) => !evidenceIds.has(id));
if (missingEvidenceIds.length > 0) throw new Error(`Missing Judge Evidence IDs: ${missingEvidenceIds.join(", ")}`);

for (const path of ["../config/networks.json", "../config/pilot.json", "../docs/deployments/creditcoin.json", "../config/issuance.json", "../config/source-vault-deployment.json"]) {
  if (!`${app}\n${wallet}`.includes(`fetchJson("${path}")`)) throw new Error(`Dashboard does not load ${path}`);
}

if (!wallet.includes('fetchJson("../config/issuance.json")')) throw new Error("Wallet flow does not load issuance config");
if (!wallet.includes("networks.source.transactionExecutor")) throw new Error("Wallet flow does not configure the supported source executor");
if (!wallet.includes("SOURCE_EXECUTOR_SELECTOR")) throw new Error("Wallet flow does not verify the controller source executor");
if (!wallet.includes('publicRpc(rpcUrl, "eth_estimateGas"')) throw new Error("Wallet transactions do not use bounded public-RPC gas estimates");
if (!wallet.includes('publicRpc(networks.destination.rpcUrl, "eth_getLogs"')) throw new Error("Issuer portfolio does not read factory logs");
if (!wallet.includes("recoverPendingAction")) throw new Error("Wallet flow does not recover pending transactions");
if (!wallet.includes("recordPendingAction")) throw new Error("Wallet flow does not persist submitted transactions");
if (!wallet.includes("selectIssuer")) throw new Error("Issuer portfolio cannot reopen an issuer workflow");
if (!wallet.includes("encodeCreateIssuerV2")) throw new Error("New issuers do not use the redeemable V2 factory");
if (!wallet.includes("encodeRequestRedemption")) throw new Error("Managed V2 assets cannot request redemption");
if (!wallet.includes("encodeExecutePayout")) throw new Error("Managed V2 assets cannot finalize a proven payout");
if (!wallet.includes('fetchJson("../config/v2-deployments.json")')) throw new Error("Wallet flow does not load verified V2 deployments");
if (!wallet.includes("VERIFIED_DEPOSIT_SELECTOR")) throw new Error("Issuer recovery does not reject consumed deposits");
if (!definedIds.has("reserve-beneficiary")) throw new Error("Reserve flow has no mint recipient input");
if (!wallet.includes("refreshReserveFunds")) throw new Error("Reserve flow does not validate live balance and allowance");
if (wallet.includes("explorerUrl}/token/")) throw new Error("Token links use the explorer route that fails before indexing");
if (!wallet.includes('CustomEvent("resyvr:issuer-selected"')) throw new Error("Wallet flow does not publish the selected issuer");
if (!app.includes('addEventListener("resyvr:issuer-selected"')) throw new Error("Dashboard metrics do not follow the selected issuer");
for (const id of ["attestation-progress", "attested-height", "required-height", "attestation-gap", "attestation-elapsed"]) {
  if (!definedIds.has(id)) throw new Error(`Attestcoin progress is missing ${id}`);
}
if (!wallet.includes("updateAttestationProgress")) throw new Error("Proof generation does not report Attestcoin progress");
if (!wallet.includes("recoverRedemptionState")) throw new Error("Managed V2 assets cannot recover their redemption state");
if (!wallet.includes("resetRedemptionCycle")) throw new Error("V2 assets cannot start another redemption after finalization");
if (!wallet.includes("latestUnconsumedDeposit")) throw new Error("Managed issuers cannot resume repeat minting from an unconsumed deposit");
if (!wallet.includes("...v2Assets, ...v1Assets")) throw new Error("The issuer portfolio does not discover every V2 asset created by the connected administrator");
for (const action of ["approveRedemption", "requestRedemption", "payRedemption", "finalizeRedemption"]) {
  if (!wallet.includes(`action === "${action}"`)) throw new Error(`Refresh recovery is missing ${action}`);
}
if (!evidenceApp.includes('fetch("../config/v2-pilot.json"')) throw new Error("Judge Evidence does not load the published V2 lifecycle");
if (!html.includes('href="./judge-evidence.html"')) throw new Error("The dashboard does not link Judge Evidence");
if (!/^0x[0-9a-f]{40}$/i.test(networks.source.transactionExecutor || "")) {
  throw new Error("Source transaction executor is not a valid address");
}
if (networks.source.transactionExecutor.toLowerCase() !== pilot.sourceExecutor.toLowerCase()) {
  throw new Error("New issuers do not use the routed executor proven by the pilot");
}
if (networks.destination.issuerFactoryV2.toLowerCase() !== v2Deployments.destination.address.toLowerCase()) {
  throw new Error("V2 pilot factory does not match verified deployment evidence");
}
if (!v2Pilot.includes("sourceExecutor: networks.source.transactionExecutor || ZERO_ADDRESS")) {
  throw new Error("V2 issuer creation does not configure the supported source executor");
}
if (!v2Pilot.includes("transactionTargetsSourceVault") || !v2Pilot.includes("recoverConfirmedDeposit") || !v2Pilot.includes("migratePilotState")) {
  throw new Error("V2 pilot cannot validate routed source calls and recover confirmed deposits");
}
if (sourceVaultArtifact.contract !== "SourceReserveVault") throw new Error("Dashboard source-vault artifact names the wrong contract");
if (!/^0x[0-9a-f]+$/i.test(sourceVaultArtifact.creationBytecode || "")) throw new Error("Dashboard source-vault artifact has no deployable bytecode");
if (keccak256(sourceVaultArtifact.creationBytecode) !== sourceVaultArtifact.creationBytecodeHash) {
  throw new Error("Dashboard source-vault bytecode hash does not match its payload");
}

console.log(`PASS dashboard structure: ${definedIds.size} unique IDs, ${referencedIds.size} scripted targets`);
