/**
 * React Query hooks for every dashboard domain, typed against the ApiClient
 * (which itself is typed against @mtk/types).
 *
 * Conventions:
 * - query keys are namespaced arrays: ['routers'], ['router', id], ['firewall', routerId, table]…
 * - mutations invalidate their list/detail keys on settle;
 * - toggle/delete/reorder mutations are optimistic with rollback.
 */
'use client';

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  api,
  type FirewallChange,
  type FirewallRuleInput,
  type HotspotProfileInput,
  type HotspotUserInput,
  type HotspotUserProfileInput,
  type PlatformUserInput,
  type QueueInput,
  type RouterInput,
  type SiteInput,
} from './api-client';
import type {
  AlertRule,
  DownstreamDevice,
  FirewallTable,
  MetricRange,
  RouterFilters,
} from './types';

export const keys = {
  sites: ['sites'] as const,
  routers: (f?: RouterFilters) => ['routers', f ?? {}] as const,
  router: (id: string) => ['router', id] as const,
  routerResources: (id: string) => ['router', id, 'resources'] as const,
  hotspotServers: (r: string) => ['hotspot', r, 'servers'] as const,
  serverProfiles: (r: string) => ['hotspot', r, 'server-profiles'] as const,
  hotspotUsers: (r: string) => ['hotspot', r, 'users'] as const,
  userProfiles: (r: string) => ['hotspot', r, 'user-profiles'] as const,
  walledGarden: (r: string) => ['hotspot', r, 'walled-garden'] as const,
  walledGardenIp: (r: string) => ['hotspot', r, 'walled-garden-ip'] as const,
  firewall: (r: string, t: FirewallTable) => ['firewall', r, t] as const,
  simpleQueues: (r: string) => ['queues', r, 'simple'] as const,
  queueTree: (r: string) => ['queues', r, 'tree'] as const,
  metrics: (r: string, range: MetricRange) => ['metrics', r, range] as const,
  downtime: (r?: string) => ['monitoring', 'downtime', r ?? 'all'] as const,
  fleetHealth: ['monitoring', 'fleet-health'] as const,
  alertRules: ['monitoring', 'alert-rules'] as const,
  backups: (r?: string) => ['backups', r ?? 'all'] as const,
  backupPolicy: ['backups', 'policy'] as const,
  discovered: (r: string) => ['downstream', r, 'discovered'] as const,
  devices: (r?: string) => ['downstream', 'devices', r ?? 'all'] as const,
  platformUsers: ['admin', 'users'] as const,
  auditLog: (page: number) => ['admin', 'audit-log', page] as const,
  notificationChannels: ['admin', 'notification-channels'] as const,
  activeSessions: (r: string) => ['hotspot', r, 'active'] as const,
  sessionSearch: (q: string) => ['monitoring', 'session-search', q] as const,
  revenue: ['monitoring', 'revenue', 'today'] as const,
  firewallJournal: (r: string) => ['firewall', r, 'journal'] as const,
  wizardStatus: (r: string, opId: string) => ['provisioning', r, 'wizard', opId] as const,
};

/** Optimistic list mutation: apply `update` to the cached list immediately, roll back on error. */
function useOptimisticList<TItem, TVars>(
  listKey: readonly unknown[],
  mutationFn: (vars: TVars) => Promise<unknown>,
  update: (prev: TItem[], vars: TVars) => TItem[],
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: listKey });
      const previous = qc.getQueryData<TItem[]>(listKey);
      if (previous) qc.setQueryData<TItem[]>(listKey, update(previous, vars));
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(listKey, ctx.previous);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: listKey });
    },
  });
}

// ---------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------

export function useSites() {
  return useQuery({ queryKey: keys.sites, queryFn: () => api.listSites() });
}
export function useCreateSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SiteInput) => api.createSite(input),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.sites }),
  });
}
export function useUpdateSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<SiteInput> }) => api.updateSite(id, input),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.sites }),
  });
}
export function useDeleteSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteSite(id),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.sites }),
  });
}

// ---------------------------------------------------------------------------
// Routers
// ---------------------------------------------------------------------------

