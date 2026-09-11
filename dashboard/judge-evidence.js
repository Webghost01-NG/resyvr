const byId = (id) => document.getElementById(id);
const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/i;
const HASH_PATTERN = /^0x[0-9a-f]{64}$/i;
const SELECTORS = {
  netVerifiedReserve: "0x0a7c6aa0",
  totalPendingRedemption: "0x60ad5a69",
  totalRedeemed: "0xf35dad40",
  totalSupply: "0x18160ddd",
  recognizedReserve: "0x884bf9e0",
  reserveBalance: "0xa10954fe",
  canReleaseBond: "0x6343219b",
};

let networks;
let pilot;
let deployments;

function explorer(chainKey, type, value) {
  return `${networks[chainKey].explorerUrl}/${type}/${value}`;
}

function makeEvidenceRow(label, value, chainKey) {
  const row = document.createElement("div");
  row.className = "evidence-row";
  const name = document.createElement("span");
  name.textContent = label.toUpperCase();
  const address = document.createElement("code");
  address.textContent = value;
  const link = document.createElement("a");
  link.href = explorer(chainKey, "address", value);
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = `${chainKey === "source" ? "SEPOLIA" : "CREDITCOIN"} ↗`;
  row.append(name, address, link);
  return row;
}

function renderContracts() {
  const contracts = [
    ["Canonical vault factory", deployments.source.address, "source"],
    ["V2 issuer factory", deployments.destination.address, "destination"],
    ["Pilot canonical reserve vault", pilot.source.vault, "source"],
    ["Pilot V2 controller", pilot.destination.controller, "destination"],
    ["Pilot rvUSD2 token", pilot.destination.token, "destination"],
    ["Pilot CTC activation stake", pilot.destination.bondVault, "destination"],
  ];
  const target = byId("contract-list");
  target.replaceChildren(...contracts.map(([label, value, chainKey]) => makeEvidenceRow(label, value, chainKey)));
}

function transactionEntries() {
  return [
    ["01", "Create canonical vault", pilot.source.createVault, "source"],
    ["02", "Approve reserve USDC", pilot.source.approveReserve, "source"],
    ["03", "Lock reserve USDC", pilot.source.depositReserve, "source"],
    ["04", "Create V2 issuer", pilot.destination.createIssuer, "destination"],
    ["05", "Deposit CTC activation stake", pilot.destination.depositBond, "destination"],
    ["06", "Activate issuance", pilot.destination.activate, "destination"],
    ["07", "Verify deposit and mint", pilot.destination.mint, "destination"],
    ["08", "Approve redemption escrow", pilot.destination.approveRedemption, "destination"],
    ["09", "Request redemption", pilot.destination.requestRedemption, "destination"],
    ["10", "Pay reserve recipient", pilot.source.payout, "source"],
    ["11", "Verify payout and burn", pilot.destination.finalizeRedemption, "destination"],
  ];
}

function renderTransactions() {
  const rows = transactionEntries().map(([number, label, transaction, chainKey]) => {
    const row = document.createElement("div");
    row.className = "transaction-row";
    const name = document.createElement("span");
    name.textContent = `${number} · ${label.toUpperCase()}`;
    const hash = document.createElement("code");
    hash.textContent = transaction.transactionHash;
    const link = document.createElement("a");
    link.href = explorer(chainKey, "tx", transaction.transactionHash);
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = `BLOCK ${transaction.blockNumber.toLocaleString("en-US")} ↗`;
    row.append(name, hash, link);
    return row;
  });
  byId("transaction-list").replaceChildren(...rows);
}

function renderRecordedFinalState() {
  byId("net-reserve").textContent = pilot.finalState.netVerifiedReserve;
  byId("token-supply").textContent = pilot.finalState.tokenSupply;
  byId("pending-redemption").textContent = pilot.finalState.pendingRedemption;
  byId("source-reserve").textContent = pilot.finalState.sourceRecognizedReserve;
}

async function publicRpc(rpcUrl, method, params = []) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${method} returned HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.error) throw new Error(payload.error.message || `${method} failed`);
    return payload.result;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function contractUint(chainKey, address, selector) {
  const result = await publicRpc(networks[chainKey].rpcUrl, "eth_call", [{ to: address, data: selector }, "latest"]);
  return BigInt(result || "0x0");
}

function checkResult(label, passed, detail) {
  return { label, passed, detail };
}

async function verifyBytecode(label, chainKey, address) {
  const code = await publicRpc(networks[chainKey].rpcUrl, "eth_getCode", [address, "latest"]);
  return checkResult(label, typeof code === "string" && code.length > 2, `${code.length > 2 ? (code.length - 2) / 2 : 0} runtime bytes`);
}

async function verifyReceipt(label, chainKey, transaction) {
  const receipt = await publicRpc(networks[chainKey].rpcUrl, "eth_getTransactionReceipt", [transaction.transactionHash]);
  const passed = receipt
    && BigInt(receipt.status || "0x0") === 1n
    && Number(BigInt(receipt.blockNumber)) === transaction.blockNumber;
  return checkResult(label, Boolean(passed), receipt ? `block ${Number(BigInt(receipt.blockNumber)).toLocaleString("en-US")}` : "receipt missing");
}

function renderChecks(results) {
  const nodes = results.map((result) => {
    const row = document.createElement("div");
    row.className = `live-check${result.passed ? "" : " failed"}`;
    const label = document.createElement("span");
    label.textContent = `${result.label} · ${result.detail}`;
    const status = document.createElement("strong");
    status.textContent = result.passed ? "VERIFIED" : "FAILED";
    row.append(label, status);
    return row;
  });
  byId("live-checks").replaceChildren(...nodes);
}

