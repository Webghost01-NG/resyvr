# Resyvr V2 redemption protocol

## Status and boundary

V2 is a reviewed prototype contract set. It is not deployed and does not alter
the public V1 pilot, its issuers, or their balances. V1 remains an issuance-only
testnet system. A V2 issuer must be created with the V2 factories from the
beginning because the deployed V1 contracts are immutable.

## Canonical vault provenance

V2 removes the arbitrary-vault trust gap from issuer registration:

1. `SourceReserveVaultFactoryV2` deploys a vault on the source chain with
   CREATE2 from the reserve asset, issuer ID, and administrator.
2. `IssuerFactoryV2` independently derives that same address from its immutable
   canonical source-factory address.
3. It rejects any issuer whose supplied vault is not the derived address or
   whose payout operator is not the vault administrator.
4. A deposit proof can succeed only when a transaction at that derived address
   emits the exact canonical deposit event.

The address derivation binds the expected creation code and constructor values.
The production deployment still needs a published, verified canonical factory
address for each supported source network.

## Lifecycle

```text
Creditcoin CC3                         Ethereum Sepolia

Holder approves token
Holder requests redemption
Controller escrows token
       |                                      |
       | redemption ID ---------------------> |
       |                         Issuer calls canonical vault
       |                         Vault pays exact recipient
       |                         Vault emits ReservePaidOut
       |                                      |
       | <--------- Attestcoin payout proof --|
Controller verifies transaction and event
Controller consumes proof and redemption ID
Controller burns escrowed token
```

For a token with six decimals, redeeming `2_000_000` token units releases
`2_000_000` reserve units. The controller does not use prices or rounding.

## Required proof semantics

`executePayout` accepts a proof only when all of these conditions hold:

- the proof uses the issuer's immutable source-chain key;
- the source transaction called the canonical vault directly;
- the transaction sender is the immutable source payout operator;
- the transaction transferred no native value and its receipt succeeded;
- exactly one canonical `ReservePaidOut` log was emitted by the vault;
- calldata and log agree on redemption ID, recipient, and amount;
- event issuer ID and operator match the controller configuration;
- the redemption exists, is pending, and has the same recipient and amount;
- neither the Attestcoin query nor redemption ID has already been consumed;
- cumulative redemption cannot exceed cumulative verified reserve.

State is updated before the controller burns its own escrow balance. A revert
rolls back proof consumption, accounting, request status, and burning together.

## Issuer controls

The administrator may pause new issuance and new redemption requests
independently. Pausing redemption never blocks finalization of a request that is
already pending. The source vault exposes an identified `payout` function and
has no generic withdrawal function.

`CTCBondVaultV2` allows deactivation and withdrawal only after token supply and
pending redemption liability both reach zero. The bond remains an activation
stake and accountability signal. V2 does not claim slashing, insurance, or
automatic holder compensation.

## Deliberate recovery rule

V2 has no automatic timeout refund. A source payment can be complete while its
Attestcoin proof is still unavailable or not yet submitted. Returning escrowed
tokens on a timer could give a holder both the reserve payment and the tokens.
Anyone may submit the eventual payout proof, so a relayer affects liveness but
cannot change the verified recipient or amount.

This choice leaves an explicit issuer-liveness risk: the holder's tokens remain
escrowed until the issuer pays. A future cancellation protocol requires a
separate challenge and non-payment proof design.

## Prototype contracts

- `SourceReserveVaultFactoryV2.sol` — canonical source-vault deployment;
- `SourceReserveVaultV2.sol` — exact deposits and identified payouts;
- `IssuerFactoryV2.sol` — canonical-vault-gated issuer creation;
- `IssuerControllerV2.sol` — issuance, escrow, payout-proof verification, burn;
- `IssuerTokenV2.sol` — controller-only mint and escrow burn;
- `CTCBondVaultV2.sol` — liability-aware CTC bond custody.

The tests in `contracts/test/RedemptionV2.t.sol` exercise the successful
lifecycle, address provenance, payout authorization, exact transfer accounting,
proof and redemption replay, mismatched terms, failed receipts, pause behavior,
and bond release constraints.

## Deployment order

V2 uses separate factories and does not replace V1:

```bash
forge script --root contracts script/DeploySourceReserveVaultFactoryV2.s.sol \
  --rpc-url "$SEPOLIA_RPC_URL" --broadcast --browser

RESYVR_SOURCE_VAULT_FACTORY_V2=<sepolia-factory> \
RESYVR_MINIMUM_CTC_BOND=1000000000000000000 \
forge script --root contracts script/DeployIssuerFactoryV2.s.sol \
  --rpc-url "$CREDITCOIN_RPC_URL" --broadcast --browser
```

The source factory must be deployed first because its address is immutable in
the Creditcoin V2 factory. Deployment addresses and real redemption evidence
must be captured before V2 is described as live.
