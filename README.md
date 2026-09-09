# Resyvr

> Proof keeps the reserve.

Resyvr is a multi-issuer asset issuance rail for Creditcoin. An issuer locks an
approved reserve asset in a source-chain vault, proves that deposit through the
Attestcoin Protocol, and mints a branded reserve token on Creditcoin. Each
issuer has an isolated reserve position, token, roles, and CTC safety bond.

The hackathon target is the **RWA track**: give organizations a reusable way to
issue and manage reserve-backed digital assets while making the backing trail
publicly inspectable.

## Why this is different

Creditcoin already provides the verification primitive and an official bridge
example. Public hackathon projects also demonstrate source-chain lock-to-mint
and USDC deposit-to-mint flows. Resyvr focuses on the issuer control plane those
examples do not provide:

- permissionless creation of isolated issuer/token/reserve pairs;
- proof-bounded minting tied to an exact source vault and reserve asset;
- CTC-denominated issuer safety bonds;
- proof-aware redemption accounting and mismatch penalties;
- public reserve coverage, proof provenance, roles, and failure states.

## Four-day MVP

One issuer creates one branded token, deposits test USDC into a Sepolia reserve
vault, and submits a genuine Attestcoin proof to mint the matching amount on
Creditcoin CC3 Testnet. The dashboard shows the source transaction, verified
reserve, supply, coverage, CTC bond, and rejected replay/mismatch cases.

Redemption is included only if the proof-bounded issuance path is working by the
end of day one. The system will not claim that CTC is dollar-stable or that a
historical deposit proof alone proves current solvency.

## Documents

- [Architecture](docs/architecture.md)
- [Competitive landscape](docs/competitive-landscape.md)
- [MVP and delivery gates](docs/mvp.md)
- [Attestcoin protocol preflight](docs/protocol-preflight.md)
- [Security invariant evidence](docs/security-invariants.md)
- [Deployment and failure evidence](docs/deployment-evidence.md)
- [Browser wallet flow](docs/wallet-flow.md)

## Public proof dashboard

Serve the repository root and open the dashboard:

```bash
npm run dashboard
```

<http://127.0.0.1:8000/dashboard/>

The page uses read-only JSON-RPC calls to compare the live Creditcoin controller
with the tracked Sepolia and CC3 deployment evidence. It shows stale, waiting,
unavailable, and error states explicitly. Token supply, coverage, and the CTC
bond remain marked pending until the issuer core is deployed and recorded.

The issuer launchpad guides MetaMask through explicit CC3 and Sepolia network
switches, issuer creation, CTC bond activation, reserve approval and deposit,
Attestcoin waiting, and proof submission. Each transaction displays its network
and effect before the wallet opens.

## Status

The Sepolia reserve vault and Creditcoin proof controller are deployed, and one
real 5 test-USDC deposit proof has updated CC3 reserve accounting. The isolated
issuer token and CTC bond contracts are implemented and tested but are not yet
claimed as deployed.
