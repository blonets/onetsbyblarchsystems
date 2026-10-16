# Technical Incidents, Root Causes & Architectural Solutions

This document logs critical production-level issues encountered during Phase 0 & Phase 1 implementation, their root causes, and the permanent architectural solutions implemented.

---

## 1. Hotspot Mutation Failure: `422 (Unprocessable Content) - has no device id yet`

### Symptoms
When attempting to modify (`PATCH`) or delete (`DELETE`) a hotspot user, profile, or server through the dashboard, the API responded with `422 Unprocessable Content`, stating that the item had no physical device ID assigned.

### Root Cause Analysis
1. **RouterOS API Protocol Contract**:
   When issuing `/ip/hotspot/user/add` or `/ip/hotspot/user-profile/add`, RouterOS responds with a completion sentence containing the newly created item ID in the `=ret=` attribute:
   ```text
   !done
   =ret=*15
   ```
   Standard response filters in `@mtk/ros-api` only gathered sentences where `type === 're'`, completely discarding attributes on `!done`. As a result, the worker reported `rows: []` back to BullMQ.
2. **Audit State Pointer Destruction**:
   When the worker called `audit.record` upon job completion, `AuditService.append()` in `apps/api/src/audit/audit.service.ts` replaced `existing.after` wholesale with `{ rows: 1, attempts: 1 }`. This destroyed the `entity: { table: 'hotspot-user', id: '...' }` pointer that `CommandsService.reconcileMirror()` relied on to locate the database record.
3. **Table Mapping Discrepancy**:
   `CommandsService.reconcileMirror()` only evaluated `hotspotUsers` when `entity.table === 'hotspot'`, ignoring `hotspot-server`, `hotspot-profile`, and `hotspot-user-profile`.

### The Solution
1. **Response Parser (`collectReplyRows`)**:
   Added `collectReplyRows()` in `apps/worker/src/jobs/commands.job.ts` and `apps/worker/src/jobs/safe-apply.ts` that explicitly inspects `!done` sentences and extracts `=ret=` into `.id`:
   ```typescript
   export function collectReplyRows(replies: Sentence[]): Record<string, string>[] {
     const rows = replyRows(replies);
     if (rows.length > 0) return rows;
     const done = replies.find((s) => s.type === 'done');
     const ret = done?.attrs['ret'];
     if (ret !== undefined) {
       return [{ '.id': ret, id: ret, ret }];
     }
     return [];
   }
   ```
2. **Deep-Merging in `AuditService.append`**:
   Updated `apps/api/src/audit/audit.service.ts` so updates merge existing metadata:
   ```typescript
   after: {
     ...(typeof existing.after === 'object' && existing.after ? (existing.after as object) : {}),
     ...(typeof input.after === 'object' && input.after ? (input.after as object) : {}),
   }
   ```
3. **Graceful Deletion for Unreconciled Entities**:
   Updated `apps/api/src/hotspot/hotspot.service.ts` to allow direct database deletion if `!row.mikrotikId`:
   ```typescript
   if (!row.mikrotikId) {
     await this.db.hotspotUsers.delete({ id });
     return;
   }
   ```

---

## 2. Telemetry Ingestion Failure: Metrics Dashboard Showing Zeros (`HTTP 500`)

### Symptoms
The Web dashboard Health Overview displayed zeros for CPU, memory, traffic, and hotspot active sessions, despite site routers being online and passing traffic.

### Root Cause Analysis
1. **NestJS ValidationPipe Whitelist Stripping**:
   In `apps/api/src/main.ts`, the global validation pipe was enabled with:
   ```typescript
   app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
   ```
   In `class-validator`, when `whitelist: true` is configured, any property without at least one validator decorator from `class-validator` is stripped from incoming request bodies.
2. In `apps/api/src/monitoring/monitoring.controller.ts`, metric DTOs had:
   ```typescript
   class CpuDto extends MetricPointDto {
     @IsString() routerId!: string;
     @Type(() => Number) cpuPct!: number; // MISSING @IsNumber()
   }
   ```
   Because `@Type(() => Number)` belongs to `class-transformer` (not `class-validator`), `ValidationPipe` stripped `cpuPct`, `totalKb`, `freeKb`, `rxBps`, `txBps`, and `activeN`.
3. In `PrismaMetricsStore.insertBatch`, values arrived as `undefined`. Prisma converted them to `null` in array unnest queries:
   ```sql
   INSERT INTO metric_cpu (ts, router_id, cpu_pct)
   SELECT * FROM unnest($1::timestamptz[], $2::text[], $3::float8[])
   ```
   Because `cpu_pct` is defined as `NOT NULL`, PostgreSQL rejected the query with error code `23502` (`not_null_violation`), causing the API to return `500 Internal Server Error`.

### The Solution
Added `@IsNumber()` from `class-validator` to all metric DTOs in `apps/api/src/monitoring/monitoring.controller.ts`:
```typescript
import { IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';

class CpuDto extends MetricPointDto {
  @IsString() routerId!: string;
  @IsNumber() @Type(() => Number) cpuPct!: number;
}
class MemDto extends MetricPointDto {
  @IsString() routerId!: string;
  @IsNumber() @Type(() => Number) totalKb!: number;
  @IsNumber() @Type(() => Number) freeKb!: number;
}
class TrafficDto extends MetricPointDto {
  @IsString() routerId!: string;
  @IsString() iface!: string;
  @IsNumber() @Type(() => Number) rxBps!: number;
  @IsNumber() @Type(() => Number) txBps!: number;
}
class HotspotActiveDto extends MetricPointDto {
  @IsString() routerId!: string;
  @IsNumber() @Type(() => Number) activeN!: number;
}
```

---

## 3. Worker Poller Timeout Gaps on Decommissioned Routers

### Symptoms
During worker polling ticks, the health monitor and metrics poller experienced 10-second delays attempting to connect to legacy test routers.

### Root Cause Analysis
Routers that were previously deleted in the UI were marked `status = 'offline'` rather than `'decommissioned'`, or had leftover records in the database. `RoutersService.listIdsForWorker()` filters for `status !== 'decommissioned'`. As a result, the worker attempted TCP connections to unreachable tunnel IPs (e.g. `10.200.0.3`).

### The Solution
1. Set obsolete test records in PostgreSQL to `status = 'decommissioned'` and recorded `decommissionedAt = NOW()`.
2. Verified `listIdsForWorker()` immediately narrowed the active polling list to currently connected routers only.

---

## 4. RouterOS Script Download Delay Race Condition

### Symptoms
On certain slower RouterOS devices, executing `/tool fetch ...; /import onboard.rsc` in immediate succession resulted in `expected end of command` or `file not found` errors.

### Root Cause Analysis
RouterOS v6.49 `/tool fetch` runs asynchronously in some firmware builds when chained with a semicolon, causing `/import` to attempt reading the file before disk write buffers flush.

### The Solution
Updated the canonical one-liner to insert a 2-second sleep delay between fetch and import:
```routeros
/tool fetch mode=https url="https://api.onetsbyblarch.online/api/v1/onboard/<TOKEN>/onboard.rsc" dst-path=onboard.rsc check-certificate=no; :delay 2s; /import onboard.rsc
```
This guarantees that file download has finished and disk writes are complete before RouterOS begins script parsing.