export function useRouters(filters?: RouterFilters) {
  return useQuery({ queryKey: keys.routers(filters), queryFn: () => api.listRouters(filters) });
}
export function useRouter(id: string) {
  return useQuery({ queryKey: keys.router(id), queryFn: () => api.getRouter(id), enabled: !!id });
}
export function useRouterResources(id: string, enabled = true) {
  return useQuery({
    queryKey: keys.routerResources(id),
    queryFn: () => api.getRouterResources(id),
    enabled: !!id && enabled,
    refetchInterval: 15_000,
  });
}
export function useCreateRouter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RouterInput) => api.createRouter(input),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['routers'] }),
  });
}
export function useUpdateRouter(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<RouterInput>) => api.updateRouter(id, input),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.router(id) });
      void qc.invalidateQueries({ queryKey: ['routers'] });
    },
  });
}
export function useDeleteRouter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteRouter(id),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['routers'] }),
  });
}
export function useRebootRouter() {
  return useMutation({ mutationFn: (id: string) => api.rebootRouter(id) });
}
export function useRotateRouterSecret() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.rotateRouterSecret(id),
    onSettled: (_d, _e, routerId) => void qc.invalidateQueries({ queryKey: keys.router(routerId) }),
  });
}
export function useIssueOnboardingToken() {
  return useMutation({
    mutationFn: ({ siteId, identity }: { siteId: string; identity: string }) =>
      api.issueOnboardingToken(siteId, identity),
  });
}
export function useOnboardingToken(token: string | null) {
  return useQuery({
    queryKey: ['onboarding-token', token],
    queryFn: () => (token ? api.getOnboardingToken(token) : null),
    enabled: Boolean(token),
    refetchInterval: (query) => (query.state.data?.usedAt ? false : 2000),
  });
}
export function usePreviewSetupWizard(routerId: string) {
  return useMutation({
    mutationFn: (input: import('./api-client').WizardPreviewRequest) => api.previewSetupWizard(routerId, input),
  });
}
export function useApplySetupWizard(routerId: string) {
  return useMutation({
    mutationFn: (opId: string) => api.applySetupWizard(routerId, opId),
  });
}
export function useSetupWizardStatus(routerId: string, opId: string | null) {
  return useQuery({
    queryKey: keys.wizardStatus(routerId, opId ?? ''),
    queryFn: () => api.getSetupWizardStatus(routerId, opId!),
    enabled: !!routerId && !!opId,
    // Poll while the run is active; stop once it reaches a terminal state.
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === 'done' || s === 'failed' ? false : 2000;
    },
  });
}
export function useBulkRouterOperation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ routerIds, operation }: { routerIds: string[]; operation: import('./types').BulkOperation }) =>
      api.bulkRouterOperation(routerIds, operation),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['routers'] }),
  });
}

// ---------------------------------------------------------------------------
// Hotspot
// ---------------------------------------------------------------------------

function hotspotCrud<TList, TInput, TUpdate>(
  listKey: (r: string) => readonly unknown[],
  list: (r: string) => Promise<TList[]>,
  create: (r: string, i: TInput) => Promise<TList>,
  update: (r: string, id: string, i: TUpdate) => Promise<TList>,
  remove: (r: string, id: string) => Promise<void>,
) {
  return {
    useList: (routerId: string, enabled = true) =>
      useQuery({ queryKey: listKey(routerId), queryFn: () => list(routerId), enabled: !!routerId && enabled }),
    useCreate: (routerId: string) => {
      const qc = useQueryClient();
      return useMutation({
        mutationFn: (input: TInput) => create(routerId, input),
        onSettled: () => void qc.invalidateQueries({ queryKey: listKey(routerId) }),
      });
    },
    useUpdate: (routerId: string) => {
      const qc = useQueryClient();
      return useMutation({
        mutationFn: ({ id, input }: { id: string; input: TUpdate }) => update(routerId, id, input),
        onSettled: () => void qc.invalidateQueries({ queryKey: listKey(routerId) }),
      });
    },
    useDelete: (routerId: string) => {
      const qc = useQueryClient();
      return useOptimisticList<TList, string>(listKey(routerId), (id) => remove(routerId, id), (prev, id) =>
        prev.filter((x) => (x as { id: string }).id !== id),
      );
    },
  };
}

export const hotspotServersApi = hotspotCrud(
  keys.hotspotServers,
  (r) => api.listHotspotServers(r),
  (r, i: { name: string; interface: string; profile?: string }) => api.createHotspotServer(r, i),
  (r, id, i: Partial<{ name: string; interface: string; profile?: string; disabled: boolean }>) =>
    api.updateHotspotServer(r, id, i),
  (r, id) => api.deleteHotspotServer(r, id),
);

export const serverProfilesApi = hotspotCrud(
  keys.serverProfiles,
  (r) => api.listServerProfiles(r),
  (r, i: HotspotProfileInput) => api.createServerProfile(r, i),
  (r, id, i: Partial<HotspotProfileInput>) => api.updateServerProfile(r, id, i),
  (r, id) => api.deleteServerProfile(r, id),
);

