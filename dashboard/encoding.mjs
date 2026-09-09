function stripHexPrefix(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]*$/.test(value)) throw new Error("Expected a hex value");
  return value.slice(2).toLowerCase();
}

function padWord(value) {
  if (value.length > 64) throw new Error("ABI value exceeds one word");
  return value.padStart(64, "0");
}

function encodeUint(value) {
  const number = BigInt(value);
  if (number < 0n) throw new Error("Unsigned ABI value cannot be negative");
  return padWord(number.toString(16));
}

function encodeAddress(value) {
  const address = stripHexPrefix(value);
  if (!/^[0-9a-f]{40}$/.test(address)) throw new Error("Expected a 20-byte address");
  return padWord(address);
}

function encodeBytes32(value) {
  const bytes = stripHexPrefix(value);
  if (bytes.length !== 64) throw new Error("Expected a 32-byte value");
  return bytes;
}

function encodeDynamicBytes(value) {
  const bytes = stripHexPrefix(value);
  if (bytes.length % 2 !== 0) throw new Error("Hex bytes must contain complete bytes");
  const paddedLength = Math.ceil(bytes.length / 64) * 64;
  return `${encodeUint(bytes.length / 2)}${bytes.padEnd(paddedLength, "0")}`;
}

function encodeString(value) {
  const bytes = [...new TextEncoder().encode(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return encodeDynamicBytes(`0x${bytes}`);
}

function byteLength(value) {
  return value.length / 2;
}

export function encodeApprove(spender, amount) {
  return `0x095ea7b3${encodeAddress(spender)}${encodeUint(amount)}`;
}

export function encodeFactoryDeployment(bytecode, minimumBondWei) {
  const creationBytecode = stripHexPrefix(bytecode);
  if (creationBytecode.length === 0) throw new Error("Factory bytecode is unavailable");
  return `0x${creationBytecode}${encodeUint(minimumBondWei)}`;
}

export function encodeSourceVaultDeployment(bytecode, reserveAsset, issuerId) {
  const creationBytecode = stripHexPrefix(bytecode);
  if (creationBytecode.length === 0) throw new Error("Source vault bytecode is unavailable");
  return `0x${creationBytecode}${encodeAddress(reserveAsset)}${encodeBytes32(issuerId)}`;
}

export function encodeDeposit(depositId, beneficiary, amount) {
  return `0xd954863c${encodeBytes32(depositId)}${encodeAddress(beneficiary)}${encodeUint(amount)}`;
}

export function encodeCreateIssuer(parameters) {
  const name = encodeString(parameters.tokenName);
  const symbol = encodeString(parameters.tokenSymbol);
  const tupleHeadBytes = 8 * 32;
  const tuple = [
    encodeBytes32(parameters.issuerId),
    encodeUint(parameters.sourceChainKey),
    encodeAddress(parameters.sourceVault),
    encodeAddress(parameters.sourceExecutor),
    encodeAddress(parameters.reserveAsset),
    encodeUint(parameters.decimals),
    encodeUint(tupleHeadBytes),
    encodeUint(tupleHeadBytes + byteLength(name)),
    name,
    symbol,
  ].join("");
  return `0x3db42169${encodeUint(32)}${tuple}`;
}

export function encodeExecuteDeposit(proof) {
  const transaction = encodeDynamicBytes(proof.txBytes);
  const siblings = `${encodeUint(proof.merkleProof.siblings.length)}${proof.merkleProof.siblings
    .map((entry) => `${encodeBytes32(entry.hash)}${encodeUint(entry.isLeft ? 1 : 0)}`)
    .join("")}`;
  const roots = `${encodeUint(proof.continuityProof.roots.length)}${proof.continuityProof.roots
    .map(encodeBytes32)
    .join("")}`;
  const headBytes = 7 * 32;

  return `0x083eb8c8${[
    encodeUint(proof.chainKey),
    encodeUint(proof.headerNumber),
    encodeUint(headBytes),
    encodeBytes32(proof.merkleProof.root),
    encodeUint(headBytes + byteLength(transaction)),
    encodeBytes32(proof.continuityProof.lowerEndpointDigest),
    encodeUint(headBytes + byteLength(transaction) + byteLength(siblings)),
    transaction,
    siblings,
    roots,
  ].join("")}`;
}

export function parseUnits(value, decimals) {
  if (!/^\d+(?:\.\d+)?$/.test(value)) throw new Error("Enter a positive decimal amount");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) throw new Error(`Amount supports at most ${decimals} decimal places`);
  const units = BigInt(`${whole}${fraction.padEnd(decimals, "0")}`);
  if (units <= 0n) throw new Error("Amount must be greater than zero");
  return units;
}
