/**
 * Delays execution until at least `minMs` milliseconds have elapsed since `startTime`.
 * Used to prevent timing-based side-channel attacks (e.g. user enumeration).
 */
export async function delayUntil(startTime: number, minMs: number): Promise<void> {
  const elapsed = Date.now() - startTime;
  const remaining = minMs - elapsed;
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
}
