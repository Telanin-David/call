import { apiBase } from './backend';

/** A failed api call. `message` is written for the rep and safe to show. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    /** Seconds to wait before trying again, when the api says so. */
    public readonly retryAfter = 0,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${apiBase() ?? '/api'}${path}`, {
      credentials: 'include',
      ...init,
      // Writes must be JSON: the api refuses anything else (cross-site forms).
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
  } catch {
    throw new ApiError(0, 'offline', "Can't reach Dialer. Check your internet and try again.");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: unknown; code?: unknown };
    throw new ApiError(
      res.status,
      typeof body.code === 'string' ? body.code : '',
      typeof body.error === 'string' ? body.error : 'Something went wrong. Try again.',
      Number(res.headers.get('Retry-After')) || 0,
    );
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/** The message to show for any error from a mutation or query. */
export function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong. Try again.';
}
