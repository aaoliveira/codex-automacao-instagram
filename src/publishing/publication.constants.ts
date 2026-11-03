import { positiveIntFromEnv } from "../shared/queue-runtime-config";

export const INSTAGRAM_PUBLICATION_QUEUE = "instagram-publications";
export const INSTAGRAM_PUBLICATION_JOB = "publish-publication";

export const PUBLICATION_MAX_ATTEMPTS = positiveIntFromEnv(
  "PUBLICATION_MAX_ATTEMPTS",
  3,
  10,
);
export const PUBLICATION_RETRY_DELAY_MS = positiveIntFromEnv(
  "PUBLICATION_RETRY_DELAY_MS",
  2_000,
  600_000,
);
