import {
  encodeApprove,
  encodeCreateIssuer,
  encodeDeposit,
  encodeExecuteDeposit,
  encodeFactoryDeployment,
  parseUnits,
} from "./encoding.mjs?v=10";

const ISSUER_CREATED_TOPIC = "0x75118ee2db244652d7ac3bbe9a9f199941ece831c61580f5a72e4b7fa9ef245a";
const RESERVE_DEPOSITED_TOPIC = "0x9ade6207680ee84077f86cc08de4f401b88731138ea5b583f09bd7266113453d";
const ISSUER_LOOKUP_SELECTOR = "0xc53a4413";
const TOKEN_SELECTOR = "0xfc0c546a";
const BOND_VAULT_SELECTOR = "0x990826b3";
const BOND_ACTIVE_SELECTOR = "0x02fb0c5e";
const BOND_MINIMUM_SELECTOR = "0xaa7517e1";
const STORAGE_KEY = "resyvr-issuer-flow-v1";

const flow = {
  account: null,
  factory: null,
  factoryDeploymentTransaction: null,
  controller: null,
  token: null,
  bondVault: null,
  bondActive: false,
  minimumBondWei: null,
  approvalTransaction: null,
  bondTransaction: null,
  activationTransaction: null,
  depositTransaction: null,
  depositBlock: null,
  depositId: null,
  depositAmount: null,
  depositAccount: null,
  proofCalldata: null,
  proofTransaction: null,
};

let networks;
let pilot;
let issuance;
let factoryDeployment;

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

