import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { Server, Socket, createServer } from 'node:net';
import { AddressInfo } from 'node:net';
import { FtpClient, ftpGet, ftpPut } from '../src/ftp.js';

/**
 * Minimal in-process FTP server speaking just the subset FtpClient uses:
 * USER/PASS/TYPE/PASV/RETR/STOR/QUIT. Lets the real client code run over
 * loopback TCP with no external dependencies.
 */
class FakeFtpServer {
  private server?: Server;
  readonly files = new Map<string, Buffer>();
  readonly seenPass = new Set<string>();
  port = 0;

  async start(): Promise<void> {
    this.server = createServer((control) => this.handleControl(control));
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    this.port = (this.server.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve, reject) =>
      this.server!.close((err) => (err ? reject(err) : resolve())),
    );
  }

  private send(control: Socket, line: string): void {
    control.write(`${line}\r\n`);
  }

  private handleControl(control: Socket): void {
    let buf = '';
    let data: DataChannel | undefined;
    this.send(control, '220 FakeFTP ready');
    control.on('data', (chunk: Buffer) => {
      buf += chunk.toString('latin1');
      let idx: number;
      while ((idx = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const next = this.onCommand(control, line, data);
        if (next) data = next;
      }
    });
    control.on('close', () => data?.close());
  }

  private onCommand(control: Socket, line: string, data: DataChannel | undefined): DataChannel | undefined {
    const [cmdRaw, ...rest] = line.split(' ');
    const cmd = (cmdRaw ?? '').toUpperCase();
    const arg = rest.join(' ');
    switch (cmd) {
      case 'USER':
        this.send(control, '331 need password');
        break;
      case 'PASS':
        this.seenPass.add(arg);
        this.send(control, '230 logged in');
        break;
      case 'TYPE':
        this.send(control, '200 type ok');
        break;
      case 'PASV': {
        const channel = new DataChannel();
        channel.listen(() => {
          const port = channel.port();
          const p1 = Math.floor(port / 256);
          const p2 = port % 256;
          this.send(control, `227 ok (127,0,0,1,${p1},${p2})`);
        });
        return channel;
      }
      case 'RETR': {
        const payload = this.files.get(arg);
        if (!payload) {
          this.send(control, '550 not found');
          break;
        }
        this.send(control, '150 opening data connection');
        data!.use((sock) => {
          sock.end(payload, () => {
            this.send(control, '226 transfer complete');
          });
        });
        break;
      }
      case 'STOR': {
        this.send(control, '150 opening data connection');
        data!.use((sock) => {
          const chunks: Buffer[] = [];
          sock.on('data', (c: Buffer) => chunks.push(c));
          sock.on('end', () => {
            this.files.set(arg, Buffer.concat(chunks));
            this.send(control, '226 transfer complete');
          });
        });
        break;
      }
      case 'QUIT':
        this.send(control, '221 bye');
        control.end();
        break;
      default:
        this.send(control, '502 not implemented');
    }
    return undefined;
  }
}

/**
 * A PASV data listener that buffers the incoming socket: the client opens
 * the data connection immediately after PASV, possibly before RETR/STOR is
 * processed, so the socket must be captured regardless of ordering.
 */
class DataChannel {
  private server?: Server;
  private socket?: Socket;
  private waiters: Array<(s: Socket) => void> = [];

  listen(onListening: () => void): void {
    this.server = createServer((sock: Socket) => {
      this.socket = sock;
      const waiters = this.waiters.splice(0);
      for (const w of waiters) w(sock);
    });
    this.server.listen(0, '127.0.0.1', onListening);
  }

  port(): number {
    return (this.server!.address() as AddressInfo).port;
  }

  use(fn: (s: Socket) => void): void {
    if (this.socket) fn(this.socket);
    else this.waiters.push(fn);
  }

  close(): void {
    this.server?.close();
  }
}

describe('FtpClient', () => {
  const server = new FakeFtpServer();
  beforeAll(async () => {
    server.files.set('backup.backup', Buffer.from('fake-backup-bytes'));
    await server.start();
  });
  afterAll(async () => server.stop());

  const opts = () => ({
    host: '127.0.0.1',
    port: server.port,
    user: 'admin',
    password: 'secret',
  });

  it('downloads a file (RETR)', async () => {
    const data = await ftpGet(opts(), 'backup.backup');
    expect(data.toString()).toBe('fake-backup-bytes');
    expect(server.seenPass.has('secret')).toBe(true);
  });

  it('uploads a file (STOR)', async () => {
    await ftpPut(opts(), 'upload.rsc', Buffer.from('/system identity set name=x\n'));
    expect(server.files.get('upload.rsc')?.toString()).toBe('/system identity set name=x\n');
  });

  it('fails cleanly on missing files', async () => {
    await expect(ftpGet(opts(), 'nope.backup')).rejects.toThrow(/550|RETR/);
  });

  it('supports an explicit client session', async () => {
    const client = await FtpClient.connect(opts());
    const data = await client.get('backup.backup');
    expect(data.length).toBeGreaterThan(0);
    await client.quit();
  });
});
