/**
 * @mtk/ros-api — zero-heavy-dependency TypeScript client for the MikroTik
 * RouterOS API (binary word protocol).
 *
 * - {@link RosConnection}: connect / login (both flows) / talk / reconnect w/ backoff
 * - {@link TcpTransport}: real TCP transport (needs reachable network; never used in tests)
 * - `commands/*`: typed sentence builders + reply parsers per domain
 *
 * Tests inject an in-memory {@link Transport} fake — fully hermetic, no network.
 */

export * from './protocol.js';
export * from './errors.js';
export * from './transport.js';
export * from './login.js';
export * from './connection.js';
export * from './commands/index.js';
export * as commands from './commands/index.js';
