# Resyvr — proof-bounded RWA issuance and redemption

**Tagline:** Proof keeps the reserve.

**Track:** RWA

**Repository:** https://github.com/Webghost01-NG/resyvr

**Live product:** https://webghost01-ng.github.io/resyvr/dashboard/

**Judge Evidence:** https://webghost01-ng.github.io/resyvr/dashboard/judge-evidence.html

## 30-second pitch

Resyvr lets an organization create a branded real-world asset token on
Creditcoin and prove its complete reserve lifecycle. The issuer locks test USDC
in a canonical Sepolia vault. Attestcoin proves the deposit to Creditcoin, where
Resyvr validates the transaction, receipt, vault, asset, issuer, beneficiary,
amount, and replay identity before minting the exact proven amount. During
redemption, tokens enter escrow, the canonical vault pays the named recipient,
a second proof verifies that payout, and Creditcoin burns the matching supply.

Every new asset gets an isolated controller, ERC-20 token, reserve vault, CTC
activation stake, repeatable minting, redemption, and a public evidence trail.

## The problem

A cross-chain inclusion proof establishes that a transaction occurred. It does
not establish that the transaction should mint or burn an RWA token. Issuers
still need rules for vault provenance, receipt success, reserve asset, issuer
identity, beneficiary, exact amount, replay protection, supply accounting, and
redemption settlement. Building those controls repeatedly slows every RWA team
and creates subtle security gaps.

## The product

Resyvr provides reusable infrastructure for the full lifecycle:

- a canonical CREATE2 Sepolia vault factory that prevents an issuer from
  registering arbitrary source code;
- a Creditcoin factory that creates an isolated controller, token, and native
  CTC activation-stake vault for every asset;
- proof-bounded issuance that mints only to the beneficiary and for the amount
  encoded in a successful canonical reserve-deposit event;
- repeat minting for the same token through new uniquely identified deposits;
- proof-finalized redemption through token escrow, an identified source payout,
  a second Attestcoin proof, and atomic supply burn;
- query-ID, deposit-ID, payout-ID, and redemption-ID replay protection;
- a wallet flow that records transaction hashes before polling and recovers
  confirmed progress from chain logs after refresh;
- a public Judge Evidence page that verifies the live deployment without a
  wallet, private key, or API key.

## Full V2 lifecycle

1. The issuer creates a canonical reserve vault on Ethereum Sepolia.
2. The issuer creates its controller, branded token, and activation-stake vault
   on Creditcoin CC3.
3. The issuer funds the 1 CTC activation stake and enables issuance.
4. Test USDC enters the canonical vault for a named token beneficiary.
5. Attestcoin builds a proof after the Sepolia block reaches coverage.
6. The controller verifies the deposit and mints the exact proven amount.
7. A holder escrows tokens in a redemption request on Creditcoin.
8. The issuer pays the request's named recipient from the canonical vault.
9. Attestcoin proves the successful Sepolia payout.
10. The controller verifies the payout, completes the request, and burns the
    escrowed supply.

To create more of the same token, the issuer repeats steps 4–6. To run another
redemption, the holder repeats steps 7–10. No new token deployment is needed.

## Why Creditcoin and Attestcoin matter

Creditcoin is the verification and settlement layer. Resyvr calls the CC3 Block
Prover precompile through Attestcoin, consumes proof identities, records reserve
and redemption accounting, and changes token supply on Creditcoin. Native CTC
pays destination-chain gas and funds the issuer activation stake. Removing
Creditcoin removes the demonstrated cross-chain authorization gate and the
destination state machine.

## Live V2 evidence

The public V2 pilot completed a real testnet round trip:

- **reserve locked:** 100,000 base units, or 0.1 Circle test USDC;
- **tokens minted:** 100,000 base units, or 0.1 rvUSD2;
- **reserve paid out:** 100,000 base units to the named recipient;
- **tokens burned:** the complete 0.1 rvUSD2 supply;
- **final state:** zero token supply, zero pending redemption, and zero net
  proof-accounted reserve.

