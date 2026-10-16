import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/** Manual partial DTO (avoids the @nestjs/mapped-types dependency in the scaffold). */
export class UpdateRouterDto {
  @IsOptional()
  @IsString()
  siteId?: string;

  @IsOptional()
  @IsString()
  identity?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  apiPort?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  apiSslPort?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  winboxPort?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  sshPort?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  telnetPort?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  ftpPort?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  wwwPort?: number;

  @IsOptional()
  @IsBoolean()
  isHub?: boolean;
}
