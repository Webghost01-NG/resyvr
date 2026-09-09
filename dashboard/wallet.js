import {
  encodeApprove,
  encodeCreateIssuer,
  encodeDeposit,
  encodeExecuteDeposit,
  encodeSourceVaultDeployment,
  parseUnits,
} from "./encoding.mjs?v=11";

const ISSUER_CREATED_TOPIC = "0x75118ee2db244652d7ac3bbe9a9f199941ece831c61580f5a72e4b7fa9ef245a";
const RESERVE_DEPOSITED_TOPIC = "0x9ade6207680ee84077f86cc08de4f401b88731138ea5b583f09bd7266113453d";
const ISSUER_LOOKUP_SELECTOR = "0xc53a4413";
const TOKEN_SELECTOR = "0xfc0c546a";
const BOND_VAULT_SELECTOR = "0x990826b3";
const BOND_ACTIVE_SELECTOR = "0x02fb0c5e";
const BOND_MINIMUM_SELECTOR = "0xaa7517e1";
const SOURCE_EXECUTOR_SELECTOR = "0xacfb1e26";
const VERIFIED_DEPOSIT_SELECTOR = "0xe6d82c39";
const BALANCE_OF_SELECTOR = "0x70a08231";
const ALLOWANCE_SELECTOR = "0xdd62ed3e";
const STORAGE_KEY = "resyvr-issuer-flow-v2";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const flow = {
  mode: "new",
  account: null,
  factory: null,
  issuerId: null,
  tokenName: "",
  tokenSymbol: "",
  sourceVault: null,
  sourceVaultTransaction: null,
  creationTransaction: null,
  sourceExecutor: ZERO_ADDRESS,
  controller: null,
  token: null,
  bondVault: null,
  bondActive: false,
  bondFunded: false,
  minimumBondWei: null,
  approvalTransaction: null,
  bondTransaction: null,
  activationTransaction: null,
  depositTransaction: null,
  depositBlock: null,
  depositId: null,
  depositAmount: null,
  depositAccount: null,
  depositBeneficiary: null,
  reserveBalance: null,
  reserveAllowance: null,
  proofCalldata: null,
  proofTransaction: null,
  pendingAction: null,
};

let networks;
let pilot;
let issuance;
let sourceVaultDeployment;
let portfolioRequest = 0;
let proofRequest = 0;

function byId(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing wallet-flow element: ${id}`);
  return element;
}

function shortHex(value, front = 8, back = 6) {
  if (!value) return "—";
  return `${value.slice(0, front)}…${value.slice(-back)}`;
}

function wordAddress(value) {
  if (!value || value === "0x") return null;
  const normalized = value.replace(/^0x/, "").padStart(64, "0");
  const address = `0x${normalized.slice(-40)}`;
  return /^0x0{40}$/.test(address) ? null : address;
}

function randomBytes32() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function freshIssuerState() {
  return {
    mode: "new",
    issuerId: null,
    tokenName: "",
    tokenSymbol: "",
    sourceVault: null,
    sourceVaultTransaction: null,
    creationTransaction: null,
    sourceExecutor: ZERO_ADDRESS,
    controller: null,
    token: null,
    bondVault: null,
    bondActive: false,
    bondFunded: false,
    minimumBondWei: null,
    approvalTransaction: null,
    bondTransaction: null,
    activationTransaction: null,
    depositTransaction: null,
    depositBlock: null,
    depositId: null,
    depositAmount: null,
    depositAccount: null,
    depositBeneficiary: null,
    reserveBalance: null,
    reserveAllowance: null,
    proofCalldata: null,
    proofTransaction: null,
    pendingAction: null,
  };
}

function readTokenDraft() {
  const tokenName = byId("token-name").value.trim();
  const tokenSymbol = byId("token-symbol").value.trim().toUpperCase();
  if (tokenName.length < 3) throw new Error("Enter a token name with at least 3 characters");
  if (!/^[A-Z][A-Z0-9]{1,10}$/.test(tokenSymbol)) {
    throw new Error("Use a 2–11 character symbol beginning with a letter");
  }
  return { tokenName, tokenSymbol };
}

function loadSavedFlow() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (saved && typeof saved === "object") Object.assign(flow, saved);
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function saveFlow() {
  const {
    account: _account,
    reserveBalance: _reserveBalance,
    reserveAllowance: _reserveAllowance,
    ...persisted
  } = flow;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
}

function setActionState(id, message, status = "waiting", transactionHash = null, explorerUrl = null) {
  const element = byId(id);
  element.replaceChildren(document.createTextNode(message));
  element.dataset.state = status;
  if (transactionHash && explorerUrl) {
    const link = document.createElement("a");
    link.href = `${explorerUrl}/tx/${transactionHash}`;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = ` ${shortHex(transactionHash)} ↗`;
    element.append(link);
  }
}

function hasFinalActionState(id) {
  return ["success", "error"].includes(byId(id).dataset.state);
}

function friendlyError(error) {
  if (error?.code === 4001) return "Wallet request rejected. No successful action was recorded.";
  if (error?.code === -32002) return "MetaMask already has a request open.";
  if (typeof error?.message === "string" && error.message) return error.message;
  if (typeof error?.data?.message === "string" && error.data.message) return error.data.message;
  if (typeof error === "object" && error !== null) {
    try {
      return JSON.stringify(error);
    } catch {
      return "Wallet request failed with an unreadable provider error.";
    }
  }
  return error instanceof Error ? error.message : String(error);
}

function nextPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

async function fetchJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response.json();
}

async function publicRpc(rpcUrl, method, params = []) {
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
    if (error?.name === "AbortError") throw new Error(`${method} timed out`);
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function contractCall(rpcUrl, address, data) {
  return publicRpc(rpcUrl, "eth_call", [{ to: address, data }, "latest"]);
}

const chainDefinitions = {
  source: () => ({
    chainId: `0x${Number(networks.source.chainId).toString(16)}`,
    chainName: networks.source.name,
    nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: [networks.source.rpcUrl],
    blockExplorerUrls: [networks.source.explorerUrl],
  }),
  destination: () => ({
    chainId: `0x${Number(networks.destination.chainId).toString(16)}`,
    chainName: networks.destination.name,
    nativeCurrency: { name: "Creditcoin", symbol: "CTC", decimals: 18 },
    rpcUrls: [networks.destination.rpcUrl],
    blockExplorerUrls: [networks.destination.explorerUrl],
  }),
};

async function ensureChain(chainKey) {
  const provider = window.ethereum;
  if (!provider) throw new Error("MetaMask was not detected in this browser");
  const chain = chainDefinitions[chainKey]();
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chain.chainId }] });
  } catch (error) {
    if (error?.code !== 4902) throw error;
    await provider.request({ method: "wallet_addEthereumChain", params: [chain] });
  }
  flow.chainId = Number.parseInt(chain.chainId, 16);
  render();
}

async function prepareWalletRequest(chainKey, effect) {
  const chain = chainDefinitions[chainKey]();
  byId("signature-effect").textContent = `${chain.chainName}: ${effect}`;
  await nextPaint();
  await ensureChain(chainKey);
}

async function estimateBoundedGas(chainKey, transaction) {
  const rpcUrl = networks[chainKey].rpcUrl;
  const request = { from: flow.account, ...transaction };
  const [estimateHex, latestBlock] = await Promise.all([
    publicRpc(rpcUrl, "eth_estimateGas", [request]),
    publicRpc(rpcUrl, "eth_getBlockByNumber", ["latest", false]),
  ]);
  const estimate = BigInt(estimateHex);
  const blockLimit = BigInt(latestBlock?.gasLimit || "0x1c9c380");
  const rpcLimit = chainKey === "source" ? 16_000_000n : blockLimit;
  const safeLimit = (blockLimit < rpcLimit ? blockLimit : rpcLimit) * 9n / 10n;
  const buffered = estimate * 3n + 100_000n;
  if (estimate > safeLimit) {
    throw new Error(`Estimated gas ${estimate.toLocaleString("en-US")} exceeds this network's safe transaction limit`);
  }
  const gas = buffered < safeLimit ? buffered : safeLimit;
  return `0x${gas.toString(16)}`;
}

