import { IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';

/**
 * One guided step that generates the full hotspot sentence batch:
 * address + pool + DHCP server/network + NAT masquerade + walled-garden +
 * DNS + hotspot server-profile + hotspot server (+ login-page notes).
 *
 * `confirm=true` enqueues the batch (tracked by opId, idempotent);
 * otherwise the endpoint returns a step-by-step preview (sentences grouped
 * by step) without touching anything.
 */
export class HotspotSetupWizardDto {
  /** LAN interface the hotspot binds to, e.g. "bridge-lan". */
  @IsString()
  interface!: string;

  /** Hotspot gateway address in CIDR, e.g. "192.168.10.1/24". */
  @IsString()
  hotspotAddress!: string;

  @IsOptional()
  @IsString()
  poolName?: string;

  /** e.g. "192.168.10.100-192.168.10.200". */
  @IsOptional()
  @IsString()
  poolRange?: string;

  @IsOptional()
  @IsString()
  dhcpServerName?: string;

  /** DHCP lease time, e.g. "1h". */
  @IsOptional()
  @IsString()
  leaseTime?: string;

  /** Comma-separated DNS servers handed to clients, e.g. "8.8.8.8,1.1.1.1". */
  @IsOptional()
  @IsString()
  dnsServers?: string;

  /** WAN/out interface for the masquerade rule, e.g. "ether1". */
  @IsOptional()
  @IsString()
  outInterface?: string;

  /** /ip/hotspot/profile name. */
  @IsOptional()
  @IsString()
  serverProfileName?: string;

  /** DNS name shown on the hotspot login (optional). */
  @IsOptional()
  @IsString()
  dnsName?: string;

  /** e.g. "http-pap,http-chap,cookie". */
  @IsOptional()
  @IsString()
  loginBy?: string;

  /** /ip/hotspot server name. */
  @IsOptional()
  @IsString()
  serverName?: string;

  /** Hosts to pre-allow in the walled garden (DNS), e.g. payment gateways. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  walledGardenHosts?: string[];

  /** Idempotency key for the whole wizard run. */
  @IsOptional()
  @IsString()
  opId?: string;

  /** false/omitted → preview only; true → enqueue the batch. */
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}
