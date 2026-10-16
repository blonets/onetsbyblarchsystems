import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

function PortField() {
  return function (target: object, propertyKey: string): void {
    IsOptional()(target, propertyKey);
    IsInt()(target, propertyKey);
    Min(1)(target, propertyKey);
    Max(65535)(target, propertyKey);
  };
}

export class CreateRouterDto {
  @IsString()
  siteId!: string;

  @IsString()
  identity!: string;

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
  @IsBoolean()
  isHub?: boolean;
}