async function waitForReceipt(transactionHash, chainKey, timeoutMs = 300_000) {
  const startedAt = Date.now();
  const rpcUrl = networks[chainKey].rpcUrl;
  let transientFailures = 0;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const receipt = await publicRpc(rpcUrl, "eth_getTransactionReceipt", [transactionHash]);
      if (receipt) {
        if (BigInt(receipt.status || "0x0") !== 1n) throw new Error(`Transaction ${shortHex(transactionHash)} failed on-chain`);
        return receipt;
      }
      transientFailures = 0;
    } catch (error) {
      if (/failed on-chain/.test(error instanceof Error ? error.message : "")) throw error;
      transientFailures += 1;
      if (transientFailures >= 10) {
        const failure = new Error(`Receipt lookup is temporarily unavailable. Your transaction was submitted as ${shortHex(transactionHash)}; inspect it before retrying.`);
        failure.transactionHash = transactionHash;
        failure.explorerUrl = networks[chainKey].explorerUrl;
        throw failure;
      }
    }
    await new Promise((resolve) => window.setTimeout(resolve, 3_000));
  }
  const timeout = new Error(`Confirmation timed out for ${shortHex(transactionHash)}. Inspect the submitted transaction before retrying.`);
  timeout.transactionHash = transactionHash;
  timeout.explorerUrl = networks[chainKey].explorerUrl;
  throw timeout;
}

async function sendWalletTransaction(chainKey, transaction, effect, onSubmitted = null) {
  if (!flow.account) throw new Error("Connect MetaMask first");
  await prepareWalletRequest(chainKey, effect);
  const gas = await estimateBoundedGas(chainKey, transaction);
  const transactionHash = await window.ethereum.request({
    method: "eth_sendTransaction",
    params: [{ from: flow.account, ...transaction, gas }],
  });
  if (onSubmitted) onSubmitted(transactionHash);
  const receipt = await waitForReceipt(transactionHash, chainKey);
  return { transactionHash, receipt };
}

function recordPendingAction(action, chainKey, stateId, message, context = {}) {
  return (transactionHash) => {
    flow.pendingAction = { action, chainKey, stateId, transactionHash, account: flow.account, context };
    saveFlow();
    setActionState(stateId, message, "waiting", transactionHash, networks[chainKey].explorerUrl);
    render();
  };
}

function clearPendingAction(transactionHash) {
  if (flow.pendingAction?.transactionHash === transactionHash) {
    flow.pendingAction = null;
  }
}

function createdControllerFromReceipt(receipt) {
  const event = receipt.logs?.find(
    (log) => log.address?.toLowerCase() === flow.factory.toLowerCase()
      && log.topics?.[0]?.toLowerCase() === ISSUER_CREATED_TOPIC,
  );
  if (!event?.topics?.[3]) throw new Error("IssuerCreated event was not found in the successful receipt");
  const controller = wordAddress(event.topics[3]);
  if (!controller) throw new Error("IssuerCreated returned an invalid controller address");
  return controller;
}

async function applyRecoveredAction(pending, receipt) {
  const { action, transactionHash, context } = pending;
  if (action === "sourceVault") {
    if (!receipt.contractAddress) throw new Error("Confirmed vault deployment has no contract address");
    flow.sourceVault = receipt.contractAddress;
    flow.sourceVaultTransaction = transactionHash;
    flow.sourceExecutor = networks.source.transactionExecutor || ZERO_ADDRESS;
    await refreshReserveFunds().catch(() => {});
    setActionState("source-vault-state", `Reserve vault recovered: ${shortHex(flow.sourceVault)}`, "success", transactionHash, networks.source.explorerUrl);
  } else if (action === "createIssuer") {
    flow.creationTransaction = transactionHash;
    flow.controller = createdControllerFromReceipt(receipt);
    await resolveIssuerAddresses();
    setActionState("create-state", "Issuer creation recovered and confirmed.", "success", transactionHash, networks.destination.explorerUrl);
    void refreshIssuerPortfolio();
  } else if (action === "depositBond") {
    flow.bondTransaction = transactionHash;
    flow.bondFunded = true;
    setActionState("bond-state", "CTC bond deposit recovered. Activate issuance next.", "success", transactionHash, networks.destination.explorerUrl);
  } else if (action === "activateBond") {
    flow.activationTransaction = transactionHash;
    flow.bondActive = true;
    setActionState("bond-state", "Issuance activation recovered and confirmed.", "success", transactionHash, networks.destination.explorerUrl);
  } else if (action === "approveReserve") {
    flow.approvalTransaction = transactionHash;
    await refreshReserveFunds().catch(() => {});
    setActionState("deposit-state", "Approval recovered. Deposit the reserve next.", "success", transactionHash, networks.source.explorerUrl);
  } else if (action === "depositReserve") {
    flow.depositTransaction = transactionHash;
    flow.depositBlock = Number(BigInt(receipt.blockNumber));
    flow.depositId = context.depositId;
    flow.depositAmount = context.amount;
    flow.depositAccount = context.account;
    flow.depositBeneficiary = context.beneficiary || context.account;
    flow.proofCalldata = null;
    flow.proofTransaction = null;
    await refreshReserveFunds().catch(() => {});
    setActionState("deposit-state", `Reserve deposit recovered in Sepolia block ${flow.depositBlock}.`, "success", transactionHash, networks.source.explorerUrl);
  } else if (action === "submitProof") {
    flow.proofTransaction = transactionHash;
    setActionState("mint-state", "Proof submission recovered and mint confirmed.", "success", transactionHash, networks.destination.explorerUrl);
    byId("refresh-button").click();
  }
  clearPendingAction(transactionHash);
  saveFlow();
  render();
  emitIssuerView();
}

async function recoverPendingAction() {
  const pending = flow.pendingAction;
  if (!pending?.transactionHash || !pending.chainKey || !pending.stateId) return;
  const explorerUrl = networks[pending.chainKey].explorerUrl;
  if (pending.account && flow.account?.toLowerCase() !== pending.account.toLowerCase()) {
    setActionState(
      pending.stateId,
      `Reconnect ${shortHex(pending.account, 6, 4)} to recover its submitted transaction.`,
      "waiting",
      pending.transactionHash,
      explorerUrl,
    );
    return;
  }
  try {
    const receipt = await publicRpc(
      networks[pending.chainKey].rpcUrl,
      "eth_getTransactionReceipt",
      [pending.transactionHash],
    );
    if (!receipt) {
      setActionState(pending.stateId, "Submitted transaction is still pending.", "waiting", pending.transactionHash, explorerUrl);
      return;
    }
    if (BigInt(receipt.status || "0x0") !== 1n) {
      clearPendingAction(pending.transactionHash);
      saveFlow();
      setActionState(pending.stateId, "Submitted transaction failed on-chain. It is safe to retry.", "error", pending.transactionHash, explorerUrl);
      render();
      return;
    }
    await applyRecoveredAction(pending, receipt);
  } catch (error) {
    setActionState(
      pending.stateId,
      `Could not recover the submitted transaction yet: ${friendlyError(error)}`,
      "error",
      pending.transactionHash,
      explorerUrl,
    );
  }
}

function decodeAbiString(data) {
  if (!/^0x[0-9a-f]+$/i.test(data || "") || data.length < 130) return "";
  try {
    const offset = Number(BigInt(`0x${data.slice(2, 66)}`));
    const lengthOffset = 2 + offset * 2;
    const length = Number(BigInt(`0x${data.slice(lengthOffset, lengthOffset + 64)}`));
    const valueOffset = lengthOffset + 64;
    const bytes = data.slice(valueOffset, valueOffset + length * 2).match(/.{2}/g) || [];
    return new TextDecoder().decode(Uint8Array.from(bytes, (byte) => Number.parseInt(byte, 16)));
  } catch {
    return "";
  }
}

function addressTopic(address) {
  return `0x${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
}

function addressArgument(address) {
  return address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

function formatReserveUnits(value) {
  const decimals = networks.source.reserveAsset.decimals;
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole.toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}`;
}

