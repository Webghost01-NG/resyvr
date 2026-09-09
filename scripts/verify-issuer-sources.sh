#!/usr/bin/env bash
set -euo pipefail

RESYVR_FACTORY=$(jq -er '.factory' config/issuance.json)
RESYVR_CONTROLLER=$(jq -er '.issuerController' config/issuance.json)
RESYVR_TOKEN=$(jq -er '.token' config/issuance.json)
RESYVR_BOND=$(jq -er '.bondVault' config/issuance.json)
RESYVR_ADMIN=$(jq -er '.administrator' config/issuance.json)
RESYVR_MINIMUM=$(jq -er '.minimumBondWei' config/issuance.json)
RESYVR_NAME=$(jq -er '.tokenName' config/issuance.json)
RESYVR_SYMBOL=$(jq -er '.tokenSymbol' config/issuance.json)
RESYVR_ISSUER=$(jq -er '.issuerId' config/pilot.json)
RESYVR_VAULT=$(jq -er '.sourceVault' config/pilot.json)
RESYVR_EXECUTOR=$(jq -er '.sourceExecutor' config/pilot.json)
RESYVR_ASSET=$(jq -er '.source.reserveAsset.address' config/networks.json)
RESYVR_CHAIN_KEY=$(jq -er '.source.attestcoinChainKey' config/networks.json)
RESYVR_DECIMALS=$(jq -er '.source.reserveAsset.decimals' config/networks.json)
RESYVR_VERIFIER_URL=$(jq -er '.destination.explorerUrl + "/api/"' config/networks.json)
RESYVR_CHAIN_ID=$(jq -er '.destination.chainId' config/networks.json)

RESYVR_FACTORY_ARGS=$(cast abi-encode 'constructor(uint256)' "$RESYVR_MINIMUM")
RESYVR_CONTROLLER_ARGS=$(cast abi-encode \
  'constructor(uint64,address,address,address,bytes32,address,string,string,uint8,uint256)' \
  "$RESYVR_CHAIN_KEY" "$RESYVR_VAULT" "$RESYVR_EXECUTOR" "$RESYVR_ASSET" \
  "$RESYVR_ISSUER" "$RESYVR_ADMIN" "$RESYVR_NAME" "$RESYVR_SYMBOL" \
  "$RESYVR_DECIMALS" "$RESYVR_MINIMUM")
RESYVR_TOKEN_ARGS=$(cast abi-encode 'constructor(string,string,uint8)' \
  "$RESYVR_NAME" "$RESYVR_SYMBOL" "$RESYVR_DECIMALS")
RESYVR_BOND_ARGS=$(cast abi-encode 'constructor(address,uint256)' "$RESYVR_ADMIN" "$RESYVR_MINIMUM")

verify_contract() {
  local address=$1
  local contract=$2
  local constructor_args=$3
  forge verify-contract "$address" "$contract" \
    --root contracts \
    --chain-id "$RESYVR_CHAIN_ID" \
    --verifier blockscout \
    --verifier-url "$RESYVR_VERIFIER_URL" \
    --constructor-args "$constructor_args" \
    --watch
}

verify_contract "$RESYVR_FACTORY" 'src/IssuerFactory.sol:IssuerFactory' "$RESYVR_FACTORY_ARGS"
verify_contract "$RESYVR_CONTROLLER" 'src/IssuerController.sol:IssuerController' "$RESYVR_CONTROLLER_ARGS"
verify_contract "$RESYVR_TOKEN" 'src/IssuerToken.sol:IssuerToken' "$RESYVR_TOKEN_ARGS"
verify_contract "$RESYVR_BOND" 'src/CTCBondVault.sol:CTCBondVault' "$RESYVR_BOND_ARGS"
