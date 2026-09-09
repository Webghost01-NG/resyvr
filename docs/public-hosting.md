# Public dashboard hosting

Resyvr is a static site and needs no server-side secret, build command, or RPC
proxy. The repository root includes `index.html`, which sends the public root to
`dashboard/`. Dashboard JSON-RPC and Attestcoin reads use the public endpoints
already pinned in `config/networks.json`.

## GitHub Pages

After the repository owner enables Pages, use these settings:

- **Source:** Deploy from a branch
- **Branch:** `main`
- **Folder:** `/ (root)`

The expected project URL is
`https://webghost01-ng.github.io/resyvr/`. Treat that address as pending until
GitHub reports a successful deployment and it opens in a logged-out browser.

After activation, check both routes:

1. Open the project root and confirm it redirects to `/resyvr/dashboard/`.
2. Open the dashboard directly and confirm the hero reports a fresh CC3 live
   read rather than `Live read failed`.
3. Connect MetaMask and confirm the portfolio, contract-address links, and
   selected-issuer metrics load.
4. Test at a narrow mobile width and confirm the fixed navigation does not
   cover the focused launch control.

No `.env` file, wallet key, API token, or deployment credential belongs in the
Pages source. Wallet transactions remain user-confirmed in MetaMask.
