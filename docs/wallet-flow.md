# Browser issuer flow

The dashboard launchpad implements the supported issuance sequence without
requiring terminal access or custody of a private key.

1. **Create issuer on Creditcoin CC3.** The wallet submits the immutable source
   chain, reserve vault, reserve asset, issuer ID, token metadata, and optional
   smart-account executor to the deployed factory. The controller, token, and
   bond-vault addresses are read from the successful `IssuerCreated` event.
2. **Post and activate the native CTC bond.** Bond deposit and activation are
   separate CC3 transactions. The preview explains that activation prevents
   withdrawals while proof-backed issuance remains active.
3. **Lock reserve on Sepolia.** Approval is limited to the entered test-USDC
   amount. A second transaction locks that amount under a random deposit ID for
   the connected account as beneficiary. For the fixed pilot, the launchpad can
   instead select the already-recorded 5 test-USDC deposit; it still revalidates
   that receipt and event before generating proof calldata.
4. **Wait for Attestcoin.** No wallet signature is requested. The page verifies
   the successful Sepolia receipt, transaction target, sender, vault event,
   issuer ID, deposit ID, beneficiary, depositor, and amount. It then displays
   the latest attested height until the proof builder can serve the deposit.
5. **Verify and mint on CC3.** The browser ABI-encodes the returned proof and
   requests one CC3 transaction. Minting is reported only after a successful
   receipt from the issuer controller.

Every transaction request shows its network and effect before MetaMask opens.
User rejection, a reverted receipt, timeout, proof mismatch, and RPC failure are
shown as errors and never stored as successful progress. Transaction hashes link
to the appropriate explorer.

The ABI encoder is dependency-free in the browser. `npm run dashboard:check`
compares its factory, ERC-20, vault, and nested proof calldata byte-for-byte
against ethers v6 encodings.
