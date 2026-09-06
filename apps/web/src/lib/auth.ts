export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

export type SessionUser = { id: string; email: string; firstName: string; lastName: string; jobTitle?: string; roles: string[] };

export function getSession() {
  if (typeof window === "undefined") return null;
  const token = localStorage.getItem("aurilink_token");
  const rawUser = localStorage.getItem("aurilink_user");
  if (!token || !rawUser) return null;
  try { return { token, user: JSON.parse(rawUser) as SessionUser }; } catch { return null; }
}

export function saveSession(token: string, user: SessionUser) {
  localStorage.setItem("aurilink_token", token);
  localStorage.setItem("aurilink_user", JSON.stringify(user));
}

export function logout() {
  localStorage.removeItem("aurilink_token");
  localStorage.removeItem("aurilink_user");
  window.location.replace("/login");
}

export async function authFetch(path: string, init: RequestInit = {}) {
  const session = getSession();
  const response = await fetch(`${API_URL}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}), ...(session ? { Authorization: `Bearer ${session.token}` } : {}) } });
  if (response.status === 401) logout();
  return response;
}
