/** Demo control-panel gate. Anything other than an explicit on-switch is off. */
export function demoEnabled(env: Record<string, string | undefined>): boolean {
  const value = env.WAYFINDER_DEMO;
  return value === "1" || value === "true";
}

export class DemoDisabledError extends Error {
  readonly status = 404;
  constructor() {
    super("Not found");
  }
}

export function requireDemo(env: Record<string, string | undefined>): void {
  if (!demoEnabled(env)) throw new DemoDisabledError();
}
