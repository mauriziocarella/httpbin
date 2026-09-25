import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createColumnHelper, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import {
  Activity, ArrowLeft, Braces, Check, ChevronLeft, ChevronRight, Copy, Database,
  Download, FileJson2, ListFilter, Monitor, Moon, MoreHorizontal, Pause, Play, Plus,
  Radio, Save, Search, Shield, Sun, Terminal,
  Settings2, SlidersHorizontal, Trash2, X,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "./lib/api";
import type { CapturedRequest, EndpointSettings, HeaderPair, Inbox, ResponseConfig, ResponseRule } from "./lib/types";
import { cn } from "./lib/utils";
import { useAppStore } from "./store/use-app-store";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import packageJson from "../package.json";

const ResponseBodyEditor = lazy(() => import("./components/response-body-editor"));

const methodColor: Record<string, string> = {
  GET: "text-cyan-300 bg-cyan-400/10 border-cyan-400/20",
  POST: "text-emerald-300 bg-emerald-400/10 border-emerald-400/20",
  PUT: "text-amber-300 bg-amber-400/10 border-amber-400/20",
  PATCH: "text-violet-300 bg-violet-400/10 border-violet-400/20",
  DELETE: "text-red-300 bg-red-400/10 border-red-400/20",
};

const columnHelper = createColumnHelper<CapturedRequest>();
const columns = [
  columnHelper.accessor("method", { header: "Metodo" }),
  columnHelper.accessor("path", { header: "Percorso" }),
  columnHelper.accessor("responseStatus", { header: "Esito" }),
  columnHelper.accessor("createdAt", { header: "Received" }),
];

type ThemePreference = "light" | "dark" | "system";

function useThemePreference() {
  const [theme, setThemeState] = useState<ThemePreference>(() => {
    const stored = localStorage.getItem("httpbin-theme") || localStorage.getItem("relaybin-theme");
    return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
  });

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme = theme === "system" ? (media.matches ? "dark" : "light") : theme;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  const setTheme = (value: ThemePreference) => {
    localStorage.setItem("httpbin-theme", value);
    setThemeState(value);
  };
  return { theme, setTheme };
}

function formatDateTime(value: string) {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");

  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${String(date.getFullYear()).slice(-2)} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
function formatBytes(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

function CountChip({ count, selected }: { count: number; selected: boolean }) {
  if (count === 0) return null;
  return <span className={cn(
    "inline-flex h-5 shrink-0 items-center justify-center text-[10px] font-semibold leading-none tabular-nums",
    count < 10 ? "w-5 rounded-full" : "min-w-5 rounded-full px-1.5",
    selected ? "bg-amber-400 text-slate-950" : "bg-white/[0.07] text-slate-500",
  )}>{count}</span>;
}
function prettyBody(body: string, contentType: string) {
  if (!body) return "No payload";
  if (contentType.includes("json")) try { return JSON.stringify(JSON.parse(body), null, 2); } catch { return body; }
  return body;
}

function countPayloadItems(body: string, contentType: string) {
  if (!body) return 0;
  if (contentType.includes("json")) {
    try {
      const value = JSON.parse(body);
      if (Array.isArray(value)) return value.length;
      if (value && typeof value === "object") return Object.keys(value).length;
    } catch {
      return 1;
    }
  }
  return 1;
}

export default function App() {
  return <Routes>
    <Route path="/" element={<HomePage />} />
    <Route path="/endpoint/:inboxId" element={<Workspace />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}

function AppHeader() {
  const navigate = useNavigate();
  const themePreference = useThemePreference();
  return <header className="relative z-30 flex h-14 shrink-0 items-center border-b border-white/[0.07] bg-ink-950 px-4">
    <button onClick={() => navigate("/")} className="flex min-w-0 items-center gap-2.5 rounded-md outline-none" aria-label="Go to home">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-amber-400 text-slate-950 shadow-[0_0_22px_rgba(251,191,36,.17)]"><Radio className="size-4" strokeWidth={2.6} /></span>
      <span className="text-[15px] font-semibold tracking-[-.02em] text-white">httpbin</span>
      <span className="font-mono text-[10px] text-slate-600" aria-label={`Version ${packageJson.version}`}>v{packageJson.version}</span>
    </button>
    <div className="ml-auto"><ThemeMenu theme={themePreference.theme} onChange={themePreference.setTheme} /></div>
  </header>;
}

function rememberEndpoint(id: string) {
  try {
    const current = JSON.parse(localStorage.getItem("httpbin-endpoints") || localStorage.getItem("relaybin-endpoints") || "[]") as string[];
    localStorage.setItem("httpbin-endpoints", JSON.stringify([id, ...current.filter((item) => item !== id)].slice(0, 50)));
  } catch {
    localStorage.setItem("httpbin-endpoints", JSON.stringify([id]));
  }
}

function forgetEndpoint(id: string) {
  try {
    const current = JSON.parse(localStorage.getItem("httpbin-endpoints") || localStorage.getItem("relaybin-endpoints") || "[]") as string[];
    localStorage.setItem("httpbin-endpoints", JSON.stringify(current.filter((item) => item !== id)));
  } catch { /* nothing to remove */ }
}

function HomePage() {
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const createMutation = useMutation({
    mutationFn: (name: string) => api.createInbox(name),
    onSuccess: (inbox) => {
      rememberEndpoint(inbox.id);
      toast.success("Endpoint created");
      navigate(`/endpoint/${inbox.id}`);
    },
    onError: (error) => toast.error(error.message),
  });
  return <div className="flex h-dvh min-h-[560px] flex-col overflow-hidden bg-ink-950">
    <AppHeader />
    <main className="dot-grid flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="w-full max-w-lg text-center">
        <div className="mx-auto mb-6 grid size-14 place-items-center rounded-2xl border border-amber-400/20 bg-amber-400/[0.07] text-amber-400 shadow-xl"><Braces className="size-6" /></div>
        <h1 className="text-2xl font-semibold tracking-[-.025em] text-slate-100 sm:text-3xl">Inspect your next webhook</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-500">Create an endpoint, send a request, and inspect its payload, headers, and query parameters in real time.</p>
        <Button className="mt-7" size="md" variant="primary" onClick={() => setCreateOpen(true)}><Plus className="size-4" /> New endpoint</Button>
      </div>
    </main>
    {createOpen && <CreateEndpointDialog pending={createMutation.isPending} onClose={() => setCreateOpen(false)} onCreate={(name) => createMutation.mutate(name)} />}
  </div>;
}

function Workspace() {
  const queryClient = useQueryClient();
  const store = useAppStore();
  const navigate = useNavigate();
  const { inboxId } = useParams<{ inboxId: string }>();
  const [search, setSearch] = useState("");
  const [methodFilter, setMethodFilter] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [timeFilter, setTimeFilter] = useState("ALL");
  const [page, setPage] = useState(0);
  const [livePaused, setLivePaused] = useState(false);
  const [pendingEvents, setPendingEvents] = useState(0);
  const [connection, setConnection] = useState<"connecting" | "connected" | "error">("connecting");
  const [detailWidth, setDetailWidth] = useState(500);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const pausedRef = useRef(livePaused);
  pausedRef.current = livePaused;
  const pageSize = 50;
  const inboxQuery = useQuery({ queryKey: ["inbox", inboxId], queryFn: () => api.getInbox(inboxId!), enabled: !!inboxId, retry: false });
  const activeInbox = inboxQuery.data;
  const since = timeFilter === "1H" ? new Date(Date.now() - 3600_000).toISOString() : timeFilter === "24H" ? new Date(Date.now() - 86400_000).toISOString() : timeFilter === "7D" ? new Date(Date.now() - 604800_000).toISOString() : undefined;
  const requestsQuery = useQuery({
    queryKey: ["requests", inboxId, page, search, methodFilter, typeFilter, timeFilter],
    queryFn: () => api.listRequests(inboxId!, { limit: pageSize, offset: page * pageSize, search: search || undefined, method: methodFilter === "ALL" ? undefined : methodFilter, contentType: typeFilter === "ALL" ? undefined : typeFilter, since }),
    enabled: !!activeInbox && !!inboxId,
  });
  const requestPage = requestsQuery.data;
  const requests = requestPage?.items ?? [];
  const selectedRequest = requests.find((item) => item.id === store.selectedRequestId);

  useEffect(() => { store.selectRequest(undefined); setPage(0); }, [inboxId]);

  useEffect(() => {
    if (!activeInbox) return;
    setConnection("connecting");
    const events = new EventSource(`/api/inboxes/${activeInbox.id}/stream`);
    events.addEventListener("ready", () => setConnection("connected"));
    events.onerror = () => setConnection("error");
    events.addEventListener("request", () => {
      if (pausedRef.current) { setPendingEvents((count) => count + 1); return; }
      queryClient.invalidateQueries({ queryKey: ["requests", activeInbox.id] });
    });
    return () => events.close();
  }, [activeInbox?.id, page, queryClient]);

  useEffect(() => { setPage(0); }, [search, methodFilter, typeFilter, timeFilter]);

  const resumeLive = () => {
    setLivePaused(false);
    setPendingEvents(0);
    setPage(0);
    queryClient.invalidateQueries({ queryKey: ["requests", activeInbox?.id] });
  };

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteInbox(id),
    onSuccess: () => {
      store.selectRequest(undefined);
      if (inboxId) forgetEndpoint(inboxId);
      toast.success("Endpoint deleted");
      navigate("/");
    },
    onError: (error) => toast.error(error.message),
  });
  const clearMutation = useMutation({
    mutationFn: (id: string) => api.clearRequests(id),
    onSuccess: () => {
      store.selectRequest(undefined);
      setPage(0);
      queryClient.invalidateQueries({ queryKey: ["requests", activeInbox?.id] });
      queryClient.invalidateQueries({ queryKey: ["inbox", activeInbox?.id] });
      toast.success("Events cleared");
    },
  });
  const deleteRequestMutation = useMutation({
    mutationFn: (id: string) => api.deleteRequest(id),
    onSuccess: () => {
      store.selectRequest(undefined);
      queryClient.invalidateQueries({ queryKey: ["requests", activeInbox?.id] });
      toast.success("Event deleted");
    },
    onError: (error) => toast.error(error.message),
  });

  const filtered = requests;
  useReactTable({ data: filtered, columns, getCoreRowModel: getCoreRowModel() });

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.matches("input, textarea, select, [contenteditable=true]")) return;
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const current = filtered.findIndex((item) => item.id === store.selectedRequestId);
      const next = event.key === "ArrowDown" ? Math.min(filtered.length - 1, current + 1) : Math.max(0, current < 0 ? 0 : current - 1);
      if (filtered[next]) store.selectRequest(filtered[next].id);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [filtered, store.selectedRequestId]);

  const origin = window.location.origin;
  const hookUrl = activeInbox ? `${origin}/hook/${activeInbox.token}` : "";

  async function copy(text: string, label = "Copied") {
    await navigator.clipboard.writeText(text);
    toast.success(label);
  }

  const startResize = (event: React.PointerEvent) => {
    event.preventDefault();
    const resize = (moveEvent: PointerEvent) => setDetailWidth(Math.max(360, Math.min(760, window.innerWidth - moveEvent.clientX)));
    const stop = () => { window.removeEventListener("pointermove", resize); window.removeEventListener("pointerup", stop); };
    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", stop);
  };

  return (
    <div className="flex h-dvh min-h-[620px] flex-col overflow-hidden bg-ink-950">
      <AppHeader />

      <main className="relative flex min-h-0 flex-1">
        <section className={cn("flex min-w-0 flex-1 flex-col border-r border-white/[0.07] bg-ink-950", store.mobilePanel === "detail" ? "hidden md:flex" : "flex")}>
          {activeInbox ? (
            <>
              <div className="border-b border-white/[0.07] bg-ink-950 px-4 py-3 sm:px-5">
                <div className="mb-2.5 flex min-h-6 items-center gap-2">
                  <h1 className="truncate text-base font-semibold text-slate-100">{activeInbox.name}</h1>
                  <Button size="sm" variant="ghost" className="ml-auto h-7 px-2 text-slate-500" onClick={() => setSettingsOpen(true)}><Settings2 className="size-3.5" /><span className="hidden sm:inline">Settings</span></Button>
                </div>
                <div className="flex min-w-0 items-center rounded-md border border-white/10 bg-black/20 font-mono text-xs">
                  <span className="min-w-0 flex-1 truncate px-3 text-slate-400">{hookUrl}</span>
                  <button className="border-l border-white/10 p-2.5 text-slate-500 hover:text-amber-300" onClick={() => copy(hookUrl, "URL copied")} aria-label="Copy URL"><Copy className="size-3.5" /></button>
                </div>
              </div>
              <div className="flex min-h-14 flex-wrap items-center gap-2 border-b border-white/[0.07] px-3 py-2 sm:px-4">
                <div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-600" /><Input className="h-8 border-transparent bg-white/[0.035] pl-9 text-xs focus:border-white/10" placeholder="Filter events…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
                <select aria-label="Filter by method" className="h-8 rounded-md border border-white/10 bg-black/20 px-2 text-[11px] text-slate-400 outline-none" value={methodFilter} onChange={(event) => setMethodFilter(event.target.value)}><option value="ALL">All methods</option>{["GET","POST","PUT","PATCH","DELETE"].map((method) => <option key={method}>{method}</option>)}</select>
                <select aria-label="Filter by content type" className="hidden h-8 rounded-md border border-white/10 bg-black/20 px-2 text-[11px] text-slate-400 outline-none lg:block" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="ALL">All content types</option><option value="json">JSON</option><option value="xml">XML</option><option value="html">HTML</option><option value="text/plain">Text</option></select>
                <select aria-label="Filter by time range" className="hidden h-8 rounded-md border border-white/10 bg-black/20 px-2 text-[11px] text-slate-400 outline-none xl:block" value={timeFilter} onChange={(event) => setTimeFilter(event.target.value)}><option value="ALL">All time</option><option value="1H">Last hour</option><option value="24H">Last 24 hours</option><option value="7D">Last 7 days</option></select>
                <span className="hidden text-xs tabular-nums text-slate-600 sm:inline">{requestPage?.total ?? 0} events</span>
                <Button size="sm" variant="ghost" className={cn("h-8 px-2", livePaused ? "text-amber-300" : "text-slate-500")} aria-label={livePaused ? "Resume updates" : "Pause updates"} title={livePaused ? "Resume updates" : "Pause updates"} onClick={() => livePaused ? resumeLive() : setLivePaused(true)}>{livePaused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}{pendingEvents > 0 && <CountChip count={pendingEvents} selected />}</Button>
                <Button size="icon" variant="ghost" className="size-8" title="Clear events" disabled={!requests.length || clearMutation.isPending} onClick={() => clearMutation.mutate(activeInbox.id)}><Trash2 className="size-3.5" /></Button>
              </div>
              <div className="flex h-8 items-center gap-2 border-b border-white/[0.05] px-4 text-[10px] text-slate-600"><span className={cn("size-1.5 rounded-full", livePaused ? "bg-amber-400" : connection === "connected" ? "bg-emerald-400" : connection === "error" ? "bg-red-400" : "bg-slate-500")} />{livePaused ? `Updates paused${pendingEvents ? ` · ${pendingEvents} new` : ""}` : connection === "connected" ? "Live connection active" : connection === "error" ? "Reconnecting" : "Connecting"}<span className="ml-auto hidden sm:inline">↑ ↓ to navigate</span></div>
              <RequestList requests={filtered} selectedId={selectedRequest?.id} onSelect={(id) => store.selectRequest(id)} loading={requestsQuery.isLoading} hookUrl={hookUrl} onCopy={copy} />
              {(requestPage?.total ?? 0) > pageSize && <div className="flex h-11 shrink-0 items-center justify-between border-t border-white/[0.07] px-4 text-[11px] text-slate-600"><span>{page * pageSize + 1}–{Math.min((page + 1) * pageSize, requestPage?.total ?? 0)} of {requestPage?.total}</span><div className="flex gap-1"><Button size="icon" variant="ghost" className="size-7" disabled={page === 0} onClick={() => { setPage((value) => value - 1); store.selectRequest(undefined); }}><ChevronLeft className="size-3.5" /></Button><Button size="icon" variant="ghost" className="size-7" disabled={(page + 1) * pageSize >= (requestPage?.total ?? 0)} onClick={() => { setPage((value) => value + 1); store.selectRequest(undefined); }}><ChevronRight className="size-3.5" /></Button></div></div>}
            </>
          ) : (
            inboxQuery.isLoading ? <div className="flex-1 animate-pulse bg-white/[0.015]" /> : <MissingEndpoint onHome={() => navigate("/")} />
          )}
        </section>

        <aside style={{ width: detailWidth }} className={cn("relative w-full shrink-0 flex-col bg-ink-900 md:max-w-[60vw]", store.mobilePanel === "detail" ? "flex" : "hidden md:flex")}>
          <button aria-label="Resize event details" onPointerDown={startResize} className="absolute inset-y-0 -left-1 z-20 hidden w-2 cursor-col-resize md:block" />
          <RequestDetail request={selectedRequest} hookUrl={hookUrl} onCopy={copy} onBack={() => store.selectRequest(undefined)} onDelete={(id) => deleteRequestMutation.mutate(id)} deleting={deleteRequestMutation.isPending} />
        </aside>
      </main>

      {settingsOpen && activeInbox && <EndpointSettingsDialog inbox={activeInbox} hookUrl={hookUrl} onClose={() => setSettingsOpen(false)} onDelete={() => { setSettingsOpen(false); deleteMutation.mutate(activeInbox.id); }} />}
    </div>
  );
}

