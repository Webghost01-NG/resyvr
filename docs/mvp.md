# Four-Day MVP and Delivery Gates

## Target demonstration

An issuer uses Resyvr to create a branded reserve token on Creditcoin, posts a
native CTC bond, deposits test USDC into the configured Sepolia vault, and mints
only after a genuine Attestcoin proof verifies the exact deposit. A public page
shows reserve coverage and proof provenance. A replayed or mismatched proof is
rejected visibly.

## Phase 1 — proof feasibility

Deliverables:

- pin official Attestcoin contract and SDK versions;
- deploy or reuse a minimal Sepolia reserve vault;
- decode one real successful reserve-deposit receipt;
- verify it through the CC3 Block Prover;
- document proof latency, query cost, and exact semantic checks.

Exit gate: one genuine source deposit produces one verified state change on
Creditcoin. If this fails, contract and frontend expansion stop.

## Phase 2 — reserve-safe contract core

Depends on Phase 1.

Deliverables:

- issuer registry and factory;
- isolated issuer token;
- proof reserve controller;
- replay, emitter, status, beneficiary, amount, and decimal checks;
- native CTC bond deposit and activation gate;
- focused unit, fuzz, and invariant tests.

Exit gate: tests demonstrate that confirmed minted supply never exceeds the
confirmed reserve accounting and that malformed proofs fail closed.

## Phase 3 — product surface

Depends on Phase 2.

Deliverables:

- public coverage and proof page;
- issuer creation and bond flow;
- reserve deposit guidance;
- proof submission and mint status;
- explicit attestation-waiting and failure states;
- responsive wallet and wrong-network handling.

Exit gate: a new reviewer can follow the real flow without terminal access.

## Phase 4 — deployment and submission

Depends on Phase 3.

Deliverables:

- reproducible Sepolia and CC3 deployment records;
- explorer-linked source and destination transactions;
- one full successful flow and three negative-path demonstrations;
- architecture, trust model, setup, and limitations;
- concise demo video and RWA-track submission copy.

## Deferred unless ahead of schedule

- production reserve assets or mainnet funds;
- permissionless two-way redemption;
- multiple source chains or reserve assets;
- CTC/USD valuation or price-oracle integration;
- governance, yield, compliance claims, and fiat on/off ramps;
- audits and production-readiness claims.