export const userProfilesApi = hotspotCrud(
  keys.userProfiles,
  (r) => api.listUserProfiles(r),
  (r, i: HotspotUserProfileInput) => api.createUserProfile(r, i),
  (r, id, i: Partial<HotspotUserProfileInput>) => api.updateUserProfile(r, id, i),
  (r, id) => api.deleteUserProfile(r, id),
);

export function useHotspotUsers(routerId: string, enabled = true) {
  return useQuery({
    queryKey: keys.hotspotUsers(routerId),
    queryFn: () => api.listHotspotUsers(routerId),
    enabled: !!routerId && enabled,
  });
}
export function useCreateHotspotUser(routerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: HotspotUserInput) => api.createHotspotUser(routerId, input),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.hotspotUsers(routerId) }),
  });
}
export function useUpdateHotspotUser(routerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<HotspotUserInput> }) =>
      api.updateHotspotUser(routerId, id, input),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.hotspotUsers(routerId) }),
  });
}
/** Optimistic enable/disable for hotspot users. */
export function useToggleHotspotUser(routerId: string) {
  const key = keys.hotspotUsers(routerId);
  return useOptimisticList<{ id: string; disabled: boolean }, { id: string; disabled: boolean }>(
    key,
    ({ id, disabled }) => api.updateHotspotUser(routerId, id, { disabled }),
    (prev, { id, disabled }) => prev.map((u) => (u.id === id ? { ...u, disabled } : u)),
  );
}
export function useDeleteHotspotUser(routerId: string) {
  const key = keys.hotspotUsers(routerId);
  return useOptimisticList<{ id: string }, string>(
    key,
    (id) => api.deleteHotspotUser(routerId, id),
    (prev, id) => prev.filter((u) => u.id !== id),
  );
}
export function useBulkImportHotspotUsers(routerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ csv, profile }: { csv: string; profile: string }) =>
      api.bulkImportHotspotUsers(routerId, csv, profile),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.hotspotUsers(routerId) }),
  });
}
export function useGenerateVoucherBatch(routerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: import('./api-client').VoucherBatchRequest) => api.generateVoucherBatch(routerId, input),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.hotspotUsers(routerId) }),
  });
}
export function useResetHotspotUserCounters(routerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.resetHotspotUserCounters(routerId, id),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.hotspotUsers(routerId) }),
  });
}

export function useWalledGarden(routerId: string) {
  return useQuery({ queryKey: keys.walledGarden(routerId), queryFn: () => api.listWalledGarden(routerId), enabled: !!routerId });
}
export function useCreateWalledGarden(routerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { dstHost: string; comment?: string }) => api.createWalledGarden(routerId, input),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.walledGarden(routerId) }),
  });
}
export function useDeleteWalledGarden(routerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteWalledGarden(routerId, id),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.walledGarden(routerId) }),
  });
}
export function useWalledGardenIp(routerId: string) {
  return useQuery({ queryKey: keys.walledGardenIp(routerId), queryFn: () => api.listWalledGardenIp(routerId), enabled: !!routerId });
}
export function useCreateWalledGardenIp(routerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { dstAddress: string; comment?: string }) => api.createWalledGardenIp(routerId, input),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.walledGardenIp(routerId) }),
  });
}
export function useDeleteWalledGardenIp(routerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteWalledGardenIp(routerId, id),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.walledGardenIp(routerId) }),
  });
}

// ---------------------------------------------------------------------------
// Firewall
// ---------------------------------------------------------------------------

