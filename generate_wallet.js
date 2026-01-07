const CardanoWasm = require('@emurgo/cardano-serialization-lib-nodejs');
const bip39 = require('bip39');

// Generate a 24-word mnemonic
const mnemonic = bip39.generateMnemonic(256);
console.log('Mnemonic:', mnemonic);

// Derive root key from mnemonic
const entropy = bip39.mnemonicToEntropy(mnemonic);
const rootKey = CardanoWasm.Bip32PrivateKey.from_bip39_entropy(
  Buffer.from(entropy, 'hex'),
  Buffer.from('') // empty password
);
console.log('Root Key (hex):', Buffer.from(rootKey.as_bytes()).toString('hex')); 