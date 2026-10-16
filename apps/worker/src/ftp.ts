/**
 * Minimal FTP client (passive mode) for backup file retrieval.
 *
 * RouterOS `.backup` files cannot be fetched over the binary API protocol —
 * they are retrieved over FTP from the router's FTP service (port comes from
 * the router record's `ftpPort`; the hub CHR runs FTP on 8921). This client
 * implements just enough of RFC 959 for RETR (download) and STOR (upload):
 * USER/PASS login, TYPE I, PASV, RETR/STOR, QUIT.
 *
 * Credentials are passed in at call time from the vaulted router record —
 * never logged (the PASS command is redacted in debug output).
 */

import { Socket } from 'node:net';

export interface FtpOptions {
  host: string;
  port?: number; // default 21; pass the router's ftpPort
  user: string;
  password: string;
  connectTimeoutMs?: number;
  /**
   * Connect the PASV data socket to `host` (the control host) instead of the
   * address the server advertises in its PASV reply (default true).
   *
   * RouterOS devices behind NAT report their internal address in PASV
   * (live-observed: a CHR advertising 10.164.0.5 while reached via its public
   * IP), which is unroutable from the platform. The control host is always
   * the address we actually reached, so it is the correct data target for
   * this fleet. Set false for spec-strict behavior against well-behaved
   * servers.
   */
  useControlHostForData?: boolean;
  debug?: (line: string) => void;
}

class FtpProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FtpProtocolError';
  }
}

interface FtpResponse {
  code: number;
  lines: string[];
}

export class FtpClient {
  private socket?: Socket;
  private buffer = '';
  private readonly queue: Array<{
    resolve: (r: FtpResponse) => void;
    reject: (e: Error) => void;
    lines: string[];
  }> = [];
  private readonly debug?: (line: string) => void;

  private constructor(private readonly options: FtpOptions) {
    this.debug = options.debug;
  }

  static async connect(options: FtpOptions): Promise<FtpClient> {
    const client = new FtpClient(options);
    await client.open();
    const greeting = await client.readResponse();
    if (greeting.code !== 220) throw new FtpProtocolError(`bad greeting: ${greeting.lines[0]}`);
    await client.login();
    return client;
  }

