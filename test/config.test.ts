import assert from 'node:assert/strict';
import test from 'node:test';

import { loadConfig } from '../src/config';

test('loads pinned public network defaults without a wallet', () => {
  const config = loadConfig({});

  assert.equal(config.source.chainId, 11155111n);
  assert.equal(config.source.chainKey, 1);
  assert.equal(config.source.reserveAsset.symbol, 'USDC');
  assert.equal(config.source.reserveAsset.decimals, 6);
  assert.equal(config.destination.chainId, 102031n);
  assert.equal(config.destination.verifierPrecompile.toLowerCase().endsWith('0fd2'), true);
  assert.equal(config.walletAddress, undefined);
});

test('accepts a public wallet address and strips trailing URL slashes', () => {
  const config = loadConfig({
    RESYVR_WALLET_ADDRESS: '0x6CeD8D6Bad8Dfd2e60BCEA116fE74548f959f1F2',
    PROOF_BUILDER_URL: 'https://example.com/',
  });

  assert.equal(config.walletAddress, '0x6CeD8D6Bad8Dfd2e60BCEA116fE74548f959f1F2');
  assert.equal(config.destination.proofBuilderUrl, 'https://example.com');
});

test('rejects malformed wallet addresses and non-HTTPS endpoints', () => {
  assert.throws(() => loadConfig({ RESYVR_WALLET_ADDRESS: '0x1234' }), /20-byte EVM address/);
  assert.throws(() => loadConfig({ SOURCE_CHAIN_RPC_URL: 'http://localhost:8545' }), /must use HTTPS/);
});
