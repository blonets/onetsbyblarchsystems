import { ArrayNotEmpty, ArrayUnique, IsArray, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class ProvisionRouterDto {
  @IsUUID()
  routerUuid!: string;

  /** TEMPORARY scaffold input — TODO: load used IPs from the Router table instead. */
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @ArrayNotEmpty()
  usedTunnelIps!: string[];
}

export class ProvisionDirectDto {
  @IsString()
  host!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  apiPort?: number;

  @IsString()
  username!: string;

  @IsString()
  password!: string;

  @IsOptional()
  @IsString()
  siteId?: string;

  @IsOptional()
  @IsString()
  identityName?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
