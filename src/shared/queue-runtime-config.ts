export function positiveIntFromEnv(
  name: string,
  fallback: number,
  maximum = 100_000,
): number {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  }
  return parsed;
}

export const PUBLICATION_WORKER_CONCURRENCY = positiveIntFromEnv(
  "PUBLICATION_WORKER_CONCURRENCY",
  1,
  100,
);
export const WEBHOOK_WORKER_CONCURRENCY = positiveIntFromEnv(
  "WEBHOOK_WORKER_CONCURRENCY",
  1,
  100,
);
export const AUTOMATION_WORKER_CONCURRENCY = positiveIntFromEnv(
  "AUTOMATION_WORKER_CONCURRENCY",
  1,
  100,
);
