const selectors = {
  totalVerifiedReserve: "0x884d15ee",
  issuancePaused: "0xc691af92",
  token: "0xfc0c546a",
  bondVault: "0x990826b3",
  totalSupply: "0x18160ddd",
  decimals: "0x313ce567",
  active: "0x02fb0c5e",
  minimumBond: "0xaa7517e1",
  administrator: "0xf53d0a8e",
  issuerId: "0x12c80af1",
  sourceChainKey: "0xa97b6290",
  sourceVault: "0xcf15ed6b",
  reserveAsset: "0x7732dce2",
};

const staleAfterSeconds = 180;

function byId(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing dashboard element: ${id}`);
  return element;
}

function setText(id, value) {
  byId(id).textContent = value;
}

function shortHex(value, front = 8, back = 6) {
  if (!value || value.length <= front + back + 1) return value || "—";
  return `${value.slice(0, front)}…${value.slice(-back)}`;
}

function decodeUint(value) {
  return BigInt(value || "0x0");
}

function decodeAddress(value) {
  if (!value || value === "0x") return null;
  const normalized = value.slice(2).padStart(64, "0");
  const address = `0x${normalized.slice(-40)}`;
  return /^0x0{40}$/.test(address) ? null : address;
}

function formatUnits(value, decimals, maximumFractionDigits = 2) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = absolute / base;
  const fraction = (absolute % base).toString().padStart(decimals, "0").slice(0, maximumFractionDigits);
  const trimmed = fraction.replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole.toLocaleString("en-US")}${trimmed ? `.${trimmed}` : ""}`;
}

function coveragePercent(reserve, supply) {
  if (supply === 0n) return null;
  const basisPoints = (reserve * 10_000n) / supply;
  return `${formatUnits(basisPoints, 2, 2)}%`;
}

function setLink(id, href, label) {
  const link = byId(id);
  link.classList.remove("muted");
  link.href = href;
  link.textContent = label;
  link.target = "_blank";
  link.rel = "noreferrer";
}

function setPendingLink(id, label) {
  const link = byId(id);
  link.removeAttribute("href");
  link.removeAttribute("target");
  link.removeAttribute("rel");
  link.textContent = label;
  link.classList.add("muted");
}

async function fetchJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response.json();
}

async function rpc(rpcUrl, method, params = []) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10_000);
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

function contractCall(rpcUrl, address, data) {
  return rpc(rpcUrl, "eth_call", [{ to: address, data }, "latest"]);
}

function applyTrackedEvidence(networks, pilot, deployment) {
  const sourceExplorer = networks.source.explorerUrl;
  const destinationExplorer = networks.destination.explorerUrl;
  const sourceTransaction = pilot.depositTransactionHash || deployment.proof?.sourceTransactionHash;
  const proofTransaction = pilot.proofSubmissionTransactionHash || deployment.proof?.submissionTransactionHash;

  setText("source-block", Number(pilot.depositBlockNumber).toLocaleString("en-US"));
  setText("deposit-id", pilot.depositId);
  byId("deposit-id").title = pilot.depositId;
  setText("proof-block", Number(deployment.proof?.submissionBlockNumber || 0).toLocaleString("en-US"));
  setText("merkle-siblings", String(deployment.proof?.merkleSiblings ?? "—"));
  setText("continuity-roots", String(deployment.proof?.continuityRoots ?? "—"));
  setText("replay-result", deployment.verifiedState?.replayCallError || "Not tested");
  setText(
    "attestation-detail",
    proofTransaction
      ? `${deployment.proof?.transactionBytes?.toLocaleString("en-US") || "—"} proof bytes accepted on CC3`
      : "Waiting for an attested source block and proof submission",
  );

  const attestationStatus = byId("attestation-status");
  attestationStatus.textContent = proofTransaction ? "Proof accepted" : "Waiting for attestation";
  attestationStatus.className = `status ${proofTransaction ? "verified-status" : "waiting-status"}`;

  if (sourceTransaction) {
    setLink("source-transaction-link", `${sourceExplorer}/tx/${sourceTransaction}`, "Inspect Sepolia transaction ↗");
  } else {
    setPendingLink("source-transaction-link", "Source transaction pending");
  }
  if (proofTransaction) {
    setLink("proof-transaction-link", `${destinationExplorer}/tx/${proofTransaction}`, "Inspect Creditcoin transaction ↗");
  } else {
    setPendingLink("proof-transaction-link", "Creditcoin proof transaction pending");
  }

  const configuration = deployment.configuration;
  setText("issuer-id", configuration.issuerId);
  setText("source-chain-key", `${configuration.sourceChainKey} · ${networks.source.name}`);
  setLink("source-vault-link", `${sourceExplorer}/address/${configuration.sourceVault}`, shortHex(configuration.sourceVault));
  setLink("reserve-asset-link", `${sourceExplorer}/address/${configuration.reserveAsset}`, shortHex(configuration.reserveAsset));
  setLink("controller-link", `${destinationExplorer}/address/${deployment.address}`, shortHex(deployment.address));
  setLink("header-contract-link", `${destinationExplorer}/address/${deployment.address}`, "View contract ↗");

  const reserve = BigInt(deployment.verifiedState?.totalVerifiedReserve || pilot.amount || "0");
  const decimals = networks.source.reserveAsset.decimals;
  setText("reserve-value", `${formatUnits(reserve, decimals)} ${networks.source.reserveAsset.symbol}`);
  setText("reserve-detail", "Tracked on-chain evidence · refreshing live value");
}

