import { Global, Module } from '@nestjs/common';
import { VAULT_PORT, InMemoryVault } from './vault.port.js';

/**
 * Vault module (global). Default binding is the in-memory vault (dev/test).
 * Production deployments override the VAULT_PORT provider with a real
 * Vault/KMS implementation — see vault.port.ts.
 */
@Global()
@Module({
  providers: [{ provide: VAULT_PORT, useClass: InMemoryVault }],
  exports: [VAULT_PORT],
})
export class VaultModule {}
