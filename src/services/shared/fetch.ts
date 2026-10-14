/**
 * Safe fetch with timeout and error handling
 */
export async function safeFetch(
  url: string,
  options: RequestInit & { timeout?: number } = {}
): Promise<Response> {
  const { timeout = 15000, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetch with retry logic
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit & { timeout?: number; retries?: number } = {}
): Promise<Response> {
  const { retries = 2, timeout, ...fetchOptions } = options;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await safeFetch(url, { ...fetchOptions, timeout });
      if (response.ok || response.status < 500) return response;
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    } catch (err) {
      if (attempt >= retries) throw err;
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw new Error(`Fetch failed after ${retries + 1} attempts: ${url}`);
}
