import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  addRequest, cleanupExpiredRequests, clearRequests, closeStore, createInbox, getInbox,
  getInboxByToken, getRequest, listRequests, loadStore, removeInbox, removeRequest, updateInbox,
  type CapturedRequest, type EndpointSettings, type ResponseConfig, type ResponseRule,
} from "./store.js";

const maxPayloadBytes = Number(process.env.MAX_PAYLOAD_BYTES || 2 * 1024 * 1024);
const rateLimitPerMinute = Number(process.env.HOOK_RATE_LIMIT_PER_MINUTE || 120);
const app = Fastify({ logger: true, bodyLimit: maxPayloadBytes });
const port = Number(process.env.PORT || 3000);
const clients = new Map<string, Set<NodeJS.WritableStream>>();
const rateBuckets = new Map<string, { startedAt: number; count: number }>();

await loadStore();
await app.register(cors, { origin: true });
app.addContentTypeParser("*", { parseAs: "buffer" }, (_request, body, done) => done(null, body));

app.get("/api/health", async () => ({ ok: true, storage: "sqlite", maxPayloadBytes }));
app.post<{ Body: { name?: string } }>("/api/inboxes", async (request, reply) => reply.code(201).send(await createInbox(request.body?.name)));
app.get<{ Params: { id: string } }>("/api/inboxes/:id", async (request, reply) => getInbox(request.params.id) ?? reply.code(404).send({ error: "Endpoint not found" }));
app.patch<{ Params: { id: string }; Body: { name?: string; response?: ResponseConfig; responseRules?: ResponseRule[]; settings?: EndpointSettings } }>("/api/inboxes/:id", async (request, reply) => {
  const body = request.body ?? {};
  const responses = [body.response, ...(body.responseRules ?? []).map((rule) => rule.response)].filter(Boolean) as ResponseConfig[];
  if (responses.some((response) => !validResponse(response))) return reply.code(400).send({ error: "Invalid response configuration" });
  if (body.responseRules && (body.responseRules.length > 20 || body.responseRules.some((rule) => !rule.id || !rule.name.trim()))) return reply.code(400).send({ error: "Invalid response rules" });
  if (body.settings && (!Number.isInteger(body.settings.maxEvents) || body.settings.maxEvents < 10 || body.settings.maxEvents > 5000 || ![0, 1, 6, 24, 72, 168, 720].includes(body.settings.retentionHours) || (body.settings.redactedHeaders ?? []).length > 50)) {
    return reply.code(400).send({ error: "Invalid endpoint limits" });
  }
  return (await updateInbox(request.params.id, body)) ?? reply.code(404).send({ error: "Endpoint not found" });
});
app.delete<{ Params: { id: string } }>("/api/inboxes/:id", async (request, reply) => (await removeInbox(request.params.id)) ? reply.code(204).send() : reply.code(404).send());
app.get<{ Params: { id: string }; Querystring: { limit?: string; offset?: string; search?: string; method?: string; contentType?: string; since?: string } }>("/api/inboxes/:id/requests", async (request, reply) => getInbox(request.params.id) ? listRequests(request.params.id, { limit: Number(request.query.limit || 100), offset: Number(request.query.offset || 0), search: request.query.search, method: request.query.method, contentType: request.query.contentType, since: request.query.since }) : reply.code(404).send({ error: "Endpoint not found" }));
app.delete<{ Params: { id: string } }>("/api/inboxes/:id/requests", async (request, reply) => {
  if (!getInbox(request.params.id)) return reply.code(404).send();
  await clearRequests(request.params.id);
  return reply.code(204).send();
});
app.get<{ Params: { id: string } }>("/api/requests/:id", async (request, reply) => getRequest(request.params.id) ?? reply.code(404).send({ error: "Request not found" }));
app.delete<{ Params: { id: string } }>("/api/requests/:id", async (request, reply) => (await removeRequest(request.params.id)) ? reply.code(204).send() : reply.code(404).send({ error: "Request not found" }));

app.get<{ Params: { id: string } }>("/api/inboxes/:id/stream", async (request, reply) => {
  if (!getInbox(request.params.id)) return reply.code(404).send();
  reply.hijack();
  const response = reply.raw;
  response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  response.write("event: ready\ndata: {}\n\n");
  const set = clients.get(request.params.id) ?? new Set();
  set.add(response);
  clients.set(request.params.id, set);
  const heartbeat = setInterval(() => response.write(": ping\n\n"), 25000);
  request.raw.on("close", () => { clearInterval(heartbeat); set.delete(response); if (!set.size) clients.delete(request.params.id); });
});

function publish(inboxId: string, event: CapturedRequest) {
  const message = `id: ${event.id}\nevent: request\ndata: ${JSON.stringify(event)}\n\n`;
  for (const client of clients.get(inboxId) ?? []) client.write(message);
}

app.all<{ Params: { token: string; "*": string } }>("/hook/:token/*", handleHook);
app.all<{ Params: { token: string } }>("/hook/:token", handleHook);

