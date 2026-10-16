import { createHash } from 'node:crypto';

/**
 * Both RouterOS login flows.
 *
 * - RouterOS >= 6.43 / v7 ("modern"): `/login =name=<user> =password=<pass>`
 *   answered with a single `!done`.
 * - Older RouterOS ("legacy", pre-6.43): `/login` returns `!done =ret=<challenge>`,
 *   then the client replies with
 *   `/login =name=<user> =response=00<md5hex>` where
 *   `md5hex = MD5( 0x00 || password || challengeBytes )`.
 */

/** Sentence for the modern (6.43+/v7) direct login. */
export function modernLoginSentence(username: string, password: string): string[] {
  return ['/login', `=name=${username}`, `=password=${password}`];
}

/** Sentence requesting the legacy login challenge. */
export function legacyChallengeSentence(): string[] {
  return ['/login'];
}

/**
 * Compute the legacy challenge-response value.
 * `=response=` + "00" + hex(md5(0x00 + password + challenge)).
 */
export function legacyResponse(password: string, challengeHex: string): string {
  const challenge = Buffer.from(challengeHex, 'hex');
  const digest = createHash('md5')
    .update(Buffer.concat([Buffer.from([0]), Buffer.from(password, 'utf8'), challenge]))
    .digest('hex');
  return `00${digest}`;
}

/** Sentence answering the legacy login challenge. */
export function legacyAnswerSentence(username: string, response: string): string[] {
  return ['/login', `=name=${username}`, `=response=${response}`];
}
