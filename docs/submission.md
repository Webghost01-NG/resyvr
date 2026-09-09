# Resyvr — RWA issuance infrastructure on Creditcoin

**Tagline:** Proof keeps the reserve.

**Track:** RWA

**Repository:** https://github.com/Webghost01-NG/resyvr

**Live demo:** https://webghost01-ng.github.io/resyvr/

## 30-second pitch

Resyvr lets an organization launch a reserve-backed asset on Creditcoin without
building its own cross-chain verification system. The issuer creates an
isolated token, posts a visible CTC bond, and locks a reserve asset in a
source-chain vault. Creditcoin's Attestcoin Protocol proves the exact deposit.
Resyvr validates the vault, asset, issuer, depositor, beneficiary, amount,
receipt status, and replay identity before minting exactly the proven amount. A
public dashboard exposes reserve, supply, coverage, bond status, and the full
transaction trail.

## The problem

A cross-chain inclusion proof establishes that a transaction happened. It does
not determine whether the transaction came from the correct reserve vault,
belongs to the correct issuer, names the intended beneficiary, represents a
successful deposit, or has already been used. Teams issuing reserve-backed
assets must repeatedly implement those authorization rules, token deployment,
issuer isolation, accounting, bonds, and public evidence.

## What Resyvr provides

- Permissionless factory creation of isolated issuer controllers, tokens, and
  CTC bond vaults.
- Immutable binding to one source chain, reserve vault, reserve asset, issuer
  identity, and optional smart-account executor.
- Exact proof-bounded minting to the beneficiary encoded in the verified vault
  event.
- Replay protection by both Attestcoin query identity and source deposit ID.
- A native CTC bond that must be funded and active before issuance.
- Public RPC-based coverage and provenance checks that require no wallet or API
  key.
- A self-service launchpad with live balance and allowance checks, explicit
  cross-network transaction effects, recoverable pending transactions,
  multi-issuer management, recipient-directed minting, and Attestcoin progress.

## How it works

1. An issuer deploys an isolated `SourceReserveVault` on Ethereum Sepolia.
2. `IssuerFactory` creates its branded token, controller, and CTC bond vault on
   Creditcoin.
3. The issuer funds its isolated `CTCBondVault` and activates issuance.
4. Reserve assets enter the configured source vault for a chosen beneficiary.
5. Attestcoin attests the source block and constructs the transaction proof.
6. `IssuerController` verifies inclusion and every deposit field, consumes two
   replay keys, updates reserve accounting, and mints the exact amount.
7. The dashboard reads the live controller, token, and bond state and links the
   source and destination transactions.

To issue more units of the same asset, the administrator reopens that issuer
and repeats the reserve-deposit and proof steps. It does not deploy a new token.

## Working testnet evidence

The pilot uses Circle test USDC on Ethereum Sepolia and Creditcoin CC3 Testnet.
The source deposit locked 5 test USDC. A genuine Attestcoin proof was accepted
by the bonded issuer controller and minted exactly 5 rvUSD to the proven
beneficiary.

| Evidence | Explorer |
| --- | --- |
| Sepolia source vault | [`0x99d9…B34f`](https://eth-sepolia.blockscout.com/address/0x99d9d85EAca66c85526cb8DA2CbF9948FD4B34f1) |
| 5 test-USDC deposit | [`0xbc7b…45b`](https://eth-sepolia.blockscout.com/tx/0xbc7b11952b799049cab6159f43c80f4c52242e678891a693f337060e0db3545b) |
| Creditcoin issuer factory | [`0xd951…323F`](https://creditcoin-testnet.blockscout.com/address/0xd951A7094814DC2Ab9BE5F5E263A0081C89f323F) |
| Issuer controller | [`0x81a5…2948`](https://creditcoin-testnet.blockscout.com/address/0x81a5E9379eaa4a2dAed7108120e8059d6CeF2948) |
| rvUSD token | [`0xbCb8…5Afa`](https://creditcoin-testnet.blockscout.com/address/0xbCb8eE1A76842d4Fea3Eca2dD65768efF4645Afa) |
| 1 CTC bond vault | [`0x164e…B55f`](https://creditcoin-testnet.blockscout.com/address/0x164e57032b0224C435d7ADD047D57463efcBB55f) |
| Proof-backed rvUSD mint | [`0xe5c1…4ddb`](https://creditcoin-testnet.blockscout.com/tx/0xe5c1d4c22e4ea74ff241f6192aea2c786c55f9faac6f2678bc79c6e28c814ddb) |

All six deployed contracts used by the base proof and issuer flow are
source-verified. `npm run evidence:verify` independently checks both chains,
receipts, source events, bytecode, verified source status, immutable bindings,
replay state, beneficiary balance, reserve/supply equality, and the active CTC
bond. It currently completes 79 live checks.

The vault now holds 6 test USDC because a later 1-USDC deposit has not been
proven to the issuer controller. Verified reserve and rvUSD supply both remain
5. This is the intended boundary: a source deposit cannot mint until its proof
is accepted.

## Product screenshots

![Live proof dashboard](screenshots/live-proof-dashboard.png)

![On-chain multi-issuer portfolio](screenshots/issuer-portfolio.png)

## Why Creditcoin matters

Creditcoin is the destination settlement and verification layer. Resyvr calls
the CC3 Block Prover precompile through Attestcoin for the genuine Sepolia
transaction proof, uses native CTC for gas and the issuer activation bond, and
records reserve accounting and token issuance in public CC3 state. Removing
Creditcoin removes the cross-chain proof gate and the native bond and settlement
layer demonstrated by the project.

## Existing work and the contribution

Creditcoin's official
[Attestcoin bridge example](https://github.com/gluwa/attestcoin-protocol-examples/tree/main/bridge)
establishes proof-authorized cross-chain minting.
[Manatee](https://github.com/ducnmm/manatee) demonstrates social cross-chain
transfers, while
[Bliker](https://github.com/abaresks24/creditcoin-shielded-pool) focuses on
shielded USDC. Resyvr contributes the reusable RWA issuer control plane:
deterministic issuer isolation, immutable reserve boundaries, branded assets,
CTC activation bonds, proof-bounded supply, and public evidence. We found no
public Creditcoin product with this complete scope as of 9 September 2026. We
do not claim that the underlying proof or lock-to-mint pattern is new.

## Security evidence

The 39-test Foundry suite includes unit tests, 256-run fuzz tests, and 64
stateful campaigns of 32 calls each. It covers chain, transaction target, log
emitter, receipt status, issuer, depositor, beneficiary, amount, duplicate
events, query and deposit replay, bond activation, pause authority, and
controller-only minting. The stateful invariant requires token supply to equal
independently accumulated proven reserve after every sequence.

The accepted live query also rejects replay with
`QueryAlreadyProcessed(bytes32)`. Wrong-emitter and wrong-beneficiary failures
are deterministic contract tests and are presented as tests rather than as
invented live transactions.

## Trust model and limitations

Attestcoin proves source-chain inclusion; Resyvr interprets the proven
transaction under immutable rules. The test-USDC issuer remains trusted for the
reserve asset. The CTC bond is a visible commitment rather than dollar
insurance, and the MVP has no slashing path. Attestation introduces latency.
Redemption is intentionally deferred because a safe source-chain payout needs
an asynchronous request, payout proof, expiry, and recovery design. This is
testnet software, test USDC has no financial value, and the contracts have not
been audited.

## Technology

Creditcoin CC3 Testnet, Attestcoin Protocol, Solidity 0.8.30, Foundry,
TypeScript, ethers v6, and a dependency-free browser interface.
