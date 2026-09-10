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

The complete pilot issuer is deployed and source-verified on Creditcoin CC3:

| Component | Address |
| --- | --- |
| Issuer factory | [`0xd951…323F`](https://creditcoin-testnet.blockscout.com/address/0xd951A7094814DC2Ab9BE5F5E263A0081C89f323F) |
| Issuer controller | [`0x81a5…2948`](https://creditcoin-testnet.blockscout.com/address/0x81a5E9379eaa4a2dAed7108120e8059d6CeF2948) |
| rvUSD token | [`0xbCb8…5Afa`](https://creditcoin-testnet.blockscout.com/address/0xbCb8eE1A76842d4Fea3Eca2dD65768efF4645Afa) |
| CTC bond vault | [`0x164e…B55f`](https://creditcoin-testnet.blockscout.com/address/0x164e57032b0224C435d7ADD047D57463efcBB55f) |

The successful sequence is recorded with exact receipts in
`config/issuance.json`: factory deployment at block 5,458,124, issuer creation
at block 5,458,126, 1 CTC bond funding at block 5,458,129, bond activation at
block 5,458,131, and proof-backed minting at block 5,458,200. The final
[`0xe5c1…4ddb`](https://creditcoin-testnet.blockscout.com/tx/0xe5c1d4c22e4ea74ff241f6192aea2c786c55f9faac6f2678bc79c6e28c814ddb)
transaction consumed the recorded Attestcoin query, raised verified reserve to
5,000,000 base units, and minted exactly 5,000,000 rvUSD base units to the
proven beneficiary.

`config/factory-deployment.json` contains the exact compiled factory creation
bytecode and its hash. `npm run deployment:prepare` regenerates it from the
Foundry artifact. The launchpad submits that bytecode through MetaMask, then
guides issuer creation, CTC bond deposit and activation, and proof submission.

After those transactions confirm, `npm run deployment:capture` discovers them
from the public Creditcoin explorer using the issuer wallet and bytecode. It
validates the factory bond minimum, `IssuerCreated` event, administrator,
contract bytecode, and proof event before writing `config/issuance.json`.
`npm run deployment:verify-sources` then submits the exact constructor arguments
for all four issuer contracts to Creditcoin Blockscout.
`npm run evidence:verify` then additionally requires exact equality between
verified reserve, token supply, and beneficiary balance, plus a funded active
CTC bond.

The source vault now holds 6 test USDC because a later 1-USDC deposit is also
confirmed on Sepolia. The issuer controller and rvUSD supply remain at 5 units:
only the original 5-USDC deposit has a submitted proof. This difference is
expected and demonstrates that unproven deposits do not mint destination
tokens.

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

The full 54-test suite also covers source-chain, transaction target, issuer,
depositor, receipt status, amount, duplicate-log, deposit-ID replay, pause,
bond, mint authorization, canonical V2 vault provenance, and V2 redemption
failures. Stateful campaigns assert that V1 token supply always equals
independently accumulated proven reserve. V2 tests remain local prototype
evidence until its separate deployments are recorded.

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
