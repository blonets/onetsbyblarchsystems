import { Inject, Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import type { RoleName, User } from '@mtk/types';
import { DB_PORT, type DbPort, type NewUser } from '../db/database.port.js';
import { hashPassword } from './password.js';

export const ROLE_NAMES: RoleName[] = ['viewer', 'technician', 'operator', 'admin'];

/**
 * User management (admin-only at the controller layer).
 * Passwords are bcrypt hashes; the plaintext never hits the DB.
 */
@Injectable()
export class UsersService implements OnModuleInit {
  constructor(@Inject(DB_PORT) private readonly db: DbPort) {}

  async onModuleInit(): Promise<void> {
    await this.ensureRoles();
    if (process.env.NODE_ENV === 'test') return;
    const count = await this.db.users.count({});
    const seedPw = process.env.ADMIN_PASSWORD ?? process.env.SSTP_HUB_API_PASSWORD;
    if (count === 0 && seedPw && seedPw.length >= 8) {
      const primaryEmail = (process.env.ADMIN_EMAIL ?? 'admin@onetsbyblarch.online').trim().toLowerCase();
      await this.create({
        email: primaryEmail,
        name: 'Platform Admin',
        password: seedPw,
        role: 'admin',
      }).catch(() => undefined);
      if (primaryEmail !== 'admin@fleet.local') {
        await this.create({
          email: 'admin@fleet.local',
          name: 'Platform Admin',
          password: seedPw,
          role: 'admin',
        }).catch(() => undefined);
      }
    }
  }

  /** Idempotent: creates the four platform roles if missing. */
  async ensureRoles(): Promise<void> {
    for (const name of ROLE_NAMES) {
      const existing = await this.db.roles.findUnique({ name });
      if (!existing) {
        await this.db.roles.create({
          name,
          description:
            name === 'admin'
              ? 'Full access: users, secrets rotation, restore.'
              : name === 'operator'
                ? 'Hotspot, firewall, queues + view + onboarding.'
                : name === 'technician'
                  ? 'Onboarding + view.'
                  : 'Read-only.',
        });
      }
    }
  }

  private async roleIdFor(name: RoleName): Promise<string> {
    await this.ensureRoles();
    const role = await this.db.roles.findUnique({ name });
    if (!role) throw new NotFoundException(`role ${name} not found`);
    return role.id;
  }

  async create(input: {
    email: string;
    name: string;
    password: string;
    role?: RoleName;
    siteIds?: string[];
  }): Promise<User> {
    const email = input.email.trim().toLowerCase();
    const existing = await this.db.users.findUnique({ email });
    if (existing) throw new Error(`user ${email} already exists`);
    const data: NewUser = {
      email,
      name: input.name,
      passwordHash: await hashPassword(input.password),
      roleId: await this.roleIdFor(input.role ?? 'viewer'),
    };
    const row = await this.db.users.create(data);
    if (input.siteIds?.length) {
      for (const siteId of input.siteIds) {
        await this.db.siteUsers.create({ userId: row.id, siteId }).catch(() => undefined);
      }
    }
    return this.toDto(row);
  }

  async list(opts: { page?: number; pageSize?: number; includeDisabled?: boolean } = {}): Promise<{ items: User[]; total: number }> {
    const page = opts.page ?? 1;
    const pageSize = opts.pageSize ?? 50;
    const all = await this.db.users.findMany({ orderBy: { createdAt: 'desc' } });
    const filtered = opts.includeDisabled ? all : all.filter((u) => !u.disabledAt);
    const items = await Promise.all(
      filtered.slice((page - 1) * pageSize, page * pageSize).map((u) => this.toDto(u)),
    );
    return { items, total: filtered.length };
  }

  async findById(id: string): Promise<User> {
    const row = await this.db.users.findUnique({ id });
    if (!row) throw new NotFoundException(`user ${id} not found`);
    return this.toDto(row);
  }

  async findByEmail(email: string): Promise<User | null> {
    const row = await this.db.users.findUnique({ email: email.trim().toLowerCase() });
    return row ? this.toDto(row) : null;
  }

  /** Internal: full row incl. hash (auth only). */
  async findRowByEmail(email: string) {
    return this.db.users.findUnique({ email: email.trim().toLowerCase() });
  }

  async update(
    id: string,
    input: { name?: string; role?: RoleName; siteIds?: string[] },
  ): Promise<User> {
    const row = await this.db.users.findUnique({ id });
    if (!row) throw new NotFoundException(`user ${id} not found`);
    const patch: Partial<NewUser> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.role !== undefined) patch.roleId = await this.roleIdFor(input.role);
    const updated = await this.db.users.update({ id }, patch);
    if (input.siteIds !== undefined) {
      await this.db.siteUsers.deleteMany({ userId: id });
      for (const siteId of input.siteIds) {
        await this.db.siteUsers.create({ userId: id, siteId }).catch(() => undefined);
      }
    }
    return this.toDto(updated);
  }

  async setPassword(id: string, password: string): Promise<void> {
    const row = await this.db.users.findUnique({ id });
    if (!row) throw new NotFoundException(`user ${id} not found`);
    await this.db.users.update({ id }, { passwordHash: await hashPassword(password) });
    // Password change invalidates all sessions.
    await this.db.refreshTokens.deleteMany({ userId: id });
  }

  async setDisabled(id: string, disabled: boolean): Promise<User> {
    const row = await this.db.users.findUnique({ id });
    if (!row) throw new NotFoundException(`user ${id} not found`);
    if (disabled) await this.db.refreshTokens.deleteMany({ userId: id });
    const updated = await this.db.users.update(
      { id },
      { disabledAt: disabled ? new Date() : null },
    );
    return this.toDto(updated);
  }

  private async toDto(row: {
    id: string; email: string; name: string; roleId: string;
    disabledAt: Date | null; createdAt: Date;
  }): Promise<User> {
    const role = await this.db.roles.findUnique({ id: row.roleId });
    const siteLinks = await this.db.siteUsers.findMany({ where: { userId: row.id } });
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      roleId: row.roleId,
      role: (role?.name as RoleName | undefined) ?? 'viewer',
      siteIds: siteLinks.map((l) => l.siteId),
      disabledAt: row.disabledAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
