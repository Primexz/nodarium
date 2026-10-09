export class APIError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/v1/${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
    signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(10000)])
      : AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));

    if (res.status === 401 && !path.startsWith('auth/'))
      window.dispatchEvent(new Event('session-expired'));

    throw new APIError(res.status, body.error || 'Request failed');
  }

  return res.status === 204 ? (undefined as T) : res.json();
}
