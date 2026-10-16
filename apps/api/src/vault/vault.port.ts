import { randomUUID } from 'node:crypto';

/**
 * Secret storage port.
 *
 * The DB holds only *references* (`sstpPasswordRef`, `apiPasswordRef`);
 * actual secret values live behind this interface (Vault/KMS in production).
 *
 * Rules:
 * - `store` returns an opaque reference; the secret value is never logged,
 *   never returned by any read API, and never persisted to Postgres.
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
 * Loudly warns on construction. Production MUST bind a real Vault/KMS
 * implementation to {@link VAULT_PORT} (e.g. HashiCorp Vault KV with
 * transit encryption, or a cloud KMS envelope). Secrets kept here die with
 * the process and are visible to anyone with heap access.
 */
export class InMemoryVault implements VaultPort {
  private readonly secrets = new Map<string, string>();

  constructor() {
    // eslint-disable-next-line no-console
    console.warn(
      '[vault] Using InMemoryVault — DEV/TEST ONLY. Bind a real Vault/KMS implementation for any production deployment.',
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
