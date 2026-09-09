# Resyvr two-minute demo

This script demonstrates the completed transactions. It does not depend on a
fresh wallet signature or another Attestcoin wait during judging.

## Before recording

Run the verification and start the dashboard:

```bash
npm ci
npm run check
npm run dashboard
```

Open these tabs in order:

1. `http://127.0.0.1:8000/dashboard/`
2. [Sepolia deposit](https://eth-sepolia.blockscout.com/tx/0xbc7b11952b799049cab6159f43c80f4c52242e678891a693f337060e0db3545b)
3. [Creditcoin proof and mint](https://creditcoin-testnet.blockscout.com/tx/0xe5c1d4c22e4ea74ff241f6192aea2c786c55f9faac6f2678bc79c6e28c814ddb)
4. [Verified issuer controller](https://creditcoin-testnet.blockscout.com/address/0x81a5E9379eaa4a2dAed7108120e8059d6CeF2948)
5. A terminal in the repository root.

Keep the browser at 100% zoom and hide bookmarks, notifications, private tabs,
and wallet balances. Refresh the dashboard immediately before recording so its
live-read timestamp is current.

## Recording script

| Time | Screen | Narration |
| --- | --- | --- |
| 0:00–0:12 | Dashboard hero and coverage | “Resyvr is issuance infrastructure for reserve-backed assets on Creditcoin. This is live testnet state: 5 test USDC proven, exactly 5 rvUSD issued, 100% proof coverage, and an active 1 CTC issuer bond.” |
| 0:12–0:27 | Issuer launch sequence | “An organization creates an isolated token and controller, posts its CTC bond, and locks its reserve asset on the source chain. The same factory can create separate issuers with separate reserve boundaries.” |
| 0:27–0:43 | Sepolia deposit explorer | “Here is the real Sepolia transaction. Five test USDC entered the configured vault. Its event fixes the issuer ID, unique deposit ID, depositor, beneficiary, and amount.” |
| 0:43–1:02 | Creditcoin proof transaction | “Attestcoin proves that source transaction to Creditcoin. Resyvr accepts inclusion only after matching every event and transaction field. This successful CC3 transaction consumes the proof and deposit identities, records five units of reserve, and mints five rvUSD.” |
| 1:02–1:18 | Controller and token links, then dashboard refresh | “The issuer controller, token, bond vault, source vault, and factory are source-verified. The dashboard reads their current state through public RPC instead of trusting a private database.” |
| 1:18–1:36 | Terminal: targeted negative tests | “A valid proof cannot be replayed. A copied event from the wrong contract and a beneficiary mismatch also fail closed. These three boundaries are covered directly in the contract tests.” |
| 1:36–1:52 | Dashboard proof trail and configuration | “Creditcoin supplies the cross-chain proof primitive, the destination state, gas, and the native issuer bond. Resyvr packages those primitives into infrastructure other asset teams can reuse.” |
| 1:52–2:00 | Dashboard coverage | “The current MVP proves issuance. Redemption, objective bond slashing, and production reserve assets remain explicit future work. Resyvr: proof keeps the reserve.” |

For the negative-path scene, run:

```bash
forge test --root contracts \
  --match-test 'testRejects(SpoofedDepositEmitter|EventThatDoesNotMatchCalldata|QueryReplay)' \
  -vv
```

The expected result is three passing tests. Do not label those deterministic
cases as additional live transactions. The live replay rejection is recorded
separately in `docs/deployments/creditcoin.json`.

## Optional 30-second cut

“Resyvr lets organizations issue reserve-backed assets on Creditcoin. An issuer
creates an isolated token, posts a CTC bond, and locks a reserve asset on
Ethereum. Attestcoin proves the exact deposit; Resyvr validates the vault,
issuer, beneficiary, amount, receipt status, and replay identity before minting
exactly that amount. This live pilot proves 5 test USDC and 5 rvUSD with a
publicly inspectable 1 CTC bond. Developers get a reusable issuer factory,
proof-safe accounting, and a public verification dashboard.”
