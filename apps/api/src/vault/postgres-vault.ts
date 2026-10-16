import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import type { DbPort } from '../db/database.port.js';
import type { VaultPort } from './vault.port.js';

const REF_PREFIX = 'pg:';
const IV_BYTES = 12; // AES-GCM standard nonce size
const KEY_BYTES = 32; // AES-256

/**
 * Persistent vault — the production {@link VaultPort}.
 *
 * Secrets are encrypted with AES-256-GCM under a master key supplied via
 * the `VAULT_MASTER_KEY` env var (base64-encoded 32 bytes) and persisted
 * as ciphertext in the `vault_entries` table (via {@link DbPort}, the same
 * database access pattern every service uses). Plaintext exists only in
 * memory at store/retrieve time; neither the plaintext nor the key is ever
 * logged or written to the database.
 *
 * FAILS CLOSED: construction throws when the key is missing or does not
 * decode to exactly 32 bytes. There is no fallback to plaintext or to the
 * in-memory vault — a misconfigured production key must stop the boot,
 * not silently downgrade secret storage.
 */
export class PostgresVault implements VaultPort {
  private readonly key: Buffer;

  constructor(
    private readonly db: DbPort,
    masterKeyBase64: string,
  ) {
    const key = masterKeyBase64 ? Buffer.from(masterKeyBase64.trim(), 'base64') : Buffer.alloc(0);
    if (key.length !== KEY_BYTES) {
      throw new Error(
        'VAULT_MASTER_KEY is missing or invalid: expected a base64-encoded 32-byte key ' +
          '(generate one with `openssl rand -base64 32`). Refusing to start the vault.',
      );
    }
    this.key = key;
  }

  async store(secret: string): Promise<string> {
    if (!secret) throw new Error('refusing to store an empty secret');
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const ref = `${REF_PREFIX}${randomUUID()}`;
    await this.db.vaultEntries.create({
      ref,
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
    });
    return ref;
  }

  async retrieve(ref: string): Promise<string> {
    const row = ref.startsWith(REF_PREFIX)
      ? await this.db.vaultEntries.findUnique({ ref })
      : null;
    if (!row) throw new Error('unknown secret reference');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(row.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(row.authTag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(row.ciphertext, 'base64')),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  }

  async revoke(ref: string): Promise<void> {
    // deleteMany (not delete) so revoking an unknown/already-revoked ref is
    // a no-op instead of an error — best-effort deletion, per VaultPort.
    await this.db.vaultEntries.deleteMany({ ref });
  }
}
