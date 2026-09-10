import {
  encodeApprove,
  encodeCreateIssuerV2,
  encodeCreateVaultV2,
  encodeDeposit,
  encodeExecuteDeposit,
  encodeExecutePayout,
  encodePayout,
  encodeRequestRedemption,
} from "./encoding.mjs";

const STORAGE_KEY = "resyvr-v2-live-pilot-v1";
const AMOUNT = 100_000n;
const BOND = 1_000_000_000_000_000_000n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const EVENTS = {
  vaultCreated: "0x92d243730efa31ff8070da9350a5a4752a0b1966123736eca67301a32613730c",
  issuerCreated: "0x9d1a92e189a3272df55fb2f060d82bdf60a2442960394ca8c30bddbdeb91bdc3",
  deposited: "0x9ade6207680ee84077f86cc08de4f401b88731138ea5b583f09bd7266113453d",
  redemptionRequested: "0xb4cbc054b7e6d64ba19d651568aa4fd320289257968bf6e5c503e6f1dd204a1a",
  paidOut: "0xcd2b81e88b4cb36689d93ebfc7715ca831397b9f255341fcb2784932d669e2a0",
};
const CALLS = {
  activate: "0x1de54f6b",
  depositBond: "0x741b3c39",
  netVerifiedReserve: "0x0a7c6aa0",
  recognizedReserve: "0x884bf9e0",
  totalPendingRedemption: "0x60ad5a69",
  totalRedeemed: "0xf35dad40",
  totalSupply: "0x18160ddd",
};

const byId = (id) => document.getElementById(id);
let networks;
let state = loadState();
let busy = false;

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{"step":0,"transactions":[]}');
  } catch {
    return { step: 0, transactions: [] };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  render();
}

function randomHex(bytes) {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return [...value].map((part) => part.toString(16).padStart(2, "0")).join("");
}

function createIssuerId(account) {
  const address = account.toLowerCase().replace(/^0x/, "");
  const timestamp = Math.floor(Date.now() / 1000).toString(16).padStart(12, "0");
  return `0x${address}${timestamp}${randomHex(6)}`;
}

function shortHex(value) {
  return value ? `${value.slice(0, 8)}…${value.slice(-6)}` : "—";
}

function errorMessage(error) {
  const message = error?.data?.message || error?.message || String(error);
  return message.replace(/^Error:\s*/i, "");
}

function toQuantity(value) {
  return `0x${BigInt(value).toString(16)}`;
}

function addressFromWord(value) {
  return `0x${value.replace(/^0x/, "").slice(-40)}`;
}

