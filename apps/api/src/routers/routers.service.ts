import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Router, RouterStatus } from '@mtk/types';
import { CreateRouterDto } from './dto/create-router.dto.js';
import { UpdateRouterDto } from './dto/update-router.dto.js';

/**
 * Routers CRUD + status.
 *
 * Storage is an in-memory Map for the scaffold so the API boots without a
 * database. TODO: replace with PrismaClient (see prisma/schema.prisma) —
 * the method signatures are already the repository interface the Prisma
 * implementation must satisfy.
 */
@Injectable()
export class RoutersService {
  private readonly store = new Map<string, Router>();

  create(dto: CreateRouterDto): Router {
    const now = new Date().toISOString();
    const router: Router = {
      id: randomUUID(),
      siteId: dto.siteId,
      identity: dto.identity,
      apiPort: dto.apiPort ?? 8728,
      apiSslPort: dto.apiSslPort ?? 8729,
      winboxPort: dto.winboxPort ?? 8291,
      sshPort: dto.sshPort ?? 22,
      telnetPort: dto.telnetPort ?? 23,
      ftpPort: dto.ftpPort ?? 21,
      wwwPort: dto.wwwPort ?? 80,
      status: 'unknown',
      isHub: dto.isHub ?? false,
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(router.id, router);
    return router;
  }

  findAll(): Router[] {
    return [...this.store.values()];
  }

  findOne(id: string): Router {
    const router = this.store.get(id);
    if (!router) throw new NotFoundException(`router ${id} not found`);
    return router;
  }

  update(id: string, dto: UpdateRouterDto): Router {
    const current = this.findOne(id);
    const updated: Router = {
      ...current,
      ...definedOnly(dto),
      updatedAt: new Date().toISOString(),
    };
    this.store.set(id, updated);
    return updated;
  }

  remove(id: string): void {
    if (!this.store.delete(id)) throw new NotFoundException(`router ${id} not found`);
  }

  /**
   * Last-known status from the platform's point of view.
   * TODO: live-check via the worker's ConnectionManager (ping the API port
   * over the tunnel) instead of trusting the stored value.
   */
  getStatus(id: string): { id: string; status: RouterStatus; lastSeenAt?: string } {
    const router = this.findOne(id);
    return { id: router.id, status: router.status, lastSeenAt: router.lastSeenAt };
  }

  /** Called by the worker poller. TODO: persist + write RouterMetric hypertable. */
  markSeen(id: string, rosVersion?: string): Router {
    const router = this.findOne(id);
    const updated: Router = {
      ...router,
      status: 'online',
      lastSeenAt: new Date().toISOString(),
      rosVersion: rosVersion ?? router.rosVersion,
      updatedAt: new Date().toISOString(),
    };
    this.store.set(id, updated);
    return updated;
  }
}

function definedOnly<T extends object>(dto: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(dto)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}
