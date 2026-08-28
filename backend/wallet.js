const crypto = require('crypto');
const nacl = require('tweetnacl');
const bs58 = require('bs58').default || require('bs58');

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

module.exports = { encryptSecret, decryptSecret, generateSolanaKeypair };