function ThemeMenu({ theme, onChange }: { theme: ThemePreference; onChange: (theme: ThemePreference) => void }) {
  const [open, setOpen] = useState(false);
  const options = [
    { id: "light", label: "Light", icon: Sun },
    { id: "dark", label: "Dark", icon: Moon },
    { id: "system", label: "System", icon: Monitor },
  ] as const;
  const ActiveIcon = options.find((option) => option.id === theme)?.icon ?? Monitor;
  return <div className="relative">
    <Button size="icon" variant="secondary" className="size-8" aria-label="Change theme" aria-expanded={open} title="Theme" onClick={() => setOpen((value) => !value)}><ActiveIcon className="size-3.5" /></Button>
    {open && <><button className="fixed inset-0 z-30 cursor-default" aria-label="Close theme picker" onClick={() => setOpen(false)} /><div className="absolute right-0 top-10 z-40 w-40 rounded-lg border border-white/10 bg-ink-850 p-1.5 shadow-2xl">{options.map((option) => <button key={option.id} onClick={() => { onChange(option.id); setOpen(false); }} className={cn("flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs transition hover:bg-white/[0.06]", theme === option.id ? "text-amber-500" : "text-slate-400")}><option.icon className="size-3.5" /><span className="flex-1">{option.label}</span>{theme === option.id && <Check className="size-3.5" />}</button>)}</div></>}
  </div>;
}

