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
// /me, /my-day, chat endpointy kvůli Railway cold startu — server po nečinnosti
// spí a první request po probuzení může trvat 15–25 s. 30 s má rezervu.
const SLOW_ENDPOINT_TIMEOUT_MS = 30000;

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

// ─── Chat typy (deklarované nahoře, ať je `api` níže může referovat) ────────

export type ChatAttachment = {
  kind: 'image' | 'file';
  url: string;
  name?: string;
  size?: number;
  mime?: string;
};

export type ChatMemberUser = {
  id: number;
  username: string;
  display_name: string;
  person: {
    photo_url: string | null;
    first_name: string | null;
    last_name: string | null;
  } | null;
};

export type ChatChannelMember = {
  id: number;
  user_id: number;
  role: string;
  last_read_at: string | null;
  muted: boolean;
  user: ChatMemberUser;
};

export type ChatLastMessage = {
  id: string;
  content: string;
  created_at: string;
  attachments: ChatAttachment[] | null;
  sender: { id: number; display_name: string; username: string } | null;
};

export type ChatChannelSummary = {
  id: string;
  type: 'direct' | 'group' | 'task' | 'system';
  name: string | null;
  topic: string | null;
  last_message_at: string;
  muted: boolean;
  unread: number;
  members: ChatChannelMember[];
  last_message: ChatLastMessage | null;
};

export type ChatMessage = {
  id: string;
  channel_id: string;
  sender_id: number | null;
  sender_type: 'user' | 'system' | 'ai';
  sender_label: string | null;
  content: string;
  attachments: ChatAttachment[] | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
  sender: {
    id: number;
    username: string;
    display_name: string;
    person: { photo_url: string | null } | null;
  } | null;
};

export type EveningReflection = {
  id: number;
  person_id: number;
  date: string;
  mood: number | null;
  energy: number | null;
  wins: string | null;
  struggles: string | null;
  tomorrow_focus: string | null;
  free_text: string | null;
  ai_summary: string | null;
  submitted_at: string;
};

export type SearchableUser = {
  id: number;
  username: string;
  display_name: string;
  person: {
    first_name: string | null;
    last_name: string | null;
    photo_url: string | null;
  } | null;
};

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
    request<{ person: any; device: any }>('GET', '/api/velin/me', {
      jwt,
      timeoutMs: SLOW_ENDPOINT_TIMEOUT_MS,
    }),

  myDay: (jwt: string) =>
    request<{ date: string; plan: any; overdue: any[] }>('GET', '/api/velin/my-day', {
      jwt,
      timeoutMs: SLOW_ENDPOINT_TIMEOUT_MS,
    }),

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

  // ─── Chat ─────────────────────────────────────────────────────────────────
  chatChannels: (jwt: string) =>
    request<ChatChannelSummary[]>('GET', '/api/velin/chat/channels', {
      jwt,
      timeoutMs: SLOW_ENDPOINT_TIMEOUT_MS,
    }),

  chatMessages: (jwt: string, channelId: string, before?: string, limit = 50) => {
    const qs = new URLSearchParams();
    if (before) qs.set('before', before);
    qs.set('limit', String(limit));
    return request<ChatMessage[]>(
      'GET',
      `/api/velin/chat/channels/${channelId}/messages?${qs.toString()}`,
      { jwt, timeoutMs: SLOW_ENDPOINT_TIMEOUT_MS }
    );
  },

  chatSend: (jwt: string, channelId: string, content: string, attachments: ChatAttachment[] = []) =>
    request<ChatMessage>('POST', `/api/velin/chat/channels/${channelId}/messages`, {
      jwt,
      body: { content, attachments },
    }),

  chatMarkRead: (jwt: string, channelId: string) =>
    request<{ ok: true }>('POST', `/api/velin/chat/channels/${channelId}/read`, {
      jwt,
      body: {},
    }),

  chatDirectChannel: (jwt: string, userId: number) =>
    request<{ channel: any }>('POST', '/api/velin/chat/channels/direct', {
      jwt,
      body: { user_id: userId },
    }),

  chatSearchableUsers: (jwt: string, q = '') => {
    const qs = q ? `?q=${encodeURIComponent(q)}` : '';
    return request<SearchableUser[]>('GET', `/api/velin/chat/users/searchable${qs}`, { jwt });
  },

  // ─── Večerní reflexe (Fáze 2) ────────────────────────────────────────────
  getEveningReflection: (jwt: string, date?: string) => {
    const qs = date ? `?date=${encodeURIComponent(date)}` : '';
    return request<{ reflection: EveningReflection | null; date: string }>(
      'GET',
      `/api/velin/feedback/evening${qs}`,
      { jwt }
    );
  },

  submitEveningReflection: (
    jwt: string,
    data: {
      mood?: number | null;
      energy?: number | null;
      wins?: string | null;
      struggles?: string | null;
      tomorrow_focus?: string | null;
      free_text?: string | null;
    }
  ) =>
    request<{ reflection: EveningReflection }>('POST', '/api/velin/feedback/evening', {
      jwt,
      body: data,
    }),

  // Chat upload — fotky/soubory přes multipart/form-data.
  // file.uri = lokální path z expo-image-picker / expo-document-picker.
  // Vrátí strukturu kompatibilní s ChatAttachment (kind, url, name, size, mime).
  chatUpload: async (
    jwt: string,
    file: { uri: string; name: string; mime: string },
    channelId?: string
  ): Promise<ChatAttachment> => {
    const formData = new FormData();
    // RN FormData přijímá { uri, name, type } jako "file" object
    formData.append('file', {
      uri: file.uri,
      name: file.name,
      type: file.mime,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    if (channelId) formData.append('channel_id', channelId);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 s upload

    try {
      const res = await fetch(`${API_BASE}/api/velin/chat/upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
          // POZOR: NEnastavujeme Content-Type — fetch dosadí multipart boundary sám
        },
        body: formData as any,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const text = await res.text();
      let body: any = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = text; }

      if (!res.ok) {
        const message = (body && body.error) || `HTTP ${res.status}`;
        throw new ApiError(res.status, message, body);
      }
      return body as ChatAttachment;
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err instanceof ApiError) throw err;
      if (err?.name === 'AbortError') {
        throw new ApiError(0, 'Upload trval příliš dlouho (60 s)', null);
      }
      throw new ApiError(0, err?.message || 'Síťová chyba při uploadu', null);
    }
  },
};

export { API_BASE };
