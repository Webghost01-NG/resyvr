# Security invariant evidence

Resyvr treats a valid Attestcoin inclusion proof as one input to authorization,
not as authorization by itself. The contract test suite exercises the complete
issuance boundary below.

## Proof semantics

`ProofReserveController.t.sol` covers the configured source chain, proof-verifier
result, successful receipt status, transaction destination, smart-account
executor, vault log emitter, event signature, issuer ID, beneficiary, depositor,
amount, calldata-to-event agreement, ambiguous duplicate logs, query replay, and
deposit-ID replay. A rejected proof must leave both replay maps and reserve
accounting unchanged.

## Issuance authorization

`IssuerFactory.t.sol` proves that each token has one controller-only minter,
issuer configuration is immutable, issuance can be paused only by its immutable
administrator, and minting requires a funded and active native CTC bond. A
paused or inactive issuance attempt rolls back proof consumption and token
supply together.

The fuzz case runs exact mint accounting across token decimals 0 through 18,
positive reserve amounts from 1 through `type(uint128).max + 1`, arbitrary
beneficiaries, and arbitrary deposit IDs.

## Stateful invariants

`IssuerInvariants.t.sol` runs 64 stateful campaigns of 32 calls each. The handler
mixes unique valid deposits with replay attempts and unauthorized mint, pause,
administrator-change, bond-deactivation, and bond-withdrawal calls. After every
sequence it requires:

- issuer token total supply equals the controller's confirmed reserve;
- total supply equals the handler's independently accumulated proven amount;
- no replay or unauthorized mutation has succeeded;
- token controller and issuer administrator remain unchanged;
- the active CTC bond remains at or above the immutable factory minimum.

These tests use a deterministic verifier stub to isolate the controller's
semantic and state-transition logic. The live CC3 evidence separately exercises
Creditcoin's Block Prover precompile with a real Sepolia transaction proof.

## V2 redemption lifecycle

`RedemptionV2.t.sol` additionally requires that both chain factories derive the
same canonical source vault and rejects arbitrary vaults or payout operators.
It tests exact reserve payout, escrow and burn accounting, payout-query and
redemption-ID replay, failed receipts, mismatched recipients and amounts,
fee-on-transfer reserve behavior, pause behavior, and CTC bond locking until all
issued supply is redeemed. These tests isolate contract behavior; the separate
`npm run evidence:v2:pilot` verifier reproduces 93 checks against the deployed
factories and completed live deposit, mint, payout, proof-finalization, and burn
transactions.
