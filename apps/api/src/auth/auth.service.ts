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

  private async issueTokenPair(user: User): Promise<AuthTokens> {
    const role = user.role ?? 'viewer';
    const accessToken = this.jwt.sign({ sub: user.id, email: user.email, role, roles: [role] });
    const refreshToken = randomBytes(48).toString('base64url');
    await this.db.refreshTokens.create({
      userId: user.id,
      tokenHash: sha256Hex(refreshToken),
      expiresAt: new Date(Date.now() + this.refreshTtlMs()),
    });
    const expiresIn = Number(this.config.get('JWT_EXPIRES_IN') ?? 3600);
    return { accessToken, refreshToken, expiresIn };
  }
}
