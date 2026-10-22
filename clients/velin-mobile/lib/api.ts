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
export const apiBase = API_BASE;

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

export type MeetingReservation = {
  id: number; name: string | null; email: string | null; phone: string | null; status: 'booked' | 'done' | 'canceled' | 'no_show' | string;
  compounder_lead_id: number | null; created_at: string; note: string | null; internal_note?: string | null; mode: string | null; financing_path: string | null;
  lead: { id: number; name: string; email: string | null; phone: string | null; city: string | null; status: string } | null;
};
export type MeetingSlot = {
  id: number; starts_at: string; duration_min: number; capacity: number; mode: string | null; note: string | null; active: boolean;
  booked: number; reservations: MeetingReservation[];
};
export type MeetingSlotInput = { starts_at: string; duration_min?: number; capacity?: number; mode?: string | null; note?: string | null; active?: boolean };

export type SupportMessage = {
  id: number;
  supporter_id: number;
  sender: 'user' | 'agent';
  agent_name: string | null;
  body: string;
  created_at: string;
  file_name: string | null;
  file_type: string | null;
  file_size: number | null;
  order_id: number | null;
};

export type SupportThread = {
  id: number;
  nick: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  unread: number;
  last_at: string | null;
  last_body: string | null;
  last_sender: 'user' | 'agent' | null;
  online?: boolean; // zákazník je právě na webu BS2
  page_path?: string | null; // na které stránce právě je
  page_since?: string | null; // na webu od
  device?: string | null;
};

export type SupportThreadsResponse = {
  online: boolean;
  agent: string;
  agents: { name: string }[];
  threads: SupportThread[];
};