function loadSavedFlow() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (saved && typeof saved === "object") Object.assign(flow, saved);
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function saveFlow() {
  const { account: _account, ...persisted } = flow;
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
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`${method} returned HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error.message || `${method} failed`);
  return payload.result;
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
}

async function prepareWalletRequest(chainKey, effect) {
  const chain = chainDefinitions[chainKey]();
  byId("signature-effect").textContent = `${chain.chainName}: ${effect}`;
  await nextPaint();
  await ensureChain(chainKey);
}

async function waitForReceipt(transactionHash, timeoutMs = 300_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const receipt = await window.ethereum.request({
      method: "eth_getTransactionReceipt",
      params: [transactionHash],
    });
    if (receipt) {
      if (BigInt(receipt.status || "0x0") !== 1n) throw new Error(`Transaction ${shortHex(transactionHash)} failed on-chain`);
      return receipt;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 3_000));
  }
  throw new Error(`Timed out waiting for transaction ${shortHex(transactionHash)}`);
}

async function sendWalletTransaction(chainKey, transaction, effect) {
  if (!flow.account) throw new Error("Connect MetaMask first");
  await prepareWalletRequest(chainKey, effect);
  const transactionHash = await window.ethereum.request({
    method: "eth_sendTransaction",
    params: [{ from: flow.account, ...transaction }],
  });
  const receipt = await waitForReceipt(transactionHash);
  return { transactionHash, receipt };
}

async function resolveIssuerAddresses() {
  flow.factory = issuance.factory || flow.factory;
  flow.controller = issuance.issuerController || flow.controller;
  flow.token = issuance.token || flow.token;
  flow.bondVault = issuance.bondVault || flow.bondVault;

  if (!flow.controller && flow.factory) {
    const result = await contractCall(
      networks.destination.rpcUrl,
      flow.factory,
      `${ISSUER_LOOKUP_SELECTOR}${pilot.issuerId.slice(2)}`,
    );
    const words = result.slice(2).match(/.{64}/g) || [];
    flow.controller = wordAddress(words[5]);
    flow.token = wordAddress(words[6]);
    flow.bondVault = wordAddress(words[7]);
  }

  if (flow.controller) {
    const [tokenResult, bondResult] = await Promise.all([
      contractCall(networks.destination.rpcUrl, flow.controller, TOKEN_SELECTOR),
      contractCall(networks.destination.rpcUrl, flow.controller, BOND_VAULT_SELECTOR),
    ]);
    flow.token = wordAddress(tokenResult) || flow.token;
    flow.bondVault = wordAddress(bondResult) || flow.bondVault;
  }
  if (flow.bondVault) {
    const [activeResult, minimumResult] = await Promise.all([
      contractCall(networks.destination.rpcUrl, flow.bondVault, BOND_ACTIVE_SELECTOR),
      contractCall(networks.destination.rpcUrl, flow.bondVault, BOND_MINIMUM_SELECTOR),
    ]);
    flow.bondActive = BigInt(activeResult || "0x0") === 1n;
    flow.minimumBondWei = BigInt(minimumResult).toString();
  }
  saveFlow();
}

function render() {
  const connected = Boolean(flow.account);
  byId("wallet-account").textContent = connected ? shortHex(flow.account, 12, 8) : "Not connected";
  byId("connect-wallet").textContent = connected ? "Wallet connected" : "Connect MetaMask";

  byId("deploy-factory").disabled = !connected || Boolean(flow.factory);
  byId("create-issuer").disabled = !connected || !flow.factory || Boolean(flow.controller);
  byId("deposit-bond").disabled = !connected || !flow.bondVault || flow.bondActive;
  byId("activate-bond").disabled = !connected || !flow.bondVault || flow.bondActive;
  byId("approve-reserve").disabled = !connected || !flow.controller || !flow.bondActive;
  byId("deposit-reserve").disabled = !connected || !flow.controller || !flow.bondActive;
  byId("use-pilot-deposit").disabled = !connected || !flow.controller || !flow.bondActive || Boolean(flow.proofTransaction);
  byId("generate-proof").disabled = !flow.depositTransaction || !flow.depositBlock;
  byId("submit-proof").disabled = !connected || !flow.controller || !flow.proofCalldata;

  if (flow.controller) {
    if (!hasFinalActionState("create-state")) {
      setActionState("create-state", `Issuer controller ready: ${shortHex(flow.controller)}`, "success");
    }
  } else if (flow.factory && !hasFinalActionState("create-state")) {
    setActionState("create-state", `Factory ready: ${shortHex(flow.factory)}. Wallet signature required.`, "waiting");
  } else if (connected && !hasFinalActionState("create-state")) {
    setActionState("create-state", "Deploy the audited factory bytecode on Creditcoin CC3.", "waiting");
  }
  if (flow.bondVault && !hasFinalActionState("bond-state")) {
    const message = flow.bondActive
      ? `Bond active. Vault: ${shortHex(flow.bondVault)}`
      : flow.bondTransaction
        ? "Bond deposit confirmed. Activation signature remains."
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
  } else if (connected && flow.controller && !hasFinalActionState("deposit-state")) {
    setActionState("deposit-state", "Enter an amount. Approval and deposit are separate Sepolia signatures.");
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
    byId("signature-effect").textContent = "Connect MetaMask. This requests account access only; no transaction or message signature.";
    await nextPaint();
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    flow.account = accounts[0] || null;
    render();
  } catch (error) {
    byId("signature-effect").textContent = friendlyError(error);
  }
}

async function deployFactory() {
  const button = byId("deploy-factory");
  button.disabled = true;
  try {
    setActionState("create-state", "Waiting for the CC3 factory-deployment signature…");
    const { transactionHash, receipt } = await sendWalletTransaction(
      "destination",
      { data: encodeFactoryDeployment(factoryDeployment.creationBytecode, issuance.minimumBondWei) },
      `Deploy the Resyvr issuer factory with an immutable ${formatNative(issuance.minimumBondWei)} CTC minimum bond.`,
    );
    if (!receipt.contractAddress) throw new Error("Successful deployment receipt did not contain a contract address");
    flow.factory = receipt.contractAddress;
    flow.factoryDeploymentTransaction = transactionHash;
    saveFlow();
    setActionState("create-state", `Factory deployed: ${shortHex(flow.factory)}. Create the issuer next.`, "success", transactionHash, networks.destination.explorerUrl);
  } catch (error) {
    setActionState("create-state", friendlyError(error), "error");
  } finally {
    render();
  }
}

async function createIssuer() {
  const button = byId("create-issuer");
  button.disabled = true;
  try {
    const data = encodeCreateIssuer({
      issuerId: pilot.issuerId,
      sourceChainKey: networks.source.attestcoinChainKey,
      sourceVault: pilot.sourceVault,
      sourceExecutor: pilot.sourceExecutor,
      reserveAsset: networks.source.reserveAsset.address,
      decimals: networks.source.reserveAsset.decimals,
      tokenName: issuance.tokenName,
      tokenSymbol: issuance.tokenSymbol,
    });
    setActionState("create-state", "Waiting for the CC3 wallet signature…");
    const { transactionHash, receipt } = await sendWalletTransaction(
      "destination",
      { to: flow.factory, data },
      `Create ${issuance.tokenSymbol}. Deploys an issuer controller, token, and CTC bond vault; no CTC value is transferred.`,
    );
    const event = receipt.logs?.find(
      (log) => log.address?.toLowerCase() === flow.factory.toLowerCase() && log.topics?.[0]?.toLowerCase() === ISSUER_CREATED_TOPIC,
    );
    if (!event?.topics?.[3]) throw new Error("IssuerCreated event was not found in the successful receipt");
    flow.controller = wordAddress(event.topics[3]);
    if (!flow.controller) throw new Error("IssuerCreated returned an invalid controller address");
    await resolveIssuerAddresses();
    setActionState("create-state", "Issuer created.", "success", transactionHash, networks.destination.explorerUrl);
    saveFlow();
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
    );
    flow.bondTransaction = transactionHash;
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
    );
    flow.activationTransaction = transactionHash;
    flow.bondActive = true;
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

async function approveReserve() {
  const button = byId("approve-reserve");
  button.disabled = true;
  try {
    const amount = selectedReserveAmount();
    setActionState("deposit-state", "Waiting for the Sepolia approval signature…");
    const { transactionHash } = await sendWalletTransaction(
      "source",
      { to: networks.source.reserveAsset.address, data: encodeApprove(pilot.sourceVault, amount) },
      `Approve the reserve vault to transfer exactly ${byId("reserve-amount").value.trim()} ${networks.source.reserveAsset.symbol}. No tokens move in this transaction.`,
    );
    flow.approvalTransaction = transactionHash;
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
    const depositId = randomBytes32();
    setActionState("deposit-state", "Waiting for the Sepolia reserve-deposit signature…");
    const { transactionHash, receipt } = await sendWalletTransaction(
      "source",
      { to: pilot.sourceVault, data: encodeDeposit(depositId, flow.account, amount) },
      `Lock ${byId("reserve-amount").value.trim()} ${networks.source.reserveAsset.symbol} in the Sepolia vault for ${shortHex(flow.account)}.`,
    );
    flow.depositTransaction = transactionHash;
    flow.depositBlock = Number(BigInt(receipt.blockNumber));
    flow.depositId = depositId;
    flow.depositAmount = amount.toString();
    flow.depositAccount = flow.account;
    flow.proofCalldata = null;
    flow.proofTransaction = null;
    saveFlow();
  } catch (error) {
    setActionState("deposit-state", friendlyError(error), "error");
  } finally {
    render();
  }
}

function usePilotDeposit() {
  flow.depositTransaction = pilot.depositTransactionHash;
  flow.depositBlock = pilot.depositBlockNumber;
  flow.depositId = pilot.depositId;
  flow.depositAmount = pilot.amount;
  flow.depositAccount = pilot.beneficiary;
  flow.proofCalldata = null;
  flow.proofTransaction = null;
  saveFlow();
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
  const allowedTargets = [pilot.sourceVault, pilot.sourceExecutor].map((value) => value.toLowerCase());
  if (!allowedTargets.includes(transaction.to?.toLowerCase())) throw new Error("Source transaction target is not configured");
  if (transaction.from?.toLowerCase() !== flow.depositAccount?.toLowerCase()) throw new Error("Source transaction sender changed");
  const event = receipt.logs?.find(
    (log) => log.address?.toLowerCase() === pilot.sourceVault.toLowerCase()
      && log.topics?.[0]?.toLowerCase() === RESERVE_DEPOSITED_TOPIC
      && log.topics?.[1]?.toLowerCase() === pilot.issuerId.toLowerCase()
      && log.topics?.[2]?.toLowerCase() === flow.depositId.toLowerCase(),
  );
  if (!event) throw new Error("Expected ReserveDeposited event was not found");
  if (wordAddress(event.topics[3])?.toLowerCase() !== flow.depositAccount.toLowerCase()) throw new Error("Deposit beneficiary mismatch");
  if (wordAddress(event.data.slice(2, 66))?.toLowerCase() !== flow.depositAccount.toLowerCase()) throw new Error("Deposit depositor mismatch");
  if (BigInt(`0x${event.data.slice(-64)}`) !== BigInt(flow.depositAmount)) throw new Error("Deposit amount mismatch");
}

async function generateProof() {
  const button = byId("generate-proof");
  button.disabled = true;
  try {
    await validateSourceDeposit();
    const deadline = Date.now() + 20 * 60_000;
    while (Date.now() < deadline) {
      const response = await fetch(`${networks.destination.proofBuilderUrl}/api/v1/attested-height/${networks.source.attestcoinChainKey}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`Attested-height request returned HTTP ${response.status}`);
      const { attestedHeight } = await response.json();
      if (Number(attestedHeight) >= flow.depositBlock) break;
      setActionState("proof-generation-state", `Waiting for Attestcoin: ${Number(attestedHeight).toLocaleString("en-US")} / ${flow.depositBlock.toLocaleString("en-US")}`);
      await new Promise((resolve) => window.setTimeout(resolve, 15_000));
    }
    if (Date.now() >= deadline) throw new Error("Attestcoin wait exceeded 20 minutes; retry without signing anything");

    const response = await fetch(
      `${networks.destination.proofBuilderUrl}/api/v1/proof-by-tx/${networks.source.attestcoinChainKey}/${flow.depositTransaction}`,
      { cache: "no-store" },
    );
    if (!response.ok) throw new Error(`Proof request returned HTTP ${response.status}`);
    const proof = await response.json();
    if (proof.txHash?.toLowerCase() !== flow.depositTransaction.toLowerCase()) throw new Error("Proof transaction hash mismatch");
    if (Number(proof.headerNumber) !== flow.depositBlock) throw new Error("Proof block height mismatch");
    if (Number(proof.chainKey) !== networks.source.attestcoinChainKey) throw new Error("Proof source-chain mismatch");
    flow.proofCalldata = encodeExecuteDeposit(proof);
    saveFlow();
    setActionState("proof-generation-state", `Proof ready: ${proof.merkleProof.siblings.length} siblings, ${proof.continuityProof.roots.length} continuity roots.`, "success");
  } catch (error) {
    setActionState("proof-generation-state", friendlyError(error), "error");
  } finally {
    render();
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
    );
    flow.proofTransaction = transactionHash;
    saveFlow();
    setActionState("mint-state", "Proof accepted and mint confirmed.", "success", transactionHash, networks.destination.explorerUrl);
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
  byId("deploy-factory").addEventListener("click", deployFactory);
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
  loadSavedFlow();
  [networks, pilot, issuance, factoryDeployment] = await Promise.all([
    fetchJson("../config/networks.json"),
    fetchJson("../config/pilot.json"),
    fetchJson("../config/issuance.json"),
    fetchJson("../config/factory-deployment.json"),
  ]);
  await resolveIssuerAddresses();
  bindActions();

  if (window.ethereum) {
    const accounts = await window.ethereum.request({ method: "eth_accounts" });
    flow.account = accounts[0] || null;
    window.ethereum.on?.("accountsChanged", (nextAccounts) => {
      flow.account = nextAccounts[0] || null;
      render();
    });
    window.ethereum.on?.("chainChanged", () => render());
  } else {
    byId("connect-wallet").disabled = true;
    byId("signature-effect").textContent = "MetaMask was not detected. Live read-only evidence remains available.";
  }
  render();
}

initialize().catch((error) => {
  byId("signature-effect").textContent = `Wallet flow unavailable: ${friendlyError(error)}`;
  byId("connect-wallet").disabled = true;
});
