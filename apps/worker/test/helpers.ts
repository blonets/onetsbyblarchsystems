/**
 * Shared fakes for worker unit tests: scripted ros-api transports and a
 * minimal in-process FTP server. No network access needed.
 */

import type { Transport } from '@mtk/ros-api';

/** Scripted in-memory transport: answers sentences from a handler map. */
export class ScriptedTransport implements Transport {
  readonly sent: string[][] = [];
  private pending: string[][] = [];
  private closeCbs: Array<() => void> = [];
  private connectedFlag = false;

  constructor(
    private readonly handler: (words: string[]) => string[][] | Promise<string[][]>,
    private readonly onDrop?: () => void,
  ) {}

  async connect(): Promise<void> {
    this.connectedFlag = true;
  }
  async disconnect(): Promise<void> {
    this.connectedFlag = false;
  }
  isConnected(): boolean {
    return this.connectedFlag;
  }
  onClose(cb: () => void): void {
    this.closeCbs.push(cb);
  }
  async sendSentence(words: string[]): Promise<void> {
    this.sent.push(words);
    // copy: handlers may return shared fixture arrays and readSentence shift()s
    this.pending = (await this.handler(words)).map((s) => [...s]);
  }
  async readSentence(): Promise<string[]> {
    return this.pending.shift() ?? ['!done'];
  }

  /** Simulate the network dropping underneath the session. */
  drop(): void {
    this.connectedFlag = false;
    const cbs = this.closeCbs.splice(0);
    for (const cb of cbs) cb();
    this.onDrop?.();
  }
}

/** Answer map: command path → full reply sequence. */
export function mapHandler(map: Record<string, string[][]>) {
  return (words: string[]): string[][] => {
    const hit = map[words[0] ?? ''];
    if (!hit) throw new Error(`unexpected command: ${(words[0] ?? '').toString()}`);
    return hit;
  };
}

export const done = (): string[][] => [['!done']];

export const reDone = (rows: Array<Record<string, string>>): string[][] => [
  ...rows.map((r) => [
    '!re',
    ...Object.entries(r).map(([k, v]) => `=${k}=${v}`),
  ]),
  ['!done'],
];

export const trap = (message: string): string[][] => [['!trap', `=message=${message}`]];