async function loadLiveState(networks, deployment) {
  const rpcUrl = networks.destination.rpcUrl;
  const controllerAddress = deployment.address;
  const [blockNumberHex, reserveHex, issuerId, sourceChainKeyHex, sourceVaultHex, reserveAssetHex] = await Promise.all([
    rpc(rpcUrl, "eth_blockNumber"),
    contractCall(rpcUrl, controllerAddress, selectors.totalVerifiedReserve),
    contractCall(rpcUrl, controllerAddress, selectors.issuerId),
    contractCall(rpcUrl, controllerAddress, selectors.sourceChainKey),
    contractCall(rpcUrl, controllerAddress, selectors.sourceVault),
    contractCall(rpcUrl, controllerAddress, selectors.reserveAsset),
  ]);

  const latestBlock = await rpc(rpcUrl, "eth_getBlockByNumber", [blockNumberHex, false]);
  const blockNumber = decodeUint(blockNumberHex);
  const blockTimestamp = Number(decodeUint(latestBlock.timestamp));
  const blockAge = Math.max(0, Math.floor(Date.now() / 1000) - blockTimestamp);
  const reserve = decodeUint(reserveHex);
  const decimals = networks.source.reserveAsset.decimals;

  setText("reserve-value", `${formatUnits(reserve, decimals)} ${networks.source.reserveAsset.symbol}`);
  setText("reserve-detail", `Live contract read · CC3 block ${blockNumber.toLocaleString("en-US")}`);

  const matchesConfiguration =
    issuerId.toLowerCase() === deployment.configuration.issuerId.toLowerCase()
    && decodeUint(sourceChainKeyHex) === BigInt(deployment.configuration.sourceChainKey)
    && decodeAddress(sourceVaultHex)?.toLowerCase() === deployment.configuration.sourceVault.toLowerCase()
    && decodeAddress(reserveAssetHex)?.toLowerCase() === deployment.configuration.reserveAsset.toLowerCase();

  if (!matchesConfiguration) throw new Error("Live controller configuration differs from tracked deployment evidence");
  setText("configuration-source", `Live controller configuration matches tracked evidence at CC3 block ${blockNumber}.`);

  let tokenAddress = null;
  let bondVaultAddress = null;
  if (deployment.contract === "IssuerController") {
    [tokenAddress, bondVaultAddress] = await Promise.all([
      contractCall(rpcUrl, controllerAddress, selectors.token).then(decodeAddress),
      contractCall(rpcUrl, controllerAddress, selectors.bondVault).then(decodeAddress),
    ]);
  }

  if (tokenAddress) {
    const [supplyHex, tokenDecimalsHex] = await Promise.all([
      contractCall(rpcUrl, tokenAddress, selectors.totalSupply),
      contractCall(rpcUrl, tokenAddress, selectors.decimals),
    ]);
    const supply = decodeUint(supplyHex);
    const tokenDecimals = Number(decodeUint(tokenDecimalsHex));
    setText("supply-value", formatUnits(supply, tokenDecimals));
    setText("supply-detail", `Live issuer token · ${shortHex(tokenAddress)}`);
    setText("coverage-value", coveragePercent(reserve, supply) || "No supply");
    setText("coverage-detail", supply === 0n ? "Coverage starts when proven minting begins." : "Confirmed reserve ÷ current token supply");
  } else {
    setText("supply-value", "Pending");
    setText("supply-detail", "Current pilot controller records reserve; issuer token deployment is not claimed.");
    setText("coverage-value", "Unavailable");
    setText("coverage-detail", "Coverage will calculate from live reserve and token supply after deployment.");
  }

  if (bondVaultAddress) {
    const [balanceHex, activeHex, minimumHex] = await Promise.all([
      rpc(rpcUrl, "eth_getBalance", [bondVaultAddress, "latest"]),
      contractCall(rpcUrl, bondVaultAddress, selectors.active),
      contractCall(rpcUrl, bondVaultAddress, selectors.minimumBond),
    ]);
    const balance = decodeUint(balanceHex);
    const active = decodeUint(activeHex) === 1n;
    const minimum = decodeUint(minimumHex);
    setText("bond-value", `${formatUnits(balance, 18, 3)} CTC`);
    setText("bond-detail", `${active ? "Active" : "Inactive"} · minimum ${formatUnits(minimum, 18, 3)} CTC`);
  } else {
    setText("bond-value", "Pending");
    setText("bond-detail", "No CTC bond deployment is included in the current pilot evidence.");
  }

  const stale = blockAge > staleAfterSeconds;
  document.body.dataset.state = stale ? "stale" : "live";
  setText("state-icon", stale ? "!" : "✓");
  setText("system-state", stale ? "RPC data is stale" : "Pilot evidence verified");
  setText(
    "system-message",
    stale
      ? `The latest CC3 block is ${blockAge} seconds old. Values are shown, but freshness is outside the ${staleAfterSeconds}-second window.`
      : `Live controller reads match the recorded deployment. Latest CC3 block is ${blockAge} seconds old.`,
  );
  setText("updated-at", `Live read · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
}

async function refresh() {
  const button = byId("refresh-button");
  button.disabled = true;
  button.textContent = "Refreshing…";
  document.body.dataset.state = "waiting";

  try {
    const [networks, pilot, deployment] = await Promise.all([
      fetchJson("../config/networks.json"),
      fetchJson("../config/pilot.json"),
      fetchJson("../docs/deployments/creditcoin.json"),
    ]);
    applyTrackedEvidence(networks, pilot, deployment);
    await loadLiveState(networks, deployment);
  } catch (error) {
    document.body.dataset.state = "error";
    setText("state-icon", "×");
    setText("system-state", "Live read failed");
    setText("system-message", `${error instanceof Error ? error.message : String(error)}. Tracked evidence remains visible where available.`);
    setText("updated-at", "Live read unavailable");
  } finally {
    button.disabled = false;
    button.textContent = "Refresh live reads";
  }
}

byId("refresh-button").addEventListener("click", refresh);
refresh();
