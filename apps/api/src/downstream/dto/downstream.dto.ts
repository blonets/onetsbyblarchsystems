import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';
import type { DeviceVendor, DownstreamKind } from '@mtk/types';

export const DEVICE_VENDORS: DeviceVendor[] = ['openwrt', 'ddwrt', 'ubiquiti', 'cisco', 'mikrotik', 'unknown'];
export const DOWNSTREAM_KINDS: DownstreamKind[] = ['mikrotik', 'ap', 'camera', 'pos', 'switch', 'other'];

export class OpIdDto {
  @IsOptional()
  @IsString()
  opId?: string;
}

/** Vendor-neutral management methods: which ports serve web/SSH on the device. */
export class MgmtMethodsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  web?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  ssh?: number;
}

export class RegisterDeviceDto extends OpIdDto {
  @IsString()
  name!: string;

  @IsIn(DOWNSTREAM_KINDS)
  kind!: DownstreamKind;

  /** openwrt | ddwrt | ubiquiti | cisco | mikrotik | unknown (default). */
  @IsOptional()
  @IsIn(DEVICE_VENDORS)
  vendor?: DeviceVendor;

  /** e.g. "Archer C7", "hAP ac^2". */
  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => MgmtMethodsDto)
  mgmtMethods?: MgmtMethodsDto;

  @IsOptional()
  @IsString()
  macAddress?: string;

  /** LAN address behind the site router. */
  @IsString()
  lanIp!: string;

  /** Management port on the device (22 | 80 | 443 | 8728 | 8291 …). */
  @IsInt()
  @Min(1)
  @Max(65535)
  mgmtPort!: number;

  @IsOptional()
  @IsIn(['tcp', 'udp'])
  protocol?: 'tcp' | 'udp';
}

export class UpdateDeviceDto extends OpIdDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(DOWNSTREAM_KINDS)
  kind?: DownstreamKind;

  @IsOptional()
  @IsIn(DEVICE_VENDORS)
  vendor?: DeviceVendor;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => MgmtMethodsDto)
  mgmtMethods?: MgmtMethodsDto;

  @IsOptional()
  @IsString()
  macAddress?: string;

  @IsOptional()
  @IsString()
  lanIp?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  mgmtPort?: number;
}