async function refreshReserveFunds() {
  if (!flow.account || !flow.sourceVault) {
    flow.reserveBalance = null;
    flow.reserveAllowance = null;
    return;
  }
  const asset = networks.source.reserveAsset.address;
  const owner = addressArgument(flow.account);
  const spender = addressArgument(flow.sourceVault);
  const [balance, allowance] = await Promise.all([
    contractCall(networks.source.rpcUrl, asset, `${BALANCE_OF_SELECTOR}${owner}`),
    contractCall(networks.source.rpcUrl, asset, `${ALLOWANCE_SELECTOR}${owner}${spender}`),
  ]);
  flow.reserveBalance = BigInt(balance || "0x0").toString();
  flow.reserveAllowance = BigInt(allowance || "0x0").toString();
}

function renderIssuerPortfolio(assets) {
  const section = byId("issuer-portfolio");
  const list = byId("issuer-asset-list");
  list.replaceChildren();
  section.hidden = assets.length < 2;
  if (assets.length < 2) return;

  byId("issuer-portfolio-count").textContent = `${assets.length} assets created by this wallet`;
  for (const asset of assets) {
    const card = document.createElement("article");
    card.className = "issuer-asset-card";
    if (flow.issuerId?.toLowerCase() === asset.issuerId.toLowerCase()) card.classList.add("selected");

    const titleRow = document.createElement("div");
    titleRow.className = "issuer-asset-title";
    const title = document.createElement("h4");
    title.textContent = asset.name || "Issuer token";
    const symbol = document.createElement("span");
    symbol.textContent = asset.symbol || "TOKEN";
    titleRow.append(title, symbol);

    const tokenLink = document.createElement("a");
    tokenLink.className = "mono issuer-token-link";
    tokenLink.href = `${networks.destination.explorerUrl}/address/${asset.token}`;
    tokenLink.target = "_blank";
    tokenLink.rel = "noreferrer";
    tokenLink.textContent = asset.token;

    const detail = document.createElement("p");
    detail.textContent = `CC3 Testnet · ${asset.decimals} decimals · created at block ${asset.blockNumber.toLocaleString("en-US")}`;

    const actions = document.createElement("div");
    actions.className = "issuer-asset-actions";
    const controllerLink = document.createElement("a");
    controllerLink.href = `${networks.destination.explorerUrl}/address/${asset.controller}`;
    controllerLink.target = "_blank";
    controllerLink.rel = "noreferrer";
    controllerLink.textContent = "View controller ↗";
    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.textContent = "Copy token address";
    copyButton.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(asset.token);
        copyButton.textContent = "Address copied";
        window.setTimeout(() => { copyButton.textContent = "Copy token address"; }, 1_800);
      } catch {
        copyButton.textContent = "Copy failed";
      }
    });
    const manageButton = document.createElement("button");
    manageButton.type = "button";
    manageButton.textContent = card.classList.contains("selected") ? "Managing" : "Manage issuer";
    manageButton.disabled = card.classList.contains("selected") || Boolean(flow.pendingAction);
    manageButton.addEventListener("click", () => void selectIssuer(asset, manageButton));
    actions.append(manageButton, controllerLink, copyButton);
    card.append(titleRow, tokenLink, detail, actions);
    list.append(card);
  }
}

async function refreshIssuerPortfolio() {
  const requestId = ++portfolioRequest;
  if (!flow.account || !issuance?.factory) {
    renderIssuerPortfolio([]);
    return;
  }
  try {
    const fromBlock = issuance.factoryDeployment?.blockNumber || 0;
    const logs = await publicRpc(networks.destination.rpcUrl, "eth_getLogs", [{
      address: issuance.factory,
      fromBlock: `0x${Number(fromBlock).toString(16)}`,
      toBlock: "latest",
      topics: [ISSUER_CREATED_TOPIC, null, addressTopic(flow.account)],
    }]);
    if (requestId !== portfolioRequest || logs.length < 2) {
      if (requestId === portfolioRequest) renderIssuerPortfolio([]);
      return;
    }

    const assets = await Promise.all(logs.slice(-20).reverse().map(async (log) => {
      const words = log.data.slice(2).match(/.{64}/g) || [];
      const token = wordAddress(words[0]);
      const [nameResult, symbolResult] = await Promise.all([
        contractCall(networks.destination.rpcUrl, token, "0x06fdde03").catch(() => "0x"),
        contractCall(networks.destination.rpcUrl, token, "0x95d89b41").catch(() => "0x"),
      ]);
      return {
        issuerId: log.topics[1],
        controller: wordAddress(log.topics[3]),
        token,
        sourceVault: wordAddress(words[2]),
        sourceExecutor: wordAddress(words[3]) || ZERO_ADDRESS,
        reserveAsset: wordAddress(words[4]),
        bondVault: wordAddress(words[7]),
        name: decodeAbiString(nameResult),
        symbol: decodeAbiString(symbolResult),
        decimals: Number(BigInt(`0x${words[5] || "0"}`)),
        blockNumber: Number(BigInt(log.blockNumber)),
        creationTransaction: log.transactionHash,
      };
    }));
    if (requestId === portfolioRequest) renderIssuerPortfolio(assets.filter((asset) => asset.token && asset.controller));
  } catch {
    if (requestId === portfolioRequest) renderIssuerPortfolio([]);
  }
}

async function latestUnconsumedDeposit(asset) {
  const latestHex = await publicRpc(networks.source.rpcUrl, "eth_blockNumber");
  const latest = Number(BigInt(latestHex));
  const chunkSize = 25_000;
  const oldest = Math.max(0, latest - 250_000);
  for (let toBlock = latest; toBlock >= oldest; toBlock -= chunkSize) {
    const fromBlock = Math.max(oldest, toBlock - chunkSize + 1);
    const logs = await publicRpc(networks.source.rpcUrl, "eth_getLogs", [{
      address: asset.sourceVault,
      fromBlock: `0x${fromBlock.toString(16)}`,
      toBlock: `0x${toBlock.toString(16)}`,
      topics: [RESERVE_DEPOSITED_TOPIC, asset.issuerId],
    }]);
    for (const log of logs.reverse()) {
      const depositId = log.topics[2];
      const consumed = await contractCall(
        networks.destination.rpcUrl,
        asset.controller,
        `${VERIFIED_DEPOSIT_SELECTOR}${depositId.slice(2)}`,
      );
      if (BigInt(consumed || "0x0") !== 0n) continue;
      return {
        transactionHash: log.transactionHash,
        blockNumber: Number(BigInt(log.blockNumber)),
        depositId,
        beneficiary: wordAddress(log.topics[3]),
        depositor: wordAddress(log.data.slice(2, 66)),
        amount: BigInt(`0x${log.data.slice(-64)}`).toString(),
      };
    }
  }
  return null;
}

async function selectIssuer(asset, button) {
  if (flow.pendingAction) return;
  const account = flow.account;
  const chainId = flow.chainId;
  button.disabled = true;
  button.textContent = "Loading issuer…";
  resetDisplayedFlow();
  Object.assign(flow, freshIssuerState(), {
    account,
    chainId,
    mode: "managed",
    factory: issuance.factory,
    issuerId: asset.issuerId,
    tokenName: asset.name || "Issuer token",
    tokenSymbol: asset.symbol || "TOKEN",
    sourceVault: asset.sourceVault,
    sourceExecutor: asset.sourceExecutor,
    controller: asset.controller,
    token: asset.token,
    bondVault: asset.bondVault,
    creationTransaction: asset.creationTransaction,
  });
  try {
    await resolveIssuerAddresses();
    await refreshReserveFunds().catch(() => {});
    const deposit = await latestUnconsumedDeposit(asset);
    if (deposit) {
      flow.depositTransaction = deposit.transactionHash;
      flow.depositBlock = deposit.blockNumber;
      flow.depositId = deposit.depositId;
      flow.depositAmount = deposit.amount;
      flow.depositAccount = deposit.depositor;
      flow.depositBeneficiary = deposit.beneficiary;
    }
    saveFlow();
    render();
    emitIssuerView();
    void refreshIssuerPortfolio();
    byId("launch").scrollIntoView({ behavior: "smooth", block: "start" });
    byId("signature-effect").textContent = deposit
      ? `Issuer restored with an unconsumed Sepolia deposit from block ${deposit.blockNumber.toLocaleString("en-US")}.`
      : "Issuer restored from on-chain state. No unconsumed reserve deposit was found; approve and deposit a new reserve amount.";
  } catch (error) {
    button.disabled = false;
    button.textContent = "Manage issuer";
    byId("signature-effect").textContent = `Could not restore issuer: ${friendlyError(error)}`;
  }
}

