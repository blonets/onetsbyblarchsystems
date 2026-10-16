import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

function PortField() {
  return function (target: object, propertyKey: string): void {
    IsOptional()(target, propertyKey);
    IsInt()(target, propertyKey);
    Min(1)(target, propertyKey);
    Max(65535)(target, propertyKey);
  };
}

export class CreateRouterDto {
  /** Platform UUID; generated when omitted. Stamped into the router at onboarding. */
  @IsOptional()
  @IsString()
  uuid?: string;

  @IsOptional()
  @IsString()
  siteId?: string;

  @IsString()
  tunnelIp!: string;

  @IsString()
  sstpUsername!: string;

  /** Vault/KMS reference — NEVER a plaintext password. */
  @IsString()
  sstpPasswordRef!: string;

  /** Vault/KMS reference — NEVER a plaintext password. */
  @IsString()
  apiPasswordRef!: string;

  @IsOptional()
  @IsString()
  apiUsername?: string;

  /** RouterOS API port (default 8728). */
  @PortField()
  apiPort?: number;

  /** API-SSL port (default 8729). */
  @PortField()
  apiSslPort?: number;

  /** WinBox port (default 8291). */
  @PortField()
  winboxPort?: number;

  /** SSH port (default 22; the hub CHR uses 8922). */
  @PortField()
  sshPort?: number;

  /** Telnet port (default 23; the hub CHR uses 8923). */
  @PortField()
  telnetPort?: number;

  /** FTP port (default 21; the hub CHR uses 8921). */
  @PortField()
  ftpPort?: number;

  /** WWW port (default 80; the hub CHR uses 8980). */
  @PortField()
  wwwPort?: number;

  @IsOptional()
  @IsString()
  identityName?: string;

  @IsOptional()
  @IsString()
  boardName?: string;

  @IsOptional()
  @IsString()
  routerOsVersion?: string;
}

export class UpdateRouterDto {
  @IsOptional()
  @IsString()
  siteId?: string | null;

  @PortField()
  apiPort?: number;

  @PortField()
  apiSslPort?: number;

  @PortField()
  winboxPort?: number;

  @PortField()
  sshPort?: number;

  @PortField()
  telnetPort?: number;

  @PortField()
  ftpPort?: number;

  @PortField()
  wwwPort?: number;

  @IsOptional()
  @IsString()
  identityName?: string;

  @IsOptional()
  @IsString()
  boardName?: string;

  @IsOptional()
  @IsString()
  routerOsVersion?: string;

  @IsOptional()
  @IsString()
  serialNumber?: string;

  @IsOptional()
  @IsIn(['pending', 'online', 'offline', 'suspect', 'decommissioned'])
  status?: 'pending' | 'online' | 'offline' | 'suspect' | 'decommissioned';
}
