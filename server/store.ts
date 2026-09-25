import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type HeaderPair = { key: string; value: string };
export type ResponseConfig = { status: number; delay: number; contentType: string; headers: HeaderPair[]; body: string; randomStatus?: number[] };
export type ResponseRule = {
  id: string; name: string; enabled: boolean; method: string; pathContains: string;
  headerName: string; headerValue: string; queryName: string; queryValue: string; response: ResponseConfig;
};
export type EndpointSettings = { retentionHours: number; maxEvents: number; redactSensitiveHeaders: boolean; redactedHeaders: string[]; redactIp: boolean };
export type Inbox = {
  id: string; token: string; name: string; createdAt: string; response: ResponseConfig;
  responseRules: ResponseRule[]; settings: EndpointSettings; requestCount?: number; storageBytes?: number;
};
export type CapturedRequest = {
  id: string; inboxId: string; method: string; path: string;
  query: Record<string, string | string[]>; headers: Record<string, string | string[]>;
  body: string; contentType: string; size: number; ip: string; createdAt: string;
  responseStatus: number; duration: number;
};

type LegacyDatabase = { inboxes?: Array<Partial<Inbox>>; requests?: CapturedRequest[] };
type InboxRow = { id: string; token: string; name: string; created_at: string; response_json: string; rules_json: string; settings_json: string; request_count?: number; storage_bytes?: number };
type RequestRow = { id: string; inbox_id: string; method: string; path: string; query_json: string; headers_json: string; body: string; content_type: string; size: number; ip: string; created_at: string; response_status: number; duration: number };

const dataDir = process.env.DATA_DIR || path.resolve("data");
const sqliteFile = path.join(dataDir, "httpbin.sqlite");
const legacySqliteFile = path.join(dataDir, "relaybin.sqlite");
const legacyFile = path.join(dataDir, "relaybin.json");
let db: DatabaseSync;

const defaultResponse = (): ResponseConfig => ({ status: 200, delay: 0, contentType: "application/json", headers: [], body: JSON.stringify({ success: true }, null, 2), randomStatus: [] });
const defaultSettings = (): EndpointSettings => ({
  retentionHours: Number(process.env.DEFAULT_RETENTION_HOURS || 168),
  maxEvents: Number(process.env.MAX_EVENTS_PER_ENDPOINT || 500),
  redactSensitiveHeaders: true,
  redactedHeaders: [],
  redactIp: false,
});

