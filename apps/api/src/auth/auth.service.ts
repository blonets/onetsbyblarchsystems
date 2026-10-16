import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ROLE_RANK, type AuthTokens, type LoginResponse, type RoleName, type User } from '@mtk/types';
import { DB_PORT, type DbPort } from '../db/database.port.js';
import { verifyPassword } from './password.js';
import { UsersService } from './users.service.js';

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Parse JWT_EXPIRES_IN whether set as seconds ("3600") or duration ("15m", "1h", "7d"). */
export function parseJwtExpiresInSeconds(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === 'string') {
    const m = /^(\d+)\s*([smhd])?$/i.exec(raw.trim());
    if (m) {
      const n = Number(m[1]);
      const unit = (m[2] ?? 's').toLowerCase();
      const mult = unit === 'm' ? 60 : unit === 'h' ? 3600 : unit === 'd' ? 86400 : 1;
      if (n > 0) return n * mult;
    }
  }
  return 3600;
}

/**
 * Authentication: credential validation (bcrypt), JWT access tokens and
 * rotating opaque refresh tokens.
 *
 * Refresh rotation with reuse detection: each refresh burns the presented
 * token and issues a new pair. Presenting an already-burned token is treated
 * as theft — the whole token family is revoked and the user must log in again.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly users: UsersService,
    @Inject(DB_PORT) private readonly db: DbPort,
  ) {}

  private refreshTtlMs(): number {
    return Number(this.config.get('REFRESH_TOKEN_TTL_DAYS') ?? 30) * 86_400_000;
  }

  async validateUser(email: string, password: string): Promise<User | null> {
    const row = await this.users.findRowByEmail(email);
    if (!row || row.disabledAt) return null;
    if (!(await verifyPassword(password, row.passwordHash))) return null;
    return this.users.findById(row.id);
  }

  async login(email: string, password: string): Promise<LoginResponse> {
    const user = await this.validateUser(email, password);
    if (!user) throw new UnauthorizedException('invalid credentials');
    const tokens = await this.issueTokenPair(user);
    return { ...tokens, user };
  }

  async refresh(presentedToken: string): Promise<AuthTokens> {
    const tokenHash = sha256Hex(presentedToken);
    const row = await this.db.refreshTokens.findUnique({ tokenHash });

    if (!row) throw new UnauthorizedException('invalid refresh token');

    if (row.revokedAt) {
      // Reuse of a burned token → possible theft: revoke the whole family.
      await this.db.refreshTokens.deleteMany({ userId: row.userId });
      throw new UnauthorizedException('refresh token reuse detected; all sessions revoked');
    }
    if (row.expiresAt.getTime() < Date.now()) {
      await this.db.refreshTokens.delete({ id: row.id }).catch(() => undefined);
      throw new UnauthorizedException('refresh token expired');
    }

    const user = await this.users.findById(row.userId).catch(() => null);
    if (!user || user.disabledAt) {
      await this.db.refreshTokens.delete({ id: row.id }).catch(() => undefined);
      throw new UnauthorizedException('account disabled');
    }

    // Rotate: burn the presented token, issue a fresh pair.
    await this.db.refreshTokens.update({ id: row.id }, { revokedAt: new Date() });
    return this.issueTokenPair(user);
  }

  async logout(presentedToken: string): Promise<void> {
    const tokenHash = sha256Hex(presentedToken);
    await this.db.refreshTokens.deleteMany({ tokenHash }).catch(() => undefined);
  }

  async me(userId: string): Promise<User> {
    return this.users.findById(userId);
  }

  /** Highest privilege rank held by the role list (for the RBAC guard). */
  static rankOf(roles: string[]): number {
    return Math.max(0, ...roles.map((r) => ROLE_RANK[r as RoleName] ?? 0));
  }

  private async issueTokenPair(user: User): Promise<AuthTokens & { expiresAt: string }> {
    const role = user.role ?? 'viewer';
    const accessToken = this.jwt.sign({ sub: user.id, email: user.email, role, roles: [role] });
    const refreshToken = randomBytes(48).toString('base64url');
    await this.db.refreshTokens.create({
      userId: user.id,
      tokenHash: sha256Hex(refreshToken),
      expiresAt: new Date(Date.now() + this.refreshTtlMs()),
    });
    const expiresIn = parseJwtExpiresInSeconds(this.config.get('JWT_EXPIRES_IN'));
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    return { accessToken, refreshToken, expiresIn, expiresAt };
  }
}
