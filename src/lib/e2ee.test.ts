import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import {
  bytesToHex,
  decryptChunk,
  deriveSigningAddressFromKey,
  encryptMessage,
  generateEphemeralKeyPair,
  recoverSignerAddress,
} from './e2ee.js';

describe('E2EE secp256k1 operations', () => {
  it('round-trips an encrypted message with an uncompressed recipient key', () => {
    const recipient = generateEphemeralKeyPair();
    const ciphertext = encryptMessage('private message', recipient.publicKeyHex);

    assert.strictEqual(decryptChunk(ciphertext, recipient.privateKey), 'private message');
  });

  it('derives the expected Ethereum address for private key one', () => {
    const privateKey = new Uint8Array(32);
    privateKey[31] = 1;
    const publicKey = secp256k1.getPublicKey(privateKey, false);

    assert.strictEqual(
      deriveSigningAddressFromKey(bytesToHex(publicKey)),
      '7e5f4552091a69125d5dfcb7b8c2659029395bdf'
    );
  });

  it('recovers an Ethereum address from an EIP-191 signature', () => {
    const privateKey = new Uint8Array(32);
    privateKey[31] = 1;
    const message = 'Venice E2EE verification';
    const messageBytes = new TextEncoder().encode(message);
    const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${messageBytes.length}`);
    const prefixed = new Uint8Array(prefix.length + messageBytes.length);
    prefixed.set(prefix, 0);
    prefixed.set(messageBytes, prefix.length);
    const signature = secp256k1.sign(keccak_256(prefixed), privateKey);
    assert.notStrictEqual(signature.recovery, undefined);
    const serialized = new Uint8Array(65);
    serialized.set(signature.toCompactRawBytes(), 0);
    serialized[64] = 27 + signature.recovery!;

    assert.strictEqual(
      recoverSignerAddress(message, bytesToHex(serialized)),
      '7e5f4552091a69125d5dfcb7b8c2659029395bdf'
    );
  });
});
