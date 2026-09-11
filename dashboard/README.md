# Resyvr public dashboard

Run `npm run dashboard` from the repository root and open
`http://127.0.0.1:8000/dashboard/`.

The dashboard reads network endpoints and the completed V2 pilot evidence from
versioned configuration. It verifies the V2 controller's net proof-accounted
reserve, token supply, activation stake, redemption state, and immutable source
configuration over public CC3 JSON-RPC. The separate Judge Evidence page also
checks all six contracts, eleven receipts, and the completed round-trip state.

The page discovers the active issuer token and native CTC bond vault from the
controller rather than trusting copied display values. A failed or stale RPC
read remains visible as a status rather than silently falling back to a live
claim.

The issuer launchpad uses the verified V2 factories in `config/networks.json`.
Connect a wallet, choose a token name and symbol, create its canonical Sepolia
vault, create the Creditcoin token system, fund and activate its CTC stake,
deposit test USDC, generate a proof, and submit it to mint. The same page then
guides redemption escrow, reserve payout, payout-proof generation, and final
burn. The launchpad discovers V1 and V2 factory issuers by administrator topic;
the portfolio stays hidden until at least two matching on-chain issuers exist.
Each portfolio card can reopen its issuer workflow and exposes the token address
holders import on Creditcoin CC3. The reserve form can mint to the connected
wallet or a separately entered recipient address after proof verification.
Selecting a card also changes the public metrics and immutable configuration to
that issuer's live controller. Reserve actions validate live wallet balance and
vault allowance before requesting a signature. Token links use the explorer's
contract-address route so an unminted token does not lead to an unindexed page.
Proof generation reports Attestcoin's current and required heights, block gap,
and elapsed time. Proof-service failures preserve the existing deposit for a
safe retry without another wallet signature.
Every new asset uses V2. Selecting any creator-owned V2 asset restores its
repeatable mint and redemption controls. Existing V1 assets remain explicitly
issuance-only. Submitted hashes are saved before receipt polling, and confirmed
state is recovered from chain logs after refresh.

`v2-pilot.html` remains the focused deployment runner used to produce the live
round-trip evidence. It uses the verified
factory addresses in `config/networks.json`, creates a unique issuer ID for the
connected administrator, and guides the wallet across Sepolia and Creditcoin.
It validates the canonical deposit and payout events before building their
Attestcoin proof calldata, then verifies zero token supply, zero pending
redemption, zero net verified reserve, and restored source USDC after the final
burn. The same generic lifecycle is now embedded in the main dashboard for all
new V2 assets.

The interface uses a code-native proof orbit to show the pilot's actual
Sepolia → Attestcoin → Creditcoin route. Section reveals and pointer depth are
implemented in `motion.js`; both automatically stop when the visitor enables
reduced motion. No animation library or image asset is required.
