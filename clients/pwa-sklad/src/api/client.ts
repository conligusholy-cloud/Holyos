// HolyOS PWA — fetch wrapper s Bearer tokenem a jednotným error handlingem.
//
// PWA záměrně **nepoužívá** httpOnly cookie (HolyOS modul v prohlížeči ji má,
// ale PWA běží na samostatném originu na SUNMI čtečce a standardem je
// Authorization: Bearer z localStorage). middleware/auth.js v HolyOS umí oboje.

import { getDeviceId } from '../device';

const TOKEN_KEY = 'holyos.pwa.token';

export class ApiError extends Error {
  status: number;
  payload: unknown;
  constructor(message: string, status: number, payload?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    // Soukromý režim / zablokovaný storage — ignore, zůstane in-memory.
  }
}

function resolveUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? '';
  return `${base}${path}`;
}

export interface ApiOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  skipAuth?: boolean;
}

/**
 * Globální handler pro neautorizované odpovědi. AuthProvider ho registruje
 * po mountu a nastavuje logout + redirect na /login.
 */
let unauthorizedHandler: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn;
}

export async function apiFetch<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  const { body, headers, skipAuth, ...rest } = options;
  const finalHeaders = new Headers(headers);

  if (!finalHeaders.has('Accept')) finalHeaders.set('Accept', 'application/json');
  if (body !== undefined && !finalHeaders.has('Content-Type')) {
    finalHeaders.set('Content-Type', 'application/json');
  }

  if (!skipAuth) {
    const token = getStoredToken();
    if (token && !finalHeaders.has('Authorization')) {
      finalHeaders.set('Authorization', `Bearer ${token}`);
    }
  }

  // X-Device-Id — backend ukládá do InventoryMovement.device_id (audit).
  // Posíláme globálně; pro endpointy, které ho neukládají, je neškodný.
  if (!finalHeaders.has('X-Device-Id')) {
    finalHeaders.set('X-Device-Id', getDeviceId());
  }

  let response: Response;
  try {
    response = await fetch(resolveUrl(path), {
      ...rest,
      headers: finalHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new ApiError(err instanceof Error ? err.message : 'Síťová chyba', 0);
  }

  const contentType = response.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  const payload: unknown = isJson ? await response.json().catch(() => null) : await response.text();

  if (!response.ok) {
    if (response.status === 401 && !skipAuth && unauthorizedHandler) {
      unauthorizedHandler();
    }
    const message =
      (isJson && payload && typeof payload === 'object' && 'error' in (payload as Record<string, unknown>)
        ? String((payload as Record<string, unknown>).error)
        : null) ??
      response.statusText ??
      `HTTP ${response.status}`;
    throw new ApiError(message, response.status, payload);
  }

  return payload as T;
}
