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
  sourceExecutor: ZERO_ADDRESS,
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
let sourceVaultDeployment;

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
    sourceExecutor: ZERO_ADDRESS,
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
  const transactionHash = await window.ethereum.request({
    method: "eth_sendTransaction",
    params: [{ from: flow.account, ...transaction }],
  });
  if (onSubmitted) onSubmitted(transactionHash);
  const receipt = await waitForReceipt(transactionHash, chainKey);
  return { transactionHash, receipt };
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
    const [activeResult, minimumResult] = await Promise.all([
      contractCall(networks.destination.rpcUrl, flow.bondVault, BOND_ACTIVE_SELECTOR),
      contractCall(networks.destination.rpcUrl, flow.bondVault, BOND_MINIMUM_SELECTOR),
    ]);
    flow.bondActive = BigInt(activeResult || "0x0") === 1n;
    flow.minimumBondWei = BigInt(minimumResult).toString();
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
  const walletAccount = byId("wallet-account");
  walletAccount.textContent = connected ? shortHex(flow.account, 6, 4) : "Connect a wallet to begin";
  walletAccount.title = connected ? flow.account : "";
  byId("wallet-network").textContent = connected ? chainLabel(flow.chainId) : "MetaMask · no signature on connection";
  byId("connect-wallet").textContent = connected ? "Change wallet" : "Connect wallet ↗";
  byId("wallet-avatar").textContent = connected ? flow.account.slice(2, 4).toUpperCase() : "W";
  byId("wallet-avatar").style.setProperty("--wallet-hue", connected ? String(Number.parseInt(flow.account.slice(2, 4), 16) + 180) : "250");

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
    tokenLink.href = `${networks.destination.explorerUrl}/token/${flow.token}`;
    tokenLink.title = `Open ${flow.token} in the Creditcoin explorer`;
  }

  byId("deploy-source-vault").disabled = !connected || pilotMode || Boolean(flow.sourceVault) || !validTokenDraft();
  byId("create-issuer").disabled = !connected || !flow.factory || !flow.sourceVault || Boolean(flow.controller);
  byId("deposit-bond").disabled = !connected || !flow.bondVault || flow.bondActive || Boolean(flow.bondTransaction);
  byId("activate-bond").disabled = !connected || !flow.bondVault || flow.bondActive || (!flow.bondTransaction && !pilotMode);
  byId("approve-reserve").disabled = !connected || !flow.controller || !flow.bondActive;
  byId("deposit-reserve").disabled = !connected || !flow.controller || !flow.bondActive || !flow.approvalTransaction;
  byId("use-pilot-deposit").disabled = !connected || !pilotMode || Boolean(flow.proofTransaction);
  byId("generate-proof").disabled = !flow.depositTransaction || !flow.depositBlock;
  byId("submit-proof").disabled = !connected || !flow.controller || !flow.proofCalldata;

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
      : flow.bondTransaction
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
    setActionState("deposit-state", flow.approvalTransaction ? "Approval confirmed. Deposit the reserve next." : "Enter an amount, then approve the exact USDC transfer.");
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
    render();
  } catch (error) {
    byId("signature-effect").textContent = friendlyError(error);
  }
}

function resetDisplayedFlow() {
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
      (submittedHash) => {
        flow.sourceVaultTransaction = submittedHash;
        saveFlow();
        setActionState(
          "source-vault-state",
          "Deployment submitted. Waiting for Sepolia confirmation…",
          "waiting",
          submittedHash,
          networks.source.explorerUrl,
        );
      },
    );
    if (!receipt.contractAddress) throw new Error("Successful vault deployment did not return a contract address");
    flow.sourceVault = receipt.contractAddress;
    flow.sourceVaultTransaction = transactionHash;
    flow.sourceExecutor = networks.source.transactionExecutor || ZERO_ADDRESS;
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
    minimumBondWei: issuance.minimumBondWei,
    bondTransaction: issuance.bondDeposit?.transactionHash || null,
    activationTransaction: issuance.bondActivation?.transactionHash || null,
    depositTransaction: pilot.depositTransactionHash,
    depositBlock: pilot.depositBlockNumber,
    depositId: pilot.depositId,
    depositAmount: pilot.amount,
    depositAccount: pilot.beneficiary,
    proofTransaction: issuance.proofSubmission?.transactionHash || null,
  });
  try {
    await resolveIssuerAddresses();
  } catch (error) {
    byId("signature-effect").textContent = `Pilot loaded from tracked evidence. Live refresh failed: ${friendlyError(error)}`;
  }
  saveFlow();
  if (!byId("signature-effect").textContent.startsWith("Pilot loaded")) {
    byId("signature-effect").textContent = "Completed pilot loaded. Explorer evidence is available without signing.";
  }
  render();
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
      { to: networks.source.reserveAsset.address, data: encodeApprove(flow.sourceVault, amount) },
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
      { to: flow.sourceVault, data: encodeDeposit(depositId, flow.account, amount) },
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

function selectPilotDeposit() {
  flow.depositTransaction = pilot.depositTransactionHash;
  flow.depositBlock = pilot.depositBlockNumber;
  flow.depositId = pilot.depositId;
  flow.depositAmount = pilot.amount;
  flow.depositAccount = pilot.beneficiary;
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
  if (wordAddress(event.topics[3])?.toLowerCase() !== flow.depositAccount.toLowerCase()) throw new Error("Deposit beneficiary mismatch");
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
  byId("deploy-source-vault").addEventListener("click", deploySourceVault);
  byId("load-pilot").addEventListener("click", loadPilotIssuer);
  byId("start-new-issuer").addEventListener("click", startNewIssuer);
  byId("token-name").addEventListener("input", updateTokenDraft);
  byId("token-symbol").addEventListener("input", updateTokenDraft);
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
    void recoverSourceVaultDeployment();
    window.ethereum.on?.("accountsChanged", (nextAccounts) => {
      flow.account = nextAccounts[0] || null;
      void recoverSourceVaultDeployment();
      render();
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
}

initialize().catch((error) => {
  byId("signature-effect").textContent = `Wallet flow unavailable: ${friendlyError(error)}`;
  byId("connect-wallet").disabled = true;
});
