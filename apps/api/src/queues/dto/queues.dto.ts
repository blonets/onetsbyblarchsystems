import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class OpIdDto {
  @IsOptional()
  @IsString()
  opId?: string;
}

/**
 * Rate strings are stored exactly as submitted (e.g. "5M/10M"). NOTE: the
 * device normalizes rates (`2M/2M` → `2000000/2000000`), so rate strings must
 * never be compared literally — the platform treats them as opaque.
 */
export class CreateQueueDto extends OpIdDto {
  @IsIn(['simple', 'tree'])
  kind!: 'simple' | 'tree';

  @IsString()
  name!: string;

  /** Simple: target address/interface (e.g. "192.168.88.0/24"). */
  @IsOptional()
  @IsString()
  target?: string;

  /** Tree: parent queue name (e.g. "global"). Required for kind=tree. */
  @IsOptional()
  @IsString()
  parent?: string;

  /** Tree-only: packet mark this queue catches. */
  @IsOptional()
  @IsString()
  packetMark?: string;

  /** e.g. "5M/10M" */
  @IsOptional()
  @IsString()
  maxLimit?: string;

  @IsOptional()
  @IsString()
  limitAt?: string;

  /** 1..8 */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(8)
  priority?: number;

  @IsOptional()
  @IsBoolean()
  disabled?: boolean;

  @IsOptional()
  @IsString()
  comment?: string;
}

export class UpdateQueueDto extends OpIdDto {
  @IsOptional()
  @IsString()
  target?: string;

  @IsOptional()
  @IsString()
  parent?: string;

  @IsOptional()
  @IsString()
  packetMark?: string;

  @IsOptional()
  @IsString()
  maxLimit?: string;

  @IsOptional()
  @IsString()
  limitAt?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(8)
  priority?: number;

  @IsOptional()
  @IsBoolean()
  disabled?: boolean;

  @IsOptional()
  @IsString()
  comment?: string;
}

export class MoveQueueDto extends OpIdDto {
  /** Platform queue id to move this queue before. Omitted → move to top. */
  @IsOptional()
  @IsString()
  beforeId?: string;
}