| Component | Network | Address |
| --- | --- | --- |
| Canonical vault factory | Sepolia | [`0x97e2…400f`](https://eth-sepolia.blockscout.com/address/0x97e27c9dAA20fE0D3B7C18A7DBd8ca2A266E400f) |
| Canonical reserve vault | Sepolia | [`0xb733…5A1e`](https://eth-sepolia.blockscout.com/address/0xb733B5680f83f92f978d8862dD689f4372Ec5A1e) |
| V2 issuer factory | Creditcoin | [`0x9266…f0d8`](https://creditcoin-testnet.blockscout.com/address/0x9266b4af55cdb47da17bf2d8a403113a6f7bf0d8) |
| Issuer controller | Creditcoin | [`0x1349…7834`](https://creditcoin-testnet.blockscout.com/address/0x13497bba153d8417bd75ad14a9ba4651fae57834) |
| rvUSD2 token | Creditcoin | [`0x5b8b…9ac9`](https://creditcoin-testnet.blockscout.com/address/0x5b8b9d3cc8f63f84ab612c78ae1c1cb3019f9ac9) |
| CTC activation-stake vault | Creditcoin | [`0x488e…9226`](https://creditcoin-testnet.blockscout.com/address/0x488e45a5fe3ee0f6521ad267c6f5b2b8ace49226) |

| Action | Network | Transaction |
| --- | --- | --- |
| Create canonical vault | Sepolia | [`0x2ef2…9945`](https://eth-sepolia.blockscout.com/tx/0x2ef29334599d3c258e73ba95256410eda444f79474d238a9fccc292298c29945) |
| Approve reserve | Sepolia | [`0x83c2…187e`](https://eth-sepolia.blockscout.com/tx/0x83c28be6f7c8f2b13593dce166778bf8905e747ba52504330a8da85520a8187e) |
| Lock reserve | Sepolia | [`0x52a6…00c7`](https://eth-sepolia.blockscout.com/tx/0x52a6c854c0f75569438f5639c469cd89d99178522767b38e0dc1568e828e00c7) |
| Create V2 issuer | Creditcoin | [`0x0a5b…cdff`](https://creditcoin-testnet.blockscout.com/tx/0x0a5befda33ea5dec986f685e480fdd8895cde7a6c15ef6056c914e8eb2f4cdff) |
| Deposit activation stake | Creditcoin | [`0xafe4…fd40`](https://creditcoin-testnet.blockscout.com/tx/0xafe4e26fb863b10bb195e222d20623cfd31e59a9004b8cea79b44c0bb84cfd40) |
| Activate issuance | Creditcoin | [`0xe6cc…4316`](https://creditcoin-testnet.blockscout.com/tx/0xe6ccf042e9155a9fe1d36c316623994326bc8e926607dd7c97af5ac82b784316) |
| Verify deposit and mint | Creditcoin | [`0x7d1d…226b`](https://creditcoin-testnet.blockscout.com/tx/0x7d1df433188d47633c2b10c67bd97e9b4275652a66ddb2432112ae09e39c226b) |
| Approve redemption escrow | Creditcoin | [`0xa80f…6821`](https://creditcoin-testnet.blockscout.com/tx/0xa80f4c42d92c65a2bb35a223ef2fc8d6ec87dde3d8b2d76ab5934d7580736821) |
| Request redemption | Creditcoin | [`0x368e…d5d0`](https://creditcoin-testnet.blockscout.com/tx/0x368e3fc870f5370bcb0d735ade7001296f3b79b201b49bb643ae5c797d5dd5d0) |
| Pay reserve recipient | Sepolia | [`0x0b9f…45e4`](https://eth-sepolia.blockscout.com/tx/0x0b9f8a0a60b6aaf394cf8f1892a65d540aad3c5eada901d78b160fc7a04645e4) |
| Finalize redemption and burn | Creditcoin | [`0xe006…60b0`](https://creditcoin-testnet.blockscout.com/tx/0xe0065570adb21e6316c6d708049efebf5b5bea5427e826b8ea448964421d60b0) |

The [Judge Evidence page](https://webghost01-ng.github.io/resyvr/dashboard/judge-evidence.html)
loads these versioned records, checks the six deployed contracts, eleven
receipts, and final state from public RPCs, and presents every explorer link in
one place. `npm run evidence:v2:pilot` independently performs **93 live checks**.

## Engineering and security evidence

The project has **55 passing Foundry tests**, including fuzz tests and stateful
invariants. They cover source-chain binding, canonical vault provenance,
receipt success, emitter and calldata agreement, beneficiary and amount checks,
exact decimal conversion, issuer isolation, pause authority, escrow and burn
accounting, fee-on-transfer behavior, CTC stake liability constraints, and all
four replay identities.

`npm run check` also runs TypeScript tests, typechecking, browser syntax and DOM
contracts, ABI encoding comparisons, submission checks, network preflight, 79
historical V1 live checks, V2 factory verification, and the 93-check live V2
lifecycle verifier.

## V1 and V2 boundary

V2 is the current product path and the submission hero. Every newly created
asset uses its canonical vault, repeatable minting, redemption escrow, proven
payout, and burn lifecycle. V1 is retained only as historical evidence that the
first issuance design produced a genuine five-test-USDC Attestcoin-backed mint.
Its deployed contracts are immutable and issuance-only; the interface labels
them accordingly rather than pretending they gained redemption.

## Trust boundaries

- This is unaudited testnet software. Circle test USDC has no financial value.
- Attestcoin proves supported source-chain events after an attestation delay;
  it does not guarantee the reserve token issuer, legal claim, custody entity,
  or off-chain asset quality.
- Canonical vault provenance proves that a registered V2 vault uses the
  published Resyvr bytecode and immutable configuration. The issuer still has a
  liveness obligation to execute requested reserve payouts.
- The dashboard reports **proof-accounting coverage**: accepted net reserve
  proofs divided by Creditcoin supply. It is not a legal solvency opinion or a
  continuous valuation oracle.
- The native CTC vault is an **activation stake and accountability signal**.
  It cannot be withdrawn while supply or pending redemption liability exists,
  but it is not insurance and has no slashing rule, dollar peg, or automatic
  holder compensation.
- A relayer can delay proof submission but cannot alter the proven payout
  recipient or amount. V2 deliberately avoids a timer-based refund because a
  source payout may already be complete while its proof is pending; refunding
  escrow in that interval could pay a holder twice.
- Default enforcement, legal ownership, licensed custody, production reserve
  attestations, dispute resolution, and recovery procedures belong to an
  issuer's legal and operational layer. Resyvr exposes the cryptographic facts
  that such a layer can use; it does not replace that layer.

## Technology

Creditcoin CC3 Testnet, Attestcoin Protocol, Ethereum Sepolia, Solidity 0.8.30,
Foundry, TypeScript, ethers v6, MetaMask, and a dependency-free browser UI.

## Existing work and Resyvr's contribution

Creditcoin's official Attestcoin bridge example demonstrates proof-authorized
cross-chain minting. Manatee demonstrates social cross-chain transfers, and
Bliker focuses on shielded USDC. Resyvr contributes the RWA issuer control
plane around the proof primitive: canonical vault provenance, multi-issuer
isolation, branded assets, exact proof-accounted supply, liability-aware
activation stakes, proof-finalized redemption, and one public lifecycle record.
The project does not claim that inclusion proofs or lock-to-mint are new.

## Submission assets

- Repository: https://github.com/Webghost01-NG/resyvr
- Live product: https://webghost01-ng.github.io/resyvr/dashboard/
- Judge Evidence: https://webghost01-ng.github.io/resyvr/dashboard/judge-evidence.html
- Technical README: https://github.com/Webghost01-NG/resyvr#readme
- Demo script: `docs/demo-script.md`
- Submission checklist: `docs/submission-checklist.md`
- Demo video: to be recorded and added before DoraHacks submission
- Pitch deck: to be added to the DoraHacks submission if its form requires one
