const MINIMUM_BOND = 1_000_000_000_000_000_000n;
const STORAGE_KEY = "resyvr-v2-factory-deployments";
const NETWORKS = {
  source: {
    chainId: "0xaa36a7",
    chainName: "Ethereum Sepolia",
    nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"],
    blockExplorerUrls: ["https://sepolia.etherscan.io"],
  },
  destination: {
    chainId: "0x18e8f",
    chainName: "Creditcoin CC3 Testnet",
    nativeCurrency: { name: "Test CTC", symbol: "CTC", decimals: 18 },
    rpcUrls: ["https://rpc.cc3-testnet.creditcoin.network"],
    blockExplorerUrls: ["https://creditcoin-testnet.blockscout.com"],
  },
};

const byId = (id) => document.getElementById(id);
let account = "";
let bytecode;
let deployments = loadDeployments();

function loadDeployments() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch { return {}; }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(deployments));
  render();
}

function shortHex(value) {
  return value ? `${value.slice(0, 8)}…${value.slice(-6)}` : "—";
}

function errorMessage(error) {
  return error?.data?.message || error?.message || String(error);
}

function word(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}

function addressWord(address) {
  return address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

async function switchNetwork(network) {
  try {
    await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: network.chainId }] });
  } catch (error) {
    if (Number(error?.code) !== 4902) throw error;
    await ethereum.request({ method: "wallet_addEthereumChain", params: [network] });
  }
  const active = await ethereum.request({ method: "eth_chainId" });
  if (active.toLowerCase() !== network.chainId) throw new Error(`MetaMask did not switch to ${network.chainName}`);
}

async function waitForReceipt(hash) {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const receipt = await ethereum.request({ method: "eth_getTransactionReceipt", params: [hash] });
    if (receipt) {
      if (BigInt(receipt.status) !== 1n) throw new Error(`Transaction ${hash} failed on-chain`);
      if (!receipt.contractAddress) throw new Error("Confirmed deployment did not return a contract address");
      return receipt;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`Timed out waiting for ${hash}; its hash is saved and can be checked in the explorer`);
}

async function deploy(key, network, data, statusId) {
  const status = byId(statusId);
  await switchNetwork(network);
  status.className = "status";
  status.textContent = `Estimating deployment on ${network.chainName}…`;
  const estimateHex = await ethereum.request({ method: "eth_estimateGas", params: [{ from: account, data }] });
  const buffered = (BigInt(estimateHex) * 120n) / 100n;
  const transactionHash = await ethereum.request({
    method: "eth_sendTransaction",
    params: [{ from: account, data, gas: `0x${buffered.toString(16)}` }],
  });
  deployments[key] = { chainId: Number(BigInt(network.chainId)), transactionHash };
  persist();
  status.textContent = `Submitted ${shortHex(transactionHash)}. Waiting for confirmation…`;
  const receipt = await waitForReceipt(transactionHash);
  deployments[key] = {
    ...deployments[key],
    address: receipt.contractAddress,
    blockNumber: Number(BigInt(receipt.blockNumber)),
  };
  persist();
}

async function connect() {
  if (!window.ethereum) throw new Error("MetaMask was not found in this browser");
  const accounts = await ethereum.request({ method: "eth_requestAccounts" });
  account = accounts[0] || "";
  if (!account) throw new Error("MetaMask did not return an account");
  if (deployments.wallet && account.toLowerCase() !== deployments.wallet.toLowerCase()) {
    throw new Error(`Select the wallet that started this deployment: ${deployments.wallet}`);
  }
  deployments.wallet ||= account;
  persist();
  render();
}

function renderResult(key, statusId, linkId, network) {
  const deployment = deployments[key];
  const status = byId(statusId);
  const link = byId(linkId);
  if (!deployment?.address) return;
  status.className = "status success";
  status.textContent = `Confirmed ${deployment.address}`;
  link.href = `${network.blockExplorerUrls[0]}/address/${deployment.address}`;
  link.hidden = false;
}

function render() {
  byId("wallet-state").textContent = account ? `Connected ${account}` : "Wallet not connected";
  byId("connect-wallet").textContent = account ? "Wallet connected" : "Connect MetaMask";
  byId("connect-wallet").disabled = Boolean(account);
  byId("deploy-source").disabled = !account || Boolean(deployments.source?.address);
  byId("deploy-destination").disabled = !account || !deployments.source?.address || Boolean(deployments.destination?.address);
  renderResult("source", "source-status", "source-link", NETWORKS.source);
  renderResult("destination", "destination-status", "destination-link", NETWORKS.destination);
  if (deployments.source?.address && !deployments.destination?.address) {
    byId("destination-status").textContent = "Ready. MetaMask will switch to Creditcoin automatically.";
  }
  if (deployments.source?.address && deployments.destination?.address) {
    byId("evidence").hidden = false;
    byId("evidence-json").textContent = JSON.stringify(deployments, null, 2);
  }
}

async function act(button, statusId, action) {
  button.disabled = true;
  try { await action(); } catch (error) {
    const status = byId(statusId);
    status.className = "status error";
    status.textContent = errorMessage(error);
  } finally { render(); }
}

byId("connect-wallet").addEventListener("click", (event) => act(event.currentTarget, "wallet-state", connect));
byId("deploy-source").addEventListener("click", (event) => act(event.currentTarget, "source-status", async () => {
  await deploy("source", NETWORKS.source, bytecode.contracts.SourceReserveVaultFactoryV2.creationBytecode, "source-status");
}));
byId("deploy-destination").addEventListener("click", (event) => act(event.currentTarget, "destination-status", async () => {
  const creation = bytecode.contracts.IssuerFactoryV2.creationBytecode;
  const constructorArgs = `${word(MINIMUM_BOND)}${addressWord(deployments.source.address)}`;
  await deploy("destination", NETWORKS.destination, `${creation}${constructorArgs}`, "destination-status");
}));
byId("copy-evidence").addEventListener("click", async () => {
  await navigator.clipboard.writeText(byId("evidence-json").textContent);
  byId("copy-evidence").textContent = "Copied";
});

if (window.ethereum) {
  ethereum.on("accountsChanged", (accounts) => { account = accounts[0] || ""; render(); });
}

const [bytecodeResponse, officialResponse] = await Promise.all([
  fetch("../config/v2-deployment-bytecode.json"),
  fetch("../config/v2-deployments.json"),
]);
if (!bytecodeResponse.ok) throw new Error(`V2 deployment bytecode unavailable: HTTP ${bytecodeResponse.status}`);
bytecode = await bytecodeResponse.json();
if (officialResponse.ok && !deployments.source?.address && !deployments.destination?.address) {
  const official = await officialResponse.json();
  deployments = {
    wallet: official.deployer,
    source: {
      chainId: official.source.chainId,
      address: official.source.address,
      transactionHash: official.source.transactionHash,
      blockNumber: official.source.blockNumber,
    },
    destination: {
      chainId: official.destination.chainId,
      address: official.destination.address,
      transactionHash: official.destination.transactionHash,
      blockNumber: official.destination.blockNumber,
    },
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(deployments));
}
render();
