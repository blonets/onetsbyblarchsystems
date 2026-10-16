/**
 * Backup encryption — AES-256-GCM (the cipher libsodium exposes as
 * crypto_aead_aes256gcm; implemented here with node:crypto to keep the worker
 * dependency-free).
 *
 * Key sourcing: the 32-byte key is referenced — never stored — via the
 * `BACKUP_KMS_KEY` env var (64 hex chars) at runtime. In production this env
 * var is populated from the KMS/vault by the deployment (Dokploy secret).
 *
 * Envelope (JSON, base64 fields):
 *   { v: 1, alg: "aes-256-gcm", iv, ct }   // tag appended to ct
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALG = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

export interface EncryptedEnvelope {
  v: 1;
  alg: typeof ALG;
  iv: string; // base64
  ct: string; // base64, ciphertext || 16-byte auth tag
}

/** Resolve the 32-byte backup key from the runtime environment. */
export function resolveBackupKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const hex = env['BACKUP_KMS_KEY'];
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      'BACKUP_KMS_KEY must be set to 64 hex chars (32 bytes) — refusing to encrypt without a key',
    );
  }
  return Buffer.from(hex, 'hex');
}

export function encryptBackup(plaintext: Uint8Array, key: Buffer): EncryptedEnvelope {
  if (key.length !== 32) throw new Error('backup key must be 32 bytes');
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALG, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  if (tag.length !== TAG_LEN) throw new Error('unexpected GCM tag length');
  return {
    v: 1,
    alg: ALG,
    iv: iv.toString('base64'),
    ct: Buffer.concat([ct, tag]).toString('base64'),
  };
}

export function decryptBackup(envelope: EncryptedEnvelope, key: Buffer): Buffer {
  if (envelope.v !== 1 || envelope.alg !== ALG) {
    throw new Error(`unsupported backup envelope v${envelope.v}/${envelope.alg}`);
  }
  if (key.length !== 32) throw new Error('backup key must be 32 bytes');
  const iv = Buffer.from(envelope.iv, 'base64');
  const raw = Buffer.from(envelope.ct, 'base64');
  if (raw.length < TAG_LEN) throw new Error('backup ciphertext too short');
  const tag = raw.subarray(raw.length - TAG_LEN);
  const ct = raw.subarray(0, raw.length - TAG_LEN);
  const decipher = createDecipheriv(ALG, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

/** Serialize an envelope for storage. */
export const serializeEnvelope = (env: EncryptedEnvelope): string => JSON.stringify(env);

/** Parse + validate a stored envelope. */
export function parseEnvelope(json: string): EncryptedEnvelope {
  const parsed = JSON.parse(json) as EncryptedEnvelope;
  if (parsed?.v !== 1 || parsed?.alg !== ALG || !parsed.iv || !parsed.ct) {
    throw new Error('not a valid backup envelope');
  }
  return parsed;
}
