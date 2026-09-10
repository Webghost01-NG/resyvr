const selectors = {
  totalVerifiedReserve: "0x884d15ee",
  issuancePaused: "0xc691af92",
  token: "0xfc0c546a",
  bondVault: "0x990826b3",
  totalSupply: "0x18160ddd",
  balanceOf: "0x70a08231",
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
let selectedIssuer = null;
let refreshRequest = 0;

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

function addressArgument(address) {
  return address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
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
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
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
    } catch (error) {
      lastError = error;
      if (attempt === 0) await new Promise((resolve) => window.setTimeout(resolve, 400));
    } finally {
      window.clearTimeout(timeout);
    }
  }
  throw lastError;
}

function contractCall(rpcUrl, address, data) {
  return rpc(rpcUrl, "eth_call", [{ to: address, data }, "latest"]);
}

function applyTrackedEvidence(networks, pilot, deployment) {
  const sourceExplorer = networks.source.explorerUrl;
  const destinationExplorer = networks.destination.explorerUrl;
  const sourceTransaction = pilot.depositTransactionHash || deployment.proof?.sourceTransactionHash;
  const proofTransaction = deployment.proof?.submissionTransactionHash || pilot.proofSubmissionTransactionHash;

  document.querySelector(".token-core .token-symbol").textContent = "rv";
  document.querySelector(".token-core strong").textContent = "USD";
  setText("coverage-title", "What the chain can prove now");
  document.querySelector("#coverage .source-note").textContent = "Live values use read-only JSON-RPC against the deployed pilot issuer contracts.";
  setText("proof-title", "One deposit. Three inspectable steps.");
  setText("source-evidence-status", sourceTransaction ? "Reserve locked" : "Vault configured");
  byId("source-evidence-status").className = `status ${sourceTransaction ? "verified-status" : "waiting-status"}`;
  setText("source-evidence-title", sourceTransaction ? "Reserve locked" : "Reserve not locked");
  setText(
    "source-evidence-description",
    sourceTransaction
      ? "Circle test USDC entered the immutable Sepolia reserve vault with a unique deposit ID."
      : "The source vault is configured, but no confirmed reserve deposit is recorded yet.",
  );
  setText("destination-evidence-status", proofTransaction ? "State updated" : "Waiting for proof");
  byId("destination-evidence-status").className = `status ${proofTransaction ? "verified-status" : "waiting-status"}`;
  setText("destination-evidence-title", proofTransaction ? "Reserve recorded" : "Reserve not recorded");

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

function applySelectedIssuerEvidence(networks, issuer) {
  const sourceExplorer = networks.source.explorerUrl;
  const destinationExplorer = networks.destination.explorerUrl;
  const symbol = issuer.symbol || "TOKEN";

  document.querySelector(".token-core .token-symbol").textContent = "";
  document.querySelector(".token-core strong").textContent = symbol;
  setText("coverage-title", `What ${symbol} can prove now`);
  document.querySelector("#coverage .source-note").textContent = `Live values for ${issuer.name || symbol} use its selected CC3 controller.`;
  setText("proof-title", `${symbol} issuance trail`);

  const reserveLocked = Boolean(issuer.depositTransaction && issuer.depositBlock && issuer.depositId);
  setText("source-evidence-status", reserveLocked ? "Reserve locked" : "Vault configured");
  byId("source-evidence-status").className = `status ${reserveLocked ? "verified-status" : "waiting-status"}`;
  setText("source-evidence-title", reserveLocked ? "Reserve locked" : "Reserve not locked");
  setText(
    "source-evidence-description",
    reserveLocked
      ? "Circle test USDC entered the immutable Sepolia reserve vault with a unique deposit ID."
      : "The issuer contracts and source vault exist, but this issuer has no confirmed reserve deposit yet.",
  );
  setText("source-block", issuer.depositBlock ? Number(issuer.depositBlock).toLocaleString("en-US") : "Pending");
  setText("deposit-id", issuer.depositId || "No reserve deposit yet");
  byId("deposit-id").title = issuer.depositId || "";
  if (issuer.depositTransaction) {
    setLink("source-transaction-link", `${sourceExplorer}/tx/${issuer.depositTransaction}`, "Inspect Sepolia transaction ↗");
  } else {
    setPendingLink("source-transaction-link", "Reserve deposit pending");
  }

  const proofAccepted = Boolean(issuer.proofTransaction);
  const attestationStatus = byId("attestation-status");
  attestationStatus.textContent = proofAccepted ? "Proof submitted" : "Awaiting proof";
  attestationStatus.className = `status ${proofAccepted ? "verified-status" : "waiting-status"}`;
  setText("merkle-siblings", proofAccepted ? "Verified" : "—");
  setText("continuity-roots", proofAccepted ? "Verified" : "—");
  setText("attestation-detail", proofAccepted ? "Proof accepted by the selected issuer controller" : "Complete the reserve deposit and generate its Attestcoin proof");
  setText("proof-block", proofAccepted ? "Confirmed" : "Pending");
  setText("replay-result", proofAccepted ? "Consumed" : "Not submitted");
  setText("destination-evidence-status", proofAccepted ? "State updated" : "Waiting for proof");
  byId("destination-evidence-status").className = `status ${proofAccepted ? "verified-status" : "waiting-status"}`;
  setText("destination-evidence-title", proofAccepted ? "Reserve recorded" : "Reserve not recorded");
  if (issuer.proofTransaction) {
    setLink("proof-transaction-link", `${destinationExplorer}/tx/${issuer.proofTransaction}`, "Inspect Creditcoin transaction ↗");
  } else {
    setPendingLink("proof-transaction-link", "Proof submission pending");
  }

  setText("issuer-id", issuer.issuerId);
  setText("source-chain-key", `${issuer.sourceChainKey} · ${networks.source.name}`);
  setLink("source-vault-link", `${sourceExplorer}/address/${issuer.sourceVault}`, shortHex(issuer.sourceVault));
  setLink("reserve-asset-link", `${sourceExplorer}/address/${issuer.reserveAsset}`, shortHex(issuer.reserveAsset));
  setLink("controller-link", `${destinationExplorer}/address/${issuer.controller}`, shortHex(issuer.controller));
  setLink("header-contract-link", `${destinationExplorer}/address/${issuer.controller}`, "View contract ↗");

  setText("reserve-value", "Reading…");
  setText("reserve-detail", `Selected issuer · ${symbol}`);
  setText("supply-value", "Reading…");
  setText("supply-detail", issuer.token ? `Token contract · ${shortHex(issuer.token)}` : "Reading token contract");
  setText("coverage-value", "Reading…");
  setText("coverage-detail", "Confirmed reserve ÷ current token supply");
  setText("bond-value", "Reading…");
  setText("bond-detail", "Reading the selected issuer bond vault");
}

function activeDeployment(baseDeployment, issuance) {
  if (!issuance.issuerController || !issuance.token || !issuance.bondVault || !issuance.proofSubmission) {
    return baseDeployment;
  }

  return {
    ...baseDeployment,
    contract: "IssuerController",
    address: issuance.issuerController,
    proof: {
      ...baseDeployment.proof,
      submissionTransactionHash: issuance.proofSubmission.transactionHash,
      submissionBlockNumber: issuance.proofSubmission.blockNumber,
      submissionGasUsed: issuance.proofSubmission.gasUsed,
      queryId: issuance.proofSubmission.queryId,
    },
  };
}

async function loadLiveState(networks, deployment, requestId) {
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
  if (requestId !== refreshRequest) return;

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
  const viewLabel = deployment.viewLabel || "Pilot";
  setText("configuration-source", `Live ${viewLabel} controller configuration matches at CC3 block ${blockNumber}.`);

  let tokenAddress = null;
  let bondVaultAddress = null;
  if (deployment.contract === "IssuerController") {
    [tokenAddress, bondVaultAddress] = await Promise.all([
      contractCall(rpcUrl, controllerAddress, selectors.token).then(decodeAddress),
      contractCall(rpcUrl, controllerAddress, selectors.bondVault).then(decodeAddress),
    ]);
  }

  if (tokenAddress) {
    const [supplyHex, tokenDecimalsHex, holderBalanceHex] = await Promise.all([
      contractCall(rpcUrl, tokenAddress, selectors.totalSupply),
      contractCall(rpcUrl, tokenAddress, selectors.decimals),
      deployment.holder
        ? contractCall(rpcUrl, tokenAddress, `${selectors.balanceOf}${addressArgument(deployment.holder)}`)
        : Promise.resolve(null),
    ]);
    if (requestId !== refreshRequest) return;
    const supply = decodeUint(supplyHex);
    const tokenDecimals = Number(decodeUint(tokenDecimalsHex));
    setText("supply-value", formatUnits(supply, tokenDecimals));
    const holderBalance = holderBalanceHex === null ? null : decodeUint(holderBalanceHex);
    setText(
      "supply-detail",
      holderBalance === null
        ? `Live issuer token · ${shortHex(tokenAddress)}`
        : `Your balance ${formatUnits(holderBalance, tokenDecimals)} ${deployment.symbol} · ${shortHex(tokenAddress)}`,
    );
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
    if (requestId !== refreshRequest) return;
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
  setText("system-state", stale ? "RPC data is stale" : `${viewLabel} live state verified`);
  setText(
    "system-message",
    stale
      ? `The latest CC3 block is ${blockAge} seconds old. Values are shown, but freshness is outside the ${staleAfterSeconds}-second window.`
      : `Live controller reads match ${viewLabel}. Latest CC3 block is ${blockAge} seconds old.`,
  );
  setText("updated-at", `Live read · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
}

async function refresh() {
  const requestId = ++refreshRequest;
  const button = byId("refresh-button");
  button.disabled = true;
  button.textContent = "↻";
  button.setAttribute("aria-label", "Refreshing live blockchain reads");
  document.body.dataset.state = "waiting";

  try {
    const [networks, pilot, baseDeployment, issuance] = await Promise.all([
      fetchJson("../config/networks.json"),
      fetchJson("../config/pilot.json"),
      fetchJson("../docs/deployments/creditcoin.json"),
      fetchJson("../config/issuance.json"),
    ]);
    if (requestId !== refreshRequest) return;
    let deployment;
    if (selectedIssuer) {
      applySelectedIssuerEvidence(networks, selectedIssuer);
      deployment = {
        contract: "IssuerController",
        address: selectedIssuer.controller,
        holder: selectedIssuer.account,
        symbol: selectedIssuer.symbol,
        viewLabel: `${selectedIssuer.name || selectedIssuer.symbol} (${selectedIssuer.symbol})`,
        configuration: {
          issuerId: selectedIssuer.issuerId,
          sourceChainKey: selectedIssuer.sourceChainKey,
          sourceVault: selectedIssuer.sourceVault,
          reserveAsset: selectedIssuer.reserveAsset,
        },
      };
    } else {
      deployment = activeDeployment(baseDeployment, issuance);
      applyTrackedEvidence(networks, pilot, deployment);
    }
    await loadLiveState(networks, deployment, requestId);
  } catch (error) {
    if (requestId !== refreshRequest) return;
    document.body.dataset.state = "error";
    setText("state-icon", "×");
    setText("system-state", "Live read failed");
    setText("system-message", `${error instanceof Error ? error.message : String(error)}. Tracked evidence remains visible where available.`);
    setText("updated-at", "Live read unavailable");
  } finally {
    if (requestId !== refreshRequest) return;
    button.disabled = false;
    button.textContent = "↻";
    button.setAttribute("aria-label", "Refresh live blockchain reads");
  }
}

byId("refresh-button").addEventListener("click", refresh);
window.addEventListener("resyvr:issuer-selected", (event) => {
  selectedIssuer = event.detail?.controller ? event.detail : null;
  void refresh();
});
refresh();
