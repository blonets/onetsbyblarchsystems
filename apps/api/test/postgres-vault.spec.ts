import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { InMemoryDatabase } from '../src/db/in-memory-database.js';
import { PostgresVault } from '../src/vault/postgres-vault.js';

const newKey = (): string => randomBytes(32).toString('base64');
const SECRET = 's3cr3t-router-password!';

describe('PostgresVault', () => {
  it('roundtrips a secret and returns a pg: reference', async () => {
    const vault = new PostgresVault(new InMemoryDatabase(), newKey());
    const ref = await vault.store(SECRET);
    expect(ref).toMatch(/^pg:[0-9a-f-]{36}$/);
    await expect(vault.retrieve(ref)).resolves.toBe(SECRET);
  });

  it('persists ciphertext only — the stored row never contains the plaintext', async () => {
    const db = new InMemoryDatabase();
    const vault = new PostgresVault(db, newKey());
    const ref = await vault.store(SECRET);
    const row = await db.vaultEntries.findUnique({ ref });
    expect(row).not.toBeNull();
    expect(row!.ciphertext).not.toContain(SECRET);
    expect(Buffer.from(row!.ciphertext, 'base64').toString('utf8')).not.toContain(SECRET);
    expect(Buffer.from(row!.iv, 'base64')).toHaveLength(12);
    expect(Buffer.from(row!.authTag, 'base64')).toHaveLength(16);
  });

  it('survives a restart — a second instance with the same key retrieves the secret', async () => {
    const db = new InMemoryDatabase();
    const key = newKey();
    const ref = await new PostgresVault(db, key).store(SECRET);
    await expect(new PostgresVault(db, key).retrieve(ref)).resolves.toBe(SECRET);
  });

  it('fails to decrypt with the wrong master key (GCM auth)', async () => {
    const db = new InMemoryDatabase();
    const ref = await new PostgresVault(db, newKey()).store(SECRET);
    await expect(new PostgresVault(db, newKey()).retrieve(ref)).rejects.toThrow();
  });

  it('throws on unknown references, including refs from other vault kinds', async () => {
    const vault = new PostgresVault(new InMemoryDatabase(), newKey());
    await expect(vault.retrieve('pg:00000000-0000-0000-0000-000000000000')).rejects.toThrow(
      'unknown secret reference',
    );
    await expect(vault.retrieve('mem:whatever')).rejects.toThrow('unknown secret reference');
  });

  it('revoke deletes the entry and is idempotent', async () => {
    const vault = new PostgresVault(new InMemoryDatabase(), newKey());
    const ref = await vault.store(SECRET);
    await vault.revoke(ref);
    await expect(vault.retrieve(ref)).rejects.toThrow('unknown secret reference');
    await expect(vault.revoke(ref)).resolves.toBeUndefined();
    await expect(vault.revoke('pg:never-existed')).resolves.toBeUndefined();
  });

  it('refuses to store an empty secret', async () => {
    const vault = new PostgresVault(new InMemoryDatabase(), newKey());
    await expect(vault.store('')).rejects.toThrow('refusing to store an empty secret');
  });

  it('uses a fresh IV per store — identical secrets encrypt differently', async () => {
    const db = new InMemoryDatabase();
    const vault = new PostgresVault(db, newKey());
    const a = await vault.store(SECRET);
    const b = await vault.store(SECRET);
    expect(a).not.toBe(b);
    const rowA = await db.vaultEntries.findUnique({ ref: a });
    const rowB = await db.vaultEntries.findUnique({ ref: b });
    expect(rowA!.iv).not.toBe(rowB!.iv);
    expect(rowA!.ciphertext).not.toBe(rowB!.ciphertext);
  });

  describe('master key validation (fails closed)', () => {
    it('throws when the key is missing', () => {
      expect(() => new PostgresVault(new InMemoryDatabase(), '')).toThrow('VAULT_MASTER_KEY');
    });

    it('throws when the key does not decode to 32 bytes', () => {
      const short = randomBytes(16).toString('base64');
      expect(() => new PostgresVault(new InMemoryDatabase(), short)).toThrow('VAULT_MASTER_KEY');
      const long = randomBytes(64).toString('base64');
      expect(() => new PostgresVault(new InMemoryDatabase(), long)).toThrow('VAULT_MASTER_KEY');
      expect(() => new PostgresVault(new InMemoryDatabase(), 'not-a-key!!!')).toThrow(
        'VAULT_MASTER_KEY',
      );
    });
  });
});
