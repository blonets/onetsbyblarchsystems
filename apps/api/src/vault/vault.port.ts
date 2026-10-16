import { randomUUID } from 'node:crypto';

/**
 * Secret storage port.
 *
 * Business tables hold only *references* (`sstpPasswordRef`,
 * `apiPasswordRef`); actual secret values live behind this interface and
 * are never returned by any read API, never logged, and never retained by
 * callers. Plaintext is never stored anywhere: the production
 * implementation ({@link PostgresVault}) persists values only as
 * AES-256-GCM ciphertext in the `vault_entries` table, with the master key
 * supplied via the `VAULT_MASTER_KEY` env var (it never touches the DB).
 *
 * Rules:
 * - `store` returns an opaque reference; the secret value is never logged
 *   and never persisted in plaintext.
 * - `retrieve` is called only at the moment a secret is needed (onboarding
 *   .rsc render, secret rotation) and the value must not be retained.
 */
export interface VaultPort {
  /** Persist a secret, returning its opaque reference. */
  store(secret: string): Promise<string>;
  /** Resolve a reference back to the secret value. */
  retrieve(ref: string): Promise<string>;
  /** Best-effort deletion of a stored secret. */
  revoke(ref: string): Promise<void>;
}

export const VAULT_PORT = Symbol('VAULT_PORT');

/**
 * In-memory vault — DEV/TEST ONLY.
 *
 * Loudly warns on construction. This is the binding only when
 * `VAULT_MASTER_KEY` is unset; with the key set, {@link PostgresVault}
 * (AES-256-GCM ciphertext in Postgres) is bound instead. Secrets kept here
 * die with the process and are visible to anyone with heap access.
 */
export class InMemoryVault implements VaultPort {
  private readonly secrets = new Map<string, string>();

  constructor() {
    // eslint-disable-next-line no-console
    console.warn(
      '[vault] Using InMemoryVault — DEV/TEST ONLY. Set VAULT_MASTER_KEY to bind the persistent PostgresVault for any production deployment.',
    );
  }

  async store(secret: string): Promise<string> {
    if (!secret) throw new Error('refusing to store an empty secret');
    const ref = `mem:${randomUUID()}`;
    this.secrets.set(ref, secret);
    return ref;
  }

  async retrieve(ref: string): Promise<string> {
    const value = this.secrets.get(ref);
    if (value === undefined) throw new Error(`unknown secret reference`);
    return value;
  }

  async revoke(ref: string): Promise<void> {
    this.secrets.delete(ref);
  }
}
