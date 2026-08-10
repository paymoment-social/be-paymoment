const RETRYABLE_POSTGRES_CODES = new Set(["40001", "40P01"]);

function postgresCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

export async function withTransactionRetry<T>(operation: () => Promise<T>, maxAttempts = 3): Promise<T> {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error("maxAttempts must be a positive integer.");
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!RETRYABLE_POSTGRES_CODES.has(postgresCode(error) ?? "") || attempt === maxAttempts) throw error;
      await Bun.sleep(Math.min(25 * (2 ** (attempt - 1)), 200));
    }
  }
  throw lastError;
}
