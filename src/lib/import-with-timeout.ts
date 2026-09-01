export function importWithTimeoutRetry<T>(
  loader: () => Promise<T>,
  options: { timeoutMs: number; onGiveUp: () => void },
): Promise<T> {
  const attempt = () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("import-timeout")), options.timeoutMs);
    });
    return Promise.race([
      loader().finally(() => {
        if (timer !== undefined) clearTimeout(timer);
      }),
      timeout,
    ]);
  };

  return attempt().catch(() =>
    attempt().catch((error) => {
      options.onGiveUp();
      throw error;
    }),
  );
}
