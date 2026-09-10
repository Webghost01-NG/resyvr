# Resyvr Architecture

## Product boundary

Resyvr is a proof-bounded issuance system, not a new oracle, a production
stablecoin issuer, or a claim that CTC has a fixed dollar value. CTC pays gas
and funds an issuer activation stake. The demonstrated reserve asset is test USDC on
Sepolia.

## System map

```text
Ethereum Sepolia                              Creditcoin CC3 Testnet

Issuer / reserve provider                     Issuer / holder
        |                                             |
        v                                             v
SourceReserveVault V1/V2 -- deposit / V2 payout events --> Attestcoin proof
                                                      |
                                                      v
                                              ProofReserveController
                                                |       |       |
                                                v       v       v
                                         IssuerFactory Token  CTCBondVault
                                                |
                                                v
                                         Public proof dashboard
```

### SourceReserveVault — Sepolia

The source vault accepts one configured ERC-20 reserve asset and emits events
whose fields are sufficient to authorize a specific Creditcoin action.

```solidity
ReserveDeposited(
  bytes32 indexed issuerId,
  bytes32 indexed depositId,
  address indexed beneficiary,
  address depositor,
  uint256 amount
)

ReservePaidOut(
  bytes32 indexed issuerId,
  bytes32 indexed redemptionId,
  address indexed recipient,
  uint256 amount
)
```

The V1 vault implements deposits only. The V2 prototype adds identified payouts
and canonical CREATE2 deployment through `SourceReserveVaultFactoryV2`; it still
does not expose a generic administrative withdrawal. Every reserve
movement must emit a uniquely identified event that can be proven and
reconciled on Creditcoin. This reduces hidden-withdrawal risk but does not make
the source-chain issuer or reserve asset trustless.

### ProofReserveController — Creditcoin

The controller is the only minter for issuer tokens. For each submitted proof
it must:

1. call Creditcoin's Block Prover precompile;
2. require a successful source transaction receipt;
3. require the configured source chain, vault address, reserve token, event
   signature, issuer ID, depositor, beneficiary, and amount;
4. derive a replay key from the verified transaction/query identity;
5. update verified reserve accounting before minting;
6. mint exactly the proven amount to the proven beneficiary.

Proof inclusion alone is insufficient. All semantic checks above are contract
invariants.

### IssuerFactory and IssuerToken — Creditcoin

The factory creates deterministic issuer records and isolated ERC-20 tokens.
An issuer record binds:

- issuer ID and administrator;
- source chain key;
- source reserve vault and reserve asset;
- destination token and decimal conversion rule;
- minimum CTC bond;
- operational and paused status.

The V1 token exposes standard transfers plus controller-only minting. The V2
prototype adds controller escrow and controller-only burning after an exact
source payout proof succeeds.

### CTCBondVault — Creditcoin

Every issuer deposits native CTC before activation. The factory sets one
immutable minimum for every issuer, and an active bond cannot be withdrawn.
An issuer can deactivate issuance and then withdraw through an explicit state
transition. The MVP bond is a visible commitment and accountability mechanism;
it is not dollar insurance. There is no slashing path until an objective,
on-chain fault proof is specified and tested.

## Issuance sequence

```text
1. Issuer creates a Resyvr issuer pair on Creditcoin and posts CTC bond.
2. Issuer deposits test USDC into its configured Sepolia vault.
3. Attestcoin attestors finalize the source block.
4. A permissionless submitter obtains the transaction proof.
5. ProofReserveController verifies inclusion and event semantics.
6. Controller records the deposit as consumed and mints the exact token amount.
7. Dashboard reads both transaction provenance and current contract accounting.
```

## Redemption boundary

Attestcoin lets a Creditcoin contract verify supported source-chain data. It
does not make the Sepolia vault synchronously execute a Creditcoin burn.
Therefore redemption is an asynchronous settlement flow with an issuer-liveness
assumption:

1. holder escrows tokens in a Creditcoin redemption request;
2. issuer pays the reserve asset from the Sepolia vault using that request ID;
3. anyone submits the payout proof to Creditcoin;
4. exact recipient, amount, issuer, request ID, and receipt success are checked;
5. escrowed tokens burn and the request finalizes.

V2 deliberately has no automatic timeout refund because a completed source
payout may still be waiting for proof submission. Its bond cannot be released
while supply or a redemption liability remains. The protocol still has an
issuer-liveness assumption and does not claim a trustless two-way stablecoin.
See [the V2 redemption specification](redemption-v2.md).

## Core invariants

- A proof can be consumed once.
- Only the configured source vault can create recognized reserve events.
- A direct vault call must match its calldata; a smart-account-routed call must
  target the configured executor and bind the outer sender to the event depositor.
- Failed source transactions cannot change reserve accounting.
- Minted amount and beneficiary come from the verified event.
- Confirmed minted supply cannot exceed confirmed net reserve after decimal
  normalization.
- Issuer records cannot silently change source vault, asset, or chain.
- A V2 issuer must reference the canonical CREATE2 vault derived by the
  configured source-vault factory.
- Pausing blocks new issuance while preserving inspection and recovery paths.
- CTC bond value is shown in CTC; no unverified USD conversion is presented.

## Trust boundaries

- Attestcoin proves that a transaction was included in an attested block.
- Resyvr contracts determine whether that transaction means a valid deposit or
  payout.
- The reserve token issuer remains trusted for the reserve token itself.
- Source-vault code constrains reserve movement, but source-to-destination
  attestation has latency.
- A proof submitter affects liveness, not the verified recipient or amount.
- No contract audit is implied by tests or testnet deployment.