  private open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new Socket();
      const timeoutMs = this.options.connectTimeoutMs ?? 10_000;
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`FTP connect to ${this.options.host}:${this.options.port ?? 21} timed out`));
      }, timeoutMs);
      socket.on('error', (err) => {
        clearTimeout(timer);
        this.failAll(err);
        reject(err);
      });
      socket.on('close', () => this.failAll(new Error('FTP connection closed')));
      socket.on('data', (chunk: Buffer) => this.onData(chunk));
      socket.connect(this.options.port ?? 21, this.options.host, () => {
        clearTimeout(timer);
        this.socket = socket;
        resolve();
      });
    });
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString('latin1');
    this.pump();
  }

  private pump(): void {
    for (;;) {
      const idx = this.buffer.indexOf('\r\n');
      if (idx < 0) return;
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      const pending = this.queue[0];
      // collect multi-line replies (code followed by '-')
      const m = /^(\d{3})([ -])(.*)$/.exec(line);
      if (!m || !pending) continue;
      const code = Number(m[1]);
      pending.lines.push(line);
      if (m[2] === ' ') {
        this.queue.shift();
        pending.resolve({ code, lines: pending.lines });
      } else {
        // continuation: keep the same pending entry, remember expected code
        (pending as { expected?: number }).expected = code;
      }
    }
  }

  private failAll(err: Error): void {
    const q = this.queue.splice(0);
    for (const p of q) p.reject(err);
  }

  private readResponse(): Promise<FtpResponse> {
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject, lines: [] });
    });
  }

  private async command(cmd: string, expect: number | number[], redact = false): Promise<FtpResponse> {
    this.debug?.(redact ? cmd.replace(/PASS .*/, 'PASS ***') : cmd);
    this.socket!.write(`${cmd}\r\n`);
    const res = await this.readResponse();
    this.debug?.(`< ${res.lines.join(' / ')}`);
    const codes = Array.isArray(expect) ? expect : [expect];
    if (!codes.includes(res.code)) {
      throw new FtpProtocolError(`FTP ${cmd.split(' ')[0]} failed: ${res.lines.join(' ')}`);
    }
    return res;
  }

  private async login(): Promise<void> {
    const userRes = await this.command(`USER ${this.options.user}`, [230, 331]);
    if (userRes.code === 331) {
      await this.command(`PASS ${this.options.password}`, [230, 202], true).catch(
        (err: Error) => {
          throw new Error(`FTP login failed for ${this.options.user}: ${err.message}`);
        },
      );
    }
    await this.command('TYPE I', 200);
  }

  /** Parse the PASV response into a data-connection host/port. */
  private async passiveEndpoint(): Promise<{ host: string; port: number }> {
    const res = await this.command('PASV', 227);
    const m = /\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/.exec(res.lines.join(' '));
    if (!m) throw new FtpProtocolError(`cannot parse PASV response: ${res.lines[0]}`);
    const useControlHost = this.options.useControlHostForData ?? true;
    return {
      host: useControlHost
        ? this.options.host
        : `${m[1]}.${m[2]}.${m[3]}.${m[4]}`,
      port: Number(m[5]) * 256 + Number(m[6]),
    };
  }

  private openDataConnection(ep: { host: string; port: number }): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const s = new Socket();
      const timer = setTimeout(() => {
        s.destroy();
        reject(new Error('FTP data connection timed out'));
      }, 15_000);
      s.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      s.connect(ep.port, ep.host, () => {
        clearTimeout(timer);
        resolve(s);
      });
    });
  }

  /** Download a file (RETR). Returns the raw bytes. */
  async get(remotePath: string): Promise<Buffer> {
    const data = await this.openDataConnection(await this.passiveEndpoint());
    const chunks: Buffer[] = [];
    const done = new Promise<void>((resolve, reject) => {
      data.on('data', (c: Buffer) => chunks.push(c));
      data.on('end', () => resolve());
      data.on('error', reject);
    });
    await this.command(`RETR ${remotePath}`, [150, 125]);
    await done;
    await this.readResponse().then((res) => {
      if (res.code !== 226 && res.code !== 250) {
        throw new FtpProtocolError(`RETR completion failed: ${res.lines.join(' ')}`);
      }
    });
    return Buffer.concat(chunks);
  }

  /** Upload a file (STOR). Used by the restore job. */
  async put(remotePath: string, data: Uint8Array): Promise<void> {
    const sock = await this.openDataConnection(await this.passiveEndpoint());
    await this.command(`STOR ${remotePath}`, [150, 125]);
    await new Promise<void>((resolve, reject) => {
      sock.on('error', reject);
      sock.end(data, () => resolve());
    });
    const res = await this.readResponse();
    if (res.code !== 226 && res.code !== 250) {
      throw new FtpProtocolError(`STOR completion failed: ${res.lines.join(' ')}`);
    }
  }

  async quit(): Promise<void> {
    try {
      await this.command('QUIT', [221, 226]);
    } finally {
      this.socket?.destroy();
      this.socket = undefined;
    }
  }
}

/**
 * Convenience: download one file and close. Used by the backup job to fetch
 * `.backup` files from the router's FTP service.
 */
export async function ftpGet(options: FtpOptions, remotePath: string): Promise<Buffer> {
  const client = await FtpClient.connect(options);
  try {
    return await client.get(remotePath);
  } finally {
    await client.quit().catch(() => undefined);
  }
}

/** Convenience: upload one file and close. Used by the restore job. */
export async function ftpPut(
  options: FtpOptions,
  remotePath: string,
  data: Uint8Array,
): Promise<void> {
  const client = await FtpClient.connect(options);
  try {
    await client.put(remotePath, data);
  } finally {
    await client.quit().catch(() => undefined);
  }
}
