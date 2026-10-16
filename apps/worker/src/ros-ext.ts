/**
 * Typed RouterOS API sentence builders for domains not yet covered by
 * `@mtk/ros-api`'s command builders (interface monitor, hotspot active,
 * files, import/backup-load, neighbor discovery).
 *
 * These are structured builders — no raw string munging: each returns a word
 * array built with ros-api's `setWords`/`queryWords`/`idWord` helpers.
 * TODO(ros-api): migrate these into `packages/ros-api/src/commands/` so app
 * code keeps a single builder source of truth.
 */

import { idWord, queryWords, setWords } from '@mtk/ros-api';

/** One snapshot of interface traffic (the `=once` flag makes it non-streaming). */
export const interfaceMonitorTrafficOnce = (iface?: string): string[] => [
  '/interface/monitor-traffic',
  ...setWords({ interface: iface, once: true }),
];

export interface InterfaceTrafficSample {
  name?: string;
  'rx-bits-per-second'?: string;
  'tx-bits-per-second'?: string;
  'rx-bytes'?: string;
  'tx-bytes'?: string;
  'rx-packets'?: string;
  'tx-packets'?: string;
  [key: string]: string | undefined;
}

/** Hotspot active sessions (`/ip/hotspot/active/print`). */
export const hotspotActiveList = (filter: Record<string, string> = {}): string[] => [
  '/ip/hotspot/active/print',
  ...queryWords(filter),
];

export interface HotspotActiveSession {
  '.id'?: string;
  user?: string;
  address?: string;
  uptime?: string;
  'session-time-left'?: string;
  'bytes-in'?: string;
  'bytes-out'?: string;
  [key: string]: string | undefined;
}

/** Kick a hotspot session. */
export const hotspotActiveRemove = (id: string): string[] => [
  '/ip/hotspot/active/remove',
  idWord(id),
];

/** List files on the device (`/file/print`). */
export const filePrint = (filter: Record<string, string> = {}): string[] => [
  '/file/print',
  ...queryWords(filter),
];

/** Remove a file from the device (`/file/remove`). */
export const fileRemove = (id: string): string[] => ['/file/remove', idWord(id)];

/** Import a text export (`/import file-name=<f>`). */
export const importFile = (fileName: string): string[] => [
  '/import',
  ...setWords({ 'file-name': fileName }),
];

/** Load a binary backup (`/system/backup/load name=<f>`); reboots the router. */
export const backupLoad = (name: string): string[] => [
  '/system/backup/load',
  ...setWords({ name }),
];

/** Neighbor discovery (`/ip/neighbor/print`) for downstream-device discovery. */
export const ipNeighborPrint = (): string[] => ['/ip/neighbor/print'];

/** Lightweight health-ping sentence: small reply, no side effects. */
export const healthPing = (): string[] => ['/system/identity/print'];

/** System user list (`/user/print`) — for API-password rotation. */
export const systemUserList = (filter: Record<string, string> = {}): string[] => [
  '/user/print',
  ...queryWords(filter),
];

/** Set a system user's password (`/user/set =.id=<id> =password=<new>`). */
export const systemUserSetPassword = (id: string, password: string): string[] => [
  '/user/set',
  idWord(id),
  ...setWords({ password }),
];