export function useFirewallRules(routerId: string, table: FirewallTable, enabled = true) {
  return useQuery({
    queryKey: keys.firewall(routerId, table),
    queryFn: () => api.listFirewallRules(routerId, table),
    enabled: !!routerId && enabled,
  });
}
export function useCreateFirewallRule(routerId: string, table: FirewallTable) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: FirewallRuleInput) => api.createFirewallRule(routerId, table, input),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.firewall(routerId, table) }),
  });
}
export function useUpdateFirewallRule(routerId: string, table: FirewallTable) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ruleId, input }: { ruleId: string; input: Partial<FirewallRuleInput> }) =>
      api.updateFirewallRule(routerId, table, ruleId, input),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.firewall(routerId, table) }),
  });
}
/** Optimistic reorder (up/down). */
export function useMoveFirewallRule(routerId: string, table: FirewallTable) {
  const key = keys.firewall(routerId, table);
  return useOptimisticList<{ id: string }, { ruleId: string; direction: 'up' | 'down' }>(
    key,
    ({ ruleId, direction }) => api.moveFirewallRule(routerId, table, ruleId, direction),
    (prev, { ruleId, direction }) => {
      const i = prev.findIndex((r) => r.id === ruleId);
      const j = direction === 'up' ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    },
  );
}
/** Optimistic enable/disable. */
export function useToggleFirewallRule(routerId: string, table: FirewallTable) {
  const key = keys.firewall(routerId, table);
  return useOptimisticList<{ id: string; disabled: boolean }, { ruleId: string; disabled: boolean }>(
    key,
    ({ ruleId, disabled }) => api.toggleFirewallRule(routerId, table, ruleId, disabled),
    (prev, { ruleId, disabled }) => prev.map((r) => (r.id === ruleId ? { ...r, disabled } : r)),
  );
}
export function useDeleteFirewallRule(routerId: string, table: FirewallTable) {
  const key = keys.firewall(routerId, table);
  return useOptimisticList<{ id: string }, string>(
    key,
    (ruleId) => api.deleteFirewallRule(routerId, table, ruleId),
    (prev, ruleId) => prev.filter((r) => r.id !== ruleId),
  );
}
export function usePreviewFirewallChanges(routerId: string) {
  return useMutation({
    mutationFn: (changes: FirewallChange[]) => api.previewFirewallChanges(routerId, changes),
  });
}
export function useApplyFirewallChanges(routerId: string, table: FirewallTable) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ changes, safeApply }: { changes: FirewallChange[]; safeApply: boolean }) =>
      api.applyFirewallChanges(routerId, changes, safeApply),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.firewall(routerId, table) });
      void qc.invalidateQueries({ queryKey: keys.firewallJournal(routerId) });
    },
  });
}
export function useFirewallJournal(routerId: string, enabled = true) {
  return useQuery({
    queryKey: keys.firewallJournal(routerId),
    queryFn: () => api.listFirewallJournal(routerId),
    enabled: !!routerId && enabled,
  });
}
export function useRollbackFirewallJournal(routerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entryId: string) => api.rollbackFirewallJournal(routerId, entryId),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.firewallJournal(routerId) });
      void qc.invalidateQueries({ queryKey: ['firewall', routerId] });
    },
  });
}

// ---------------------------------------------------------------------------
// Queues
// ---------------------------------------------------------------------------

function queueCrud(
  listKey: (r: string) => readonly unknown[],
  list: (r: string) => Promise<import('./types').QueueItem[]>,
  create: (r: string, i: QueueInput) => Promise<import('./types').QueueItem>,
  update: (r: string, id: string, i: Partial<QueueInput>) => Promise<import('./types').QueueItem>,
  remove: (r: string, id: string) => Promise<void>,
) {
  return {
    useList: (routerId: string, enabled = true) =>
      useQuery({ queryKey: listKey(routerId), queryFn: () => list(routerId), enabled: !!routerId && enabled }),
    useCreate: (routerId: string) => {
      const qc = useQueryClient();
      return useMutation({
        mutationFn: (input: QueueInput) => create(routerId, input),
        onSettled: () => void qc.invalidateQueries({ queryKey: listKey(routerId) }),
      });
    },
    useUpdate: (routerId: string) => {
      const qc = useQueryClient();
      return useMutation({
        mutationFn: ({ id, input }: { id: string; input: Partial<QueueInput> }) => update(routerId, id, input),
        onSettled: () => void qc.invalidateQueries({ queryKey: listKey(routerId) }),
      });
    },
    useDelete: (routerId: string) => {
      const qc = useQueryClient();
      return useMutation({
        mutationFn: (id: string) => remove(routerId, id),
        onSettled: () => void qc.invalidateQueries({ queryKey: listKey(routerId) }),
      });
    },
  };
}

export const simpleQueuesApi = queueCrud(
  keys.simpleQueues,
  (r) => api.listSimpleQueues(r),
  (r, i) => api.createSimpleQueue(r, i),
  (r, id, i) => api.updateSimpleQueue(r, id, i),
  (r, id) => api.deleteSimpleQueue(r, id),
);
export const queueTreeApi = queueCrud(
  keys.queueTree,
  (r) => api.listQueueTree(r),
  (r, i) => api.createQueueTree(r, i),
  (r, id, i) => api.updateQueueTree(r, id, i),
  (r, id) => api.deleteQueueTree(r, id),
);

// ---------------------------------------------------------------------------
// Monitoring
// ---------------------------------------------------------------------------

