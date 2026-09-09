# Resyvr contracts

`SourceReserveVault` is the Sepolia half of the Phase 1 issuance gate. It locks
one configured ERC-20 reserve asset, rejects fee-on-transfer deposits, consumes
each deposit ID once, and emits the exact event later verified on Creditcoin.
It has no withdrawal or administrator path in the MVP.

## Validate

```bash
npm run contracts:check
```

The semantic, fuzz, and stateful invariant coverage is mapped in
[`../docs/security-invariants.md`](../docs/security-invariants.md).

## Deployment inputs

- `RESYVR_RESERVE_ASSET`: the Sepolia reserve token contract;
- `RESYVR_ISSUER_ID`: the fixed 32-byte issuer identifier.

The reproducible deployment script is
`script/DeploySourceReserveVault.s.sol`. A deployment is only considered part
of the demo after its address and transaction hash are recorded from Sepolia.

The pilot Sepolia deployment and its verified constructor reads are recorded
in [`../docs/deployments/sepolia.json`](../docs/deployments/sepolia.json).

`ProofReserveController` is the Creditcoin half of the Phase 1 gate. It binds a
proof to the configured source chain, vault, optional smart-account executor,
issuer, depositor, beneficiary, amount, deposit ID, and successful receipt. It
records verified reserve state and rejects both query and deposit-ID replays.
The live CC3 deployment, proof receipt, resulting state, and replay rejection
are recorded in
[`../docs/deployments/creditcoin.json`](../docs/deployments/creditcoin.json).

## Issuer core

`IssuerFactory` creates a deterministic controller, isolated ERC-20 token, and
native CTC bond vault for each issuer ID. The transaction sender becomes that
issuer's administrator. The factory-wide minimum CTC bond is immutable, so an
issuer cannot weaken its own activation threshold.
The registry records the administrator, source chain key, vault, optional
smart-account executor, reserve asset, controller, token, and decimals. These
values are immutable inside the deployed controller; the factory offers no
configuration-update path.

`IssuerController` extends the proof gate and is the token's only minter. A
successful proof updates verified-reserve accounting and mints the exact event
amount to the event beneficiary in one transaction. If minting fails or
issuance is paused, all proof-consumption and accounting changes roll back.

The MVP requires the reserve asset and issuer token to use the same decimals.
Decimal conversion is intentionally excluded until a rounding policy is
specified and tested. Deploy the factory reproducibly with:

```bash
forge script script/DeployIssuerFactory.s.sol:DeployIssuerFactory \
  --root contracts \
  --rpc-url "$CREDITCOIN_RPC_URL" \
  --broadcast
```

Set `RESYVR_MINIMUM_CTC_BOND` to the minimum native CTC amount in wei before
deploying the factory. Each bond starts inactive. Its issuer administrator must
explicitly deposit CTC and activate issuance. An active bond cannot be
withdrawn; the administrator must first deactivate issuance, which immediately
blocks new proof-backed minting. The MVP has no slashing path and makes no USD
claim about the bond's value.

The browser launchpad deploys the exact `IssuerFactory` creation bytecode stored
in `config/factory-deployment.json`. Regenerate that file from the Foundry
artifact with `npm run deployment:prepare`; its bytecode hash makes the wallet
payload reviewable. After the pilot transactions confirm,
`npm run deployment:capture` discovers them from the public explorer and writes
their addresses, blocks, gas, and links to `config/issuance.json`.