function RequestList({ requests, selectedId, onSelect, loading, hookUrl, onCopy }: { requests: CapturedRequest[]; selectedId?: string; onSelect: (id: string) => void; loading: boolean; hookUrl: string; onCopy: (text: string, label?: string) => void }) {
  if (loading) return <div className="space-y-px p-3">{[1,2,3,4].map(i => <div key={i} className="h-16 animate-pulse bg-white/[0.025]" />)}</div>;
  if (!requests.length) return <div className="dot-grid flex flex-1 items-center justify-center p-6"><div className="max-w-md text-center"><div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl border border-white/10 bg-ink-850 shadow-xl"><Activity className="size-5 text-amber-300" /></div><h2 className="text-base font-semibold text-slate-200">Waiting for the first event</h2><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">Send an HTTP request to the endpoint URL. It will appear here in real time.</p><button onClick={() => onCopy(`curl -X POST '${hookUrl}' -H 'Content-Type: application/json' -d '{"hello":"world"}'`, "cURL command copied")} className="mt-5 inline-flex items-center gap-2 rounded-md border border-white/10 bg-black/20 px-3 py-2 font-mono text-xs text-slate-400 hover:border-amber-400/30 hover:text-amber-200"><Copy className="size-3.5" /> copy sample cURL</button></div></div>;
  return <div className="flex-1 overflow-y-auto">
    {requests.map((request) => <button key={request.id} onClick={() => onSelect(request.id)} className={cn("group flex w-full items-center gap-3 border-b border-white/[0.055] px-4 py-3 text-left transition hover:bg-white/[0.025] sm:px-5", request.id === selectedId && "bg-white/[0.045]")}>
      <span className={cn("w-[58px] shrink-0 rounded border px-1.5 py-1 text-center font-mono text-[10px] font-bold", methodColor[request.method] || "border-white/10 bg-white/5 text-slate-300")}>{request.method}</span>
      <div className="min-w-0 flex-1"><div className="truncate font-mono text-xs text-slate-300">{request.path}</div><div className="mt-1 flex items-center gap-2 text-[11px] text-slate-600"><span>{request.contentType.split(";")[0]}</span><span>·</span><span>{formatBytes(request.size)}</span></div></div>
      <div className="text-right"><div className="text-xs tabular-nums text-slate-400">{formatDateTime(request.createdAt)}</div><div className="mt-1 text-[10px] tabular-nums text-slate-600">{request.duration} ms</div></div><ChevronRight className="size-3.5 text-slate-700 transition group-hover:translate-x-0.5 group-hover:text-slate-500" />
    </button>)}
  </div>;
}

