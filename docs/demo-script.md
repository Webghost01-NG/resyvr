# Resyvr ruthless three-minute demo

The goal is to show one undeniable fact: the full V2 reserve round trip is live
and publicly reproducible. Do not send a wallet transaction while recording.

## Before recording

Run:

```bash
npm ci
npm run evidence:v2:pilot
npm run dashboard
```

Open these tabs:

1. `http://127.0.0.1:8000/dashboard/`
2. `http://127.0.0.1:8000/dashboard/judge-evidence.html`
3. [Sepolia reserve deposit](https://eth-sepolia.blockscout.com/tx/0x52a6c854c0f75569438f5639c469cd89d99178522767b38e0dc1568e828e00c7)
4. [Creditcoin mint](https://creditcoin-testnet.blockscout.com/tx/0x7d1df433188d47633c2b10c67bd97e9b4275652a66ddb2432112ae09e39c226b)
5. [Sepolia reserve payout](https://eth-sepolia.blockscout.com/tx/0x0b9f8a0a60b6aaf394cf8f1892a65d540aad3c5eada901d78b160fc7a04645e4)
6. [Creditcoin final burn](https://creditcoin-testnet.blockscout.com/tx/0xe0065570adb21e6316c6d708049efebf5b5bea5427e826b8ea448964421d60b0)

Keep hashes readable, use 100% zoom, hide unrelated tabs and notifications,
and refresh the Judge Evidence page immediately before recording.

## Script

| Time | Screen | Narration |
| --- | --- | --- |
| 0:00–0:15 | V2 hero | “Resyvr is proof-bounded RWA infrastructure on Creditcoin. It creates branded assets whose reserve deposit, mint, redemption payout, and burn are all cryptographically linked.” |
| 0:15–0:33 | Product proof trail | “Every new issuer uses a canonical Sepolia vault. Attestcoin proves the exact source event, and the Creditcoin controller checks the successful receipt, vault, asset, issuer, recipient, amount, and replay identity.” |
| 0:33–0:50 | Issuer launchpad | “One wallet creates an isolated token system and posts a CTC activation stake. Each new reserve proof mints more of the same coin. The stake gates issuance and stays locked while liabilities exist; it is not insurance.” |
| 0:50–1:08 | Embedded redemption controls | “A holder escrows tokens on Creditcoin. The issuer pays the request’s exact recipient from the canonical Sepolia vault. A second proof finalizes the request and burns the matching supply.” |
| 1:08–1:25 | Judge Evidence summary | “This live pilot locked 0.1 test USDC, minted 0.1 rvUSD2, paid the full reserve recipient, then burned the entire supply. The final supply, pending redemption, and net reserve are all zero.” |
| 1:25–1:42 | Deposit transaction | “Here is the real Sepolia reserve deposit. Its unique deposit ID and beneficiary bind what Creditcoin is allowed to mint.” |
| 1:42–1:57 | Mint transaction | “Here is the accepted Creditcoin deposit proof and exact mint. Query and deposit replay keys are consumed on-chain.” |
| 1:57–2:12 | Payout transaction | “Here is the canonical Sepolia payout to the named redemption recipient. Its redemption ID ties it to the escrowed request.” |
| 2:12–2:28 | Finalization transaction | “Here is the accepted payout proof. Creditcoin completes redemption and atomically burns the escrowed rvUSD2.” |
| 2:28–2:43 | Live checker result | “The page verifies contracts, all eleven receipts, and final accounting from public RPCs. The repository reproduces ninety-three live V2 checks and fifty-five Foundry tests.” |
| 2:43–3:00 | Trust boundaries and hero | “This is unaudited testnet infrastructure. Attestation has delay, the issuer still owes payout liveness, and the CTC stake is not insurance. Resyvr makes the enforceable cryptographic lifecycle public: proof keeps the reserve.” |

## Claims to keep exact

- Say **proof-accounting coverage**, not real-time solvency.
- Say **CTC activation stake**, not insurance or collateral protection.
- Say **Circle test USDC**, not production USDC.
- Say **V2 is live; V1 is the historical issuance pilot**.
- Do not claim Attestcoin proves legal title, custody quality, or issuer honesty.
