import { Injectable, NotImplementedException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

/**
 * Auth skeleton: JWT signing is real; the user store is a TODO.
 * Wire `validateUser` to Prisma (User model) + bcrypt before enabling /auth/login.
 */
@Injectable()
export class AuthService {
  constructor(private readonly jwt: JwtService) {}

  /** TODO: Prisma User lookup + password hash comparison. */
  async validateUser(
    email: string,
    password: string,
  ): Promise<{ id: string; email: string; roles: string[] } | null> {
    void email;
    void password;
    throw new NotImplementedException('TODO: wire Prisma User lookup for credential validation');
  }

  async login(email: string, password: string): Promise<{ accessToken: string }> {
    const user = await this.validateUser(email, password);
    if (!user) throw new UnauthorizedException('invalid credentials');
    const accessToken = this.jwt.sign({ sub: user.id, email: user.email, roles: user.roles });
    return { accessToken };
  }
}
