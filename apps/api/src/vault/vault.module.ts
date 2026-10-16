import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DB_PORT, type DbPort } from '../db/database.port.js';
import { PostgresVault } from './postgres-vault.js';
import { VAULT_PORT, InMemoryVault, type VaultPort } from './vault.port.js';

/**
 * Vault module (global).
 *
 * - `VAULT_MASTER_KEY` set → {@link PostgresVault}: secrets persist as
 *   AES-256-GCM ciphertext in Postgres and survive restarts. An invalid
 *   key fails the boot closed (PostgresVault's constructor throws).
 * - unset → in-memory vault (dev/test), with its loud construction warning.
 */
@Global()
@Module({
  providers: [
    {
      provide: VAULT_PORT,
      inject: [DB_PORT, ConfigService],
      useFactory: (db: DbPort, config: ConfigService): VaultPort => {
        const masterKey = config.get<string>('VAULT_MASTER_KEY');
        if (masterKey) return new PostgresVault(db, masterKey);
        return new InMemoryVault();
      },
    },
  ],
  exports: [VAULT_PORT],
})
export class VaultModule {}