function addressArgument(value) {
  return value.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

async function publicRpc(rpcUrl, method, params = []) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  if (!response.ok) throw new Error(`RPC returned HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error.message || "RPC request failed");
  return payload.result;
}

function chain(key) {
  const item = networks[key];
  return {
    chainId: toQuantity(item.chainId),
    chainName: item.name,
    nativeCurrency: key === "source"
      ? { name: "Sepolia Ether", symbol: "ETH", decimals: 18 }
      : { name: "Creditcoin", symbol: "CTC", decimals: 18 },
    rpcUrls: [item.rpcUrl],
    blockExplorerUrls: [item.explorerUrl],
  };
}

async function switchNetwork(key) {
  const target = chain(key);
  try {
    await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: target.chainId }] });
  } catch (error) {
    if (Number(error?.code) !== 4902) throw error;
    await ethereum.request({ method: "wallet_addEthereumChain", params: [target] });
  }
  const active = await ethereum.request({ method: "eth_chainId" });
  if (active.toLowerCase() !== target.chainId.toLowerCase()) {
    throw new Error(`MetaMask did not switch to ${target.chainName}`);
  }
}

async function estimateGas(key, transaction) {
  const request = { from: state.account, ...transaction };
  const [estimateHex, latestBlock] = await Promise.all([
    publicRpc(networks[key].rpcUrl, "eth_estimateGas", [request]),
    publicRpc(networks[key].rpcUrl, "eth_getBlockByNumber", ["latest", false]),
  ]);
  const estimate = BigInt(estimateHex);
  const blockLimit = BigInt(latestBlock.gasLimit);
  const rpcLimit = 16_000_000n;
  const safeLimit = (blockLimit < rpcLimit ? blockLimit : rpcLimit) * 9n / 10n;
  if (estimate > safeLimit) throw new Error("Transaction exceeds the network gas limit");
  const buffered = estimate * 2n + 100_000n;
  return toQuantity(buffered < safeLimit ? buffered : safeLimit);
}

async function waitForReceipt(hash, key, timeoutMs = 300_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const receipt = await publicRpc(networks[key].rpcUrl, "eth_getTransactionReceipt", [hash]);
    if (receipt) {
      if (BigInt(receipt.status || "0x0") !== 1n) {
        const error = new Error(`Transaction ${shortHex(hash)} failed on-chain`);
        error.transactionFailed = true;
        throw error;
      }
      return receipt;
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  throw new Error(`Confirmation timed out for ${shortHex(hash)}; its hash is saved, so do not repeat it blindly`);
}

async function sendTransaction(key, transaction, label) {
  if (!state.account) throw new Error("Connect MetaMask first");
  await switchNetwork(key);
  setStatus(`Estimating ${label} on ${networks[key].name}…`);
  const gas = await estimateGas(key, transaction);
  const hash = await ethereum.request({
    method: "eth_sendTransaction",
    params: [{ from: state.account, ...transaction, gas }],
  });
  state.pending = { step: state.step, key, hash, label };
  state.transactions ||= [];
  state.transactions.push({ step: state.step, key, hash, label });
  saveState();
  setStatus(`Submitted ${shortHex(hash)}. Waiting for confirmation…`);
  return waitForReceipt(hash, key);
}

async function transactionReceipt(key, action) {
  let receipt;
  if (state.pending?.step === state.step) {
    setStatus(`Recovering submitted ${state.pending.label}…`);
    receipt = await waitForReceipt(state.pending.hash, state.pending.key);
  } else {
    receipt = await action();
  }
  state.pending = null;
  return receipt;
}

function matchingLog(receipt, address, topic) {
  return receipt.logs?.find((log) =>
    log.address?.toLowerCase() === address.toLowerCase()
      && log.topics?.[0]?.toLowerCase() === topic.toLowerCase());
}

function setStatus(message, type = "") {
  const target = byId("action-status");
  target.textContent = message;
  target.className = `status ${type}`.trim();
}

function recordAddress(label, value, key, chainKey) {
  state.evidence ||= [];
  const index = state.evidence.findIndex((entry) => entry.key === key);
  const entry = { key, label, value, type: "address", chainKey };
  if (index >= 0) state.evidence[index] = entry;
  else state.evidence.push(entry);
}

function recordTransaction(label, hash, key, chainKey) {
  state.evidence ||= [];
  const index = state.evidence.findIndex((entry) => entry.key === key);
  const entry = { key, label, value: hash, type: "transaction", chainKey };
  if (index >= 0) state.evidence[index] = entry;
  else state.evidence.push(entry);
}

function completeStep(message) {
  state.step += 1;
  state.lastMessage = message;
  state.lastType = "success";
  saveState();
}

async function connect() {
  if (!window.ethereum) throw new Error("MetaMask was not found in this browser");
  const accounts = await ethereum.request({ method: "eth_requestAccounts" });
  const account = accounts[0];
  if (!account) throw new Error("MetaMask did not return an account");
  if (state.account && account.toLowerCase() !== state.account.toLowerCase()) {
    throw new Error(`Select the wallet that started this pilot: ${state.account}`);
  }
  state.account = account;
}

async function readUint(key, to, data) {
  const result = await publicRpc(networks[key].rpcUrl, "eth_call", [{ to, data }, "latest"]);
  return BigInt(result || "0x0");
}

async function validateDepositTransaction() {
  const [receipt, transaction] = await Promise.all([
    publicRpc(networks.source.rpcUrl, "eth_getTransactionReceipt", [state.depositTransaction]),
    publicRpc(networks.source.rpcUrl, "eth_getTransactionByHash", [state.depositTransaction]),
  ]);
  if (!receipt || !transaction || BigInt(receipt.status || "0x0") !== 1n) throw new Error("Reserve deposit is missing or failed");
  if (transaction.to?.toLowerCase() !== state.sourceVault.toLowerCase()) throw new Error("Reserve deposit targeted the wrong vault");
  if (transaction.from?.toLowerCase() !== state.account.toLowerCase()) throw new Error("Reserve depositor does not match the pilot wallet");
  const event = matchingLog(receipt, state.sourceVault, EVENTS.deposited);
  if (!event || event.topics?.[1]?.toLowerCase() !== state.issuerId.toLowerCase()) throw new Error("Canonical ReserveDeposited event was not found");
  if (event.topics?.[2]?.toLowerCase() !== state.depositId.toLowerCase()) throw new Error("Deposit ID does not match");
  if (addressFromWord(event.topics[3]).toLowerCase() !== state.account.toLowerCase()) throw new Error("Mint beneficiary does not match");
  if (addressFromWord(`0x${event.data.slice(2, 66)}`).toLowerCase() !== state.account.toLowerCase()) throw new Error("Deposit event sender does not match");
  if (BigInt(`0x${event.data.slice(66, 130)}`) !== AMOUNT) throw new Error("Deposit amount does not match 0.1 USDC");
}

async function validatePayoutTransaction() {
  const [receipt, transaction] = await Promise.all([
    publicRpc(networks.source.rpcUrl, "eth_getTransactionReceipt", [state.payoutTransaction]),
    publicRpc(networks.source.rpcUrl, "eth_getTransactionByHash", [state.payoutTransaction]),
  ]);
  if (!receipt || !transaction || BigInt(receipt.status || "0x0") !== 1n) throw new Error("Reserve payout is missing or failed");
  if (transaction.to?.toLowerCase() !== state.sourceVault.toLowerCase()) throw new Error("Reserve payout targeted the wrong vault");
  if (transaction.from?.toLowerCase() !== state.account.toLowerCase()) throw new Error("Payout operator does not match the configured administrator");
  const event = matchingLog(receipt, state.sourceVault, EVENTS.paidOut);
  if (!event || event.topics?.[1]?.toLowerCase() !== state.issuerId.toLowerCase()) throw new Error("Canonical ReservePaidOut event was not found");
  if (event.topics?.[2]?.toLowerCase() !== state.redemptionId.toLowerCase()) throw new Error("Payout redemption ID does not match");
  if (addressFromWord(event.topics[3]).toLowerCase() !== state.account.toLowerCase()) throw new Error("Payout recipient does not match");
  if (addressFromWord(`0x${event.data.slice(2, 66)}`).toLowerCase() !== state.account.toLowerCase()) throw new Error("Payout operator event does not match");
  if (BigInt(`0x${event.data.slice(66, 130)}`) !== AMOUNT) throw new Error("Payout amount does not match 0.1 USDC");
}

async function fetchProofJson(path, label) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${networks.destination.proofBuilderUrl}${path}`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function generateProof(kind) {
  const isDeposit = kind === "deposit";
  if (isDeposit) await validateDepositTransaction();
  else await validatePayoutTransaction();
  const transactionHash = isDeposit ? state.depositTransaction : state.payoutTransaction;
  const blockNumber = isDeposit ? state.depositBlock : state.payoutBlock;
  const deadline = Date.now() + 20 * 60_000;
  while (Date.now() < deadline) {
    const height = await fetchProofJson(
      `/api/v1/attested-height/${networks.source.attestcoinChainKey}`,
      "Attestcoin height request",
    );
    const current = Number(height.attestedHeight);
    if (current >= blockNumber) break;
    setStatus(`Attestcoin has reached Sepolia block ${current.toLocaleString("en-US")}; waiting for ${blockNumber.toLocaleString("en-US")}…`);
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
  const finalHeight = await fetchProofJson(
    `/api/v1/attested-height/${networks.source.attestcoinChainKey}`,
    "Attestcoin height request",
  );
  if (Number(finalHeight.attestedHeight) < blockNumber) throw new Error("Attestcoin wait exceeded 20 minutes; retry without repeating the source transaction");
  setStatus("Source block is attested. Retrieving and validating the proof…");
  const proof = await fetchProofJson(
    `/api/v1/proof-by-tx/${networks.source.attestcoinChainKey}/${transactionHash}`,
    "Proof request",
  );
  if (proof.txHash?.toLowerCase() !== transactionHash.toLowerCase()) throw new Error("Proof transaction hash mismatch");
  if (Number(proof.headerNumber) !== blockNumber) throw new Error("Proof block height mismatch");
  if (Number(proof.chainKey) !== networks.source.attestcoinChainKey) throw new Error("Proof source chain mismatch");
  state[isDeposit ? "depositProof" : "payoutProof"] =
    isDeposit ? encodeExecuteDeposit(proof) : encodeExecutePayout(proof);
  state[isDeposit ? "depositProofShape" : "payoutProofShape"] = {
    siblings: proof.merkleProof.siblings.length,
    continuityRoots: proof.continuityProof.roots.length,
  };
}

const steps = [
  {
    network: "METAMASK",
    title: "Connect the pilot wallet",
    description: "The same wallet administers both networks. No private key leaves MetaMask.",
    button: "Connect MetaMask",
    run: async () => {
      await connect();
      state.issuerId ||= createIssuerId(state.account);
      state.depositId ||= `0x${randomHex(32)}`;
      state.initialUsdcBalance = (await readUint(
        "source",
        networks.source.reserveAsset.address,
        `0x70a08231${addressArgument(state.account)}`,
      )).toString();
      if (BigInt(state.initialUsdcBalance) < AMOUNT) throw new Error("This wallet needs at least 0.1 test USDC on Sepolia");
      completeStep("Wallet connected. The pilot has enough test USDC.");
    },
  },
  {
    network: "ETHEREUM SEPOLIA · 1 SIGNATURE",
    title: "Create the canonical reserve vault",
    description: "The reviewed V2 factory deploys the only vault implementation accepted by this issuer.",
    button: "Create canonical vault",
    run: async () => {
      const receipt = await transactionReceipt("source", () => sendTransaction("source", {
        to: networks.source.canonicalVaultFactoryV2,
        data: encodeCreateVaultV2(networks.source.reserveAsset.address, state.issuerId),
      }, "canonical reserve vault creation"));
      const event = matchingLog(receipt, networks.source.canonicalVaultFactoryV2, EVENTS.vaultCreated);
      if (!event?.topics?.[3]) throw new Error("CanonicalVaultCreated event was not found");
      state.sourceVault = addressFromWord(event.topics[3]);
      recordAddress("Canonical Sepolia vault", state.sourceVault, "sourceVault", "source");
      recordTransaction("Create canonical vault", receipt.transactionHash, "createVault", "source");
      completeStep("Canonical source vault confirmed.");
    },
  },
  {
    network: "CREDITCOIN CC3 · 1 SIGNATURE",
    title: "Create the V2 token system",
    description: "Deploys an isolated controller, rvUSD2 token, and bond vault bound to the canonical Sepolia vault.",
    button: "Create V2 issuer",
    run: async () => {
      const data = encodeCreateIssuerV2({
        issuerId: state.issuerId,
        sourceChainKey: networks.source.attestcoinChainKey,
        sourceVault: state.sourceVault,
        sourceExecutor: ZERO_ADDRESS,
        sourcePayoutOperator: state.account,
        reserveAsset: networks.source.reserveAsset.address,
        decimals: 6,
        tokenName: "Resyvr Redeemable USD",
        tokenSymbol: "rvUSD2",
      });
      const receipt = await transactionReceipt("destination", () => sendTransaction("destination", {
        to: networks.destination.issuerFactoryV2,
        data,
      }, "V2 issuer creation"));
      const event = matchingLog(receipt, networks.destination.issuerFactoryV2, EVENTS.issuerCreated);
      if (!event?.topics?.[3] || !event.data) throw new Error("IssuerCreatedV2 event was not found");
      state.controller = addressFromWord(event.topics[3]);
      state.token = addressFromWord(`0x${event.data.slice(2, 66)}`);
      const sourceVault = addressFromWord(`0x${event.data.slice(66, 130)}`);
      const payoutOperator = addressFromWord(`0x${event.data.slice(130, 194)}`);
      state.bondVault = addressFromWord(`0x${event.data.slice(194, 258)}`);
      if (sourceVault.toLowerCase() !== state.sourceVault.toLowerCase()) throw new Error("Issuer event returned the wrong source vault");
      if (payoutOperator.toLowerCase() !== state.account.toLowerCase()) throw new Error("Issuer event returned the wrong payout operator");
      recordAddress("V2 controller", state.controller, "controller", "destination");
      recordAddress("rvUSD2 token", state.token, "token", "destination");
      recordAddress("CTC activation stake vault", state.bondVault, "bondVault", "destination");
      recordTransaction("Create V2 issuer", receipt.transactionHash, "createIssuer", "destination");
      completeStep("V2 token system confirmed.");
    },
  },
  {
    network: "CREDITCOIN CC3 · 1 SIGNATURE",
    title: "Deposit the 1 CTC activation stake",
    description: "This stake activates issuance and stays locked while token supply or pending redemptions exist.",
    button: "Deposit 1 CTC",
    run: async () => {
      const receipt = await transactionReceipt("destination", () => sendTransaction("destination", {
        to: state.bondVault,
        data: CALLS.depositBond,
        value: toQuantity(BOND),
      }, "1 CTC activation stake"));
      recordTransaction("Deposit activation stake", receipt.transactionHash, "depositBond", "destination");
      completeStep("The 1 CTC activation stake is deposited.");
    },
  },
  {
    network: "CREDITCOIN CC3 · 1 SIGNATURE",
    title: "Activate proof-backed issuance",
    description: "Activation opens minting through valid Attestcoin deposit proofs.",
    button: "Activate issuance",
    run: async () => {
      const receipt = await transactionReceipt("destination", () => sendTransaction("destination", {
        to: state.bondVault,
        data: CALLS.activate,
      }, "V2 issuance activation"));
      recordTransaction("Activate issuance", receipt.transactionHash, "activate", "destination");
      completeStep("Proof-backed issuance is active.");
    },
  },
  {
    network: "ETHEREUM SEPOLIA · 1 SIGNATURE",
    title: "Approve exactly 0.1 test USDC",
    description: "The canonical vault receives allowance for this pilot amount only.",
    button: "Approve 0.1 USDC",
    run: async () => {
      const receipt = await transactionReceipt("source", () => sendTransaction("source", {
        to: networks.source.reserveAsset.address,
        data: encodeApprove(state.sourceVault, AMOUNT),
      }, "0.1 test USDC approval"));
      recordTransaction("Approve reserve", receipt.transactionHash, "approveReserve", "source");
      completeStep("Exact reserve allowance confirmed.");
    },
  },
  {
    network: "ETHEREUM SEPOLIA · 1 SIGNATURE",
    title: "Lock the 0.1 USDC reserve",
    description: "The vault records a unique deposit ID and your wallet as the future rvUSD2 recipient.",
    button: "Deposit reserve",
    run: async () => {
      const receipt = await transactionReceipt("source", () => sendTransaction("source", {
        to: state.sourceVault,
        data: encodeDeposit(state.depositId, state.account, AMOUNT),
      }, "0.1 test USDC reserve deposit"));
      state.depositTransaction = receipt.transactionHash;
      state.depositBlock = Number(BigInt(receipt.blockNumber));
      await validateDepositTransaction();
      recordTransaction("Lock reserve", receipt.transactionHash, "depositReserve", "source");
      completeStep("0.1 test USDC is locked in the canonical vault.");
    },
  },
  {
    network: "ATTESTCOIN · NO SIGNATURE",
    title: "Build the deposit proof",
    description: "Waits for source finality, retrieves the official proof, and validates the Sepolia deposit before encoding calldata.",
    button: "Generate deposit proof",
    run: async () => {
      await generateProof("deposit");
      completeStep("The deposit proof is ready for Creditcoin.");
    },
  },
  {
    network: "CREDITCOIN CC3 · 1 SIGNATURE",
    title: "Submit proof and mint 0.1 rvUSD2",
    description: "The controller verifies every source field and mints the exact proven reserve amount.",
    button: "Mint proof-backed rvUSD2",
    run: async () => {
      const receipt = await transactionReceipt("destination", () => sendTransaction("destination", {
        to: state.controller,
        data: state.depositProof,
      }, "Attestcoin deposit proof and 0.1 rvUSD2 mint"));
      const supply = await readUint("destination", state.token, CALLS.totalSupply);
      const balance = await readUint("destination", state.token, `0x70a08231${addressArgument(state.account)}`);
      if (supply !== AMOUNT || balance !== AMOUNT) throw new Error("Mint confirmed but token supply or recipient balance is not exactly 0.1");
      state.mintedSupply = supply.toString();
      recordTransaction("Verify deposit and mint", receipt.transactionHash, "mint", "destination");
      completeStep("Exactly 0.1 rvUSD2 was minted to your Creditcoin wallet.");
    },
  },
  {
    network: "CREDITCOIN CC3 · 1 SIGNATURE",
    title: "Approve redemption escrow",
    description: "Allows the V2 controller to escrow exactly 0.1 rvUSD2 for this redemption.",
    button: "Approve 0.1 rvUSD2",
    run: async () => {
      const receipt = await transactionReceipt("destination", () => sendTransaction("destination", {
        to: state.token,
        data: encodeApprove(state.controller, AMOUNT),
      }, "0.1 rvUSD2 redemption approval"));
      recordTransaction("Approve redemption escrow", receipt.transactionHash, "approveRedemption", "destination");
      completeStep("Exact redemption allowance confirmed.");
    },
  },
  {
    network: "CREDITCOIN CC3 · 1 SIGNATURE",
    title: "Request redemption to Sepolia",
    description: "Escrows 0.1 rvUSD2 and creates the redemption ID that the source payout must reference.",
    button: "Request redemption",
    run: async () => {
      const receipt = await transactionReceipt("destination", () => sendTransaction("destination", {
        to: state.controller,
        data: encodeRequestRedemption(AMOUNT, state.account),
      }, "0.1 rvUSD2 redemption request"));
      const event = matchingLog(receipt, state.controller, EVENTS.redemptionRequested);
      if (!event?.topics?.[1]) throw new Error("RedemptionRequested event was not found");
      state.redemptionId = event.topics[1];
      recordTransaction("Request redemption", receipt.transactionHash, "requestRedemption", "destination");
      completeStep("0.1 rvUSD2 is escrowed and its redemption ID is confirmed.");
    },
  },
  {
    network: "ETHEREUM SEPOLIA · 1 SIGNATURE",
    title: "Pay out the reserve",
    description: "The canonical vault returns exactly 0.1 test USDC to the recipient named in the redemption.",
    button: "Pay out 0.1 USDC",
    run: async () => {
      const receipt = await transactionReceipt("source", () => sendTransaction("source", {
        to: state.sourceVault,
        data: encodePayout(state.redemptionId, state.account, AMOUNT),
      }, "0.1 test USDC redemption payout"));
      state.payoutTransaction = receipt.transactionHash;
      state.payoutBlock = Number(BigInt(receipt.blockNumber));
      await validatePayoutTransaction();
      recordTransaction("Pay reserve recipient", receipt.transactionHash, "payout", "source");
      completeStep("The canonical vault returned exactly 0.1 test USDC.");
    },
  },
  {
    network: "ATTESTCOIN · NO SIGNATURE",
    title: "Build the payout proof",
    description: "Validates the payout transaction, event, redemption ID, recipient, operator, and amount before encoding proof calldata.",
    button: "Generate payout proof",
    run: async () => {
      await generateProof("payout");
      completeStep("The exact payout proof is ready for Creditcoin.");
    },
  },
  {
    network: "CREDITCOIN CC3 · 1 SIGNATURE",
    title: "Finalize redemption and burn",
    description: "The controller accepts the proof once, completes the redemption, and burns the escrowed rvUSD2.",
    button: "Submit payout proof",
    run: async () => {
      const receipt = await transactionReceipt("destination", () => sendTransaction("destination", {
        to: state.controller,
        data: state.payoutProof,
      }, "Attestcoin payout proof and escrow burn"));
      recordTransaction("Finalize redemption and burn", receipt.transactionHash, "finalizeRedemption", "destination");
      completeStep("Payout proof accepted and escrowed rvUSD2 burned.");
    },
  },
  {
    network: "TWO NETWORKS · NO SIGNATURE",
    title: "Verify the completed cycle",
    description: "Reads both chains independently and accepts completion only when every final invariant matches.",
    button: "Verify final state",
    run: async () => {
      const [supply, pending, netReserve, redeemed, sourceReserve, finalUsdcBalance] = await Promise.all([
        readUint("destination", state.token, CALLS.totalSupply),
        readUint("destination", state.controller, CALLS.totalPendingRedemption),
        readUint("destination", state.controller, CALLS.netVerifiedReserve),
        readUint("destination", state.controller, CALLS.totalRedeemed),
        readUint("source", state.sourceVault, CALLS.recognizedReserve),
        readUint("source", networks.source.reserveAsset.address, `0x70a08231${addressArgument(state.account)}`),
      ]);
      if (supply !== 0n) throw new Error("rvUSD2 supply is not zero");
      if (pending !== 0n) throw new Error("A redemption remains pending");
      if (netReserve !== 0n || sourceReserve !== 0n) throw new Error("Verified or source reserve did not return to zero");
      if (redeemed !== AMOUNT) throw new Error("Creditcoin redeemed total is not exactly 0.1");
      if (finalUsdcBalance < BigInt(state.initialUsdcBalance)) throw new Error("The wallet's test USDC balance was not fully restored");
      state.final = {
        tokenSupply: supply.toString(),
        pendingRedemption: pending.toString(),
        netVerifiedReserve: netReserve.toString(),
        totalRedeemed: redeemed.toString(),
        sourceRecognizedReserve: sourceReserve.toString(),
        usdcRestored: true,
      };
      state.complete = true;
      completeStep("Live V2 issuance and redemption verified across both chains.");
    },
  },
];

function explorerFor(entry) {
  const network = networks?.[entry.chainKey];
  if (!network) return "";
  return `${network.explorerUrl}/${entry.type === "transaction" ? "tx" : "address"}/${entry.value}`;
}

function renderEvidence() {
  const list = byId("evidence-list");
  list.replaceChildren();
  for (const entry of state.evidence || []) {
    const article = document.createElement("article");
    article.className = "evidence-item";
    const label = document.createElement("span");
    label.textContent = entry.label.toUpperCase();
    const link = document.createElement("a");
    link.href = explorerFor(entry);
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = `${entry.value} ↗`;
    article.append(label, link);
    list.append(article);
  }
  if ((state.evidence || []).length === 0) {
    const article = document.createElement("article");
    article.className = "evidence-item";
    const label = document.createElement("span");
    label.textContent = "WAITING FOR FIRST CONFIRMATION";
    const detail = document.createElement("code");
    detail.textContent = "Confirmed addresses and transaction hashes will appear here.";
    article.append(label, detail);
    list.append(article);
  }
}

function exportEvidence() {
  return {
    schemaVersion: 1,
    account: state.account,
    issuerId: state.issuerId,
    amount: AMOUNT.toString(),
    tokenSymbol: "rvUSD2",
    sourceVault: state.sourceVault,
    controller: state.controller,
    token: state.token,
    bondVault: state.bondVault,
    depositId: state.depositId,
    redemptionId: state.redemptionId,
    depositBlock: state.depositBlock,
    payoutBlock: state.payoutBlock,
    transactions: state.transactions,
    proofShapes: {
      deposit: state.depositProofShape,
      payout: state.payoutProofShape,
    },
    final: state.final,
  };
}

function render() {
  if (!networks) return;
  const current = steps[Math.min(state.step || 0, steps.length - 1)];
  byId("step-number").textContent = String(Math.min(state.step || 0, 14)).padStart(2, "0");
  byId("progress-bar").style.width = `${Math.min(100, ((state.step || 0) / 14) * 100)}%`;
  byId("wallet-label").textContent = state.account ? `Connected ${shortHex(state.account)}` : "Wallet not connected";
  byId("action-network").textContent = state.complete ? "CROSS-CHAIN LIFECYCLE VERIFIED" : current.network;
  byId("action-title").textContent = state.complete ? "The live V2 pilot is complete" : current.title;
  byId("action-description").textContent = state.complete
    ? "0.1 USDC was locked, 0.1 rvUSD2 was minted, the reserve was paid back, and all escrowed supply was burned."
    : current.description;
  const button = byId("continue-button");
  button.textContent = state.complete ? "Lifecycle complete" : current.button;
  button.disabled = busy || state.complete;
  if (!busy) setStatus(state.lastMessage || "No transaction or message will be signed automatically.", state.lastType || "");

  const latest = state.pending || [...(state.transactions || [])].reverse()[0];
  const transactionLink = byId("transaction-link");
  if (latest?.hash && latest?.key && networks[latest.key]) {
    transactionLink.href = `${networks[latest.key].explorerUrl}/tx/${latest.hash}`;
    transactionLink.hidden = false;
  } else {
    transactionLink.hidden = true;
  }
  renderEvidence();
  byId("complete-panel").hidden = !state.complete;
  if (state.complete) byId("evidence-json").textContent = JSON.stringify(exportEvidence(), null, 2);
}

async function ensurePilotAccount() {
  if (!state.account || state.step === 0) return;
  const accounts = await ethereum.request({ method: "eth_requestAccounts" });
  if (!accounts.some((account) => account.toLowerCase() === state.account.toLowerCase())) {
    throw new Error(`Select the wallet that started this pilot: ${state.account}`);
  }
}

async function runCurrentStep() {
  if (busy || state.complete) return;
  busy = true;
  render();
  try {
    await ensurePilotAccount();
    await steps[state.step].run();
  } catch (error) {
    if (error?.transactionFailed) state.pending = null;
    state.lastMessage = errorMessage(error);
    state.lastType = "error";
    saveState();
    setStatus(state.lastMessage, "error");
  } finally {
    busy = false;
    render();
  }
}

byId("continue-button").addEventListener("click", runCurrentStep);
byId("copy-evidence").addEventListener("click", async () => {
  await navigator.clipboard.writeText(JSON.stringify(exportEvidence(), null, 2));
  byId("copy-evidence").textContent = "Copied";
});

if (window.ethereum) {
  ethereum.on("accountsChanged", () => render());
  ethereum.on("chainChanged", () => render());
}

const response = await fetch("../config/networks.json");
if (!response.ok) throw new Error(`Network configuration unavailable: HTTP ${response.status}`);
networks = await response.json();
if (!networks.source.canonicalVaultFactoryV2 || !networks.destination.issuerFactoryV2) {
  throw new Error("Verified V2 factory addresses are unavailable");
}
render();
