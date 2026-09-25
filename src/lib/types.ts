export type HeaderPair = { key: string; value: string };
export type ResponseConfig = { status: number; delay: number; contentType: string; headers: HeaderPair[]; body: string; randomStatus?: number[] };
export type ResponseRule = { id: string; name: string; enabled: boolean; method: string; pathContains: string; headerName: string; headerValue: string; queryName: string; queryValue: string; response: ResponseConfig };
export type EndpointSettings = { retentionHours: number; maxEvents: number; redactSensitiveHeaders: boolean; redactedHeaders: string[]; redactIp: boolean };
export type Inbox = { id: string; token: string; name: string; createdAt: string; response: ResponseConfig; responseRules: ResponseRule[]; settings: EndpointSettings; requestCount?: number; storageBytes?: number };
export type CapturedRequest = { id: string; inboxId: string; method: string; path: string; query: Record<string, string | string[]>; headers: Record<string, string | string[]>; body: string; contentType: string; size: number; ip: string; createdAt: string; responseStatus: number; duration: number };
export type RequestPage = { items: CapturedRequest[]; total: number; limit: number; offset: number };
