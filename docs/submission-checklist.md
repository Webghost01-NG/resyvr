# Judge and submission checklist

## Ready-to-paste fields

| Field | Value |
| --- | --- |
| Project name | Resyvr |
| Tagline | Proof keeps the reserve. |
| Track | RWA |
| One-line description | Multi-issuer infrastructure for proof-bounded RWA issuance and redemption on Creditcoin using Attestcoin and native CTC activation stakes. |
| Repository | https://github.com/Webghost01-NG/resyvr |
| License | MIT |
| Submission copy | `docs/submission.md` |
| Demo narration | `docs/demo-script.md` |
| Local product URL | `http://127.0.0.1:8000/dashboard/` after `npm run dashboard` |
| Public product URL | https://webghost01-ng.github.io/resyvr/dashboard/ |
| Judge Evidence URL | https://webghost01-ng.github.io/resyvr/dashboard/judge-evidence.html |

## Evidence gate

- [x] Public repository contains the implementation and MIT license.
- [x] Real Sepolia reserve deposit and payout transactions are linked.
- [x] Real Creditcoin mint and redemption-finalization transactions are linked.
- [x] Factory, issuer controller, token, and bond vault addresses are linked.
- [x] All deployed contracts are source-verified.
- [x] The complete V2 round trip ends at zero supply, zero pending redemption,
      and zero net proof-accounted reserve.
- [x] Native CTC activation stake is funded and remains liability-aware.
- [x] Replay, wrong-emitter, and wrong-beneficiary failures are demonstrated.
- [x] Official Attestcoin examples and nearby hackathon projects are acknowledged.
- [x] Redemption, reserve-token trust, bond scope, attestation latency, testnet
      status, and audit status are explicit.
- [x] Current hero and multi-issuer screenshots are committed.
- [x] Three-minute narration covers V2 issuance, redemption, both proofs, final
      accounting, live evidence, and limitations.
- [x] Judge Evidence page lists all V2 contracts and eleven transaction hashes.
- [x] `npm run evidence:v2:pilot` reproduces 93 live V2 checks.
- [x] Public Pages root and dashboard return HTTP 200 over HTTPS.
- [x] Logged-out mobile check loads fresh CC3 state with no horizontal overflow.

## Final recording gate

- [ ] Record the three-minute script at 1080p.
- [ ] Confirm transaction text remains readable after video compression.
- [ ] Upload the video and add its public URL to the DoraHacks BUIDL.
- [ ] Use the final redesigned dashboard selected for the submission.
- [ ] Watch the uploaded video once without authentication or browser cache.

## Final DoraHacks gate

- [ ] Paste `docs/submission.md` without changing evidence values.
- [ ] Select the RWA track.
- [ ] Add the public GitHub repository.
- [ ] Add https://webghost01-ng.github.io/resyvr/dashboard/ as the public dashboard URL.
- [ ] Add the Judge Evidence URL to the project description or evidence field.
- [ ] Add the public demo video URL.
- [ ] Confirm every submitted link opens in a logged-out browser.
- [ ] Submit before the displayed DoraHacks deadline.

The repository cannot complete the video upload or DoraHacks account submission
on behalf of the account owner. Everything required to record and paste those
two external deliverables is contained in this package.