async function runLiveVerification() {
  const button = byId("verify-live");
  button.disabled = true;
  button.textContent = "Verifying both chains…";
  byId("verification-label").textContent = "LIVE RPC VERIFICATION RUNNING";
  try {
    const contractChecks = await Promise.all([
      verifyBytecode("Canonical vault factory", "source", deployments.source.address),
      verifyBytecode("V2 issuer factory", "destination", deployments.destination.address),
      verifyBytecode("Canonical reserve vault", "source", pilot.source.vault),
      verifyBytecode("V2 controller", "destination", pilot.destination.controller),
      verifyBytecode("rvUSD2 token", "destination", pilot.destination.token),
      verifyBytecode("CTC stake vault", "destination", pilot.destination.bondVault),
    ]);
    const receiptChecks = await Promise.all(transactionEntries().map(([, label, transaction, chainKey]) =>
      verifyReceipt(label, chainKey, transaction)));
    const [netReserve, supply, pending, redeemed, sourceRecognized, sourceBalance, bondBalance, canRelease] = await Promise.all([
      contractUint("destination", pilot.destination.controller, SELECTORS.netVerifiedReserve),
      contractUint("destination", pilot.destination.token, SELECTORS.totalSupply),
      contractUint("destination", pilot.destination.controller, SELECTORS.totalPendingRedemption),
      contractUint("destination", pilot.destination.controller, SELECTORS.totalRedeemed),
      contractUint("source", pilot.source.vault, SELECTORS.recognizedReserve),
      contractUint("source", pilot.source.vault, SELECTORS.reserveBalance),
      publicRpc(networks.destination.rpcUrl, "eth_getBalance", [pilot.destination.bondVault, "latest"]).then(BigInt),
      contractUint("destination", pilot.destination.controller, SELECTORS.canReleaseBond),
    ]);
    const stateChecks = [
      checkResult("Net verified reserve", netReserve.toString() === pilot.finalState.netVerifiedReserve, netReserve.toString()),
      checkResult("Final token supply", supply.toString() === pilot.finalState.tokenSupply, supply.toString()),
      checkResult("Pending redemption", pending.toString() === pilot.finalState.pendingRedemption, pending.toString()),
      checkResult("Cumulative redeemed", redeemed.toString() === pilot.finalState.totalRedeemed, redeemed.toString()),
      checkResult("Source recognized reserve", sourceRecognized.toString() === pilot.finalState.sourceRecognizedReserve, sourceRecognized.toString()),
      checkResult("Source reserve balance", sourceBalance.toString() === pilot.finalState.sourceReserveBalance, sourceBalance.toString()),
      checkResult("CTC activation stake", bondBalance.toString() === pilot.finalState.bondBalance, `${bondBalance / 10n ** 18n} CTC`),
      checkResult("Liability-aware bond release", canRelease === 1n && pilot.finalState.bondCanRelease, canRelease === 1n ? "eligible" : "locked"),
    ];
    const results = [...contractChecks, ...receiptChecks, ...stateChecks];
    renderChecks(results);
    const passed = results.filter((result) => result.passed).length;
    const complete = passed === results.length;
    byId("verification-score").textContent = `${passed}/${results.length}`;
    byId("verification-label").textContent = complete ? "LIVE V2 LIFECYCLE VERIFIED" : "LIVE VERIFICATION FOUND A MISMATCH";
    byId("verification-detail").textContent = complete
      ? "Contracts, receipts, reserve state, redemption state, and final supply match the published record."
      : "Review the failed checks below before relying on the recorded state.";
    byId("verification-label").parentElement.classList.toggle("failed", !complete);
    byId("net-reserve").textContent = netReserve.toString();
    byId("token-supply").textContent = supply.toString();
    byId("pending-redemption").textContent = pending.toString();
    byId("source-reserve").textContent = sourceRecognized.toString();
  } catch (error) {
    byId("verification-score").textContent = "RPC";
    byId("verification-label").textContent = "LIVE READ TEMPORARILY UNAVAILABLE";
    byId("verification-detail").textContent = `${error.message}. Recorded explorer evidence remains linked below.`;
    byId("verification-label").parentElement.classList.add("failed");
  } finally {
    button.disabled = false;
    button.textContent = "Run live verification again";
  }
}

async function loadEvidence() {
  const [networkResponse, pilotResponse, deploymentResponse] = await Promise.all([
    fetch("../config/networks.json", { cache: "no-store" }),
    fetch("../config/v2-pilot.json", { cache: "no-store" }),
    fetch("../config/v2-deployments.json", { cache: "no-store" }),
  ]);
  if (!networkResponse.ok || !pilotResponse.ok || !deploymentResponse.ok) throw new Error("Published evidence configuration is unavailable");
  [networks, pilot, deployments] = await Promise.all([
    networkResponse.json(),
    pilotResponse.json(),
    deploymentResponse.json(),
  ]);
  const addresses = [deployments.source.address, deployments.destination.address, pilot.source.vault, pilot.destination.controller, pilot.destination.token, pilot.destination.bondVault];
  const hashes = transactionEntries().map(([, , transaction]) => transaction.transactionHash);
  if (!addresses.every((value) => ADDRESS_PATTERN.test(value)) || !hashes.every((value) => HASH_PATTERN.test(value))) {
    throw new Error("Published evidence contains an invalid address or transaction hash");
  }
  renderContracts();
  renderTransactions();
  renderRecordedFinalState();
  await runLiveVerification();
}

byId("verify-live").addEventListener("click", runLiveVerification);
loadEvidence().catch((error) => {
  byId("verification-score").textContent = "ERR";
  byId("verification-label").textContent = "EVIDENCE FAILED TO LOAD";
  byId("verification-detail").textContent = error.message;
  byId("verification-label").parentElement.classList.add("failed");
  byId("verify-live").disabled = true;
});