export type SupportThreadResponse = {
  who: {
    id: number;
    nick: string | null;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
  };
  msgs: SupportMessage[];
  orders: number;
  online: boolean;
  supportOnline: boolean;
  agent: string;
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

export type AttendancePunch = {
  id: number;
  person_id: number;
  kind: 'in' | 'out' | 'break_start' | 'break_end';
  source: string;
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  inside_fence: boolean;
  fence_id: number | null;
  punched_at: string;
  notes: string | null;
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

export type AppNotification = {
  id: number;
  type: string | null;
  title: string | null;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

export type MyAssistantConfig = {
  enabled: boolean;
  number: string;
  inbound_greeting?: string;
  inbound_prompt?: string;
  transfer_enabled: boolean;
  transfer_number: string;
  tts_voice?: 'female' | 'male';
};

export type AssistantCall = {
  id: string;
  from_number: string | null;
  caller_name: string | null;
  caller_intent: string | null;
  summary: string | null;
  started_at: string;
  duration_sec: number | null;
  handoff: boolean;
  audio_url: string | null;
  read?: boolean; // vzkaz už jsem si otevřel
  audio_play_url?: string | null; // podepsaný odkaz přes HolyOS (hraje bez přihlášení k Twiliu)
  transcript: Array<{ role?: string; text?: string }> | null;
  full_transcript: string | null;
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

  // Velín — konfigurace osobního AI asistenta (číslo, zapnuto)
  myAssistant: (jwt: string) =>
    request<MyAssistantConfig>('GET', '/api/velin/me/assistant', { jwt }),

  // Uložení vlastní konfigurace asistenta z mobilu
  saveMyAssistant: (jwt: string, body: Partial<MyAssistantConfig>) =>
    request<{ ok: boolean }>('PUT', '/api/velin/me/assistant', { jwt, body }),

  // Vzkazy/hovory osobního asistenta (s nahrávkou + přepisem)
  myAssistantCalls: (jwt: string) =>
    request<{ calls: AssistantCall[]; unread?: number }>('GET', '/api/velin/me/assistant/calls', {
      jwt,
      timeoutMs: SLOW_ENDPOINT_TIMEOUT_MS,
    }),
  markAssistantCallRead: (jwt: string, id: string, read = true) =>
    request<{ ok: boolean; read: boolean }>('POST', `/api/velin/me/assistant/calls/${encodeURIComponent(id)}/read`, { jwt, body: { read } }),

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

  // ─── Notifikace (historie) ───────────────────────────────────────────────
  notifications: (jwt: string, limit = 100) =>
    request<AppNotification[]>('GET', `/api/notifications?limit=${limit}`, {
      jwt,
      timeoutMs: SLOW_ENDPOINT_TIMEOUT_MS,
    }),

  markNotificationRead: (jwt: string, id: number) =>
    request<{ ok?: boolean }>('POST', `/api/notifications/${id}/read`, { jwt, body: {} }),

  markAllNotificationsRead: (jwt: string) =>
    request<{ ok?: boolean }>('POST', '/api/notifications/read-all', { jwt, body: {} }),

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

  // ─── Podpora BS2 (jen Tomáš a Jan Holý; proxy HolyOS → BS2) ───────────────
  // Centrum reklamy (jen Tomáš a Jan Holý — stejná oprávnění jako na webu; token je shodný HolyOS JWT)
  adsGet: <T = any>(jwt: string, path: string) =>
    request<T>('GET', '/api/ads-center' + path, { jwt, timeoutMs: 60000 }),

  adsPost: <T = any>(jwt: string, path: string, body: any = {}) =>
    request<T>('POST', '/api/ads-center' + path, { jwt, body, timeoutMs: 60000 }),

  // Administrace schůzek (jen Tomáš a Jan Holý)
  meetings: (jwt: string, from: string, to: string) =>
    request<{ slots: MeetingSlot[] }>('GET', `/api/velin/meetings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { jwt }),
  meetingsCreate: (jwt: string, slots: MeetingSlotInput[]) =>
    request<{ ok: boolean; created: number[] }>('POST', '/api/velin/meetings/slots', { jwt, body: { slots }, timeoutMs: 60000 }),
  meetingSlotUpdate: (jwt: string, id: number, body: Partial<MeetingSlotInput>) =>
    request<{ ok: boolean }>('POST', `/api/velin/meetings/slots/${id}/update`, { jwt, body }),
  meetingSlotDelete: (jwt: string, id: number) =>
    request<{ ok: boolean; deactivated?: boolean }>('POST', `/api/velin/meetings/slots/${id}/delete`, { jwt, body: {} }),
  meetingReservationSet: (jwt: string, id: number, body: { status?: string; note?: string | null; internal_note?: string | null }) =>
    request<{ ok: boolean }>('POST', `/api/velin/meetings/reservations/${id}`, { jwt, body }),
  meetingLeasingCompanies: (jwt: string) =>
    request<{ id: number; name: string; contact_name: string | null; email: string | null; phone: string | null }[]>('GET', '/api/velin/meetings/leasing-companies', { jwt }),
  meetingLeasingList: (jwt: string, id: number) =>
    request<{ id: number; company: string | null; status: string; subject: string; price: number; sent_at: string; deadline_at: string | null; result_note: string | null; result_monthly: number | null }[]>('GET', `/api/velin/meetings/reservations/${id}/leasing`, { jwt }),
  meetingLeasingSend: (jwt: string, id: number, body: { company_ids: number[]; client_first_name: string; client_last_name: string; client_company?: string | null; client_ico?: string | null; client_email?: string | null; client_phone?: string | null; subject: string; price: number; note?: string | null }) =>
    request<{ ok: boolean; sent: { company: string; email_sent?: boolean; sms_sent?: boolean; errors?: string[] }[] }>('POST', `/api/velin/meetings/reservations/${id}/leasing`, { jwt, body }),

  supportMe: (jwt: string) =>
    request<{ allowed: boolean }>('GET', '/api/velin/support/me', { jwt }),

  supportThreads: (jwt: string) =>
    request<SupportThreadsResponse>('GET', '/api/velin/support/threads', {
      jwt,
      timeoutMs: SLOW_ENDPOINT_TIMEOUT_MS,
    }),

  supportThread: (jwt: string, id: number, after?: number) =>
    request<SupportThreadResponse>(
      'GET',
      `/api/velin/support/threads/${id}${after != null ? `?after=${after}` : ''}`,
      { jwt, timeoutMs: SLOW_ENDPOINT_TIMEOUT_MS }
    ),

  supportSend: (jwt: string, id: number, body: string) =>
    request<{ ok: boolean; msg: SupportMessage | null }>(
      'POST',
      `/api/velin/support/threads/${id}/send`,
      { jwt, body: { body }, timeoutMs: SLOW_ENDPOINT_TIMEOUT_MS }
    ),

  supportSetOnline: (jwt: string, online: boolean, agent?: string) =>
    request<{ ok: boolean; online: boolean }>('POST', '/api/velin/support/online', {
      jwt,
      body: { online, agent },
    }),

  supportSoundGet: (jwt: string) =>
    request<{ sound: string; sounds: string[] }>('GET', '/api/velin/support/sound', { jwt }),
  supportSoundSet: (jwt: string, sound: string) =>
    request<{ ok: boolean; sound: string }>('PUT', '/api/velin/support/sound', { jwt, body: { sound } }),

  supportFileUrl: (id: number) => `${API_BASE}/api/velin/support/file/${id}`,

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

  // ─── Compounder smlouvy — autorizace/podpis za Best Series ───────────────
  contractForSign: (jwt: string, id: number) =>
    request<{
      ok: boolean; id: number; type: string; typeLabel: string;
      kiosk_code: string; kiosk_label: string | null; status: string;
      share_token: string | null;
      customer_signature: string | null; customer_name: string | null; customer_signed_at: string | null;
    }>('GET', `/api/compounder/contracts/${id}/for-sign`, { jwt }),

  contractCountersign: (jwt: string, id: number, signature: string) =>
    request<{ ok: boolean; awaiting_customer?: boolean }>(
      'POST', `/api/compounder/contracts/${id}/countersign`,
      { jwt, body: { signature, consent: true } }
    ),

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

  // ─── Docházka (Fáze 3) ───────────────────────────────────────────────────
  attendanceToday: (jwt: string) =>
    request<{ punches: AttendancePunch[]; currentState: 'in' | 'out' | 'break' }>(
      'GET',
      '/api/velin/attendance/today',
      { jwt }
    ),

  attendancePunch: (
    jwt: string,
    data: {
      kind: 'in' | 'out' | 'break_start' | 'break_end';
      lat?: number | null;
      lng?: number | null;
      accuracy_m?: number | null;
      source?: 'velin_manual' | 'velin_geofence_auto';
    }
  ) =>
    request<{ punch: AttendancePunch }>('POST', '/api/velin/attendance/punch', {
      jwt,
      body: data,
    }),

  // Vytvořit GeoFence z aktuální polohy (admin/manager only).
  // Použití: kolega-šéf se postaví doprostřed dílny a stiskne "Vytvořit
  // provoz tady" — Velín vezme GPS a zaregistruje fence v jednom kroku.
  createGeoFenceFromHere: (
    jwt: string,
    data: { name: string; lat: number; lng: number; radius_m?: number; notes?: string }
  ) =>
    request<{ fence: { id: number; name: string; center_lat: number; center_lng: number; radius_m: number } }>(
      'POST',
      '/api/velin/fences/from-here',
      { jwt, body: data }
    ),
};

export { API_BASE };