async function recoverSourceVaultDeployment() {
  if (flow.mode !== "new" || !flow.account || !flow.issuerId || flow.sourceVault) return;
  const rpcUrl = networks.source.rpcUrl;
  try {
    let transactionHash = flow.sourceVaultTransaction;
    if (!transactionHash) {
      const expectedInput = encodeSourceVaultDeployment(
        sourceVaultDeployment.creationBytecode,
        networks.source.reserveAsset.address,
        flow.issuerId,
      ).toLowerCase();
      const latestHex = await publicRpc(rpcUrl, "eth_blockNumber");
      const latest = Number(BigInt(latestHex));
      for (let offset = 0; offset < 32 && !transactionHash; offset += 1) {
        const blockNumber = latest - offset;
        const block = await publicRpc(rpcUrl, "eth_getBlockByNumber", [`0x${blockNumber.toString(16)}`, true]);
        const transaction = block?.transactions?.find(
          (candidate) => candidate.from?.toLowerCase() === flow.account.toLowerCase()
            && (candidate.input || candidate.data || "").toLowerCase() === expectedInput,
        );
        transactionHash = transaction?.hash || null;
      }
    }
    if (!transactionHash) return;

    flow.sourceVaultTransaction = transactionHash;
    saveFlow();
    const receipt = await publicRpc(rpcUrl, "eth_getTransactionReceipt", [transactionHash]);
    if (!receipt) {
      setActionState(
        "source-vault-state",
        "Previous deployment found and still waiting for confirmation.",
        "waiting",
        transactionHash,
        networks.source.explorerUrl,
      );
      return;
    }
    if (BigInt(receipt.status || "0x0") !== 1n || !receipt.contractAddress) {
      setActionState(
        "source-vault-state",
        "The previous reserve-vault deployment failed on-chain. You can retry safely.",
        "error",
        transactionHash,
        networks.source.explorerUrl,
      );
      return;
    }
    flow.sourceVault = receipt.contractAddress;
    flow.sourceExecutor = networks.source.transactionExecutor || ZERO_ADDRESS;
    await refreshReserveFunds().catch(() => {});
    saveFlow();
    setActionState(
      "source-vault-state",
      `Recovered confirmed reserve vault: ${shortHex(flow.sourceVault)}`,
      "success",
      transactionHash,
      networks.source.explorerUrl,
    );
    render();
  } catch {
    // Recovery is best-effort. The normal deployment button remains available.
  }
}

async function resolveIssuerAddresses() {
  flow.factory = issuance.factory || flow.factory;
  if (flow.mode === "pilot") {
    flow.issuerId = pilot.issuerId;
    flow.tokenName = issuance.tokenName;
    flow.tokenSymbol = issuance.tokenSymbol;
    flow.sourceVault = pilot.sourceVault;
    flow.sourceExecutor = pilot.sourceExecutor;
    flow.controller = issuance.issuerController;
    flow.token = issuance.token;
    flow.bondVault = issuance.bondVault;
  }

  if (!flow.controller && flow.factory && flow.issuerId) {
    const result = await contractCall(
      networks.destination.rpcUrl,
      flow.factory,
      `${ISSUER_LOOKUP_SELECTOR}${flow.issuerId.slice(2)}`,
    );
    const words = result.slice(2).match(/.{64}/g) || [];
    flow.controller = wordAddress(words[5]);
    flow.token = wordAddress(words[6]);
    flow.bondVault = wordAddress(words[7]);
  }

  if (flow.controller) {
    const [tokenResult, bondResult, executorResult] = await Promise.all([
      contractCall(networks.destination.rpcUrl, flow.controller, TOKEN_SELECTOR),
      contractCall(networks.destination.rpcUrl, flow.controller, BOND_VAULT_SELECTOR),
      contractCall(networks.destination.rpcUrl, flow.controller, SOURCE_EXECUTOR_SELECTOR),
    ]);
    flow.token = wordAddress(tokenResult) || flow.token;
    flow.bondVault = wordAddress(bondResult) || flow.bondVault;
    flow.sourceExecutor = wordAddress(executorResult) || ZERO_ADDRESS;
  }
  if (flow.bondVault) {
    const [activeResult, minimumResult, balanceResult] = await Promise.all([
      contractCall(networks.destination.rpcUrl, flow.bondVault, BOND_ACTIVE_SELECTOR),
      contractCall(networks.destination.rpcUrl, flow.bondVault, BOND_MINIMUM_SELECTOR),
      publicRpc(networks.destination.rpcUrl, "eth_getBalance", [flow.bondVault, "latest"]),
    ]);
    flow.bondActive = BigInt(activeResult || "0x0") === 1n;
    flow.minimumBondWei = BigInt(minimumResult).toString();
    flow.bondFunded = BigInt(balanceResult || "0x0") >= BigInt(flow.minimumBondWei);
  }
  saveFlow();
}

function validTokenDraft() {
  return byId("token-name").value.trim().length >= 3
    && /^[A-Za-z][A-Za-z0-9]{1,10}$/.test(byId("token-symbol").value.trim());
}

function chainLabel(chainId) {
  if (!chainId || !networks) return "Network changes happen automatically per step";
  if (Number(chainId) === Number(networks.source.chainId)) return "Ethereum Sepolia · ready for reserve actions";
  if (Number(chainId) === Number(networks.destination.chainId)) return "Creditcoin CC3 · ready for issuer actions";
  return `Chain ${Number(chainId)} · Resyvr will switch when required`;
}

