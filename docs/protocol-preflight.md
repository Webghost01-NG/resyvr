# Attestcoin Protocol Preflight

Checked on 9 September 2026.

## Pinned upstream

- Repository: https://github.com/gluwa/attestcoin-protocol-examples
- Reviewed commit: `6668487ad07fdf8119f54aab9db99b6c50155b5c`
- `@gluwa/usc-sdk`: `0.18.0`
- `@gluwa/asc-contracts`: `0.2.1`
- Solidity: `0.8.30`
- EVM target: Shanghai

The dependency versions match the reviewed official example manifest. They are
exact versions rather than ranges so an install cannot silently change the
protocol surface during the hackathon.

## Networks

| Role | Network | ID | Endpoint |
|---|---|---:|---|
| Source | Ethereum Sepolia | chain ID `11155111`, Attestcoin chain key `1` | `https://ethereum-sepolia-rpc.publicnode.com` |
| Destination | Creditcoin CC3 Testnet | chain ID `102031` | `https://rpc.cc3-testnet.creditcoin.network` |
| Proof builder | CC3 Testnet prover | — | `https://prover.cc3-testnet.creditcoin.network` |

The chain key is an Attestcoin identifier and must not be confused with
Sepolia's EVM chain ID.

The preflight starts Node with IPv4-first DNS ordering because the public RPCs
have intermittently timed out through IPv6 in this environment. This changes
name resolution only; it does not bypass or weaken any proof check.

## Contracts and assets

- Block Prover precompile: `0x0000000000000000000000000000000000000FD2`
- ChainInfo precompile: `0x0000000000000000000000000000000000000FD3`
- Reviewed official EVM v1 decoder deployment:
  `0x04B9ae8562D8Cc5bbbBbBB759080dDC30B56D18B`
- Circle test USDC on Sepolia:
  `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`

Circle documents that testnet USDC has no financial value and is not backed by
real dollars. Resyvr must label it as test USDC in the product and submission.

## Reproduce

```bash
npm ci
cp .env.example .env
npm run preflight
```

The preflight performs public, read-only checks. It does not load or require a
private key.

## Configuration discrepancy

The `creditcoin-usc-networks` repository currently exposes older environment
names and endpoints that differ from the active CC3 Testnet values used by the
official Attestcoin examples. Resyvr pins the active example configuration and
tests it against the live network rather than silently selecting an entry from
that map.
