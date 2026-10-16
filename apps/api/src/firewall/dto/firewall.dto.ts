import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

export const FIREWALL_TABLES = ['filter', 'nat', 'mangle', 'address-list'] as const;
export type FirewallTableName = (typeof FIREWALL_TABLES)[number];

export class OpIdDto {
  @IsOptional()
  @IsString()
  opId?: string;
}

/**
 * Create a firewall rule. For `table: 'address-list'`, `chain` carries the
 * list name and `srcAddress` the address entry (the DB mirror reuses the
 * generic FirewallRule columns; address-lists have no device-side ordering).
 */
export class CreateFirewallRuleDto extends OpIdDto {
  @IsIn([...FIREWALL_TABLES])
  table!: FirewallTableName;

  /** Chain name — or the address-list name when table='address-list'. */
  @IsString()
  chain!: string;

  @IsString()
  action!: string;

  @IsOptional()
  @IsString()
  protocol?: string;

  @IsOptional()
  @IsString()
  srcAddress?: string;

  @IsOptional()
  @IsString()
  dstAddress?: string;

  @IsOptional()
  @IsString()
  srcPort?: string;

  @IsOptional()
  @IsString()
  dstPort?: string;

  @IsOptional()
  @IsString()
  inInterface?: string;

  @IsOptional()
  @IsString()
  outInterface?: string;

  @IsOptional()
  @IsString()
  toAddresses?: string;

  @IsOptional()
  @IsString()
  toPorts?: string;

  /** Mangle-only. */
  @IsOptional()
  @IsString()
  newPacketMark?: string;

  /** Mangle-only. */
  @IsOptional()
  @IsString()
  newConnectionMark?: string;

  /** Mangle-only. */
  @IsOptional()
  @IsString()
  newRoutingMark?: string;

  /** Address-list-only: entry auto-expiry, e.g. "1d". */
  @IsOptional()
  @IsString()
  timeout?: string;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsBoolean()
  disabled?: boolean;

  /** Platform rule id to insert before (device `place-before`). Default: append. */
  @IsOptional()
  @IsString()
  beforeId?: string;
}

export class UpdateFirewallRuleDto extends OpIdDto {
  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsString()
  protocol?: string;

  @IsOptional()
  @IsString()
  srcAddress?: string;

  @IsOptional()
  @IsString()
  dstAddress?: string;

  @IsOptional()
  @IsString()
  srcPort?: string;

  @IsOptional()
  @IsString()
  dstPort?: string;

  @IsOptional()
  @IsString()
  inInterface?: string;

  @IsOptional()
  @IsString()
  outInterface?: string;

  @IsOptional()
  @IsString()
  toAddresses?: string;

  @IsOptional()
  @IsString()
  toPorts?: string;

  @IsOptional()
  @IsString()
  newPacketMark?: string;

  @IsOptional()
  @IsString()
  newConnectionMark?: string;

  @IsOptional()
  @IsString()
  newRoutingMark?: string;

  @IsOptional()
  @IsString()
  timeout?: string;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsBoolean()
  disabled?: boolean;
}

export class MoveFirewallRuleDto extends OpIdDto {
  /** Platform rule id to move this rule before. */
  @IsOptional()
  @IsString()
  beforeId?: string;

  /** Move to the end of the table+chain. Mutually exclusive with beforeId. */
  @IsOptional()
  @IsBoolean()
  toEnd?: boolean;
}

export class ListFirewallRulesQuery {
  @IsOptional()
  @IsIn([...FIREWALL_TABLES])
  table?: FirewallTableName;

  @IsOptional()
  @IsString()
  chain?: string;
}