function render() {
  const connected = Boolean(flow.account);
  const transactionPending = Boolean(flow.pendingAction);
  const walletAccount = byId("wallet-account");
  walletAccount.textContent = connected ? shortHex(flow.account, 6, 4) : "Connect a wallet to begin";
  walletAccount.title = connected ? flow.account : "";
  byId("wallet-network").textContent = connected ? chainLabel(flow.chainId) : "MetaMask · no signature on connection";
  byId("connect-wallet").textContent = connected ? "Change wallet" : "Connect wallet ↗";
  byId("wallet-avatar").textContent = connected ? flow.account.slice(2, 4).toUpperCase() : "W";
  byId("wallet-avatar").style.setProperty("--wallet-hue", connected ? String(Number.parseInt(flow.account.slice(2, 4), 16) + 180) : "250");
  byId("reserve-beneficiary").placeholder = connected ? flow.account : "Connect a wallet first";

  const pilotMode = flow.mode === "pilot";
  const tokenNameInput = byId("token-name");
  const tokenSymbolInput = byId("token-symbol");
  if (document.activeElement !== tokenNameInput) tokenNameInput.value = flow.tokenName || "";
  if (document.activeElement !== tokenSymbolInput) tokenSymbolInput.value = flow.tokenSymbol || "";
  tokenNameInput.disabled = pilotMode || Boolean(flow.sourceVault);
  tokenSymbolInput.disabled = pilotMode || Boolean(flow.sourceVault);
  byId("issuer-draft-id").textContent = flow.issuerId ? shortHex(flow.issuerId, 10, 8) : "Generated when you deploy";
  byId("issuer-draft-id").title = flow.issuerId || "";
  byId("load-pilot").hidden = pilotMode;
  byId("start-new-issuer").hidden = !pilotMode && !flow.sourceVault;
  byId("use-pilot-deposit").hidden = !pilotMode;

  const tokenResult = byId("token-result");
  tokenResult.hidden = !flow.token;
  if (flow.token) {
    byId("token-result-name").textContent = flow.tokenName || "Issuer token";
    byId("token-result-symbol").textContent = flow.tokenSymbol ? `(${flow.tokenSymbol})` : "";
    const tokenLink = byId("token-address-link");
    tokenLink.textContent = flow.token;
    tokenLink.href = `${networks.destination.explorerUrl}/address/${flow.token}`;
    tokenLink.title = `Open ${flow.token} in the Creditcoin explorer`;
  }

  byId("deploy-source-vault").disabled = transactionPending || !connected || pilotMode || Boolean(flow.sourceVault) || !validTokenDraft();
  byId("create-issuer").disabled = transactionPending || !connected || !flow.factory || !flow.sourceVault || Boolean(flow.controller);
  byId("deposit-bond").disabled = transactionPending || !connected || !flow.bondVault || flow.bondActive || flow.bondFunded;
  byId("activate-bond").disabled = transactionPending || !connected || !flow.bondVault || flow.bondActive || !flow.bondFunded;
  let reserveAmount = null;
  try {
    reserveAmount = selectedReserveAmount();
  } catch {
    reserveAmount = null;
  }
  const reserveBalance = flow.reserveBalance === null ? null : BigInt(flow.reserveBalance);
  const reserveAllowance = flow.reserveAllowance === null ? null : BigInt(flow.reserveAllowance);
  const hasReserveBalance = reserveAmount !== null && reserveBalance !== null && reserveBalance >= reserveAmount;
  const hasReserveAllowance = reserveAmount !== null && reserveAllowance !== null && reserveAllowance >= reserveAmount;
  byId("approve-reserve").disabled = transactionPending || !connected || !flow.controller || !flow.bondActive || !hasReserveBalance || hasReserveAllowance;
  byId("deposit-reserve").disabled = transactionPending || !connected || !flow.controller || !flow.bondActive || !hasReserveBalance || !hasReserveAllowance || !validReserveBeneficiary();
  byId("use-pilot-deposit").disabled = !connected || !pilotMode || Boolean(flow.proofTransaction);
  byId("generate-proof").disabled = !flow.depositTransaction || !flow.depositBlock || Boolean(flow.proofCalldata);
  byId("submit-proof").disabled = transactionPending || !connected || !flow.controller || !flow.proofCalldata;

  if (flow.sourceVault && !hasFinalActionState("source-vault-state")) {
    setActionState(
      "source-vault-state",
      `${pilotMode ? "Pilot" : "Your"} vault is ready: ${shortHex(flow.sourceVault)}`,
      "success",
      flow.sourceVaultTransaction,
      networks.source.explorerUrl,
    );
  } else if (connected && !validTokenDraft() && !hasFinalActionState("source-vault-state")) {
    setActionState("source-vault-state", "Enter a token name and 2–11 character symbol.");
  } else if (connected && !hasFinalActionState("source-vault-state")) {
    setActionState("source-vault-state", "Ready to create your isolated reserve vault on Sepolia.");
  }

  if (flow.controller && !hasFinalActionState("create-state")) {
    setActionState("create-state", `Token system ready: ${shortHex(flow.controller)}`, "success");
  } else if (flow.sourceVault && !hasFinalActionState("create-state")) {
    setActionState("create-state", "Reserve vault confirmed. Create the token system on Creditcoin CC3.");
  }
  if (flow.bondVault && !hasFinalActionState("bond-state")) {
    const message = flow.bondActive
      ? `Bond active. Vault: ${shortHex(flow.bondVault)}`
      : flow.bondFunded
        ? "Bond deposit confirmed. Activate issuance next."
        : `Bond vault ready: ${shortHex(flow.bondVault)}`;
    setActionState("bond-state", message, flow.bondActive ? "success" : "waiting");
  }
  if (flow.depositTransaction && !hasFinalActionState("deposit-state")) {
    setActionState(
      "deposit-state",
      `Reserve deposit confirmed in Sepolia block ${flow.depositBlock}.`,
      "success",
      flow.depositTransaction,
      networks.source.explorerUrl,
    );
  } else if (connected && flow.controller && flow.bondActive && !hasFinalActionState("deposit-state")) {
    const symbol = networks.source.reserveAsset.symbol;
    if (reserveAmount === null) {
      setActionState("deposit-state", "Enter a valid reserve amount greater than zero.", "error");
    } else if (reserveBalance === null || reserveAllowance === null) {
      setActionState("deposit-state", "Checking your live USDC balance and vault allowance…");
    } else if (!validReserveBeneficiary()) {
      setActionState("deposit-state", "Enter a valid non-zero recipient wallet address.", "error");
    } else if (!hasReserveBalance) {
      setActionState("deposit-state", `Wallet has ${formatReserveUnits(reserveBalance)} ${symbol}; enter that amount or less.`, "error");
    } else if (!hasReserveAllowance) {
      setActionState("deposit-state", `Wallet has ${formatReserveUnits(reserveBalance)} ${symbol}. Approve the entered amount next.`);
    } else {
      setActionState("deposit-state", `Balance and ${formatReserveUnits(reserveAllowance)} ${symbol} allowance confirmed. Deposit the reserve next.`, "success");
    }
  }
  if (flow.proofCalldata && !hasFinalActionState("proof-generation-state")) {
    setActionState("proof-generation-state", "Proof is ready and validated for submission.", "success");
  }
  if (flow.proofTransaction && !hasFinalActionState("mint-state")) {
    setActionState(
      "mint-state",
      "Proof accepted and mint transaction confirmed.",
      "success",
      flow.proofTransaction,
      networks.destination.explorerUrl,
    );
  }
}

async function connectWallet() {
  try {
    if (!window.ethereum) throw new Error("MetaMask was not detected in this browser");
    byId("signature-effect").textContent = flow.account
      ? "Choose the account that will administer this issuer. No transaction or message signature is requested."
      : "Connect MetaMask. This requests account access only; no transaction or message signature.";
    await nextPaint();
    if (flow.account) {
      await window.ethereum.request({
        method: "wallet_requestPermissions",
        params: [{ eth_accounts: {} }],
      });
    }
    const accounts = await window.ethereum.request({ method: flow.account ? "eth_accounts" : "eth_requestAccounts" });
    flow.account = accounts[0] || null;
    flow.chainId = Number.parseInt(await window.ethereum.request({ method: "eth_chainId" }), 16);
    await refreshReserveFunds().catch(() => {});
    render();
    emitIssuerView();
    void refreshIssuerPortfolio();
  } catch (error) {
    byId("signature-effect").textContent = friendlyError(error);
  }
}

function resetDisplayedFlow() {
  proofRequest += 1;
  byId("reserve-beneficiary").value = "";
  byId("attestation-progress").hidden = true;
  byId("attestation-progress-bar").style.width = "0%";
  const states = {
    "source-vault-state": "Connect your wallet and define the token.",
    "create-state": "A confirmed Sepolia reserve vault is required.",
    "bond-state": "Create the token system first.",
    "deposit-state": "Activate the issuer before depositing reserves.",
    "proof-generation-state": "A successful reserve deposit is required.",
    "mint-state": "A generated proof is required.",
  };
  for (const [id, message] of Object.entries(states)) {
    const element = byId(id);
    element.replaceChildren(document.createTextNode(message));
    delete element.dataset.state;
  }
}

function issuerViewDetail() {
  if (!flow.controller || flow.mode === "pilot") return null;
  return {
    account: flow.account,
    name: flow.tokenName || "Issuer token",
    symbol: flow.tokenSymbol || "TOKEN",
    issuerId: flow.issuerId,
    controller: flow.controller,
    token: flow.token,
    bondVault: flow.bondVault,
    sourceChainKey: networks.source.attestcoinChainKey,
    sourceVault: flow.sourceVault,
    reserveAsset: networks.source.reserveAsset.address,
    depositTransaction: flow.depositTransaction,
    depositBlock: flow.depositBlock,
    depositId: flow.depositId,
    proofTransaction: flow.proofTransaction,
  };
}

