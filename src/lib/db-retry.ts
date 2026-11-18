// Retries a database operation a couple of times when the failure is a dropped or cold connection (typical right
// after a serverless database wakes up, or when a pooled connection went stale). Real errors are not retried:
// validation, duplicates and constraint failures are returned at once.

const TRANSIENT_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
  "57P01", // admin shutdown
  "57P02", // crash shutdown
  "57P03", // cannot connect now (starting up)
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
]);

const TRANSIENT_TEXT =
  /connection terminated|connection timeout|timeout exceeded when trying to connect|client has encountered a connection error|the database system is (starting up|shutting down)|socket hang up|server closed the connection|ssl syscall error|econnreset/i;

/** True when the error (or anything it wraps) looks like a connection problem rather than a bad request. */
export function isTransientDbError(err: unknown, depth = 0): boolean {
  if (!err || typeof err !== "object" || depth > 4) return false;
  const e = err as { code?: unknown; message?: unknown; cause?: unknown };
  if (typeof e.code === "string" && TRANSIENT_CODES.has(e.code)) return true;
  if (typeof e.message === "string" && TRANSIENT_TEXT.test(e.message)) return true;
  return isTransientDbError(e.cause, depth + 1);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function withTransientRetry<T>(
  operation: () => Promise<T>,
  { attempts = 3, baseDelayMs = 300 }: { attempts?: number; baseDelayMs?: number } = {}
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (err) {
      if (attempt >= attempts || !isTransientDbError(err)) throw err;
      console.warn(`database connection problem (attempt ${attempt} of ${attempts}); retrying`);
      await sleep(baseDelayMs * attempt);
    }
  }
}
