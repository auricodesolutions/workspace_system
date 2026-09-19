export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

export type SessionUser = { id: string; email: string; firstName: string; lastName: string; jobTitle?: string; roles: string[] };

export function getSession() {
  if (typeof window === "undefined") return null;
  const rawUser = localStorage.getItem("aurilink_user");
  if (!rawUser) return null;
  try { return { user: JSON.parse(rawUser) as SessionUser }; } catch { return null; }
}

export function saveSession(_token: string, user: SessionUser) {
  localStorage.setItem("aurilink_user", JSON.stringify(user));
}

export function logout() {
  localStorage.removeItem("aurilink_user");
  void fetch(`${API_URL}/auth/logout`, { method: "POST", credentials: "include", keepalive: true });
  window.location.replace("/login");
}

export async function authFetch(path: string, init: RequestInit = {}) {
  const response = await fetch(`${API_URL}${path}`, { ...init, credentials: "include", headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
  if (response.status === 401) logout();
  return response;
}