function emitIssuerView() {
  window.dispatchEvent(new CustomEvent("resyvr:issuer-selected", { detail: issuerViewDetail() }));
}

async function deploySourceVault() {
  const button = byId("deploy-source-vault");
  button.disabled = true;
  try {
    const { tokenName, tokenSymbol } = readTokenDraft();
    flow.tokenName = tokenName;
    flow.tokenSymbol = tokenSymbol;
    flow.issuerId ||= randomBytes32();
    saveFlow();
    render();
    setActionState("source-vault-state", "Waiting for the Sepolia deployment signature…");
    const data = encodeSourceVaultDeployment(
      sourceVaultDeployment.creationBytecode,
      networks.source.reserveAsset.address,
      flow.issuerId,
    );
    const { transactionHash, receipt } = await sendWalletTransaction(
      "source",
      { data },
      `Deploy an isolated ${networks.source.reserveAsset.symbol} reserve vault for ${flow.tokenSymbol}. No tokens move in this transaction.`,
      recordPendingAction("sourceVault", "source", "source-vault-state", "Deployment submitted. Waiting for Sepolia confirmation…"),
    );
    if (!receipt.contractAddress) throw new Error("Successful vault deployment did not return a contract address");
    flow.sourceVault = receipt.contractAddress;
    flow.sourceVaultTransaction = transactionHash;
    flow.sourceExecutor = networks.source.transactionExecutor || ZERO_ADDRESS;
    await refreshReserveFunds().catch(() => {});
    clearPendingAction(transactionHash);
    saveFlow();
    setActionState(
      "source-vault-state",
      `Reserve vault deployed: ${shortHex(flow.sourceVault)}`,
      "success",
      transactionHash,
      networks.source.explorerUrl,
    );
  } catch (error) {
    setActionState(
      "source-vault-state",
      friendlyError(error),
      "error",
      error?.transactionHash || flow.sourceVaultTransaction,
      error?.explorerUrl || networks.source.explorerUrl,
    );
  } finally {
    render();
  }
}

async function loadPilotIssuer() {
  resetDisplayedFlow();
  Object.assign(flow, freshIssuerState(), {
    account: flow.account,
    chainId: flow.chainId,
    factory: issuance.factory,
    mode: "pilot",
    issuerId: pilot.issuerId,
    tokenName: issuance.tokenName,
    tokenSymbol: issuance.tokenSymbol,
    sourceVault: pilot.sourceVault,
    sourceExecutor: pilot.sourceExecutor,
    sourceVaultTransaction: pilot.vaultDeploymentTransactionHash || null,
    controller: issuance.issuerController,
    token: issuance.token,
    bondVault: issuance.bondVault,
    bondActive: Boolean(issuance.bondActivation?.transactionHash),
    bondFunded: Boolean(issuance.bondDeposit?.transactionHash),
    minimumBondWei: issuance.minimumBondWei,
    bondTransaction: issuance.bondDeposit?.transactionHash || null,
    activationTransaction: issuance.bondActivation?.transactionHash || null,
    depositTransaction: pilot.depositTransactionHash,
    depositBlock: pilot.depositBlockNumber,
    depositId: pilot.depositId,
    depositAmount: pilot.amount,
    depositAccount: pilot.beneficiary,
    depositBeneficiary: pilot.beneficiary,
    proofTransaction: issuance.proofSubmission?.transactionHash || null,
  });
  try {
    await resolveIssuerAddresses();
    await refreshReserveFunds().catch(() => {});
  } catch (error) {
    byId("signature-effect").textContent = `Pilot loaded from tracked evidence. Live refresh failed: ${friendlyError(error)}`;
  }
  saveFlow();
  if (!byId("signature-effect").textContent.startsWith("Pilot loaded")) {
    byId("signature-effect").textContent = "Completed pilot loaded. Explorer evidence is available without signing.";
  }
  render();
  emitIssuerView();
}

function startNewIssuer() {
  const account = flow.account;
  const chainId = flow.chainId;
  resetDisplayedFlow();
  Object.assign(flow, freshIssuerState(), {
    account,
    chainId,
    factory: issuance.factory,
    sourceExecutor: networks.source.transactionExecutor || ZERO_ADDRESS,
  });
  saveFlow();
  byId("signature-effect").textContent = "New issuer ready. Define the token, then deploy its Sepolia reserve vault.";
  render();
  emitIssuerView();
}

function updateTokenDraft(event) {
  if (flow.sourceVault || flow.mode === "pilot") return;
  if (event.target.id === "token-symbol") {
    event.target.value = event.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  }
  flow.tokenName = byId("token-name").value;
  flow.tokenSymbol = byId("token-symbol").value;
  render();
}

async function copyTokenAddress() {
  if (!flow.token) return;
  const button = byId("copy-token-address");
  try {
    await navigator.clipboard.writeText(flow.token);
    button.textContent = "Address copied";
    window.setTimeout(() => {
      button.textContent = "Copy address";
    }, 1_800);
  } catch {
    button.textContent = "Copy failed";
  }
}

async function createIssuer() {
  const button = byId("create-issuer");
  button.disabled = true;
  try {
    const data = encodeCreateIssuer({
      issuerId: flow.issuerId,
      sourceChainKey: networks.source.attestcoinChainKey,
      sourceVault: flow.sourceVault,
      sourceExecutor: flow.sourceExecutor || ZERO_ADDRESS,
      reserveAsset: networks.source.reserveAsset.address,
      decimals: networks.source.reserveAsset.decimals,
      tokenName: flow.tokenName,
      tokenSymbol: flow.tokenSymbol,
    });
    setActionState("create-state", "Waiting for the CC3 wallet signature…");
    const { transactionHash, receipt } = await sendWalletTransaction(
      "destination",
      { to: flow.factory, data },
      `Create ${flow.tokenSymbol}. Deploys your issuer controller, token, and CTC bond vault; no CTC value is transferred.`,
      recordPendingAction("createIssuer", "destination", "create-state", "Issuer creation submitted. Waiting for CC3 confirmation…"),
    );
    flow.creationTransaction = transactionHash;
    flow.controller = createdControllerFromReceipt(receipt);
    await resolveIssuerAddresses();
    clearPendingAction(transactionHash);
    setActionState("create-state", "Issuer created.", "success", transactionHash, networks.destination.explorerUrl);
    saveFlow();
    emitIssuerView();
    void refreshIssuerPortfolio();
  } catch (error) {
    setActionState("create-state", friendlyError(error), "error");
  } finally {
    render();
  }
}

async function depositBond() {
  const button = byId("deposit-bond");
  button.disabled = true;
  try {
    const minimumBondWei = flow.minimumBondWei || issuance.minimumBondWei;
    setActionState("bond-state", "Waiting for the CTC bond signature…");
    const { transactionHash } = await sendWalletTransaction(
      "destination",
      { to: flow.bondVault, data: "0x741b3c39", value: `0x${BigInt(minimumBondWei).toString(16)}` },
      `Deposit ${formatNative(minimumBondWei)} CTC into the issuer bond vault. This does not activate issuance yet.`,
      recordPendingAction("depositBond", "destination", "bond-state", "Bond deposit submitted. Waiting for CC3 confirmation…"),
    );
    flow.bondTransaction = transactionHash;
    flow.bondFunded = true;
    clearPendingAction(transactionHash);
    setActionState("bond-state", "CTC bond deposited. Activation remains.", "success", transactionHash, networks.destination.explorerUrl);
    saveFlow();
  } catch (error) {
    setActionState("bond-state", friendlyError(error), "error");
  } finally {
    render();
  }
}

async function activateBond() {
  const button = byId("activate-bond");
  button.disabled = true;
  try {
    setActionState("bond-state", "Waiting for the activation signature…");
    const { transactionHash } = await sendWalletTransaction(
      "destination",
      { to: flow.bondVault, data: "0x1de54f6b" },
      "Activate issuance. New valid reserve proofs may mint; the CTC bond cannot be withdrawn while active.",
      recordPendingAction("activateBond", "destination", "bond-state", "Activation submitted. Waiting for CC3 confirmation…"),
    );
    flow.activationTransaction = transactionHash;
    flow.bondActive = true;
    clearPendingAction(transactionHash);
    setActionState("bond-state", "Issuance activated.", "success", transactionHash, networks.destination.explorerUrl);
    saveFlow();
  } catch (error) {
    setActionState("bond-state", friendlyError(error), "error");
  } finally {
    render();
  }
}

