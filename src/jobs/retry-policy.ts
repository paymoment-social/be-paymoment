export type RetryDecision = {
  status: "failed" | "dead_lettered";
  nextAttemptAt: Date | null;
};

export function retryDelayMilliseconds(attempt: number, baseDelayMilliseconds = 1_000, maximumDelayMilliseconds = 15 * 60_000) {
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error("attempt must be a positive integer.");
  return Math.min(baseDelayMilliseconds * (2 ** (attempt - 1)), maximumDelayMilliseconds);
}

export function retryDecision(attempt: number, maxAttempts: number, now = new Date()): RetryDecision {
  if (attempt >= maxAttempts) return { status: "dead_lettered", nextAttemptAt: null };
  return {
    status: "failed",
    nextAttemptAt: new Date(now.getTime() + retryDelayMilliseconds(attempt)),
  };
}
