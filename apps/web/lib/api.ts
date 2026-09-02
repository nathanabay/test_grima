'use client';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  fullName: string;
  roles: string[];
  permissions: string[];
  branchIds: string[];
  warehouseIds: string[];
}

const ACCESS_KEY = 'pharmacore.access';
const REFRESH_KEY = 'pharmacore.refresh';
const USER_KEY = 'pharmacore.user';

export const tokenStore = {
  get access() {
    return typeof window === 'undefined' ? null : localStorage.getItem(ACCESS_KEY);
  },
  get refresh() {
    return typeof window === 'undefined' ? null : localStorage.getItem(REFRESH_KEY);
  },
  get user(): AuthUser | null {
    if (typeof window === 'undefined') return null;
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  },
  save(access: string, refresh: string, user: AuthUser) {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  clear() {
    [ACCESS_KEY, REFRESH_KEY, USER_KEY].forEach((k) => localStorage.removeItem(k));
  },
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
  }
}

function messageOf(body: any, fallback: string): string {
  const raw = body?.error ?? body?.message ?? fallback;
  return Array.isArray(raw) ? raw.join('; ') : String(raw);
}

let refreshing: Promise<boolean> | null = null;

/** Exchange the refresh token once, even if several requests fail at the same time. */
async function refreshAccessToken(): Promise<boolean> {
  if (refreshing) return refreshing;

  refreshing = (async () => {
    const refresh = tokenStore.refresh;
    if (!refresh) return false;
    try {
      const res = await fetch(`${BASE}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: refresh }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      const user = tokenStore.user;
      if (!user) return false;
      tokenStore.save(data.accessToken, data.refreshToken, user);
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();

  return refreshing;
}

export async function api<T = any>(
  path: string,
  options: { method?: string; body?: unknown; retry?: boolean } = {},
): Promise<T> {
  const { method = 'GET', body, retry = true } = options;

  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(tokenStore.access ? { Authorization: `Bearer ${tokenStore.access}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 401 && retry) {
    // The access token is short-lived; refresh once and replay the request.
    if (await refreshAccessToken()) {
      return api<T>(path, { ...options, retry: false });
    }
    tokenStore.clear();
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
  }

  const text = await res.text();
  const parsed = text ? safeJson(text) : null;

  if (!res.ok) {
    throw new ApiError(res.status, messageOf(parsed, res.statusText), parsed);
  }
  return parsed as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function login(identifier: string, password: string, mfaCode?: string) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password, mfaCode }),
  });
  const data = await res.json();
  if (!res.ok) throw new ApiError(res.status, messageOf(data, 'Sign-in failed'), data);
  tokenStore.save(data.accessToken, data.refreshToken, data.user);
  return data.user as AuthUser;
}

export async function logout() {
  try {
    await api('/auth/logout', { method: 'POST' });
  } catch {
    // Signing out locally must succeed even if the server call fails.
  }
  tokenStore.clear();
}

export function can(user: AuthUser | null, permission: string): boolean {
  return !!user?.permissions.includes(permission);
}

// ---- Formatting helpers ----

export function money(value: unknown, currency = 'ETB'): string {
  const n = Number(value ?? 0);
  return `${currency} ${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function qty(value: unknown): string {
  const n = Number(value ?? 0);
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function shortDate(value: unknown): string {
  if (!value) return '-';
  const d = new Date(value as string);
  return Number.isNaN(d.getTime()) ? '-' : d.toISOString().slice(0, 10);
}
