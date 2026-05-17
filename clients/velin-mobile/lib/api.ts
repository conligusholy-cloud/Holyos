// =============================================================================
// Velín mobile — API klient
// =============================================================================
// Tenký wrapper nad fetch. apiBase se čte z app.json (expo.extra.apiBase).
// Pokud volající předá jwt, přidáme ho do Authorization headeru.
//
// Při 401 zahodíme JWT a propagujeme chybu — volající (Gate / obrazovka)
// pak skočí zpátky na Login.

import Constants from 'expo-constants';

const API_BASE: string =
  (Constants.expoConfig?.extra as any)?.apiBase || 'https://app.holyos.cz';

export class ApiError extends Error {
  status: number;
  body: any;
  constructor(status: number, message: string, body: any) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export type LoginResponse = {
  token: string;
  user: {
    id: number;
    username: string;
    displayName?: string;
    display_name?: string;
    role: string;
    person?: { id: number; first_name?: string; last_name?: string };
  };
};

const DEFAULT_TIMEOUT_MS = 15000;

async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  options: { jwt?: string | null; body?: unknown; timeoutMs?: number } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.jwt) headers['Authorization'] = `Bearer ${options.jwt}`;

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err?.name === 'AbortError') {
      throw new ApiError(0, `Časový limit ${timeoutMs} ms vypršel — server neodpověděl`, null);
    }
    throw new ApiError(0, err?.message || 'Síťová chyba', null);
  }
  clearTimeout(timeoutId);

  let body: any = null;
  const text = await res.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!res.ok) {
    const message = (body && body.error) || res.statusText || `HTTP ${res.status}`;
    throw new ApiError(res.status, message, body);
  }
  return body as T;
}

export const api = {
  // HolyOS auth
  login: (username: string, password: string) =>
    request<LoginResponse>('POST', '/api/auth/login', { body: { username, password } }),

  // Velín — registrace push tokenu po loginu (vyžaduje JWT)
  registerDevice: (
    jwt: string,
    body: {
      expo_push_token: string;
      platform: 'ios' | 'android';
      device_label?: string;
      app_version?: string;
      os_version?: string;
    }
  ) => request<{ ok: true; device: { id: number; platform: string; device_label: string | null } }>(
    'POST',
    '/api/velin/devices/register',
    { jwt, body }
  ),

  // Velín — moje denní data
  me: (jwt: string) =>
    request<{ person: any; device: any }>('GET', '/api/velin/me', { jwt }),

  myDay: (jwt: string) =>
    request<{ date: string; plan: any; overdue: any[] }>('GET', '/api/velin/my-day', { jwt }),

  // Velín — úkoly
  getTask: (jwt: string, id: number) =>
    request<{ task: any }>('GET', `/api/velin/tasks/${id}`, { jwt }),

  acceptTask: (jwt: string, id: number) =>
    request<{ task: any }>('POST', `/api/velin/tasks/${id}/accept`, { jwt, body: {} }),

  startTask: (jwt: string, id: number) =>
    request<{ task: any }>('POST', `/api/velin/tasks/${id}/start`, { jwt, body: {} }),

  completeTask: (jwt: string, id: number, actual_min?: number) =>
    request<{ task: any }>('POST', `/api/velin/tasks/${id}/complete`, { jwt, body: { actual_min } }),

  blockTask: (jwt: string, id: number, reason: string) =>
    request<{ task: any }>('POST', `/api/velin/tasks/${id}/block`, { jwt, body: { reason } }),

  sendMessage: (jwt: string, taskId: number, body: string) =>
    request<{ message: any }>('POST', `/api/velin/tasks/${taskId}/messages`, { jwt, body: { body } }),
};

export { API_BASE };
