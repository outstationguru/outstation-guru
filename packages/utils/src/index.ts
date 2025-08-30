export function log(...args: unknown[]) {
  const ts = new Date().toISOString();
  console.log(`[OG ${ts}]`, ...args);
}

export function assert(condition: any, message: string): asserts condition {
  if (!condition) throw new Error(message);
}