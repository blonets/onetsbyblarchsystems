import { Transport } from './transport.js';
import { ReplySentence, parseReply } from './protocol.js';
import {
  legacyAnswerSentence,
  legacyChallengeSentence,
  legacyResponse,
  modernLoginSentence,
} from './login.js';
import { RosFatalError, RosLoginError, RosTrapError } from './errors.js';

export type LoginMode = 'auto' | 'modern' | 'legacy';

export interface BackoffOptions {
  /** total attempts including the first (default 5) */
  maxAttempts?: number;
  /** base delay in ms, doubled each retry (default 500) */
  baseMs?: number;
  /** cap for the delay in ms (default 30_000) */
  maxMs?: number;
  /** randomize delays (default true); set false for deterministic tests */
  jitter?: boolean;
  /** re-authenticate after a reconnect (the API session does not survive one) */
  onReconnect?: () => Promise<void>;
}

export interface ConnectionOptions {
  /** 'auto' tries modern first, then falls back to the legacy challenge flow */
  loginMode?: LoginMode;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * High-level RouterOS API session over an injectable {@link Transport}.
 *
 * Usage:
 * ```ts
 * const conn = new RosConnection(new TcpTransport({ host, port }));
 * await conn.connect();
 * await conn.login(user, pass);          // auto: modern, fallback to legacy
 * const rows = replyRows(await conn.talk(hotspotUserList()));
 * await conn.close();
 * ```
 */
export class RosConnection {
  private readonly loginMode: LoginMode;

  constructor(
    private readonly transport: Transport,
    options: ConnectionOptions = {},
  ) {
    this.loginMode = options.loginMode ?? 'auto';
  }

  get connected(): boolean {
    return this.transport.isConnected();
  }

  /** Forward transport close notifications (used by the worker's downtime ledger). */
  onTransportClose(cb: () => void): void {
    this.transport.onClose(cb);
  }

  async connect(): Promise<void> {
    await this.transport.connect();
  }

  async close(): Promise<void> {
    await this.transport.disconnect();
  }

  /**
   * Log in. In `auto` mode a `!trap` on the modern flow falls back to the
   * legacy MD5 challenge-response flow (pre-6.43 devices). Any other error —
   * including a trap on the legacy flow — is rethrown as-is.
   */
  async login(username: string, password: string): Promise<void> {
    if (this.loginMode === 'legacy') {
      await this.loginLegacy(username, password);
      return;
    }
    try {
      await this.loginModern(username, password);
    } catch (err) {
      if (this.loginMode === 'modern' || !(err instanceof RosTrapError)) throw err;
      await this.loginLegacy(username, password);
    }
  }

  private async loginModern(username: string, password: string): Promise<void> {
    const replies = await this.talkRaw(modernLoginSentence(username, password));
    assertOk(replies, 'modern login');
  }

  private async loginLegacy(username: string, password: string): Promise<void> {
    const challengeReplies = await this.talkRaw(legacyChallengeSentence());
    assertOk(challengeReplies, 'legacy login challenge');
    const challenge = challengeReplies.find((r) => r.type === 'done')?.attrs['ret'];
    if (!challenge) throw new RosLoginError('legacy login: device did not return a challenge');
    const replies = await this.talkRaw(
      legacyAnswerSentence(username, legacyResponse(password, challenge)),
    );
    assertOk(replies, 'legacy login');
  }

  /**
   * Send one command sentence and collect reply sentences until the terminal
   * `!done` / `!trap` / `!fatal`. Throws {@link RosTrapError} / {@link RosFatalError}
   * on rejection.
   */
  async talk(words: string[]): Promise<ReplySentence[]> {
    const replies = await this.talkRaw(words);
    const last = replies[replies.length - 1];
    if (last?.type === 'trap') {
      throw new RosTrapError(last.attrs['message'] ?? 'command rejected (!trap)', last.attrs);
    }
    if (last?.type === 'fatal') {
      throw new RosFatalError(last.attrs['message'] ?? 'fatal API error', last.attrs);
    }
    return replies;
  }

  /** Raw talk: no trap/fatal translation, used internally by the login flows. */
  private async talkRaw(words: string[]): Promise<ReplySentence[]> {
    await this.transport.sendSentence(words);
    const replies: ReplySentence[] = [];
    for (;;) {
      const sentence = await this.transport.readSentence();
      const reply = parseReply(sentence);
      replies.push(reply);
      if (reply.type !== 're') return replies;
    }
  }

  /**
   * Run `op`, reconnecting the transport with exponential backoff on failure.
   * After a reconnect, `onReconnect` runs (re-login) before retrying `op`.
   */
  async withReconnect<T>(op: (conn: this) => Promise<T>, backoff: BackoffOptions = {}): Promise<T> {
    const maxAttempts = backoff.maxAttempts ?? 5;
    const baseMs = backoff.baseMs ?? 500;
    const maxMs = backoff.maxMs ?? 30_000;
    const jitter = backoff.jitter ?? true;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        if (!this.transport.isConnected()) {
          await this.transport.connect();
          if (backoff.onReconnect) await backoff.onReconnect();
        }
        return await op(this);
      } catch (err) {
        lastError = err;
        try {
          await this.transport.disconnect();
        } catch {
          // ignore teardown errors during backoff
        }
        if (attempt === maxAttempts) break;
        const delay = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
        await sleep(jitter ? delay * (0.5 + Math.random() * 0.5) : delay);
      }
    }
    throw lastError;
  }
}

function assertOk(replies: ReplySentence[], what: string): void {
  const last = replies[replies.length - 1];
  if (last?.type === 'trap') {
    throw new RosTrapError(last.attrs['message'] ?? `${what} rejected (!trap)`, last.attrs);
  }
  if (last?.type === 'fatal') {
    throw new RosFatalError(last.attrs['message'] ?? `${what} fatal error`, last.attrs);
  }
  if (last?.type !== 'done') {
    throw new RosLoginError(`${what}: unexpected terminal reply ${last?.type}`);
  }
}