function parse<T>(value: string, fallback: T): T { try { return JSON.parse(value) as T; } catch { return fallback; } }
function hydrateInbox(row: InboxRow): Inbox {
  return {
    id: row.id, token: row.token, name: row.name, createdAt: row.created_at,
    response: { ...defaultResponse(), ...parse(row.response_json, defaultResponse()) },
    responseRules: parse(row.rules_json, []), settings: { ...defaultSettings(), ...parse(row.settings_json, defaultSettings()) },
    requestCount: Number(row.request_count ?? 0), storageBytes: Number(row.storage_bytes ?? 0),
  };
}
function hydrateRequest(row: RequestRow): CapturedRequest {
  return {
    id: row.id, inboxId: row.inbox_id, method: row.method, path: row.path,
    query: parse(row.query_json, {}), headers: parse(row.headers_json, {}), body: row.body,
    contentType: row.content_type, size: row.size, ip: row.ip, createdAt: row.created_at,
    responseStatus: row.response_status, duration: row.duration,
  };
}
function insertInbox(inbox: Inbox) {
  db.prepare("INSERT OR IGNORE INTO inboxes (id, token, name, created_at, response_json, rules_json, settings_json) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(inbox.id, inbox.token, inbox.name, inbox.createdAt, JSON.stringify(inbox.response), JSON.stringify(inbox.responseRules ?? []), JSON.stringify(inbox.settings ?? defaultSettings()));
}
function insertRequest(request: CapturedRequest) {
  db.prepare("INSERT OR IGNORE INTO requests (id, inbox_id, method, path, query_json, headers_json, body, content_type, size, ip, created_at, response_status, duration) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(request.id, request.inboxId, request.method, request.path, JSON.stringify(request.query), JSON.stringify(request.headers), request.body, request.contentType, request.size, request.ip, request.createdAt, request.responseStatus, request.duration);
}

export async function loadStore() {
  mkdirSync(dataDir, { recursive: true });
  if (!existsSync(sqliteFile) && existsSync(legacySqliteFile)) {
    for (const suffix of ["", "-wal", "-shm"]) {
      if (existsSync(`${legacySqliteFile}${suffix}`)) renameSync(`${legacySqliteFile}${suffix}`, `${sqliteFile}${suffix}`);
    }
  }
  db = new DatabaseSync(sqliteFile);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS inboxes (
      id TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE, name TEXT NOT NULL, created_at TEXT NOT NULL,
      response_json TEXT NOT NULL, rules_json TEXT NOT NULL DEFAULT '[]', settings_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY, inbox_id TEXT NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
      method TEXT NOT NULL, path TEXT NOT NULL, query_json TEXT NOT NULL, headers_json TEXT NOT NULL,
      body TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL, ip TEXT NOT NULL,
      created_at TEXT NOT NULL, response_status INTEGER NOT NULL, duration INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS requests_inbox_created ON requests(inbox_id, created_at DESC);
  `);
  const count = Number((db.prepare("SELECT COUNT(*) AS count FROM inboxes").get() as { count: number }).count);
  if (count === 0 && existsSync(legacyFile)) {
    const legacy = parse<LegacyDatabase>(readFileSync(legacyFile, "utf8"), {});
    db.exec("BEGIN");
    try {
      for (const item of legacy.inboxes ?? []) {
        if (!item.id || !item.token) continue;
        insertInbox({ id: item.id, token: item.token, name: item.name || "New endpoint", createdAt: item.createdAt || new Date().toISOString(), response: { ...defaultResponse(), ...(item.response ?? {}) }, responseRules: item.responseRules ?? [], settings: { ...defaultSettings(), ...(item.settings ?? {}) } });
      }
      for (const request of legacy.requests ?? []) insertRequest(request);
      db.exec("COMMIT");
      renameSync(legacyFile, `${legacyFile}.migrated`);
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  cleanupExpiredRequests();
  scrubStoredRequests();
}

export function closeStore() { db?.close(); }

export async function createInbox(name = "New endpoint") {
  const inbox: Inbox = { id: randomUUID(), token: randomBytes(12).toString("base64url"), name: name.trim().slice(0, 64) || "New endpoint", createdAt: new Date().toISOString(), response: defaultResponse(), responseRules: [], settings: defaultSettings(), requestCount: 0, storageBytes: 0 };
  insertInbox(inbox);
  return inbox;
}

const inboxSelect = `SELECT i.*, COUNT(r.id) AS request_count, COALESCE(SUM(r.size), 0) AS storage_bytes FROM inboxes i LEFT JOIN requests r ON r.inbox_id = i.id`;
export function getInbox(id: string) {
  const row = db.prepare(`${inboxSelect} WHERE i.id = ? GROUP BY i.id`).get(id) as InboxRow | undefined;
  return row ? hydrateInbox(row) : undefined;
}
export function getInboxByToken(token: string) {
  const row = db.prepare(`${inboxSelect} WHERE i.token = ? GROUP BY i.id`).get(token) as InboxRow | undefined;
  return row ? hydrateInbox(row) : undefined;
}
export async function updateInbox(id: string, changes: Partial<Pick<Inbox, "name" | "response" | "responseRules" | "settings">>) {
  const inbox = getInbox(id);
  if (!inbox) return undefined;
  const name = changes.name === undefined ? inbox.name : changes.name.trim().slice(0, 64) || inbox.name;
  const response = changes.response ?? inbox.response;
  const rules = changes.responseRules ?? inbox.responseRules;
  const settings = changes.settings ? { ...inbox.settings, ...changes.settings } : inbox.settings;
  db.prepare("UPDATE inboxes SET name = ?, response_json = ?, rules_json = ?, settings_json = ? WHERE id = ?").run(name, JSON.stringify(response), JSON.stringify(rules), JSON.stringify(settings), id);
  redactExistingRequests(id, settings);
  trimInbox(id, settings.maxEvents);
  cleanupExpiredRequests();
  return getInbox(id);
}
export async function removeInbox(id: string) { return db.prepare("DELETE FROM inboxes WHERE id = ?").run(id).changes > 0; }

export function listRequests(inboxId: string, options: { limit?: number; offset?: number; search?: string; method?: string; contentType?: string; since?: string } = {}) {
  cleanupInbox(inboxId);
  const safeLimit = Math.max(1, Math.min(200, Math.floor(options.limit ?? 100)));
  const safeOffset = Math.max(0, Math.floor(options.offset ?? 0));
  const clauses = ["inbox_id = ?"];
  const values: Array<string | number> = [inboxId];
  if (options.search?.trim()) { const search = `%${options.search.trim()}%`; clauses.push("(method LIKE ? OR path LIKE ? OR content_type LIKE ? OR body LIKE ?)"); values.push(search, search, search, search); }
  if (options.method) { clauses.push("method = ?"); values.push(options.method); }
  if (options.contentType) { clauses.push("content_type LIKE ?"); values.push(`%${options.contentType}%`); }
  if (options.since) { clauses.push("created_at >= ?"); values.push(options.since); }
  const where = clauses.join(" AND ");
  const rows = db.prepare(`SELECT * FROM requests WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...values, safeLimit, safeOffset) as unknown as RequestRow[];
  const total = Number((db.prepare(`SELECT COUNT(*) AS count FROM requests WHERE ${where}`).get(...values) as { count: number }).count);
  return { items: rows.map(hydrateRequest), total, limit: safeLimit, offset: safeOffset };
}
export function getRequest(id: string) { const row = db.prepare("SELECT * FROM requests WHERE id = ?").get(id) as RequestRow | undefined; return row ? hydrateRequest(row) : undefined; }
export async function removeRequest(id: string) { return db.prepare("DELETE FROM requests WHERE id = ?").run(id).changes > 0; }
export async function addRequest(input: Omit<CapturedRequest, "id" | "createdAt">) {
  const request: CapturedRequest = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
  insertRequest(request);
  trimInbox(input.inboxId, getInbox(input.inboxId)?.settings.maxEvents ?? defaultSettings().maxEvents);
  return request;
}
export async function clearRequests(inboxId: string) { db.prepare("DELETE FROM requests WHERE inbox_id = ?").run(inboxId); }

function trimInbox(inboxId: string, maxEvents: number) {
  db.prepare("DELETE FROM requests WHERE inbox_id = ? AND id NOT IN (SELECT id FROM requests WHERE inbox_id = ? ORDER BY created_at DESC LIMIT ?)")
    .run(inboxId, inboxId, Math.max(10, Math.min(5000, maxEvents)));
}
function cleanupInbox(inboxId: string) {
  const inbox = getInbox(inboxId);
  if (!inbox || inbox.settings.retentionHours === 0) return;
  db.prepare("DELETE FROM requests WHERE inbox_id = ? AND created_at < ?").run(inboxId, new Date(Date.now() - inbox.settings.retentionHours * 3600_000).toISOString());
}
export function cleanupExpiredRequests() {
  const rows = db.prepare("SELECT id, settings_json FROM inboxes").all() as unknown as Array<{ id: string; settings_json: string }>;
  for (const row of rows) {
    const settings = { ...defaultSettings(), ...parse<Partial<EndpointSettings>>(row.settings_json, {}) };
    if (settings.retentionHours !== 0) db.prepare("DELETE FROM requests WHERE inbox_id = ? AND created_at < ?").run(row.id, new Date(Date.now() - settings.retentionHours * 3600_000).toISOString());
  }
}

function redactExistingRequests(inboxId: string, settings: EndpointSettings) {
  const custom = new Set((settings.redactedHeaders ?? []).map((name) => name.trim().toLowerCase()).filter(Boolean));
  const sensitive = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token)$/i;
  const rows = db.prepare("SELECT id, headers_json, ip FROM requests WHERE inbox_id = ?").all(inboxId) as unknown as Array<{ id: string; headers_json: string; ip: string }>;
  const update = db.prepare("UPDATE requests SET headers_json = ?, ip = ? WHERE id = ?");
  for (const row of rows) {
    const headers = parse<Record<string, string | string[]>>(row.headers_json, {});
    const redacted = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, (settings.redactSensitiveHeaders && sensitive.test(key)) || custom.has(key.toLowerCase()) ? "[REDACTED]" : value]));
    let ip = row.ip;
    if (settings.redactIp) {
      if (ip.includes(":")) ip = `${ip.split(":").slice(0, 4).join(":")}::`;
      else { const parts = ip.split("."); if (parts.length === 4) ip = `${parts[0]}.${parts[1]}.${parts[2]}.0`; }
    }
    update.run(JSON.stringify(redacted), ip, row.id);
  }
}

function scrubStoredRequests() {
  const rows = db.prepare("SELECT id, settings_json FROM inboxes").all() as unknown as Array<{ id: string; settings_json: string }>;
  for (const row of rows) redactExistingRequests(row.id, { ...defaultSettings(), ...parse<Partial<EndpointSettings>>(row.settings_json, {}) });
}
