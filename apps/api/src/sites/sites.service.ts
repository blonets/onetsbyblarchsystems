import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Site } from '@mtk/types';
import { AuditService } from '../audit/audit.service.js';
import type { CurrentUserType } from '../common/types.js';
import { DB_PORT, type DbPort } from '../db/database.port.js';
import type { SiteRow } from '../db/rows.js';
import { CreateSiteDto, UpdateSiteDto } from './dto/site.dto.js';

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Sites CRUD. Mutations are audit-logged. */
@Injectable()
export class SitesService {
  constructor(
    @Inject(DB_PORT) private readonly db: DbPort,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateSiteDto, actor?: CurrentUserType): Promise<Site> {
    const base = (dto.slug ?? slugify(dto.name)) || 'site';
    let slug = base;
    let n = 0;
    while (await this.db.sites.findUnique({ slug })) {
      n += 1;
      slug = `${base}-${n}`;
    }
    const row = await this.db.sites.create({
      name: dto.name,
      slug,
      address: dto.address ?? null,
      city: dto.city ?? null,
      country: dto.country ?? 'EG',
      lat: dto.lat ?? null,
      lng: dto.lng ?? null,
      notes: dto.notes ?? null,
    });
    await this.audit.append({
      actorId: actor?.sub,
      action: 'site.create',
      entityType: 'site',
      entityId: row.id,
      after: { name: row.name, slug: row.slug },
      result: 'done',
    });
    return toDto(row);
  }

  async findAll(opts: { includeDeleted?: boolean } = {}): Promise<Site[]> {
    const rows = await this.db.sites.findMany({ orderBy: { name: 'asc' } });
    return rows.filter((r) => opts.includeDeleted || !r.deletedAt).map(toDto);
  }

  async findOne(id: string): Promise<Site> {
    const row = await this.db.sites.findUnique({ id });
    if (!row || row.deletedAt) throw new NotFoundException(`site ${id} not found`);
    return toDto(row);
  }

  async update(id: string, dto: UpdateSiteDto, actor?: CurrentUserType): Promise<Site> {
    const before = await this.db.sites.findUnique({ id });
    if (!before || before.deletedAt) throw new NotFoundException(`site ${id} not found`);
    const patch: Record<string, unknown> = {};
    for (const k of ['name', 'address', 'city', 'country', 'lat', 'lng', 'notes'] as const) {
      if (dto[k] !== undefined) patch[k] = dto[k];
    }
    const row = await this.db.sites.update({ id }, patch);
    await this.audit.append({
      actorId: actor?.sub,
      action: 'site.update',
      entityType: 'site',
      entityId: id,
      before: { name: before.name },
      after: { name: row.name },
      result: 'done',
    });
    return toDto(row);
  }

  /** Soft delete — routers keep their history; FK is SET NULL-safe via queries. */
  async remove(id: string, actor?: CurrentUserType): Promise<void> {
    const row = await this.db.sites.findUnique({ id });
    if (!row || row.deletedAt) throw new NotFoundException(`site ${id} not found`);
    await this.db.sites.update({ id }, { deletedAt: new Date() });
    await this.audit.append({
      actorId: actor?.sub,
      action: 'site.delete',
      entityType: 'site',
      entityId: id,
      before: { name: row.name, slug: row.slug },
      result: 'done',
    });
  }

  async routersOf(siteId: string): Promise<string[]> {
    await this.findOne(siteId);
    const routers = await this.db.routers.findMany({ where: { siteId } });
    return routers.map((r) => r.id);
  }
}

function toDto(r: SiteRow): Site {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    address: r.address,
    city: r.city,
    country: r.country,
    lat: r.lat,
    lng: r.lng,
    notes: r.notes,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
