// HolyOS PWA — typy pro auth vrstvu (shoda s odpověďmi backendu /api/auth/*)

export interface PersonSummary {
  id: number;
  firstName: string;
  lastName: string;
  photoUrl: string | null;
}

export interface AuthUser {
  id: number;
  username: string;
  displayName: string;
  role: string;
  isSuperAdmin: boolean;
  person: PersonSummary | null;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}

export interface MeResponse {
  user: AuthUser;
}
