import { Socket } from 'node:net';
import { encodeSentence, readSentence } from './protocol.js';
import { RosTimeoutError } from './errors.js';

/**
 * Message-oriented transport. The real implementation frames sentences over a
 * TCP socket; tests inject an in-memory fake. This keeps every test hermetic —
 * no network access is ever needed to exercise the protocol or login flows.
 */
export interface Transport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  sendSentence(words: string[]): Promise<void>;
  readSentence(): Promise<string[]>;
  /** Fired once when the underlying connection drops. */
  onClose(cb: () => void): void;
}

export interface TcpTransportOptions {
  host: string;
  /**
   * Port to connect to. ALWAYS pass the router's `apiPort` from its Router
   * record (e.g. the hub CHR vs. a site router may differ) — the
   * `ROS_DEFAULT_PORTS.api` fallback below only applies to ad-hoc use where
   * no record exists. No call site in this codebase may hard-code a port.
   */
  port?: number;
  connectTimeoutMs?: number;
  tls?: boolean;
}

/**
 * RouterOS factory-default service ports, for reference.
 * ros-api never hard-codes a port at a call site: callers pass the router
 * record's ports via {@link TcpTransportOptions}; these defaults only apply
 * when the caller passes nothing (ad-hoc scripts / tests).
 */
export const ROS_DEFAULT_PORTS = {
  api: 8728,
  apiSsl: 8729,
  winbox: 8291,
  ssh: 22,
  telnet: 23,
  ftp: 21,
  www: 80,
} as const;

/** @deprecated use `ROS_DEFAULT_PORTS.api` */
export const DEFAULT_API_PORT = ROS_DEFAULT_PORTS.api;

/**
 * TCP transport for the RouterOS API.
 *
 * NOTE: the sandbox blocks raw TCP to arbitrary hosts, so this class is never
 * exercised against real devices here — it is covered indirectly through the
 * Transport interface by the fake-transport unit tests, and runs for real on
 * the deployment VPS / inside Dokploy where the tunnel network is reachable.
 */
export class TcpTransport implements Transport {
  private socket?: Socket;
  private byteQueue: number[] = [];
  private byteWaiters: Array<(b: number) => void> = [];
  private closeCbs: Array<() => void> = [];
  private connectedFlag = false;

  constructor(private readonly options: TcpTransportOptions) {
    if (options.tls) {
      throw new Error('TODO: API-SSL (tls) transport not implemented yet — use plaintext API inside the SSTP tunnel');
    }
  }

  isConnected(): boolean {
    return this.connectedFlag;
  }

  async connect(): Promise<void> {
    if (this.connectedFlag) return;
    const port = this.options.port ?? ROS_DEFAULT_PORTS.api;
    await new Promise<void>((resolve, reject) => {
      const socket = new Socket();
      let settled = false;
      const timeoutMs = this.options.connectTimeoutMs ?? 10_000;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          socket.destroy();
          reject(new RosTimeoutError(`connect to ${this.options.host}:${port} timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);
      const done = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) reject(err);
        else resolve();
      };
      socket.once('error', (err) => done(err));
      socket.connect({ host: this.options.host, port }, () => {
        socket.removeAllListeners('error');
        socket.on('error', () => this.handleClose());
        socket.on('close', () => this.handleClose());
        socket.on('data', (chunk: Buffer) => this.pushBytes(chunk));
        this.socket = socket;
        this.connectedFlag = true;
        done();
      });
    });
  }

  async disconnect(): Promise<void> {
    this.handleClose();
    const socket = this.socket;
    this.socket = undefined;
    if (socket && !socket.destroyed) {
      await new Promise<void>((resolve) => {
        socket.once('close', () => resolve());
        socket.destroy();
        setImmediate(() => resolve()); // never hang if 'close' already fired
      });
    }
  }

  onClose(cb: () => void): void {
    this.closeCbs.push(cb);
  }

  async sendSentence(words: string[]): Promise<void> {
    const socket = this.socket;
    if (!socket || !this.connectedFlag) throw new Error('not connected');
    const bytes = encodeSentence(words);
    await new Promise<void>((resolve, reject) => {
      socket.write(bytes, (err) => (err ? reject(err) : resolve()));
    });
  }

  async readSentence(): Promise<string[]> {
    return readSentence({ readByte: () => this.readByte() });
  }

  private readByte(): Promise<number> {
    const queued = this.byteQueue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (!this.connectedFlag) return Promise.resolve(-1);
    return new Promise<number>((resolve) => {
      this.byteWaiters.push(resolve);
    });
  }

  private pushBytes(chunk: Buffer): void {
    for (const b of chunk) {
      const waiter = this.byteWaiters.shift();
      if (waiter) waiter(b);
      else this.byteQueue.push(b);
    }
  }

  private handleClose(): void {
    if (!this.connectedFlag) return;
    this.connectedFlag = false;
    const waiters = this.byteWaiters.splice(0);
    for (const w of waiters) w(-1);
    const cbs = this.closeCbs.splice(0);
    for (const cb of cbs) {
      try {
        cb();
      } catch {
        // listener errors must not break teardown
      }
    }
  }
}