function RequestDetail({ request, hookUrl, onCopy, onBack, onDelete, deleting }: { request?: CapturedRequest; hookUrl: string; onCopy: (text: string, label?: string) => void; onBack: () => void; onDelete: (id: string) => void; deleting: boolean }) {
  const store = useAppStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const [rawPayload, setRawPayload] = useState(false);
  useEffect(() => { setMenuOpen(false); setRawPayload(false); }, [request?.id]);
  if (!request) return <div className="dot-grid flex flex-1 items-center justify-center p-8"><div className="text-center"><FileJson2 className="mx-auto size-8 text-slate-700" /><p className="mt-3 text-sm text-slate-500">Select an event to inspect it</p></div></div>;
  const tabs = [
    { id: "payload", label: "Payload", count: countPayloadItems(request.body, request.contentType) },
    { id: "headers", label: "Headers", count: Object.keys(request.headers).length },
    { id: "query", label: "Query", count: Object.keys(request.query).length },
  ] as const;
  const curl = buildCurl(request, hookUrl);
  const download = () => {
    const blob = new Blob([JSON.stringify(request, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `httpbin-${request.id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return <>
    <div className="flex h-14 items-center border-b border-white/[0.07] px-4"><button onClick={onBack} className="mr-2 rounded-md p-1.5 text-slate-500 hover:bg-white/5 md:hidden"><ArrowLeft className="size-4" /></button><span className={cn("rounded border px-1.5 py-1 font-mono text-[10px] font-bold", methodColor[request.method] || "border-white/10")}>{request.method}</span><span className="ml-3 min-w-0 flex-1 truncate font-mono text-xs text-slate-300">{request.path}</span><div className="relative"><button aria-label="Event actions" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)} className={cn("rounded-md p-2 transition", menuOpen ? "bg-white/[0.07] text-slate-200" : "text-slate-600 hover:bg-white/5 hover:text-slate-300")}><MoreHorizontal className="size-4" /></button>{menuOpen && <><button className="fixed inset-0 z-30 cursor-default" aria-label="Close menu" onClick={() => setMenuOpen(false)} /><div className="absolute right-0 top-10 z-40 w-48 rounded-lg border border-white/10 bg-ink-850 p-1.5 shadow-2xl"><button onClick={() => { setMenuOpen(false); onCopy(curl, "cURL command copied"); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-slate-300 transition hover:bg-white/[0.06]"><Terminal className="size-3.5" /> Copy as cURL</button><button onClick={() => { setMenuOpen(false); download(); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-slate-300 transition hover:bg-white/[0.06]"><Download className="size-3.5" /> Export JSON</button><div className="my-1 border-t border-white/[0.07]" /><button disabled={deleting} onClick={() => { setMenuOpen(false); onDelete(request.id); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-red-300 transition hover:bg-red-400/10 disabled:opacity-50"><Trash2 className="size-3.5" /> Delete event</button></div></>}</div></div>
    <div className="grid grid-cols-3 border-b border-white/[0.07] bg-black/10 px-4 py-3 text-xs">
      <div><div className="text-slate-600">Received</div><div className="mt-1 text-slate-300">{formatDateTime(request.createdAt)}</div></div>
      <div><div className="text-slate-600">Response</div><div className="mt-1 text-emerald-300">{request.responseStatus}</div></div>
      <div><div className="text-slate-600">Source</div><div className="mt-1 truncate text-slate-300" title={request.ip}>{request.ip}</div></div>
    </div>
    <div className="flex items-end gap-1 border-b border-white/[0.07] px-3 pt-2">
      {tabs.map(tab => <button key={tab.id} onClick={() => store.setDetailTab(tab.id)} className={cn("flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs transition", store.detailTab === tab.id ? "border-amber-400 text-slate-100" : "border-transparent text-slate-500 hover:text-slate-300")}>{tab.label}<CountChip count={tab.count} selected={store.detailTab === tab.id} /></button>)}
      {store.detailTab === "payload" && request.body && <button onClick={() => setRawPayload((value) => !value)} className="mb-1.5 ml-auto rounded px-2 py-1 text-[10px] text-slate-500 hover:bg-white/5 hover:text-slate-300">{rawPayload ? "Formatted" : "Raw"}</button>}
    </div>
    <div className="min-h-0 flex-1 overflow-auto p-4">
      {store.detailTab === "payload" && <CodeBlock value={rawPayload ? request.body || "No payload" : prettyBody(request.body, request.contentType)} />}
      {store.detailTab === "headers" && <KeyValue data={request.headers} />}
      {store.detailTab === "query" && (Object.keys(request.query).length ? <KeyValue data={request.query} /> : <EmptyTab label="This request has no query parameters." />)}
    </div>
  </>;
}

function shellQuote(value: string) { return `'${value.replaceAll("'", `'\\''`)}'`; }
function buildCurl(request: CapturedRequest, hookUrl: string) {
  const suffix = request.path.startsWith(new URL(hookUrl).pathname) ? request.path.slice(new URL(hookUrl).pathname.length) : "";
  const headers = Object.entries(request.headers)
    .filter(([key, value]) => !["host", "content-length"].includes(key.toLowerCase()) && value !== "[REDACTED]")
    .map(([key, value]) => ` -H ${shellQuote(`${key}: ${Array.isArray(value) ? value.join(", ") : value}`)}`).join("");
  return `curl -X ${request.method}${headers}${request.body ? ` --data-raw ${shellQuote(request.body)}` : ""} ${shellQuote(`${hookUrl}${suffix}`)}`;
}

function CodeBlock({ value }: { value: string }) { return <pre className="min-h-full whitespace-pre-wrap break-words rounded-lg border border-white/[0.07] bg-black/25 p-4 font-mono text-xs leading-6 text-slate-300">{value}</pre>; }
function KeyValue({ data }: { data: Record<string, string | string[]> }) { return <div className="overflow-hidden rounded-lg border border-white/[0.07]">{Object.entries(data).map(([key, value]) => <div key={key} className="grid grid-cols-[minmax(100px,36%)_1fr] border-b border-white/[0.06] last:border-0"><div className="flex items-center break-all bg-black/20 px-3 py-2.5 font-mono text-xs text-amber-200/80">{key}</div><div className="flex items-center break-all px-3 py-2.5 font-mono text-xs leading-5 text-slate-400">{Array.isArray(value) ? value.join(", ") : value}</div></div>)}</div>; }
function EmptyTab({ label }: { label: string }) { return <div className="grid h-40 place-items-center rounded-lg border border-dashed border-white/10 text-sm text-slate-600">{label}</div>; }

function EndpointSettingsDialog({ inbox, hookUrl, onClose, onDelete }: { inbox: Inbox; hookUrl: string; onClose: () => void; onDelete: () => void }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"general" | "response" | "rules" | "privacy">("general");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [name, setName] = useState(inbox.name);
  const [response, setResponse] = useState<ResponseConfig>(inbox.response);
  const [rules, setRules] = useState<ResponseRule[]>(inbox.responseRules);
  const [settings, setSettings] = useState<EndpointSettings>(inbox.settings);
  const mutation = useMutation({
    mutationFn: () => {
      const invalid = [response, ...rules.map((rule) => rule.response)].find((item) => !validBody(item));
      if (invalid) throw new Error(`Invalid ${invalid.contentType} body`);
      return api.updateInbox(inbox.id, { name, response, responseRules: rules, settings });
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["inbox", inbox.id] }); queryClient.invalidateQueries({ queryKey: ["requests", inbox.id] }); toast.success("Configuration saved"); onClose(); },
    onError: (error) => toast.error(error.message),
  });
  const tabs = [
    { id: "general", label: "General", icon: Settings2 },
    { id: "response", label: "Response", icon: SlidersHorizontal },
    { id: "rules", label: "Rules", icon: ListFilter },
    { id: "privacy", label: "Data", icon: Shield },
  ] as const;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-3 backdrop-blur-[2px] sm:p-6" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <div role="dialog" aria-modal="true" aria-labelledby="endpoint-settings-title" className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-white/10 bg-ink-900 shadow-2xl">
      <div className="flex h-16 shrink-0 items-center border-b border-white/[0.07] px-5"><div><h2 id="endpoint-settings-title" className="text-sm font-semibold text-slate-100">Endpoint settings</h2><p className="mt-0.5 max-w-md truncate text-xs text-slate-600">{inbox.name}</p></div><button onClick={onClose} aria-label="Close settings" className="ml-auto rounded-md p-2 text-slate-500 hover:bg-white/5"><X className="size-4" /></button></div>
      <div className="flex shrink-0 gap-1 border-b border-white/[0.07] px-4 pt-2">
        {tabs.map((item) => <button key={item.id} onClick={() => setTab(item.id)} className={cn("flex items-center gap-2 border-b-2 px-3 py-2.5 text-xs transition", tab === item.id ? "border-amber-400 text-slate-100" : "border-transparent text-slate-500 hover:text-slate-300")}><item.icon className="size-3.5" />{item.label}</button>)}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
        {tab === "general" && <div className="space-y-7">
          <Field label="Endpoint name"><Input value={name} onChange={(event) => setName(event.target.value)} maxLength={64} /></Field>
          <Field label="Endpoint URL"><div className="flex items-center rounded-md border border-white/10 bg-black/20 font-mono text-xs"><span className="min-w-0 flex-1 truncate px-3 text-slate-400">{hookUrl}</span><button type="button" className="border-l border-white/10 p-3 text-slate-500 hover:text-amber-400" aria-label="Copy endpoint URL" onClick={async () => { await navigator.clipboard.writeText(hookUrl); toast.success("URL copied"); }}><Copy className="size-3.5" /></button></div></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="Created at"><div className="rounded-md border border-white/[0.07] bg-black/10 px-3 py-2.5 text-sm text-slate-400">{formatDateTime(inbox.createdAt)}</div></Field><Field label="Storage used"><div className="rounded-md border border-white/[0.07] bg-black/10 px-3 py-2.5 text-sm text-slate-400">{inbox.requestCount ?? 0} events · {formatBytes(inbox.storageBytes ?? 0)}</div></Field></div>
          <div className="rounded-lg border border-red-400/10 bg-red-400/[0.025] p-4"><div className="text-sm font-medium text-slate-300">Delete endpoint</div><p className="mt-1 text-xs leading-5 text-slate-600">Permanently removes the endpoint and every captured event.</p><Button className="mt-3" variant="danger" size="sm" onClick={() => setDeleteConfirmOpen(true)}><Trash2 className="size-3.5" /> Delete endpoint</Button></div>
        </div>}
        {tab === "response" && <div className="space-y-7">
          <p className="text-xs leading-5 text-slate-500">This configuration applies to every new request received by the endpoint.</p>
          <div className="flex flex-wrap gap-2"><span className="mr-1 self-center text-[11px] text-slate-600">Presets</span><Button size="sm" variant="secondary" onClick={() => setResponse(responsePreset(200))}>JSON 200</Button><Button size="sm" variant="secondary" onClick={() => setResponse(responsePreset(202))}>Accepted 202</Button><Button size="sm" variant="secondary" onClick={() => setResponse(responsePreset(500))}>Error 500</Button><Button size="sm" variant="secondary" onClick={() => setResponse(responsePreset(204))}>Empty 204</Button><Button size="sm" variant="secondary" onClick={() => setResponse({ ...responsePreset(504), delay: 30000 })}>Timeout 30s</Button></div>
          <ResponseFields value={response} onChange={setResponse} editor />
        </div>}
        {tab === "rules" && <div className="space-y-4">
          <div className="flex items-start justify-between gap-4"><p className="text-xs leading-5 text-slate-500">The first active rule that matches the request replaces the default response.</p><Button size="sm" variant="secondary" onClick={() => setRules((current) => [...current, newRule()])}><Plus className="size-3.5" /> Rule</Button></div>
          {!rules.length && <EmptyTab label="No rules configured." />}
          {rules.map((rule, index) => <div key={rule.id} className="space-y-4 rounded-lg border border-white/[0.08] bg-black/10 p-4">
            <div className="flex items-center gap-2"><input aria-label={`Enable ${rule.name}`} type="checkbox" checked={rule.enabled} onChange={(event) => setRules((current) => current.map((item) => item.id === rule.id ? { ...item, enabled: event.target.checked } : item))} /><Input className="h-8" value={rule.name} onChange={(event) => setRules((current) => current.map((item) => item.id === rule.id ? { ...item, name: event.target.value } : item))} /><Button size="icon" variant="ghost" className="size-8 shrink-0" onClick={() => setRules((current) => current.filter((item) => item.id !== rule.id))}><Trash2 className="size-3.5" /></Button></div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3"><select className="h-9 rounded-md border border-white/10 bg-black/20 px-2 text-xs text-slate-300 outline-none" value={rule.method} onChange={(event) => updateRule(setRules, rule.id, { method: event.target.value })}><option value="">Any method</option>{["GET","POST","PUT","PATCH","DELETE"].map((method) => <option key={method}>{method}</option>)}</select><Input className="h-9 text-xs" placeholder="Path contains" value={rule.pathContains} onChange={(event) => updateRule(setRules, rule.id, { pathContains: event.target.value })} /><Input className="h-9 text-xs" placeholder="Header name" value={rule.headerName} onChange={(event) => updateRule(setRules, rule.id, { headerName: event.target.value.toLowerCase() })} /><Input className="h-9 text-xs" placeholder="Header value contains" value={rule.headerValue} onChange={(event) => updateRule(setRules, rule.id, { headerValue: event.target.value })} /><Input className="h-9 text-xs" placeholder="Query name" value={rule.queryName} onChange={(event) => updateRule(setRules, rule.id, { queryName: event.target.value })} /><Input className="h-9 text-xs" placeholder="Query value contains" value={rule.queryValue} onChange={(event) => updateRule(setRules, rule.id, { queryValue: event.target.value })} /></div>
            <div className="grid grid-cols-[1fr_1fr_2fr] gap-2"><Input aria-label="Rule status" type="number" min={100} max={599} value={rule.response.status} onChange={(event) => updateRuleResponse(setRules, rule.id, { status: Number(event.target.value) })} /><Input aria-label="Rule delay" type="number" min={0} max={30000} value={rule.response.delay} onChange={(event) => updateRuleResponse(setRules, rule.id, { delay: Number(event.target.value) })} /><select aria-label="Rule content type" className="h-10 rounded-md border border-white/10 bg-black/20 px-2 text-xs text-slate-300 outline-none" value={rule.response.contentType} onChange={(event) => updateRuleResponse(setRules, rule.id, { contentType: event.target.value })}><option>application/json</option><option>text/plain</option><option>text/html</option><option>application/xml</option></select></div>
            <textarea aria-label={`Body ${rule.name}`} className="min-h-24 w-full rounded-md border border-white/10 bg-black/20 p-3 font-mono text-xs text-slate-300 outline-none" value={rule.response.body} onChange={(event) => updateRuleResponse(setRules, rule.id, { body: event.target.value })} />
            <div className="text-[10px] text-slate-600">Priority {index + 1} · every populated condition must match</div>
          </div>)}
        </div>}
        {tab === "privacy" && <div className="space-y-7">
          <div className="grid grid-cols-2 gap-3"><Field label="Retention"><select className="h-10 w-full rounded-md border border-white/10 bg-black/20 px-3 text-sm text-slate-300 outline-none" value={settings.retentionHours} onChange={(event) => setSettings({ ...settings, retentionHours: Number(event.target.value) })}><option value={1}>1 hour</option><option value={6}>6 hours</option><option value={24}>24 hours</option><option value={72}>3 days</option><option value={168}>7 days</option><option value={720}>30 days</option><option value={0}>No expiration</option></select></Field><Field label="Maximum events"><Input type="number" min={10} max={5000} value={settings.maxEvents} onChange={(event) => setSettings({ ...settings, maxEvents: Math.max(10, Math.min(5000, Number(event.target.value))) })} /></Field></div>
          <div className="space-y-3"><ToggleSetting checked={settings.redactSensitiveHeaders} onChange={(checked) => setSettings({ ...settings, redactSensitiveHeaders: checked })} title="Redact sensitive headers" description="Authorization, cookies, API keys, and tokens are stored as [REDACTED]." /><Field label="Additional headers to redact" hint="comma-separated"><Input placeholder="For example: x-customer-token, x-secret" value={(settings.redactedHeaders ?? []).join(", ")} onChange={(event) => setSettings({ ...settings, redactedHeaders: event.target.value.split(",").map((name) => name.trim().toLowerCase()).filter(Boolean) })} /></Field><ToggleSetting checked={settings.redactIp} onChange={(checked) => setSettings({ ...settings, redactIp: checked })} title="Anonymize IP addresses" description="Clears the final IPv4 octet and truncates IPv6 addresses." /></div>
          <p className="text-xs leading-5 text-slate-600">Webhooks may contain credentials and personal data. Use the shortest practical retention period and redact fields that are not needed for debugging.</p>
          <div className="rounded-lg border border-white/[0.07] p-4"><div className="flex items-center gap-2 text-xs font-medium text-slate-300"><Database className="size-3.5 text-amber-400" /> SQLite persistence</div><p className="mt-2 text-xs leading-5 text-slate-600">Expired events are removed automatically. Lowering the limit immediately removes the oldest events.</p></div>
        </div>}
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-white/[0.07] p-4"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => mutation.mutate()} disabled={mutation.isPending}><Save className="size-4" /> Save changes</Button></div>
    </div>
    {deleteConfirmOpen && <ConfirmActionDialog title="Delete this endpoint?" description={`The “${inbox.name}” endpoint and all of its events will be permanently deleted.`} confirmLabel="Delete endpoint" onCancel={() => setDeleteConfirmOpen(false)} onConfirm={onDelete} />}
  </div>;
}

function responsePreset(status: number): ResponseConfig {
  if (status === 204) return { status, delay: 0, contentType: "text/plain", headers: [], body: "", randomStatus: [] };
  if (status >= 400) return { status, delay: 0, contentType: "application/json", headers: [], body: JSON.stringify({ success: false, error: status === 504 ? "Gateway timeout" : "Internal error" }, null, 2), randomStatus: [] };
  return { status, delay: 0, contentType: "application/json", headers: [], body: JSON.stringify(status === 202 ? { accepted: true } : { success: true }, null, 2), randomStatus: [] };
}
function newRule(): ResponseRule { return { id: crypto.randomUUID(), name: "New rule", enabled: true, method: "", pathContains: "", headerName: "", headerValue: "", queryName: "", queryValue: "", response: responsePreset(200) }; }
function updateRule(setRules: React.Dispatch<React.SetStateAction<ResponseRule[]>>, id: string, patch: Partial<ResponseRule>) { setRules((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item)); }
function updateRuleResponse(setRules: React.Dispatch<React.SetStateAction<ResponseRule[]>>, id: string, patch: Partial<ResponseConfig>) { setRules((current) => current.map((item) => item.id === id ? { ...item, response: { ...item.response, ...patch } } : item)); }
function validBody(response: ResponseConfig) {
  if (!response.body || response.body.includes("{{")) return true;
  if (response.contentType.includes("json")) try { JSON.parse(response.body); return true; } catch { return false; }
  if (response.contentType.includes("xml")) return !new DOMParser().parseFromString(response.body, "application/xml").querySelector("parsererror");
  return true;
}

function ResponseFields({ value, onChange, editor = false }: { value: ResponseConfig; onChange: (value: ResponseConfig) => void; editor?: boolean }) {
  const updateHeader = (index: number, patch: Partial<HeaderPair>) => onChange({ ...value, headers: value.headers.map((item, i) => i === index ? { ...item, ...patch } : item) });
  return <div className="space-y-6">
    <div className="grid grid-cols-2 gap-3"><Field label="Status code"><Input type="number" min={100} max={599} value={value.status} onChange={(event) => onChange({ ...value, status: Number(event.target.value) })} /></Field><Field label="Delay (ms)" hint="max 30000"><Input type="number" min={0} max={30000} value={value.delay} onChange={(event) => onChange({ ...value, delay: Number(event.target.value) })} /></Field></div>
    <Field label="Random status codes" hint="optional, comma-separated"><Input placeholder="For example: 200, 202, 500" value={(value.randomStatus ?? []).join(", ")} onChange={(event) => onChange({ ...value, randomStatus: event.target.value.split(",").map(Number).filter((status) => Number.isInteger(status) && status >= 100 && status <= 599) })} /></Field>
    <Field label="Content-Type"><select className="h-10 w-full rounded-md border border-white/10 bg-black/20 px-3 text-sm text-slate-200 outline-none focus:border-amber-400/50" value={value.contentType} onChange={(event) => onChange({ ...value, contentType: event.target.value })}><option>application/json</option><option>text/plain</option><option>text/html</option><option>application/xml</option></select></Field>
    <Field label="Response body" hint="Templates: {{request.body.id}}, {{request.query.key}}, {{request.header.x-id}}">{editor ? <Suspense fallback={<div className="h-[260px] animate-pulse rounded-md border border-white/10 bg-black/20" />}><ResponseBodyEditor contentType={value.contentType} value={value.body} onChange={(body) => onChange({ ...value, body })} /></Suspense> : <textarea className="min-h-32 w-full rounded-md border border-white/10 bg-black/20 p-3 font-mono text-xs text-slate-300 outline-none" value={value.body} onChange={(event) => onChange({ ...value, body: event.target.value })} />}</Field>
    <Field label="Custom headers"><div className="space-y-2">{value.headers.map((header, index) => <div className="flex gap-2" key={index}><Input placeholder="X-Header" value={header.key} onChange={(event) => updateHeader(index, { key: event.target.value })} /><Input placeholder="Value or template" value={header.value} onChange={(event) => updateHeader(index, { value: event.target.value })} /><Button size="icon" variant="ghost" className="shrink-0" onClick={() => onChange({ ...value, headers: value.headers.filter((_, i) => i !== index) })}><X className="size-4" /></Button></div>)}<Button size="sm" variant="secondary" onClick={() => onChange({ ...value, headers: [...value.headers, { key: "", value: "" }] })}><Plus className="size-3.5" /> Add header</Button></div></Field>
  </div>;
}

function ToggleSetting({ checked, onChange, title, description }: { checked: boolean; onChange: (checked: boolean) => void; title: string; description: string }) {
  return <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-white/[0.07] p-4"><input className="mt-0.5" type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span><span className="block text-sm text-slate-300">{title}</span><span className="mt-1 block text-xs leading-5 text-slate-600">{description}</span></span></label>;
}

function CreateEndpointDialog({ pending, onClose, onCreate }: { pending: boolean; onClose: () => void; onCreate: (name: string) => void }) {
  const [name, setName] = useState("");
  const submit = () => {
    const value = name.trim();
    if (value && !pending) onCreate(value);
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <div role="dialog" aria-modal="true" aria-labelledby="create-endpoint-title" className="w-full max-w-md overflow-hidden rounded-xl border border-white/10 bg-ink-900 shadow-2xl">
      <div className="flex items-start border-b border-white/[0.07] px-5 py-4"><div><h2 id="create-endpoint-title" className="text-sm font-semibold text-slate-100">New endpoint</h2><p className="mt-1 text-xs leading-5 text-slate-600">Give it a recognizable name. You can change it later in settings.</p></div><button onClick={onClose} aria-label="Close" className="ml-auto rounded-md p-2 text-slate-500 hover:bg-white/5"><X className="size-4" /></button></div>
      <div className="p-5"><Field label="Endpoint name"><Input autoFocus placeholder="For example: Stripe payments" value={name} maxLength={64} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") submit(); if (event.key === "Escape") onClose(); }} /></Field></div>
      <div className="flex justify-end gap-2 border-t border-white/[0.07] p-4"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!name.trim() || pending} onClick={submit}><Plus className="size-4" /> Create endpoint</Button></div>
    </div>
  </div>;
}

function ConfirmActionDialog({ title, description, confirmLabel, onCancel, onConfirm }: { title: string; description: string; confirmLabel: string; onCancel: () => void; onConfirm: () => void }) {
  return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.currentTarget === event.target) onCancel(); }}>
    <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-action-title" aria-describedby="confirm-action-description" className="w-full max-w-sm overflow-hidden rounded-xl border border-white/10 bg-ink-900 shadow-2xl">
      <div className="p-5"><div className="mb-4 grid size-10 place-items-center rounded-full bg-red-400/10 text-red-300"><Trash2 className="size-4" /></div><h2 id="confirm-action-title" className="text-base font-semibold text-slate-100">{title}</h2><p id="confirm-action-description" className="mt-2 text-sm leading-6 text-slate-500">{description}</p></div>
      <div className="flex justify-end gap-2 border-t border-white/[0.07] p-4"><Button variant="ghost" onClick={onCancel}>Cancel</Button><Button className="bg-red-500 text-white hover:bg-red-400" onClick={onConfirm}><Trash2 className="size-4" /> {confirmLabel}</Button></div>
    </div>
  </div>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) { return <label className="block"><span className="mb-2 flex items-baseline gap-2 text-xs font-medium text-slate-300">{label}{hint && <span className="font-normal text-slate-600">{hint}</span>}</span>{children}</label>; }
function MissingEndpoint({ onHome }: { onHome: () => void }) { return <div className="dot-grid flex flex-1 items-center justify-center p-6"><div className="max-w-sm text-center"><FileJson2 className="mx-auto size-9 text-slate-700" /><h1 className="mt-4 text-lg font-semibold text-slate-200">Endpoint unavailable</h1><p className="mt-2 text-sm leading-6 text-slate-500">The link may be incorrect, or the endpoint may have been deleted.</p><Button className="mt-5" variant="secondary" onClick={onHome}>Back to home</Button></div></div>; }
