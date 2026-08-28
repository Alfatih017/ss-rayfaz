const crypto = require('crypto');
const nacl = require('tweetnacl');
const bs58 = require('bs58').default || require('bs58');
const bip39 = require('bip39');

function getKey() {
  const seed = process.env.WALLET_ENCRYPTION_KEY;
  if (!seed || seed.length < 32) throw new Error('WALLET_ENCRYPTION_KEY is required and must be at least 32 characters');
  return crypto.scryptSync(seed, 'ss-rayfaz-wallet-v1', 32);
}

function encryptSecret(secretBytes) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([cipher.update(secretBytes), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    enc: enc.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64')
  };
}

function decryptSecret(encB64, ivB64, tagB64) {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getKey(),
    Buffer.from(ivB64, 'base64')
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(encB64, 'base64')),
    decipher.final()
  ]);
  return dec;
}

function generateSolanaKeypair() {
  const kp = nacl.sign.keyPair();
  const publicKey = bs58.encode(kp.publicKey);
  return {
    publicKey,
    secretKey: Buffer.from(kp.secretKey),
    secretKeyBase58: bs58.encode(kp.secretKey)
  };
}

function deriveSolanaKeypair(mnemonic) {
  const normalized = String(mnemonic || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (![12, 24].includes(normalized.split(' ').length) || !bip39.validateMnemonic(normalized)) throw new Error('invalid mnemonic');
  let state = crypto.createHmac('sha512', 'ed25519 seed').update(bip39.mnemonicToSeedSync(normalized)).digest();
  for (const index of [44, 501, 0, 0]) {
    const data = Buffer.alloc(37); data[0] = 0; state.subarray(0, 32).copy(data, 1); data.writeUInt32BE(index + 0x80000000, 33);
    state = crypto.createHmac('sha512', state.subarray(32)).update(data).digest();
  }
  const kp = nacl.sign.keyPair.fromSeed(state.subarray(0, 32));
  return { mnemonic: normalized, publicKey: bs58.encode(kp.publicKey), secretKey: Buffer.from(kp.secretKey) };
}

module.exports = { encryptSecret, decryptSecret, generateSolanaKeypair, deriveSolanaKeypair };
