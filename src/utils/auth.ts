/**
 * Google Auth utilities.
 * Uses Google Sign-In (GIS) for authentication.
 * Restricts to @alter-5.com domain.
 */

const AUTH_STORAGE_KEY = 'alter5_auth';
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

export interface AuthUser {
  email: string;
  name: string;
  picture: string;
  token: string;
}

export function getStoredAuth(): AuthUser | null {
  try {
    const data = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!data) return null;
    const parsed = JSON.parse(data);
    // Check if token looks valid (basic check)
    if (!parsed.token || !parsed.email) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function storeAuth(user: AuthUser): void {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
}

export function clearAuth(): void {
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

export function getGoogleClientId(): string {
  return GOOGLE_CLIENT_ID;
}

export function getAuthToken(): string {
  const auth = getStoredAuth();
  return auth?.token || '';
}

/** Verify token with our backend */
export async function verifyToken(token: string): Promise<AuthUser | null> {
  try {
    const res = await fetch('/api/auth/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return { ...data, token };
  } catch {
    return null;
  }
}
