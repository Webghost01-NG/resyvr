# Browser issuer flow

Open the dashboard's **Issue your own proof-backed token** section. The
launchpad guides a new issuer through its own reserve vault and token system.
The public proof dashboard continues to show the recorded pilot's evidence.

## Before the six steps

Connect MetaMask and enter a token name and symbol. Connecting requests account
access only; it does not request a transaction or message signature. The wallet
needs Sepolia ETH for deployment and deposit gas, the configured Circle test
USDC for reserves, and Creditcoin CC3 testnet CTC for gas and the activation
bond. The token uses the reserve asset's six decimals.

The launchpad generates a new issuer ID for the source vault. The vault's
issuer ID and reserve asset are immutable. The factory later fixes the token
metadata and source configuration in the new issuer system, so review the name,
symbol, wallet account, and network before confirming deployment.

## Six steps

1. **Deploy reserve vault — Sepolia.** Select **Deploy reserve vault**. The
   wallet deploys `SourceReserveVault` with the configured USDC contract and
   your issuer ID. Continue after a successful deployment receipt supplies the
   vault address. This creates a dedicated reserve boundary for your issuer.
   The MVP vault has no withdrawal or administrative asset-change function.
2. **Create token system — Creditcoin CC3.** Select **Create token system**.
   The wallet calls the shared `IssuerFactory` with your token metadata, issuer
   ID, and source-vault configuration. This transaction creates an isolated
   controller, ERC-20 token, and native CTC bond vault. The factory caller
   becomes the issuer administrator. The successful `IssuerCreated` event and
   contract reads identify the new addresses. Creation alone does not mint
   tokens or activate issuance. The launchpad then shows the token contract
   address with a Creditcoin explorer link and copy button. Holders import that
   address in MetaMask on Creditcoin CC3 Testnet using six decimals.
3. **Post and activate bond — Creditcoin CC3.** Select **Deposit CTC** to fund
   your bond vault, then **Activate issuance** in a separate transaction. The
   on-chain minimum determines the required bond. Only the issuer administrator
   can fund and activate it. Activation prevents bond withdrawal while issuance
   remains active; deactivation blocks new minting. CTC is shown in native
   units, without a dollar-insurance claim.
4. **Deposit reserve — Sepolia.** Enter the test-USDC amount. Approve that
   amount for your vault, then confirm a separate **Deposit reserve**
   transaction. Approval alone moves no reserve and creates no mintable
   deposit. The deposit uses a fresh deposit ID and the connected wallet as
   beneficiary. The successful vault event records issuer, depositor,
   beneficiary, amount, and deposit identity. A direct token transfer to the
   vault does not create this recognized deposit event.
5. **Generate proof — no wallet signature.** Select **Generate proof**. The
   page checks the successful source receipt, transaction target and sender,
   and expected vault event fields. It waits for Attestcoin to cover the deposit
   block, then retrieves the proof and checks its transaction hash, block, and
   source chain before encoding the submission. Attestation waiting and a
   proof-service error do not mean the reserve deposit failed. Retry proof
   generation for the existing deposit when the prerequisite becomes available.
6. **Submit proof and mint — Creditcoin CC3.** Select **Mint proof-backed
   tokens**. The wallet sends the proof to your issuer controller. The
   controller verifies it through Creditcoin's native verifier, checks the
   deposit semantics and replay identities, and requires active, unpaused
   issuance. Acceptance records the reserve and mints exactly the proven amount
   to the beneficiary in one transaction. Wait for a successful receipt and
   inspect its explorer link; a generated proof or wallet submission alone is
   not a confirmed mint.

The fresh-issuer sequence normally requires seven transactions: vault
deployment, issuer creation, bond deposit, activation, USDC approval, reserve
deposit, and proof submission. Wallet connection and proof generation add no
transactions; network changes may prompt separately.

## Progress and recovery

Each transaction request displays its network and effect before MetaMask opens.
Hashes link to the corresponding Sepolia or Creditcoin explorer. A rejected
wallet request, reverted receipt, timeout, proof mismatch, or RPC failure is
shown explicitly and is never a successful completion.

Before opening MetaMask, the launchpad estimates gas through the configured
public RPC, adds execution headroom, and caps the result below the network's
safe transaction limit. This prevents wallet fallbacks such as a 21-million-gas
Sepolia transaction from exceeding the RPC limit.

If a transaction has a hash but confirmation times out, inspect that hash before
submitting another transaction. A timeout can leave the on-chain result unknown.
Keep using the issuer's administrator wallet for bond actions and confirm the
account and network shown in the next request.

After one wallet has created at least two issuers through the factory, **Your
issued assets** appears below the launch steps. It is rebuilt from indexed
`IssuerCreated` logs and live token metadata; wallets with zero or one issuer do
not see an empty portfolio section.

The pilot's recorded 5-USDC deposit belongs to its fixed issuer and source
vault. It cannot back a newly created token system, and its consumed proof
cannot mint again through the same controller. A new issuer must complete its
own deposit and proof path. Public pilot balances do not establish the new
issuer's reserve or supply.

This flow uses test assets. Reserve redemption and vault withdrawals are not
implemented in the MVP.

## Developer verification

The ABI encoder is dependency-free in the browser. `npm run dashboard:check`
checks JavaScript syntax, dashboard bindings, and ABI encoding against ethers
v6. `npm run deployment:prepare` rebuilds the source-vault and factory
deployment artifacts from the Solidity contracts. These checks do not replace
an actual wallet transaction or establish a new live issuance result.
