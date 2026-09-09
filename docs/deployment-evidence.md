# Deployment and failure evidence

This document separates live network evidence from deterministic contract-test
evidence. A test result is never presented as a Creditcoin transaction.

## Live cross-chain proof

The Sepolia `SourceReserveVault` and CC3 `ProofReserveController` addresses,
deployment receipts, proof receipt, block numbers, gas, and verified state are
recorded in `docs/deployments/sepolia.json` and
`docs/deployments/creditcoin.json`. `npm run evidence:verify` independently
reads both RPCs and fails if the contracts, receipts, source event, immutable
configuration, reserve balance, confirmed reserve, beneficiary balance, or
replay maps differ from those records.

Both contracts are source-verified on their Blockscout explorers with Solidity
0.8.30, optimizer enabled, 200 runs, via IR, and the Shanghai EVM target. The
JSON deployment records contain the exact verification status and explorer
links.

The live deposit proves 5 test USDC moved into the configured Sepolia vault.
Its genuine Attestcoin proof increased the CC3 controller's confirmed reserve
to 5,000,000 base units. A repeated call against that controller reverted with
`QueryAlreadyProcessed(bytes32)` (`0x62e48a65`); the consumed query and deposit
maps are also checked directly by `npm run evidence:verify`.

## Issuer deployment

`config/factory-deployment.json` contains the exact compiled factory creation
bytecode and its hash. `npm run deployment:prepare` regenerates it from the
Foundry artifact. The launchpad submits that bytecode through MetaMask, then
guides issuer creation, CTC bond deposit and activation, and proof submission.

After those transactions confirm, `npm run deployment:capture` discovers them
from the public Creditcoin explorer using the issuer wallet and bytecode. It
validates the factory bond minimum, `IssuerCreated` event, administrator,
contract bytecode, and proof event before writing `config/issuance.json`.
`npm run evidence:verify` then additionally requires exact equality between
verified reserve, token supply, and beneficiary balance, plus a funded active
CTC bond.

## Negative paths

These semantic failure cases use a deterministic verifier stub so each test
reaches the intended contract boundary without claiming a live proof:

```bash
forge test --root contracts \
  --match-test 'testRejects(SpoofedDepositEmitter|EventThatDoesNotMatchCalldata|QueryReplay)' \
  -vv
```

The three cases pass and demonstrate:

- replay fails with `QueryAlreadyProcessed(bytes32)` (`0x62e48a65`);
- a recognized deposit topic emitted by another contract fails with
  `NoDepositLog()` (`0x759a3684`);
- a beneficiary differing between direct-call calldata and the vault event
  fails with `InvalidDepositLog()` (`0xc12dcbc2`).

The full 39-test suite also covers source-chain, transaction target, issuer,
depositor, receipt status, amount, duplicate-log, deposit-ID replay, pause,
bond, and mint authorization failures. Stateful campaigns assert that token
supply always equals independently accumulated proven reserve.

## Reproduction

From a clean checkout with Node.js, npm, and Foundry installed:

```bash
npm install
npm run contracts:check
npm run preflight
npm run evidence:verify
npm run dashboard
```

The read-only checks need no private key or API key. Public RPC overrides may be
provided through `.env`; `.env` and all generated proof artifacts remain
ignored by Git.
