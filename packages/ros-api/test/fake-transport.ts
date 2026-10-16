import type { Transport } from '../src/transport.js';

/**
 * In-memory {@link Transport} fake. Script replies per sent sentence —
 * every unit test in this package runs against it; no network is ever touched.
 */
export class FakeTransport implements Transport {
  /** every sentence the code under test sent, in order */
  readonly sent: string[][] = [];

  private replyQueue: string[][] = [];
  private responder: (sent: string[]) => string[][] = () => [[ '!done' ]];
  private closeCbs: Array<() => void> = [];
  private connectedFlag = false;
  /** fail the next N connect() calls with this error */
  failNextConnects = 0;
  connectAttempts = 0;

  /** Set the responder: maps each sent sentence to its reply sentences. */
  respondWith(fn: (sent: string[]) => string[][]): this {
    this.responder = fn;
    return this;
  }

  /** Queue raw reply sentences (bypasses the responder). */
  enqueueReplies(sentences: string[][]): this {
    this.replyQueue.push(...sentences);
    return this;
  }

  /** Simulate the network dropping: fires onClose listeners. */
  simulateClose(): void {
    if (!this.connectedFlag) return;
    this.connectedFlag = false;
    const cbs = this.closeCbs.splice(0);
    for (const cb of cbs) cb();
  }

  async connect(): Promise<void> {
    this.connectAttempts++;
    if (this.failNextConnects > 0) {
      this.failNextConnects--;
      throw new Error('fake connect failure');
    }
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
    if (!this.connectedFlag) throw new Error('fake transport: not connected');
    this.sent.push(words);
    this.replyQueue.push(...this.responder(words));
  }

  async readSentence(): Promise<string[]> {
    const next = this.replyQueue.shift();
    if (!next) throw new Error('fake transport: no scripted reply — responder returned nothing');
    return next;
  }
}

/** Build a fake whose responder is a static map of command -> replies. */
export function scriptedTransport(script: Record<string, string[][]>): FakeTransport {
  return new FakeTransport().respondWith((sent) => script[sent[0] ?? ''] ?? [['!done']]);
}