function selectedReserveAmount() {
  return parseUnits(byId("reserve-amount").value.trim(), networks.source.reserveAsset.decimals);
}

function validReserveBeneficiary() {
  const value = byId("reserve-beneficiary").value.trim();
  return value === "" ? Boolean(flow.account) : /^0x[0-9a-fA-F]{40}$/.test(value) && !/^0x0{40}$/i.test(value);
}

function selectedReserveBeneficiary() {
  const value = byId("reserve-beneficiary").value.trim() || flow.account;
  if (!/^0x[0-9a-fA-F]{40}$/.test(value || "") || /^0x0{40}$/i.test(value)) {
    throw new Error("Enter a valid non-zero beneficiary wallet address");
  }
  return value;
}

async function approveReserve() {
  const button = byId("approve-reserve");
  button.disabled = true;
  try {
    const amount = selectedReserveAmount();
    await refreshReserveFunds();
    if (BigInt(flow.reserveBalance || "0") < amount) {
      throw new Error(`Wallet has ${formatReserveUnits(BigInt(flow.reserveBalance || "0"))} ${networks.source.reserveAsset.symbol}; enter that amount or less`);
    }
    setActionState("deposit-state", "Waiting for the Sepolia approval signature…");
    const { transactionHash } = await sendWalletTransaction(
      "source",
      { to: networks.source.reserveAsset.address, data: encodeApprove(flow.sourceVault, amount) },
      `Approve the reserve vault to transfer exactly ${byId("reserve-amount").value.trim()} ${networks.source.reserveAsset.symbol}. No tokens move in this transaction.`,
      recordPendingAction("approveReserve", "source", "deposit-state", "Approval submitted. Waiting for Sepolia confirmation…"),
    );
    flow.approvalTransaction = transactionHash;
    await refreshReserveFunds().catch(() => {});
    clearPendingAction(transactionHash);
    setActionState("deposit-state", "Approval confirmed. Reserve deposit remains.", "success", transactionHash, networks.source.explorerUrl);
    saveFlow();
  } catch (error) {
    setActionState("deposit-state", friendlyError(error), "error");
  } finally {
    render();
  }
}

async function depositReserve() {
  const button = byId("deposit-reserve");
  button.disabled = true;
  try {
    const amount = selectedReserveAmount();
    await refreshReserveFunds();
    if (BigInt(flow.reserveBalance || "0") < amount) {
      throw new Error(`Wallet has ${formatReserveUnits(BigInt(flow.reserveBalance || "0"))} ${networks.source.reserveAsset.symbol}; enter that amount or less`);
    }
    if (BigInt(flow.reserveAllowance || "0") < amount) {
      throw new Error(`Approve ${byId("reserve-amount").value.trim()} ${networks.source.reserveAsset.symbol} before depositing`);
    }
    const depositId = randomBytes32();
    const beneficiary = selectedReserveBeneficiary();
    setActionState("deposit-state", "Waiting for the Sepolia reserve-deposit signature…");
    const { transactionHash, receipt } = await sendWalletTransaction(
      "source",
      { to: flow.sourceVault, data: encodeDeposit(depositId, beneficiary, amount) },
      `Lock ${byId("reserve-amount").value.trim()} ${networks.source.reserveAsset.symbol} in the Sepolia vault and mint to ${shortHex(beneficiary)} after proof.`,
      recordPendingAction(
        "depositReserve",
        "source",
        "deposit-state",
        "Reserve deposit submitted. Waiting for Sepolia confirmation…",
        { depositId, amount: amount.toString(), account: flow.account, beneficiary },
      ),
    );
    flow.depositTransaction = transactionHash;
    flow.depositBlock = Number(BigInt(receipt.blockNumber));
    flow.depositId = depositId;
    flow.depositAmount = amount.toString();
    flow.depositAccount = flow.account;
    flow.depositBeneficiary = beneficiary;
    flow.proofCalldata = null;
    flow.proofTransaction = null;
    await refreshReserveFunds().catch(() => {});
    clearPendingAction(transactionHash);
    saveFlow();
    emitIssuerView();
  } catch (error) {
    setActionState("deposit-state", friendlyError(error), "error");
  } finally {
    render();
  }
}

function selectPilotDeposit() {
  flow.depositTransaction = pilot.depositTransactionHash;
  flow.depositBlock = pilot.depositBlockNumber;
  flow.depositId = pilot.depositId;
  flow.depositAmount = pilot.amount;
  flow.depositAccount = pilot.beneficiary;
  flow.depositBeneficiary = pilot.beneficiary;
  flow.proofCalldata = null;
  flow.proofTransaction = null;
  saveFlow();
}

function usePilotDeposit() {
  selectPilotDeposit();
  setActionState(
    "deposit-state",
    `Recorded 5 USDC deposit selected from Sepolia block ${flow.depositBlock}.`,
    "success",
    flow.depositTransaction,
    networks.source.explorerUrl,
  );
  render();
}

async function validateSourceDeposit() {
  const [receipt, transaction] = await Promise.all([
    publicRpc(networks.source.rpcUrl, "eth_getTransactionReceipt", [flow.depositTransaction]),
    publicRpc(networks.source.rpcUrl, "eth_getTransactionByHash", [flow.depositTransaction]),
  ]);
  if (!receipt || !transaction || BigInt(receipt.status || "0x0") !== 1n) throw new Error("Source deposit receipt is missing or failed");
  if (transaction.from?.toLowerCase() !== flow.depositAccount?.toLowerCase()) throw new Error("Source transaction sender changed");
  const event = receipt.logs?.find(
    (log) => log.address?.toLowerCase() === flow.sourceVault.toLowerCase()
      && log.topics?.[0]?.toLowerCase() === RESERVE_DEPOSITED_TOPIC
      && log.topics?.[1]?.toLowerCase() === flow.issuerId.toLowerCase()
      && log.topics?.[2]?.toLowerCase() === flow.depositId.toLowerCase(),
  );
  if (!event) throw new Error("Expected ReserveDeposited event was not found");
  const expectedBeneficiary = flow.depositBeneficiary || flow.depositAccount;
  if (wordAddress(event.topics[3])?.toLowerCase() !== expectedBeneficiary.toLowerCase()) throw new Error("Deposit beneficiary mismatch");
  if (wordAddress(event.data.slice(2, 66))?.toLowerCase() !== flow.depositAccount.toLowerCase()) throw new Error("Deposit depositor mismatch");
  if (BigInt(`0x${event.data.slice(-64)}`) !== BigInt(flow.depositAmount)) throw new Error("Deposit amount mismatch");

  const transactionTarget = transaction.to?.toLowerCase();
  const directDeposit = transactionTarget === flow.sourceVault.toLowerCase();
  const routedDeposit = flow.sourceExecutor !== ZERO_ADDRESS
    && transactionTarget === flow.sourceExecutor.toLowerCase();
  if (!directDeposit && !routedDeposit) {
    const actualTarget = transaction.to ? shortHex(transaction.to) : "contract creation";
    if (flow.sourceExecutor === ZERO_ADDRESS) {
      throw new Error(`This issuer predates the MetaMask route fix. Its deposit used ${actualTarget}, but its immutable controller only accepts direct deposits. Start a new issuer; new issuers accept both paths.`);
    }
    throw new Error(`Wallet routed the deposit through unsupported executor ${actualTarget}. Start a new issuer only after the configured executor is updated.`);
  }
}

