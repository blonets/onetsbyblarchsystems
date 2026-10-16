import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { ProvisioningModule } from '../provisioning/provisioning.module.js';
import { RoutersModule } from '../routers/routers.module.js';
import { InternalWorkerController } from './internal-worker.controller.js';

/**
 * Internal worker-facing endpoints (ARCHITECTURE §2 contract). All routes
 * are @Internal() — see InternalWorkerController. The vault is global
 * (VaultModule), so VAULT_PORT resolves without an import here.
 */
@Module({
  imports: [RoutersModule, ProvisioningModule, AuditModule],
  controllers: [InternalWorkerController],
})
export class InternalModule {}
