# Resyvr public dashboard

Run `npm run dashboard` from the repository root and open
`http://127.0.0.1:8000/dashboard/`.

The dashboard reads network endpoints from `config/networks.json`, pilot
transaction identities from `config/pilot.json`, and tracked contract evidence
from `docs/deployments/creditcoin.json`. It then verifies the controller's
current reserve and immutable source configuration over public CC3 JSON-RPC.

When the deployment evidence names an `IssuerController`, the same page also
discovers and reads its token supply and native CTC bond vault. Until then those
fields are labeled pending and coverage is unavailable. A failed or stale RPC
read remains visible as a status rather than silently falling back to a live
claim.
