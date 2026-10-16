import { ArrayNotEmpty, ArrayUnique, IsArray, IsString, IsUUID } from 'class-validator';

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