async function handleHook(request: any, reply: any) {
  const inbox = getInboxByToken(request.params.token);
  if (!inbox) return reply.code(404).send({ error: "Endpoint not found" });
  if (!consumeRateLimit(`${inbox.id}:${request.ip}`)) return reply.header("retry-after", "60").code(429).send({ error: "Too many requests, retry in one minute" });
  const startedAt = Date.now();
  const rawBody = Buffer.isBuffer(request.body) ? request.body.toString("utf8") : request.body == null ? "" : JSON.stringify(request.body);
  const query = request.query as Record<string, string | string[]>;
  const originalHeaders = request.headers as Record<string, string | string[]>;
  const responseConfig = resolveResponse(inbox.response, inbox.responseRules, request.method, request.url, originalHeaders, query);
  const responseStatus = chooseStatus(responseConfig);
  if (responseConfig.delay) await new Promise((resolve) => setTimeout(resolve, responseConfig.delay));
  const headers = redactHeaders(originalHeaders, inbox.settings.redactSensitiveHeaders, inbox.settings.redactedHeaders ?? []);
  const captured = await addRequest({
    inboxId: inbox.id, method: request.method, path: request.url, query, headers, body: rawBody,
    contentType: request.headers["content-type"] || "text/plain", size: Buffer.byteLength(rawBody),
    ip: inbox.settings.redactIp ? maskIp(request.ip) : request.ip, responseStatus, duration: Date.now() - startedAt,
  });
  publish(inbox.id, captured);
  for (const header of responseConfig.headers) if (header.key.trim()) reply.header(header.key.trim(), renderTemplate(header.value, request.method, request.url, originalHeaders, query, rawBody));
  reply.header("content-type", responseConfig.contentType);
  return reply.code(responseStatus).send(renderTemplate(responseConfig.body, request.method, request.url, originalHeaders, query, rawBody));
}

function validResponse(response: ResponseConfig) {
  return Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 && Number.isFinite(response.delay) && response.delay >= 0 && response.delay <= 30000 &&
    Array.isArray(response.headers) && response.headers.every((header) => /^[!#$%&'*+.^_`|~0-9A-Za-z-]*$/.test(header.key.trim()) && !/[\r\n]/.test(header.value)) &&
    (response.randomStatus ?? []).every((status) => Number.isInteger(status) && status >= 100 && status <= 599);
}

function consumeRateLimit(key: string) {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.startedAt >= 60_000) { rateBuckets.set(key, { startedAt: now, count: 1 }); return true; }
  bucket.count += 1;
  return bucket.count <= rateLimitPerMinute;
}

function redactHeaders(headers: Record<string, string | string[]>, redactDefaults: boolean, customNames: string[]) {
  const sensitive = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token)$/i;
  const custom = new Set(customNames.map((name) => name.trim().toLowerCase()).filter(Boolean));
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, (redactDefaults && sensitive.test(key)) || custom.has(key.toLowerCase()) ? "[REDACTED]" : value]));
}

function maskIp(ip: string) {
  if (ip.includes(":")) return `${ip.split(":").slice(0, 4).join(":")}::`;
  const parts = ip.split(".");
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.0` : ip;
}

function resolveResponse(fallback: ResponseConfig, rules: ResponseRule[], method: string, requestPath: string, headers: Record<string, string | string[]>, query: Record<string, string | string[]>) {
  return rules.find((rule) => rule.enabled &&
    (!rule.method || rule.method === method) &&
    (!rule.pathContains || requestPath.includes(rule.pathContains)) &&
    (!rule.headerName || String(headers[rule.headerName.toLowerCase()] ?? "").includes(rule.headerValue)) &&
    (!rule.queryName || String(query[rule.queryName] ?? "").includes(rule.queryValue)))?.response ?? fallback;
}

function chooseStatus(response: ResponseConfig) {
  const options = (response.randomStatus ?? []).filter((status) => status >= 100 && status <= 599);
  return options.length ? options[Math.floor(Math.random() * options.length)] : response.status;
}

function renderTemplate(template: string, method: string, requestPath: string, headers: Record<string, string | string[]>, query: Record<string, string | string[]>, rawBody: string) {
  let body: unknown = rawBody;
  try { body = JSON.parse(rawBody); } catch { /* raw body */ }
  const read = (root: unknown, pathParts: string[]) => pathParts.reduce<unknown>((value, key) => value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined, root);
  return template.replace(/\{\{\s*request\.([\w.-]+)\s*\}\}/g, (_match, expression: string) => {
    const [scope, ...parts] = expression.split(".");
    const value = scope === "method" ? method : scope === "path" ? requestPath : scope === "body" ? read(body, parts) : scope === "query" ? read(query, parts) : scope === "header" ? read(headers, parts.map((part) => part.toLowerCase())) : undefined;
    return value === undefined || value === null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  });
}

const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist/client");
if (process.env.NODE_ENV === "production") {
  await app.register(fastifyStatic, { root: clientRoot });
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/") || request.url.startsWith("/hook/")) return reply.code(404).send({ error: "Not found" });
    return reply.sendFile("index.html");
  });
}

const cleanupTimer = setInterval(() => {
  cleanupExpiredRequests();
  const cutoff = Date.now() - 60_000;
  for (const [key, bucket] of rateBuckets) if (bucket.startedAt < cutoff) rateBuckets.delete(key);
}, 15 * 60_000);
cleanupTimer.unref();
app.addHook("onClose", async () => { clearInterval(cleanupTimer); closeStore(); });
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, async () => { await app.close(); process.exit(0); });
await app.listen({ port, host: "0.0.0.0" });
