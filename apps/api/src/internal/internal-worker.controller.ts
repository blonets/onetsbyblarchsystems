import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import type { AuditEvent } from '@mtk/types';
import { AuditService } from '../audit/audit.service.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { Internal } from '../common/decorators/internal.decorator.js';
import { ProvisioningService } from '../provisioning/provisioning.service.js';
import { RoutersService } from '../routers/routers.service.js';
import { VAULT_PORT, type VaultPort } from '../vault/vault.port.js';

/**
 * Worker ↔ API internal contract (ARCHITECTURE §2). Machine-to-machine only:
 * @Public() skips the JWT guard and @Internal() requires the `x-internal-key`
 * header (fails closed when INTERNAL_API_KEY is unset).
 *
 * The worker holds no router registry and no credentials of its own — router
 * ids, endpoint descriptors and secrets all resolve here, at call time.
 */
@Controller('internal/worker')
@Public()
@Internal()
export class InternalWorkerController {
  constructor(
    private readonly routers: RoutersService,
    private readonly provisioning: ProvisioningService,
    private readonly audit: AuditService,
    @Inject(VAULT_PORT) private readonly vault: VaultPort,
  ) {}

  /** Full managed-router set; the worker applies its shard filter locally. */
  @Get('routers')
  async listRouters(): Promise<{ routerIds: string[] }> {
    return { routerIds: await this.routers.listIdsForWorker() };
  }

  /**
   * Endpoint descriptor with the vault-resolved API password. Unknown ids
   * 404 (via RoutersService) — the worker maps that to UnknownRouterError.
   */
  @Get('routers/:id/endpoint')
  async endpoint(@Param('id') id: string) {
    let view;
    try {
      view = await this.routers.getWorkerView(id);
    } catch (err) {
      if (id === 'hub') {
        return this.provisioning.getHubEndpoint();
      }
      throw err;
    }
    const password = await this.vault.retrieve(view.apiPasswordRef);
    return {
      routerId: view.id,
      uuid: view.uuid,
      host: view.tunnelIp,
      apiPort: view.apiPort,
      ftpPort: view.ftpPort,
      username: view.apiUsername,
      password,
      ...(view.identityName ? { identity: view.identityName } : {}),
    };
  }

  /** Provisioning-flow identity for a router: SSTP username + platform uuid. */
  @Get('routers/:id/provision-info')
  async provisionInfo(@Param('id') id: string): Promise<{ sstpUsername: string; uuid: string }> {
    const view = await this.routers.getWorkerView(id);
    return { sstpUsername: view.sstpUsername, uuid: view.uuid };
  }

  /**
   * Mint + persist fresh per-router secrets; the plaintext is returned
   * exactly once so the worker can apply it on the router and the hub.
   */
  @Post('routers/:id/fresh-secrets')
  @HttpCode(200)
  async freshSecrets(
    @Param('id') id: string,
  ): Promise<{ sstpPassword: string; apiPassword: string }> {
    return this.provisioning.generateFreshSecrets(id);
  }

  /** Worker reports a completed decommission (hub secret already removed). */
  @Post('routers/:id/decommission')
  @HttpCode(202)
  async decommission(@Param('id') id: string): Promise<{ accepted: true }> {
    await this.routers.markDecommissioned(id);
    return { accepted: true };
  }

  /** Append an action the worker executed directly to the audit log. */
  @Post('audit')
  @HttpCode(202)
  async appendAudit(@Body() entry: AuditEvent): Promise<{ accepted: true }> {
    if (!entry || typeof entry.action !== 'string' || typeof entry.opId !== 'string') {
      throw new BadRequestException('audit entry requires action and opId');
    }
    await this.audit.append({
      actorId: entry.actorId ?? null,
      // Worker events carry the router as entityType 'router' + entityId.
      routerId: entry.entityType === 'router' ? (entry.entityId ?? null) : null,
      action: entry.action,
      opId: entry.opId,
      before: entry.before ?? null,
      after: entry.after ?? null,
      result: entry.result ?? 'done',
      error: entry.error ?? null,
    });
    return { accepted: true };
  }
}