export function useRouterMetrics(routerId: string, range: MetricRange) {
  return useQuery({
    queryKey: keys.metrics(routerId, range),
    queryFn: () => api.getRouterMetrics(routerId, range),
    enabled: !!routerId,
  });
}
export function useDowntime(routerId?: string) {
  return useQuery({ queryKey: keys.downtime(routerId), queryFn: () => api.getDowntime(routerId) });
}
export function useFleetHealth() {
  return useQuery({ queryKey: keys.fleetHealth, queryFn: () => api.getFleetHealth(), refetchInterval: 30_000 });
}
export function useAlertRules() {
  return useQuery({ queryKey: keys.alertRules, queryFn: () => api.listAlertRules() });
}
export function useCreateAlertRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<AlertRule, 'id'>) => api.createAlertRule(input),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.alertRules }),
  });
}
export function useUpdateAlertRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<AlertRule> }) => api.updateAlertRule(id, input),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.alertRules }),
  });
}
export function useDeleteAlertRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteAlertRule(id),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.alertRules }),
  });
}
export function useHotspotActiveSessions(routerId: string, enabled = true) {
  return useQuery({
    queryKey: keys.activeSessions(routerId),
    queryFn: () => api.listHotspotActiveSessions(routerId),
    enabled: !!routerId && enabled,
    refetchInterval: 15_000,
  });
}
export function useKickHotspotSession(routerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => api.kickHotspotSession(routerId, sessionId),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.activeSessions(routerId) }),
  });
}
export function useSearchHotspotSessions(q: string) {
  return useQuery({
    queryKey: keys.sessionSearch(q),
    queryFn: () => api.searchHotspotSessions(q),
    enabled: q.trim().length >= 2,
  });
}
export function useRevenueSummary() {
  return useQuery({
    queryKey: keys.revenue,
    queryFn: () => api.getRevenueSummary(),
    refetchInterval: 5 * 60_000,
  });
}

// ---------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------

export function useBackups(routerId?: string) {
  return useQuery({ queryKey: keys.backups(routerId), queryFn: () => api.listBackups(routerId) });
}
export function useBackupPolicy() {
  return useQuery({ queryKey: keys.backupPolicy, queryFn: () => api.getBackupPolicy() });
}
export function useTriggerBackup() {
  const qc: QueryClient = useQueryClient();
  return useMutation({
    mutationFn: (routerId: string) => api.triggerBackup(routerId),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['backups'] }),
  });
}
export function useRestoreBackup() {
  return useMutation({ mutationFn: (backupId: string) => api.restoreBackup(backupId) });
}

// ---------------------------------------------------------------------------
// Downstream devices
// ---------------------------------------------------------------------------

export function useDiscoveredDevices(routerId: string, enabled = true) {
  return useQuery({
    queryKey: keys.discovered(routerId),
    queryFn: () => api.listDiscoveredDevices(routerId),
    enabled: !!routerId && enabled,
  });
}
export function useRescanDevices(routerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.rescanDevices(routerId),
    onSettled: (data) => {
      if (data) qc.setQueryData(keys.discovered(routerId), data);
    },
  });
}
export function useDownstreamDevices(routerId?: string) {
  return useQuery({ queryKey: keys.devices(routerId), queryFn: () => api.listDownstreamDevices(routerId) });
}
export function useEnableRemoteAccess(routerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { ipAddress: string; label: string; kind: DownstreamDevice['kind']; servicePort: number }) =>
      api.enableRemoteAccess(routerId, input.ipAddress, input.label, input.kind, input.servicePort),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.devices(routerId) });
      void qc.invalidateQueries({ queryKey: keys.devices(undefined) });
    },
  });
}
export function useDisableRemoteAccess(routerId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (deviceId: string) => api.disableRemoteAccess(deviceId),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.devices(routerId) });
      void qc.invalidateQueries({ queryKey: keys.devices(undefined) });
    },
  });
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export function usePlatformUsers() {
  return useQuery({ queryKey: keys.platformUsers, queryFn: () => api.listPlatformUsers() });
}
export function useCreatePlatformUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PlatformUserInput) => api.createPlatformUser(input),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.platformUsers }),
  });
}
export function useUpdatePlatformUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<PlatformUserInput> }) => api.updatePlatformUser(id, input),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.platformUsers }),
  });
}
export function useDeletePlatformUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deletePlatformUser(id),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.platformUsers }),
  });
}
export function useAuditLog(page: number) {
  return useQuery({ queryKey: keys.auditLog(page), queryFn: () => api.listAuditLog(page, 25) });
}
export function useNotificationChannels() {
  return useQuery({ queryKey: keys.notificationChannels, queryFn: () => api.getNotificationChannels() });
}
export function useUpdateNotificationChannels() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<{ telegramEnabled: boolean; emailEnabled: boolean }>) =>
      api.updateNotificationChannels(input),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.notificationChannels }),
  });
}
