# Competitive Landscape

Research snapshot: 9 September 2026.

## Finding

No public Creditcoin product was found with Resyvr's complete proposed scope:
multi-issuer creation, isolated external reserves, proof-bounded minting,
redemption reconciliation, CTC activation stakes, and a public proof-accounting dashboard.

The underlying pieces already exist. Resyvr must win on the issuer system and
end-to-end product rather than claim novelty for cross-chain proof verification
or token minting.

## Existing Creditcoin work

### Official Attestcoin bridge example

Creditcoin publishes contracts and a worker that demonstrate source-chain token
burning and proof-authorized minting on Creditcoin. This establishes the base
pattern Resyvr builds upon.

- https://github.com/gluwa/attestcoin-protocol-examples/tree/main/bridge

### Manatee

Manatee locks an allowlisted token on Sepolia and mints its mapped token on
Creditcoin after Attestcoin verification. Its product is social cross-chain
sending. It does not describe a multi-issuer reserve factory or issuer solvency
control plane.

- https://github.com/ducnmm/manatee

### Bliker

Bliker proves Ethereum USDC deposits into a confidential Creditcoin pool and
mints transferable pcUSDC after shielded withdrawal. Its differentiation is
privacy, selective disclosure, and confidential credit positions. It is the
closest functional overlap with Resyvr's deposit-to-mint path.

- https://github.com/abaresks24/creditcoin-shielded-pool

### Corolary

Corolary's GitHub repository description currently mentions reserve-proven
dollar issuance, but its README and implementation describe cross-chain credit
history, scoring, and collateral-efficient lending. The description appears
stale, so it is not treated as a confirmed stablecoin-issuance competitor.

- https://github.com/Nabil-Aufa/Corolary

## Broader market

Circle xReserve offers USDC-backed stablecoin infrastructure for partner
blockchains. Resyvr is not claiming that multi-chain reserve-backed issuance is
globally new. The hackathon contribution is an open, Creditcoin-native,
multi-issuer control plane using Attestcoin proofs and CTC bonds.

- https://www.circle.com/xreserve

## Official ecosystem check

Creditcoin's public ecosystem directory lists wallets, bridges, a DEX, staking,
games, and other applications, but no no-code multi-issuer reserve platform was
identified in the directory at this snapshot.

- https://creditcoin.org/Apps
- https://creditcoin.org/Launch

## Claim discipline

The project may say: "We found no public Creditcoin product with this complete
scope as of 9 September 2026."

The project must not say: "Nothing like this exists," "first ever," or
"trustless stablecoin" without further evidence.