function formatElapsed(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

function updateAttestationProgress(attestedHeight, requiredHeight, firstHeight, startedAt) {
  const progress = byId("attestation-progress");
  const covered = attestedHeight >= requiredHeight;
  const range = Math.max(1, requiredHeight - firstHeight);
  const completed = Math.max(0, Math.min(range, attestedHeight - firstHeight));
  const percent = covered ? 100 : Math.max(4, Math.round((completed * 100) / range));
  progress.hidden = false;
  byId("attestation-progress-bar").style.width = `${percent}%`;
  setTextContent("attested-height", attestedHeight.toLocaleString("en-US"));
  setTextContent("required-height", requiredHeight.toLocaleString("en-US"));
  setTextContent("attestation-gap", Math.max(0, requiredHeight - attestedHeight).toLocaleString("en-US"));
  setTextContent("attestation-elapsed", formatElapsed(Date.now() - startedAt));
}

function setTextContent(id, value) {
  byId(id).textContent = value;
}

async function fetchProofJson(path, label) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${networks.destination.proofBuilderUrl}${path}`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
    return response.json();
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`${label} timed out`);
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function generateProof() {
  const button = byId("generate-proof");
  const requestId = ++proofRequest;
  const depositTransaction = flow.depositTransaction;
  let sourceValidated = false;
  button.disabled = true;
  button.textContent = "Checking Attestcoin…";
  try {
    await validateSourceDeposit();
    sourceValidated = true;
    const startedAt = Date.now();
    const deadline = Date.now() + 20 * 60_000;
    let firstHeight = null;
    let covered = false;
    while (Date.now() < deadline && requestId === proofRequest) {
      const { attestedHeight } = await fetchProofJson(
        `/api/v1/attested-height/${networks.source.attestcoinChainKey}`,
        "Attested-height request",
      );
      const currentHeight = Number(attestedHeight);
      firstHeight ??= currentHeight;
      updateAttestationProgress(currentHeight, flow.depositBlock, firstHeight, startedAt);
      if (currentHeight >= flow.depositBlock) {
        covered = true;
        break;
      }
      setActionState("proof-generation-state", `Waiting for Attestcoin coverage. Keep this deposit; no new signature is needed.`);
      await new Promise((resolve) => window.setTimeout(resolve, 15_000));
    }
    if (requestId !== proofRequest || flow.depositTransaction !== depositTransaction) return;
    if (!covered) throw new Error("Attestcoin wait exceeded 20 minutes; retry this proof without depositing again");

    setActionState("proof-generation-state", "Source block is covered. Retrieving and validating the proof…");
    const proof = await fetchProofJson(
      `/api/v1/proof-by-tx/${networks.source.attestcoinChainKey}/${flow.depositTransaction}`,
      "Proof request",
    );
    if (proof.txHash?.toLowerCase() !== flow.depositTransaction.toLowerCase()) throw new Error("Proof transaction hash mismatch");
    if (Number(proof.headerNumber) !== flow.depositBlock) throw new Error("Proof block height mismatch");
    if (Number(proof.chainKey) !== networks.source.attestcoinChainKey) throw new Error("Proof source-chain mismatch");
    flow.proofCalldata = encodeExecuteDeposit(proof);
    saveFlow();
    setActionState("proof-generation-state", `Proof ready: ${proof.merkleProof.siblings.length} siblings, ${proof.continuityProof.roots.length} continuity roots.`, "success");
  } catch (error) {
    if (requestId === proofRequest) {
      const message = friendlyError(error);
      setActionState(
        "proof-generation-state",
        sourceValidated ? `${message}. Your reserve deposit is preserved; retry proof generation without depositing again.` : message,
        "error",
      );
    }
  } finally {
    if (requestId === proofRequest) {
      button.textContent = "Generate proof";
      render();
    }
  }
}

async function submitProof() {
  const button = byId("submit-proof");
  button.disabled = true;
  try {
    setActionState("mint-state", "Waiting for the CC3 proof-submission signature…");
    const { transactionHash } = await sendWalletTransaction(
      "destination",
      { to: flow.controller, data: flow.proofCalldata },
      `Submit the Attestcoin proof to ${shortHex(flow.controller)}. Minting occurs only if the controller accepts every field.`,
      recordPendingAction("submitProof", "destination", "mint-state", "Proof submitted. Waiting for CC3 confirmation…"),
    );
    flow.proofTransaction = transactionHash;
    clearPendingAction(transactionHash);
    saveFlow();
    setActionState("mint-state", "Proof accepted and mint confirmed.", "success", transactionHash, networks.destination.explorerUrl);
    emitIssuerView();
    byId("refresh-button").click();
  } catch (error) {
    setActionState("mint-state", friendlyError(error), "error");
  } finally {
    render();
  }
}

function formatNative(value) {
  const wei = BigInt(value);
  const whole = wei / 10n ** 18n;
  const fraction = (wei % 10n ** 18n).toString().padStart(18, "0").slice(0, 3).replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""}`;
}

function bindActions() {
  byId("connect-wallet").addEventListener("click", connectWallet);
  byId("deploy-source-vault").addEventListener("click", deploySourceVault);
  byId("load-pilot").addEventListener("click", loadPilotIssuer);
  byId("start-new-issuer").addEventListener("click", startNewIssuer);
  byId("token-name").addEventListener("input", updateTokenDraft);
  byId("token-symbol").addEventListener("input", updateTokenDraft);
  const handleReserveDraftChange = () => {
    if (!flow.depositTransaction) delete byId("deposit-state").dataset.state;
    render();
  };
  byId("reserve-amount").addEventListener("input", handleReserveDraftChange);
  byId("reserve-beneficiary").addEventListener("input", handleReserveDraftChange);
  byId("copy-token-address").addEventListener("click", copyTokenAddress);
  byId("create-issuer").addEventListener("click", createIssuer);
  byId("deposit-bond").addEventListener("click", depositBond);
  byId("activate-bond").addEventListener("click", activateBond);
  byId("approve-reserve").addEventListener("click", approveReserve);
  byId("deposit-reserve").addEventListener("click", depositReserve);
  byId("use-pilot-deposit").addEventListener("click", usePilotDeposit);
  byId("generate-proof").addEventListener("click", generateProof);
  byId("submit-proof").addEventListener("click", submitProof);
}

async function initialize() {
  const search = new URLSearchParams(window.location.search);
  if (search.get("reset") === "1") {
    localStorage.removeItem(STORAGE_KEY);
  }
  loadSavedFlow();
  [networks, pilot, issuance, sourceVaultDeployment] = await Promise.all([
    fetchJson("../config/networks.json"),
    fetchJson("../config/pilot.json"),
    fetchJson("../config/issuance.json"),
    fetchJson("../config/source-vault-deployment.json"),
  ]);
  flow.factory ||= issuance.factory;
  if (flow.mode === "new" && !flow.controller && flow.sourceExecutor === ZERO_ADDRESS) {
    flow.sourceExecutor = networks.source.transactionExecutor || ZERO_ADDRESS;
  }
  await resolveIssuerAddresses();
  if (search.get("pilot") === "1") await loadPilotIssuer();
  bindActions();

  if (window.ethereum) {
    const accounts = await window.ethereum.request({ method: "eth_accounts" });
    flow.account = accounts[0] || null;
    flow.chainId = Number.parseInt(await window.ethereum.request({ method: "eth_chainId" }), 16);
    await recoverPendingAction();
    await refreshReserveFunds().catch(() => {});
    void recoverSourceVaultDeployment();
    void refreshIssuerPortfolio();
    window.ethereum.on?.("accountsChanged", (nextAccounts) => {
      flow.account = nextAccounts[0] || null;
      void recoverPendingAction();
      void refreshReserveFunds().then(render).catch(() => render());
      void recoverSourceVaultDeployment();
      void refreshIssuerPortfolio();
      render();
      emitIssuerView();
    });
    window.ethereum.on?.("chainChanged", (nextChainId) => {
      flow.chainId = Number.parseInt(nextChainId, 16);
      render();
    });
  } else {
    byId("connect-wallet").disabled = true;
    byId("signature-effect").textContent = "MetaMask was not detected. Live read-only evidence remains available.";
  }
  render();
  emitIssuerView();
}

initialize().catch((error) => {
  byId("signature-effect").textContent = `Wallet flow unavailable: ${friendlyError(error)}`;
  byId("connect-wallet").disabled = true;
});
