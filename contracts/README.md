# Resyvr contracts

`SourceReserveVault` is the Sepolia half of the Phase 1 issuance gate. It locks
one configured ERC-20 reserve asset, rejects fee-on-transfer deposits, consumes
each deposit ID once, and emits the exact event later verified on Creditcoin.
It has no withdrawal or administrator path in the MVP.

## Validate

```bash
npm run contracts:check
```

## Deployment inputs

- `RESYVR_RESERVE_ASSET`: the Sepolia reserve token contract;
- `RESYVR_ISSUER_ID`: the fixed 32-byte issuer identifier.

The reproducible deployment script is
`script/DeploySourceReserveVault.s.sol`. A deployment is only considered part
of the demo after its address and transaction hash are recorded from Sepolia.
