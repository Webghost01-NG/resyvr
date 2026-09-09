# Judge and submission checklist

## Ready-to-paste fields

| Field | Value |
| --- | --- |
| Project name | Resyvr |
| Tagline | Proof keeps the reserve. |
| Track | RWA |
| One-line description | Multi-issuer infrastructure for launching proof-backed assets on Creditcoin with Attestcoin verification and native CTC bonds. |
| Repository | https://github.com/Webghost01-NG/resyvr |
| License | MIT |
| Submission copy | `docs/submission.md` |
| Demo narration | `docs/demo-script.md` |
| Local product URL | `http://127.0.0.1:8000/dashboard/` after `npm run dashboard` |
| Public product URL | Pending GitHub Pages activation; see `docs/public-hosting.md` |

## Evidence gate

- [x] Public repository contains the implementation and MIT license.
- [x] Real Sepolia source transaction is linked.
- [x] Real Creditcoin proof and mint transaction is linked.
- [x] Factory, issuer controller, token, and bond vault addresses are linked.
- [x] All deployed contracts are source-verified.
- [x] Verified reserve equals rvUSD supply and beneficiary balance.
- [x] Native CTC bond is funded and active.
- [x] Replay, wrong-emitter, and wrong-beneficiary failures are demonstrated.
- [x] Official Attestcoin examples and nearby hackathon projects are acknowledged.
- [x] Redemption, reserve-token trust, bond scope, attestation latency, testnet
      status, and audit status are explicit.
- [x] Current hero and multi-issuer screenshots are committed.
- [x] Three-minute narration covers self-service issuance, repeat minting, proof
      progress, live evidence, and limitations.

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
- [ ] Add the verified public dashboard URL after Pages activation.
- [ ] Add the public demo video URL.
- [ ] Confirm every submitted link opens in a logged-out browser.
- [ ] Submit before the displayed DoraHacks deadline.

The repository cannot complete the video upload or DoraHacks account submission
on behalf of the account owner. Everything required to record and paste those
two external deliverables is contained in this package.
