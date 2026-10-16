/**
 * CORS origins for the API (REST) and the Socket.IO gateway.
 *
 * Env-driven via `CORS_ORIGINS` (comma-separated). Defaults cover local dev;
 * production MUST set it to the panel host(s), e.g.
 * `CORS_ORIGINS=https://admin.onetsbyblarch.online`.
 */

/** Local-dev defaults (web on :3000, api on :3001). */
const DEV_DEFAULTS = ['http://localhost:3000', 'http://localhost:3001'];

export function getCorsOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS;
  if (!raw || !raw.trim()) return [...DEV_DEFAULTS];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function getCorsOptions(): {
  origin: string[];
  credentials: boolean;
  methods: string[];
} {
  return {
    origin: getCorsOrigins(),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  };
}
