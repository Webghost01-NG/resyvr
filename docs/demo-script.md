# Resyvr three-minute demo

This script combines the completed on-chain pilot with the reusable issuer
workflow. It does not require a new transaction during recording.

## Before recording

Run the verification and start the dashboard:

```bash
npm ci
npm run check
npm run dashboard
```

Open these tabs in order:

1. `http://127.0.0.1:8000/dashboard/?pilot=1`
2. [Sepolia deposit](https://eth-sepolia.blockscout.com/tx/0xbc7b11952b799049cab6159f43c80f4c52242e678891a693f337060e0db3545b)
3. [Creditcoin proof and mint](https://creditcoin-testnet.blockscout.com/tx/0xe5c1d4c22e4ea74ff241f6192aea2c786c55f9faac6f2678bc79c6e28c814ddb)
4. [rvUSD token](https://creditcoin-testnet.blockscout.com/token/0xbCb8eE1A76842d4Fea3Eca2dD65768efF4645Afa)
5. A terminal in the repository root.

Keep the browser at 100% zoom and hide bookmarks, notifications, unrelated
tabs, and private balances. Refresh immediately before recording so the live
read timestamp is current. Connect the issuer wallet before recording only if
you will show the on-chain issuer portfolio; connecting requests no signature.

## Recording script

| Time | Screen | Narration |
| --- | --- | --- |
| 0:00–0:15 | Dashboard hero | “Resyvr is reusable RWA issuance infrastructure on Creditcoin. An issuer creates a branded asset, locks its reserve on Ethereum, and only a matching Attestcoin proof can mint supply on CC3.” |
| 0:15–0:32 | Live coverage cards | “These are public contract reads from our live pilot: five test USDC verified, exactly five rvUSD issued, 100% on-chain coverage, and an active one CTC issuer bond.” |
| 0:32–0:53 | Six-step launchpad | “A new issuer deploys an isolated Sepolia vault, creates its CC3 token system, funds and activates its bond, deposits reserve, generates the proof, then mints. Every wallet request names its network and effect.” |
| 0:53–1:13 | Recipient field and issuer portfolio | “The reserve beneficiary can be the issuer or another wallet. One administrator can reopen every asset it created. To mint more of the same coin, it manages that issuer and proves another reserve deposit instead of deploying another token.” |
| 1:13–1:33 | Sepolia deposit explorer | “This real Sepolia event fixes the reserve vault, issuer ID, unique deposit ID, depositor, beneficiary, and five-USDC amount. Direct transfers and events from another contract are rejected.” |
| 1:33–1:51 | Proof step or progress panel | “The browser validates the source receipt and shows Attestcoin’s current height, required block, remaining gap, and elapsed wait. A proof-service timeout preserves the deposit for a signature-free retry.” |
| 1:51–2:13 | Creditcoin proof transaction | “On Creditcoin, the controller verifies inclusion and every deposit field, consumes both proof and deposit replay keys, records five units of reserve, and mints five rvUSD to the proven beneficiary.” |
| 2:13–2:32 | rvUSD token and controller | “The ERC-20 supply and holder balance are visible on Creditcoin. Unminted contracts still open through their Blockscout address page, while minted tokens receive a full indexed token page.” |
| 2:32–2:50 | Terminal negative tests | “The contracts reject query replay, a spoofed deposit emitter, and calldata that disagrees with the proven event. Our full suite also fuzzes exact mint accounting and runs stateful supply-equals-reserve invariants.” |
| 2:50–3:00 | Dashboard hero or coverage | “Creditcoin provides the verification and settlement layer; Resyvr turns it into infrastructure other asset teams can use. Redemption remains an explicit next protocol. Resyvr: proof keeps the reserve.” |

For the negative-path scene, run:

```bash
forge test --root contracts \
  --match-test 'testRejects(SpoofedDepositEmitter|EventThatDoesNotMatchCalldata|QueryReplay)' \
  -vv
```

The expected result is three passing tests. Describe these as deterministic
contract tests. The separate live replay rejection is recorded in
`docs/deployments/creditcoin.json`.

## Optional 30-second cut

“Resyvr lets organizations launch reserve-backed assets on Creditcoin. Each
issuer gets an isolated token, reserve vault, controller, and CTC bond.
Attestcoin proves the exact Ethereum deposit; Resyvr validates its vault,
issuer, beneficiary, amount, receipt, and replay identity before minting the
same amount on CC3. The live pilot proves five test USDC, five rvUSD, and a one
CTC bond. Developers get reusable issuance infrastructure with public evidence.”
