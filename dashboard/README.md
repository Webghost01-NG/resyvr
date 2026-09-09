# Resyvr public dashboard

Run `npm run dashboard` from the repository root and open
`http://127.0.0.1:8000/dashboard/`.

The dashboard reads network endpoints from `config/networks.json`, pilot
transaction identities from `config/pilot.json`, base proof evidence from
`docs/deployments/creditcoin.json`, and the active issuer deployment from
`config/issuance.json`. It then verifies the issuer controller's current
reserve, token supply, CTC bond, and immutable source configuration over public
CC3 JSON-RPC.

The page discovers the active issuer token and native CTC bond vault from the
controller rather than trusting copied display values. A failed or stale RPC
read remains visible as a status rather than silently falling back to a live
claim.

The issuer launchpad uses the shared factory address from `config/issuance.json`
to create a new issuer. Connect a wallet, choose a token name and symbol, then
deploy a dedicated Sepolia vault, create the Creditcoin token system, fund and
activate its CTC bond, deposit test USDC, generate a proof, and submit it to mint.
Source-vault creation bytecode comes from `config/source-vault-deployment.json`.
The public pilot metrics do not represent a newly created issuer's balances.
See [`../docs/wallet-flow.md`](../docs/wallet-flow.md) for the six steps,
transaction confirmations, and failure states.

The interface uses a code-native proof orbit to show the pilot's actual
Sepolia → Attestcoin → Creditcoin route. Section reveals and pointer depth are
implemented in `motion.js`; both automatically stop when the visitor enables
reduced motion. No animation library or image asset is required.
