import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { IsOptional, IsString, MinLength } from 'class-validator';
import type { AuthTokens, LoginResponse, User } from '@mtk/types';
import { AuthService } from './auth.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Public } from './decorators/public.decorator.js';
import { LoginDto } from './dto/login.dto.js';
import type { JwtPayload } from './guards/jwt-auth.guard.js';

class RefreshDto {
  @IsString()
  @MinLength(10)
  refreshToken!: string;
}

class LogoutDto {
  @IsOptional()
  @IsString()
  refreshToken?: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto): Promise<LoginResponse> {
    return this.auth.login(dto.email, dto.password);
  }

  /** Rotate the refresh token; returns a fresh access + refresh pair. */
  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto): Promise<AuthTokens> {
    return this.auth.refresh(dto.refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Body() dto?: LogoutDto): Promise<void> {
    if (dto?.refreshToken) {
      await this.auth.logout(dto.refreshToken);
    }
  }

  @Get('me')
  me(@CurrentUser() user: JwtPayload): Promise<User> {
    return this.auth.me(user.sub);
  }
}
