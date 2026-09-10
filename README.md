# Resyvr

> Proof keeps the reserve.

Resyvr is a multi-issuer asset issuance rail for Creditcoin. An issuer locks an
approved reserve asset in a source-chain vault, proves that deposit through the
Attestcoin Protocol, and mints a branded reserve token on Creditcoin. Each
issuer has an isolated reserve position, token, roles, and CTC activation stake.

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
- CTC-denominated issuer activation stakes;
- V2 proof-finalized redemption with liability-aware bond release;
- V2 canonical vault provenance instead of arbitrary source contracts;
- public reserve coverage, proof provenance, roles, and failure states.

## Four-day MVP

One issuer creates one branded token, deposits test USDC into a Sepolia reserve
vault, and submits a genuine Attestcoin proof to mint the matching amount on
Creditcoin CC3 Testnet. The dashboard shows the source transaction, verified
reserve, supply, coverage, CTC bond, and rejected replay/mismatch cases.

The live V1 pilot demonstrates proof-bounded issuance. The separate V2
prototype adds redemption and canonical source-vault provenance. The system
does not claim that CTC is dollar-stable or that a historical deposit proof
alone proves current solvency.

## Documents

- [Architecture](docs/architecture.md)
- [Competitive landscape](docs/competitive-landscape.md)
- [MVP and delivery gates](docs/mvp.md)
- [Attestcoin protocol preflight](docs/protocol-preflight.md)
- [Security invariant evidence](docs/security-invariants.md)
- [Deployment and failure evidence](docs/deployment-evidence.md)
- [Browser wallet flow](docs/wallet-flow.md)
- [Judge-ready RWA submission](docs/submission.md)
- [Three-minute demo script](docs/demo-script.md)
- [Submission checklist](docs/submission-checklist.md)
- [Public hosting guide](docs/public-hosting.md)

## Screenshots

![Live proof dashboard](docs/screenshots/live-proof-dashboard.png)

![On-chain issuer portfolio](docs/screenshots/issuer-portfolio.png)

## Public proof dashboard

**Live demo:** https://webghost01-ng.github.io/resyvr/

**Guided V2 issuance + redemption:**
https://webghost01-ng.github.io/resyvr/dashboard/v2-pilot.html

Serve the repository root and open the dashboard:

```bash
npm run dashboard
```

<http://127.0.0.1:8000/dashboard/>

The page uses read-only JSON-RPC calls to compare the live issuer controller,
rvUSD supply, and CTC bond with the tracked Sepolia and CC3 deployment evidence.
It shows stale, waiting, unavailable, and error states explicitly.

## Launch your token

Connect MetaMask and enter your token name and symbol in **Issue your own
proof-backed token**. Connecting requests account access; it does not send a
transaction. Use a wallet funded with Sepolia ETH for source-chain gas, test
USDC for the reserve, and testnet CTC for destination gas and the issuer bond.

The V1 launchpad then guides six steps:

1. **Deploy reserve vault — Sepolia.** Create a new `SourceReserveVault` bound
   to your issuer ID and the configured test USDC asset.
2. **Create token system — Creditcoin CC3.** Call the shared factory to create
   your isolated controller, branded ERC-20 token, and CTC bond vault.
3. **Post and activate bond — Creditcoin CC3.** Deposit the required native
   CTC, then confirm a separate activation transaction.
4. **Deposit reserve — Sepolia.** Approve the entered USDC amount, choose the
   Creditcoin recipient, then lock the reserve in your vault. Leave the
   recipient empty to mint to the connected wallet, or enter another valid
   `0x` wallet address to mint directly to that user after proof verification.
5. **Generate proof.** Wait for Attestcoin coverage and retrieve the deposit
   proof. This step requires no wallet signature.
6. **Submit proof and mint — Creditcoin CC3.** Submit the proof to your
   controller. A successful verification mints the exact proven amount to the
   deposit beneficiary.

Each transaction displays its network and effect before the wallet opens. A
new issuer uses its own vault and deposit; the public pilot's proof and rvUSD
metrics remain recorded evidence for that pilot. See the [wallet-flow guide](docs/wallet-flow.md)
for confirmation states and recovery guidance. The deployed V1 vault has no
withdrawal path; use test assets only.

The deployed [V2 redemption protocol](docs/redemption-v2.md) uses separate,
verified factories and leaves V1 balances untouched. Its guided pilot page
creates a canonical Sepolia vault, mints exactly `0.1 rvUSD2` from an attested
`0.1` test-USDC deposit, escrows the token for redemption, pays the exact
Sepolia recipient, submits the payout proof on Creditcoin, and verifies that
the escrowed supply was burned. The page automatically requests the correct
network, saves hashes before confirmation polling, and validates the source
transaction and event before either proof submission. It recognizes the
configured MetaMask transaction executor on Sepolia and restores a confirmed
reserve deposit from its canonical event after refresh or migration instead of
requesting a duplicate deposit.

Wallet transactions use a buffered public-RPC gas estimate so MetaMask does not
fall back to a gas limit above the network cap. When a connected administrator
has created at least two factory issuers, the launchpad shows an on-chain asset
portfolio with each token address, controller, network, decimals, and management
action. Reopening an asset restores its live bond state and latest unconsumed
reserve deposit so the administrator can finish the proof and mint sequence.
The reserve, total supply, proof-accounting coverage, CTC activation stake,
immutable configuration, and
connected-wallet token balance switch to the selected issuer's live contracts.
An issuer with a configured vault but no confirmed deposit is displayed as a
draft with **Vault configured**, never as reserve locked or source confirmed.
Importing a token contract into MetaMask only makes an existing balance visible;
tokens reach a holder through proof-backed minting to that deposit's recipient
or a later ERC-20 transfer on Creditcoin CC3.
Submitted transaction hashes are saved before receipt polling, so refreshing
the page recovers confirmed progress and prevents blind duplicate submissions.
Before requesting a reserve transaction, the launchpad reads the connected
wallet's current test-USDC balance and vault allowance. Amounts above the live
balance and unapproved deposits are blocked with a specific message.
While Attestcoin catches up, the proof step shows the attested height, required
Sepolia block, remaining block gap, and elapsed time. A timeout or proof-service
error keeps the confirmed deposit selected for a signature-free retry.

## Status

The Sepolia reserve vault and the complete Creditcoin issuer system are live on
testnet with verified source code. One genuine 5 test-USDC deposit proof minted
exactly 5 rvUSD through the bonded issuer controller. The source vault currently
holds 6 test USDC because a second 1-USDC deposit was made after the recorded
5-USDC pilot proof; that additional deposit has not been used to mint.
