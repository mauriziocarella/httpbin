import type { EndpointSettings, Inbox, RequestPage, ResponseConfig, ResponseRule } from "./types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || "Operation failed");
  return response.status === 204 ? undefined as T : response.json();
}

export const api = {
  createInbox: (name?: string) => request<Inbox>("/api/inboxes", { method: "POST", body: JSON.stringify({ name }) }),
  getInbox: (id: string) => request<Inbox>(`/api/inboxes/${id}`),
  updateInbox: (id: string, changes: { name?: string; response?: ResponseConfig; responseRules?: ResponseRule[]; settings?: EndpointSettings }) => request<Inbox>(`/api/inboxes/${id}`, { method: "PATCH", body: JSON.stringify(changes) }),
  deleteInbox: (id: string) => request<void>(`/api/inboxes/${id}`, { method: "DELETE" }),
  listRequests: (id: string, options: { limit?: number; offset?: number; search?: string; method?: string; contentType?: string; since?: string } = {}) => {
    const query = new URLSearchParams();
    query.set("limit", String(options.limit ?? 100));
    query.set("offset", String(options.offset ?? 0));
    if (options.search) query.set("search", options.search);
    if (options.method) query.set("method", options.method);
    if (options.contentType) query.set("contentType", options.contentType);
    if (options.since) query.set("since", options.since);
    return request<RequestPage>(`/api/inboxes/${id}/requests?${query}`);
  },
  clearRequests: (id: string) => request<void>(`/api/inboxes/${id}/requests`, { method: "DELETE" }),
  deleteRequest: (id: string) => request<void>(`/api/requests/${id}`, { method: "DELETE" }),
};
