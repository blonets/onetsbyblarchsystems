/** Typed errors for the RouterOS API client. */

export class RosError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RosError';
  }
}

/** The device answered with `!trap` — the command was rejected. */
export class RosTrapError extends RosError {
  /** Raw `=key=value` attributes of the trap sentence (e.g. message, category). */
  readonly attrs: Record<string, string>;

  constructor(message: string, attrs: Record<string, string> = {}) {
    super(message);
    this.name = 'RosTrapError';
    this.attrs = attrs;
  }
}

/** The device answered with `!fatal` — the API session is dead, reconnect. */
export class RosFatalError extends RosError {
  readonly attrs: Record<string, string>;

  constructor(message: string, attrs: Record<string, string> = {}) {
    super(message);
    this.name = 'RosFatalError';
    this.attrs = attrs;
  }
}

/** Login failed on both modern and legacy flows. */
export class RosLoginError extends RosError {
  constructor(message: string) {
    super(message);
    this.name = 'RosLoginError';
  }
}

/** A transport-level timeout (connect or read). */
export class RosTimeoutError extends RosError {
  constructor(message: string) {
    super(message);
    this.name = 'RosTimeoutError';
  }
}
