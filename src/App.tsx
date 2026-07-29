import { FormEvent, KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import ShikiViewer from "./ShikiViewer";
import TerminalPane from "./TerminalPane";
import { Locale, MessageKey, translate } from "./i18n";
import "./App.css";

type Scope = "global" | "project";
type EntryKind = "command" | "code" | "note" | "quicknote";
type Theme = "dark" | "light";
type Project = { id: string; name: string; path?: string; createdAt: number };
type Entry = {
  id: string;
  kind: EntryKind;
  title: string;
  content: string;
  language: string;
  project: string;
  scope: Scope;
  description: string;
  tags: string[];
  favorite: boolean;
  createdAt: number;
};
type Run = {
  id: string;
  command: string;
  projectId: string;
  source: "vault" | "terminal";
  ranAt: number;
};
type Risk = { level: "safe" | "careful" | "danger"; reasons: string[] };

const now = Date.now();
const seeds: Entry[] = [
  {
    id: "seed-command",
    kind: "command",
    title: "Start development server",
    content: "npm run dev",
    language: "shell",
    project: "",
    scope: "global",
    description: "Start the current application in development mode.",
    tags: ["dev", "npm"],
    favorite: true,
    createdAt: now - 1000,
  },
  {
    id: "seed-code",
    kind: "code",
    title: "Elixir changeset helper",
    content:
      "def changeset(user, attrs) do\n  user\n  |> cast(attrs, [:email, :name])\n  |> validate_required([:email])\n  |> unique_constraint(:email)\nend",
    language: "elixir",
    project: "",
    scope: "global",
    description: "A reusable Ecto changeset pattern.",
    tags: ["elixir", "ecto"],
    favorite: false,
    createdAt: now - 2000,
  },
  {
    id: "seed-note",
    kind: "note",
    title: "Production deploy reminder",
    content:
      "Before deploying:\n\n• Check pending migrations\n• Confirm the active branch\n• Read the release notes\n• Keep the rollback command nearby",
    language: "text",
    project: "",
    scope: "global",
    description: "Things worth checking before a production release.",
    tags: ["deploy", "checklist"],
    favorite: false,
    createdAt: now - 3000,
  },
];

const store = {
  read<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  write(key: string, value: unknown) {
    localStorage.setItem(key, JSON.stringify(value));
  },
};

function loadEntries(): Entry[] {
  const current = store.read<Entry[]>("trstcode.entries.v3", []);
  if (current.length) return current;
  const previous = store.read<Array<Record<string, unknown>>>("trstcode.snippets.v2", []);
  if (!previous.length) return seeds;
  return previous.map((item) => ({
    id: String(item.id),
    kind: "command",
    title: String(item.title || "Untitled command"),
    content: String(item.command || ""),
    language: String(item.language || "text"),
    project: item.scope === "project" && item.project
      ? `folder:${String(item.project)}`
      : "",
    scope: item.scope === "project" ? "project" : "global",
    description: String(item.description || ""),
    tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
    favorite: Boolean(item.favorite),
    createdAt: Number(item.createdAt || Date.now()),
  }));
}

function loadProjects(): Project[] {
  const current = store.read<Project[]>("trstcode.workspaces.v2", []);
  if (current.length) return current;
  return store.read<string[]>("trstcode.projects", []).map((path) => ({
    id: `folder:${path}`,
    name: folderName(path),
    path,
    createdAt: Date.now(),
  }));
}

function detectLanguage(value: string) {
  const code = value.trim().toLowerCase();
  if (/^(select|insert|update|delete|alter|drop|create table|with)\b/.test(code)) return "sql";
  if (/\b(defmodule|defp? |mix |iex|ecto|IO\.|Repo\.)\b/i.test(value)) return "elixir";
  if (/\b(fn |const |let |interface |console\.log|=>|import .* from)\b/.test(code)) return "typescript";
  if (/\b(def |puts |bundle exec|rails )/.test(code)) return "ruby";
  if (/\b(import |from |print\(|pip |python)/.test(code)) return "python";
  if (/^(ssh|sudo|docker|git|cd|ls|curl|chmod|systemctl|npm|pnpm|yarn)\b/.test(code)) return "shell";
  if ((code.startsWith("{") && code.endsWith("}")) || code.startsWith("[")) return "json";
  if (/<\/?[a-z][\s\S]*>/i.test(value)) return "html";
  return "text";
}

function formatContent(value: string, language: string, kind: EntryKind) {
  if (isNoteKind(kind)) return value.trim();
  const trimmed = value.trim();
  if (language === "json") {
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return trimmed;
    }
  }
  if (language === "sql") {
    return trimmed
      .replace(/\s+(FROM|WHERE|ORDER BY|GROUP BY|LIMIT|VALUES|SET)\s+/gi, "\n$1 ")
      .replace(/\b(select|from|where|order by|group by|limit|join|as)\b/gi, (word) => word.toUpperCase());
  }
  return trimmed;
}

function assessRisk(command: string): Risk {
  const reasons: string[] = [];
  const normalized = command.toLowerCase();
  if (/\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b/.test(normalized)) reasons.push("Recursively deletes files");
  if (/\b(drop\s+(table|database)|truncate\s+table)\b/.test(normalized)) reasons.push("Destroys database data");
  if (/\b(delete\s+from)\b/.test(normalized) && !/\bwhere\b/.test(normalized)) reasons.push("Deletes every matching database row");
  if (/\b(sudo|shutdown|reboot|mkfs|dd\s+if=)\b/.test(normalized)) reasons.push("Uses elevated or system-level operations");
  if (/(token|password|secret|api[_-]?key)\s*[=:]\s*\S+/i.test(command)) reasons.push("May contain a secret");
  if (reasons.length) return { level: "danger", reasons };
  if (/\b(deploy|migrate|ssh|kubectl|terraform apply|git push)\b/.test(normalized))
    return { level: "careful", reasons: ["May change a remote or shared environment"] };
  return { level: "safe", reasons: [] };
}

function folderName(path: string) {
  return path.split("/").filter(Boolean).pop() || "Project";
}
function shortPath(path?: string, emptyLabel = "Workspace only") {
  if (!path) return emptyLabel;
  const parts = path.split("/").filter(Boolean);
  return parts.length > 3 ? `…/${parts.slice(-2).join("/")}` : path;
}

const languageLabel: Record<string, string> = {
  shell: "$", sql: "SQL", ruby: "RB", elixir: "EX", typescript: "TS",
  javascript: "JS", python: "PY", json: "{}", text: "TXT", html: "<>", css: "CSS",
  rust: "RS", go: "GO", php: "PHP", yaml: "YML",
};
function isNoteKind(kind: EntryKind) {
  return kind === "note" || kind === "quicknote";
}

function App() {
  const [entries, setEntries] = useState<Entry[]>(loadEntries);
  const [projects, setProjects] = useState<Project[]>(loadProjects);
  const [openedIds, setOpenedIds] = useState<string[]>([]);
  const [activeProjectId, setActiveProjectId] = useState("");
  const [runs, setRuns] = useState<Run[]>(() => store.read("trstcode.runs.v3", []));
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | EntryKind | "starred">("all");
  const [activeId, setActiveId] = useState("");
  const [command, setCommand] = useState("");
  const [sessionKey, setSessionKey] = useState(0);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [projectCreator, setProjectCreator] = useState(false);
  const [riskCommand, setRiskCommand] = useState("");
  const [locale, setLocale] = useState<Locale>(() => store.read("trstcode.locale", "fr"));
  const [theme, setTheme] = useState<Theme>(() => store.read("trstcode.theme", "dark"));
  const [quickEditing, setQuickEditing] = useState<Entry | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Entry | null>(null);
  const [toast, setToast] = useState("");
  const [copiedId, setCopiedId] = useState("");
  const sendRef = useRef<(command: string) => Promise<void>>(async () => undefined);
  const toastTimer = useRef<number | undefined>(undefined);
  const copyTimer = useRef<number | undefined>(undefined);
  const tx = (key: MessageKey, variables?: Record<string, string | number>) => translate(locale, key, variables);
  const labelForKind = (kind: EntryKind) => tx(kind === "quicknote" ? "quickNote" : kind);

  useEffect(() => () => {
    window.clearTimeout(toastTimer.current);
    window.clearTimeout(copyTimer.current);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    store.write("trstcode.theme", theme);
  }, [theme]);

  const project = projects.find((item) => item.id === activeProjectId);
  const active = entries.find((item) => item.id === activeId);
  const openedProjects = openedIds.map((id) => projects.find((item) => item.id === id)).filter(Boolean) as Project[];
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return entries
      .filter((item) => filter !== "starred" || item.favorite)
      .filter((item) => !["command", "code", "note"].includes(filter) || (filter === "note" ? isNoteKind(item.kind) : item.kind === filter))
      .filter((item) => item.scope === "global" || item.project === activeProjectId)
      .filter((item) => [item.title, item.content, item.description, ...item.tags].join(" ").toLowerCase().includes(term));
  }, [activeProjectId, entries, filter, query]);

  function persistEntries(next: Entry[]) {
    setEntries(next);
    store.write("trstcode.entries.v3", next);
  }
  function persistProjects(next: Project[]) {
    setProjects(next);
    store.write("trstcode.workspaces.v2", next);
  }
  function notify(message: string) {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2400);
  }
  function changeLocale(next: Locale) {
    setLocale(next);
    store.write("trstcode.locale", next);
  }
  async function copyContent(value: string, id: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedId(id);
      notify(tx("copied"));
      window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopiedId(""), 1200);
    } catch {
      notify(tx("copyFailed"));
    }
  }
  function prependRun(run: Run) {
    setRuns((current) => {
      const next = [run, ...current].slice(0, 150);
      store.write("trstcode.runs.v3", next);
      return next;
    });
  }
  function showHome() {
    setActiveProjectId("");
    setActiveId("");
    setCommand("");
  }
  function activateProject(next: Project) {
    if (!openedIds.includes(next.id)) setOpenedIds((current) => [...current, next.id]);
    setActiveProjectId(next.id);
    setActiveId("");
    setCommand("");
  }
  function addProject(next: Project) {
    const existing = projects.find((item) => item.id === next.id);
    const list = existing ? projects : [next, ...projects];
    persistProjects(list);
    activateProject(existing || next);
    setProjectCreator(false);
  }
  async function chooseFolder() {
    if (!("__TAURI_INTERNALS__" in window)) {
      const manual = window.prompt("Project folder path");
      if (manual) addProject({ id: `folder:${manual}`, name: folderName(manual), path: manual, createdAt: Date.now() });
      return;
    }
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") addProject({ id: `folder:${selected}`, name: folderName(selected), path: selected, createdAt: Date.now() });
  }
  function closeTab(id: string) {
    const next = openedIds.filter((item) => item !== id);
    setOpenedIds(next);
    if (activeProjectId === id) {
      const replacement = projects.find((item) => item.id === next[next.length - 1]);
      if (replacement) activateProject(replacement);
      else showHome();
    }
  }
  async function execute(value = command) {
    if (!project?.path) return;
    const cleaned = value.trim();
    if (!cleaned) return;
    const risk = assessRisk(cleaned);
    if (risk.level !== "safe") return setRiskCommand(cleaned);
    await runApproved(cleaned);
  }
  async function runApproved(value: string) {
    await sendRef.current(value);
    prependRun({ id: crypto.randomUUID(), command: value, projectId: activeProjectId, source: active?.kind === "command" ? "vault" : "terminal", ranAt: Date.now() });
    setRiskCommand("");
  }
  function recordTerminalCommand(value: string) {
    prependRun({ id: crypto.randomUUID(), command: value, projectId: activeProjectId, source: "terminal", ranAt: Date.now() });
  }
  function openCreate(kind: EntryKind = "command", prefill = "") {
    setEditing({
      id: "",
      kind,
      title: "",
      content: prefill,
      language: isNoteKind(kind) ? "text" : detectLanguage(prefill),
      project: activeProjectId,
      scope: "project",
      description: "",
      tags: [],
      favorite: false,
      createdAt: Date.now(),
    });
  }
  function saveEntry(entry: Entry) {
    const completed = { ...entry, content: formatContent(entry.content, entry.language, entry.kind) };
    const saved = entry.id ? completed : { ...completed, id: crypto.randomUUID() };
    const next = entry.id
      ? entries.map((item) => item.id === entry.id ? saved : item)
      : [saved, ...entries];
    persistEntries(next);
    setActiveId(saved.id);
    setCommand(saved.kind === "command" ? saved.content : "");
    setEditing(null);
    setQuickEditing(null);
    notify(entry.id ? tx("updated") : tx(saved.kind === "command" ? "createdCommand" : saved.kind === "code" ? "createdCode" : saved.kind === "quicknote" ? "createdQuickNote" : "createdNote"));
  }
  function selectEntry(entry: Entry) {
    setActiveId(entry.id);
    setCommand(entry.kind === "command" ? entry.content : "");
  }
  function deleteEntry() {
    if (!deleteTarget) return;
    persistEntries(entries.filter((item) => item.id !== deleteTarget.id));
    setActiveId("");
    setCommand("");
    setDeleteTarget(null);
    notify(tx("deleted"));
  }

  if (!project) {
    return (
      <main className="onboarding">
        <header className="simple-header">
          <button className="brand brand-button" onClick={showHome}><span className="brand-mark">›_</span><strong>trstcode</strong></button>
          <div className="header-tools"><span>{tx("localWorkspace")}</span><ThemeControl theme={theme} onChange={setTheme} tx={tx} /><LocaleControl locale={locale} onChange={changeLocale} tx={tx} /></div>
        </header>
        <section className="onboarding-body">
          <div className="onboarding-copy">
            <span className="eyebrow">{tx("startHere")}</span>
            <h1>{tx("heroTitle")}<br /><em>{tx("heroAccent")}</em></h1>
            <p>{tx("heroText")}</p>
            <div className="home-actions">
              <button className="open-project" onClick={chooseFolder}>{tx("openFolder")} <b>→</b></button>
              <button className="workspace-only-button" onClick={() => setProjectCreator(true)}>{tx("newWorkspace")}</button>
            </div>
          </div>
          <div className="flow-card">
            <span className="eyebrow">{tx("youCanKeep")}</span>
            {[["›_", tx("commands"), tx("commandsHelp")], ["{ }", tx("codeScripts"), tx("codeHelp")], ["Aa", tx("notes"), tx("notesHelp")], ["✦", tx("quickNotes"), tx("quickNotesHelp")]].map(([icon, title, text]) => (
              <div className="content-kind" key={title}><b>{icon}</b><span><strong>{title}</strong><small>{text}</small></span></div>
            ))}
          </div>
          {projects.length > 0 && (
            <div className="recent-projects">
              <span className="eyebrow">{tx("yourWorkspaces")}</span>
              {projects.map((item) => (
                <button key={item.id} onClick={() => activateProject(item)}>
                  <span className="folder-icon">{item.path ? "▰" : "◇"}</span>
                  <span><strong>{item.name}</strong><small>{shortPath(item.path, tx("workspaceOnlyPath"))}</small></span><b>→</b>
                </button>
              ))}
            </div>
          )}
        </section>
        {projectCreator && <ProjectCreator tx={tx} onClose={() => setProjectCreator(false)} onCreate={(name) => addProject({ id: crypto.randomUUID(), name, createdAt: Date.now() })} />}
        {toast && <Toast message={toast} />}
      </main>
    );
  }

  return (
    <main className="app-shell with-tabs">
      <header className="titlebar" data-tauri-drag-region>
        <button className="brand brand-button" onClick={showHome} title={tx("backHome")}><span className="brand-mark">›_</span><strong>trstcode</strong></button>
        <div className="active-project-summary"><span className="status-dot" /><span><b>{project.name}</b><small>{shortPath(project.path, tx("workspaceOnlyPath"))}</small></span></div>
        <div className="title-actions"><ThemeControl theme={theme} onChange={setTheme} tx={tx} /><LocaleControl locale={locale} onChange={changeLocale} tx={tx} /><span className="local-badge">{tx("localOnly")}</span>{project.path && <button onClick={() => setSessionKey((key) => key + 1)}>{tx("restartTerminal")}</button>}</div>
      </header>
      <nav className="project-tabs" aria-label={tx("openProjects")}>
        <button className="home-tab" onClick={showHome} title={tx("home")}>⌂</button>
        {openedProjects.map((item) => (
          <button key={item.id} className={item.id === activeProjectId ? "active" : ""} onClick={() => activateProject(item)}>
            <span>{item.path ? "▰" : "◇"}</span>{item.name}
            <i onClick={(event) => { event.stopPropagation(); closeTab(item.id); }}>×</i>
          </button>
        ))}
        <button className="new-tab" onClick={() => setProjectCreator(true)} title={tx("addWorkspace")}>＋</button>
      </nav>

      <section className="workspace">
        <aside className="vault panel">
          <div className="panel-heading"><div><span className="eyebrow">{tx("yourLibrary")}</span><h2>{project.name}</h2></div><button className="square-button" onClick={() => openCreate("command")}>+</button></div>
          <label className="search"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tx("search")} /></label>
          <div className="filters entry-filters">
            {(["all", "command", "code", "note", "starred"] as const).map((value) => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value === "all" ? tx("all") : value === "starred" ? "★" : labelForKind(value)}</button>)}
          </div>
          <div className="snippet-list">
            {filtered.map((entry) => (
              <button key={entry.id} aria-label={entry.title} className={`snippet ${activeId === entry.id ? "selected" : ""}`} onClick={() => selectEntry(entry)}>
                <span className={`lang kind-${entry.kind}`}>{entry.kind === "quicknote" ? "✦" : entry.kind === "note" ? "Aa" : languageLabel[entry.language] || "TXT"}</span>
                <span><strong>{entry.kind === "quicknote" ? entry.content.split("\n")[0] : entry.title}</strong>{entry.kind !== "quicknote" && <code>{entry.content.replace(/\n/g, " ")}</code>}<small>{labelForKind(entry.kind)} · {entry.scope === "global" ? tx("global") : project.name}</small></span>
                <i className={entry.favorite ? "on" : ""} onClick={(e) => { e.stopPropagation(); persistEntries(entries.map((item) => item.id === entry.id ? { ...item, favorite: !item.favorite } : item)); }}>★</i>
              </button>
            ))}
            {!filtered.length && <div className="list-empty">{tx("nothingHere")}</div>}
          </div>
          <div className="create-entry-bar">
            <button onClick={() => openCreate("command")}>›_ {tx("command")}</button>
            <button onClick={() => openCreate("code")}>{"{ }"} {tx("code")}</button>
            <button onClick={() => openCreate("note")}>Aa {tx("note")}</button>
            <button className="quick-note-trigger" onClick={() => setQuickEditing({ id: "", kind: "quicknote", title: "", content: "", language: "text", project: activeProjectId, scope: "project", description: "", tags: [], favorite: false, createdAt: Date.now() })}>✦ {tx("quickNote")}</button>
          </div>
        </aside>

        <section className={`terminal-workspace panel ${active && active.kind !== "command" ? "viewing-entry" : !project.path ? "workspace-only" : ""}`}>
          {active?.kind === "code" && <EntryViewer entry={active} tx={tx} copied={copiedId === active.id} onEdit={() => setEditing(active)} onCopy={() => copyContent(active.content, active.id)} onInlineSave={saveEntry} />}
          {active && isNoteKind(active.kind) && <EntryViewer entry={active} tx={tx} copied={copiedId === active.id} onEdit={() => active.kind === "quicknote" ? setQuickEditing(active) : setEditing(active)} onCopy={() => copyContent(active.content, active.id)} onInlineSave={saveEntry} />}
          {(!active || active.kind === "command") && project.path && (
            <>
              <div className="workspace-header"><div><span className="green-dot" /><b>{tx("terminal")}</b><small>{shortPath(project.path, tx("workspaceOnlyPath"))}</small></div><span>zsh · {tx("persistentSession")}</span></div>
              <div className="guided-runner">
                <div className="runner-topline"><span className="eyebrow">{active ? `${tx("command").toUpperCase()} / ${active.title}` : tx("guidedRun")}</span><span className={`risk-pill ${assessRisk(command).level}`}>{assessRisk(command).level}</span></div>
                <textarea value={command} onChange={(e) => { setCommand(e.target.value); if (active && e.target.value !== active.content) setActiveId(""); }} placeholder={tx("pasteCommand")} spellCheck={false} />
                <div className="runner-actions"><span>{languageLabel[detectLanguage(command)] || "TXT"} · {tx("reviewBeforeRun")}</span><div>{command.trim() && !active && <button onClick={() => openCreate("command", command)}>{tx("save")}</button>}{active && <button onClick={() => setEditing(active)}>{tx("edit")}</button>}<button className="run-button" onClick={() => execute()}>{tx("runIn", { name: project.name })}</button></div></div>
              </div>
              <div className="terminal-label"><span>{tx("liveTerminal")}</span><span>{tx("clickToType")}</span></div>
              <TerminalPane directory={project.path} sessionKey={sessionKey} onCommand={recordTerminalCommand} onReady={(send) => { sendRef.current = send; }} />
            </>
          )}
          {!active && !project.path && (
            <div className="workspace-welcome">
              <span className="eyebrow">{tx("workspaceOnly")}</span><h2>{project.name}</h2>
              <p>{tx("workspaceOnlyHelp")}</p>
              <div><button onClick={() => openCreate("code")}>{tx("addCode")}</button><button onClick={() => openCreate("note")}>{tx("writeNote")}</button><button onClick={() => setQuickEditing({ id: "", kind: "quicknote", title: "", content: "", language: "text", project: activeProjectId, scope: "project", description: "", tags: [], favorite: false, createdAt: Date.now() })}>{tx("addQuickNote")}</button><button onClick={chooseFolder}>{tx("openFolder")}</button></div>
            </div>
          )}
        </section>

        <aside className="activity panel">
          <div className="panel-heading compact"><div><span className="eyebrow">{active ? tx("selected") : tx("activity")}</span><h2>{active ? labelForKind(active.kind) : tx("commandHistory")}</h2></div></div>
          {active ? (
            <div className="entry-inspector">
              <span className={`entry-kind-badge ${active.kind}`}>{labelForKind(active.kind)}</span>{active.kind !== "quicknote" && <h3>{active.title}</h3>}
              {active.kind !== "quicknote" && <p>{active.description || tx("noDescription")}</p>}
              <dl><div><dt>{tx("language")}</dt><dd>{isNoteKind(active.kind) ? tx("plainText") : active.language}</dd></div><div><dt>{tx("length")}</dt><dd>{active.content.split("\n").length} {tx("lines")}</dd></div><div><dt>{tx("scope")}</dt><dd>{active.scope === "global" ? tx("everyWorkspace") : project.name}</dd></div></dl>
              <div className="tag-row">{active.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>
              <div className="inspector-actions"><button className={`copy-button ${copiedId === active.id ? "copied" : ""}`} onClick={() => copyContent(active.content, active.id)}>{copiedId === active.id ? `✓ ${tx("copied")}` : tx("copy")}</button><button onClick={() => active.kind === "quicknote" ? setQuickEditing(active) : setEditing(active)}>{tx("edit")}</button><button className="danger-text" onClick={() => setDeleteTarget(active)}>{tx("delete")}</button></div>
            </div>
          ) : project.path ? (
            <div className="history-list">{runs.filter((run) => run.projectId === project.id).map((run) => <button key={run.id} className="history-item" onClick={() => { setCommand(run.command); setActiveId(""); }}><span className="history-arrow">↳</span><span><code>{run.command}</code><small>{new Date(run.ranAt).toLocaleString()}</small></span><b>＋</b></button>)}</div>
          ) : <div className="empty-history"><span>◇</span><strong>{tx("quietWorkspace")}</strong><p>{tx("quietWorkspaceHelp")}</p></div>}
        </aside>
      </section>

      {editing && <EntryEditor initial={editing} project={project} tx={tx} onClose={() => setEditing(null)} onSave={saveEntry} />}
      {quickEditing && <QuickNoteEditor initial={quickEditing} tx={tx} onClose={() => setQuickEditing(null)} onSave={saveEntry} />}
      {projectCreator && <ProjectCreator tx={tx} onClose={() => setProjectCreator(false)} onCreate={(name) => addProject({ id: crypto.randomUUID(), name, createdAt: Date.now() })} onFolder={chooseFolder} />}
      {deleteTarget && <DeleteConfirmation entry={deleteTarget} tx={tx} onCancel={() => setDeleteTarget(null)} onConfirm={deleteEntry} />}
      {riskCommand && <div className="modal-backdrop"><div className="risk-dialog"><span className="risk-icon">!</span><span className="eyebrow">{tx("reviewBeforeRun")}</span><h2>{tx("reviewTitle")}</h2><p>{tx("runsInside")} <b>{project.path}</b>.</p><pre>{riskCommand}</pre><ul>{assessRisk(riskCommand).reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul><div className="dialog-actions"><button onClick={() => setRiskCommand("")}>{tx("cancel")}</button><button className="danger-button" onClick={() => runApproved(riskCommand)}>{tx("understandRun")}</button></div></div></div>}
      {toast && <Toast message={toast} />}
    </main>
  );
}

type Tx = (key: MessageKey, variables?: Record<string, string | number>) => string;

function EntryViewer({ entry, tx, copied, onEdit, onCopy, onInlineSave }: { entry: Entry; tx: Tx; copied: boolean; onEdit: () => void; onCopy: () => void; onInlineSave: (entry: Entry) => void }) {
  const label = tx(entry.kind === "quicknote" ? "quickNote" : entry.kind);
  const [inlineEditing, setInlineEditing] = useState(false);
  const [draft, setDraft] = useState(entry.content);
  useEffect(() => setDraft(entry.content), [entry.content, entry.id]);
  function saveInline() {
    const content = draft.trim();
    setInlineEditing(false);
    if (!content || content === entry.content) {
      setDraft(entry.content);
      return;
    }
    onInlineSave({
      ...entry,
      content,
      title: entry.kind === "quicknote" ? content.split("\n")[0].slice(0, 80) : entry.title,
    });
  }
  const inlineKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") event.currentTarget.blur();
    if (event.key === "Escape") {
      setDraft(entry.content);
      setInlineEditing(false);
    }
  };
  return (
    <div className={`entry-viewer ${entry.kind}`}>
      <header><div><span className="eyebrow">{label} / {isNoteKind(entry.kind) ? tx("plainText").toUpperCase() : entry.language.toUpperCase()}</span>{entry.kind !== "quicknote" && <><h1>{entry.title}</h1><p>{entry.description}</p></>}</div><div><button className={`copy-button ${copied ? "copied" : ""}`} onClick={onCopy}>{copied ? `✓ ${tx("copied")}` : tx("copy")}</button><button onClick={onEdit}>{tx("edit")}</button></div></header>
      {entry.kind === "code" ? (
        inlineEditing
          ? <textarea className="code-inline-editor" autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={saveInline} onKeyDown={inlineKeyDown} spellCheck={false} />
          : <div className="code-clickable" onClick={() => setInlineEditing(true)} title={tx("clickCode")}><ShikiViewer code={entry.content} language={entry.language} /><small>✎ {tx("clickCode")}</small></div>
      ) : entry.kind === "quicknote" ? (
        inlineEditing
          ? <textarea className="quick-note-inline-editor" autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={saveInline} onKeyDown={(event) => {
              inlineKeyDown(event);
            }} />
          : <article className="note-view quick-note-clickable" onClick={() => setInlineEditing(true)} title={tx("clickQuickNote")}><span>{entry.content}</span><small>✎ {tx("clickQuickNote")}</small></article>
      ) : <article className="note-view">{entry.content}</article>}
      <footer><span>{entry.content.split("\n").length} {tx("lines")}</span><span>{entry.content.length} {tx("characters")}</span></footer>
    </div>
  );
}

function EntryEditor({ initial, project, tx, onClose, onSave }: { initial: Entry; project: Project; tx: Tx; onClose: () => void; onSave: (entry: Entry) => void }) {
  const [value, setValue] = useState(initial);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!value.title.trim() || !value.content.trim()) return;
    onSave({ ...value, language: isNoteKind(value.kind) ? "text" : value.language || detectLanguage(value.content), tags: value.tags.filter(Boolean) });
  }
  const codeLike = !isNoteKind(value.kind);
  const label = (kind: EntryKind) => tx(kind === "quicknote" ? "quickNote" : kind);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="snippet-editor large-editor" onSubmit={submit} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-heading"><div><span className="eyebrow">{value.id ? tx("editEntry") : tx("newEntry")}</span><h2>{value.id ? value.title : tx("saveKind", { kind: label(value.kind).toLowerCase() })}</h2></div><button type="button" onClick={onClose}>×</button></div>
        <div className="kind-picker">{(["command", "code", "note"] as EntryKind[]).map((kind) => <button type="button" key={kind} className={value.kind === kind ? "active" : ""} onClick={() => setValue({ ...value, kind, language: kind === "note" ? "text" : value.language === "text" ? detectLanguage(value.content) : value.language })}>{kind === "command" ? `›_ ${tx("command")}` : kind === "code" ? `{ } ${tx("codeOrScript")}` : `Aa ${tx("note")}`}</button>)}</div>
        <label>{tx("title")}<input autoFocus value={value.title} onChange={(e) => setValue({ ...value, title: e.target.value })} placeholder={value.kind === "note" ? "Checklist de déploiement" : "User creation helper"} /></label>
        <label>{tx("description")}<input value={value.description} onChange={(e) => setValue({ ...value, description: e.target.value })} placeholder={tx("usefulWhen")} /></label>
        <label>{value.kind === "command" ? tx("command") : value.kind === "code" ? tx("codeOrScript") : tx("note")}<textarea className={`code-input ${value.kind === "code" ? "long-code-input" : ""}`} value={value.content} onChange={(e) => setValue({ ...value, content: e.target.value, language: value.kind === "note" ? "text" : detectLanguage(e.target.value) })} placeholder={value.kind === "note" ? tx("notePlaceholder") : tx("codePlaceholder")} spellCheck={value.kind === "note"} /></label>
        <div className="editor-row">
          {codeLike && <label>{tx("language")}<select value={value.language} onChange={(e) => setValue({ ...value, language: e.target.value })}>{["shell", "typescript", "javascript", "elixir", "python", "ruby", "sql", "json", "html", "css", "rust", "go", "php", "yaml", "text"].map((lang) => <option key={lang}>{lang}</option>)}</select></label>}
          <label>{tx("availability")}<select value={value.scope} onChange={(e) => setValue({ ...value, scope: e.target.value as Scope, project: e.target.value === "project" ? project.id : "" })}><option value="project">{tx("projectOnly", { name: project.name })}</option><option value="global">{tx("everyWorkspace")}</option></select></label>
        </div>
        <label>{tx("tags")}<input value={value.tags.join(", ")} onChange={(e) => setValue({ ...value, tags: e.target.value.split(",").map((tag) => tag.trim()) })} placeholder="elixir, auth, helper" /></label>
        <div className="format-note">{value.kind === "code" ? tx("detectedAs", { language: value.language, lines: value.content.split("\n").length }) : tx("noteFormat")}</div>
        <div className="dialog-actions"><button type="button" onClick={onClose}>{tx("cancel")}</button><button className="primary-button" type="submit">{tx("saveKind", { kind: label(value.kind).toLowerCase() })}</button></div>
      </form>
    </div>
  );
}

function ProjectCreator({ tx, onClose, onCreate, onFolder }: { tx: Tx; onClose: () => void; onCreate: (name: string) => void; onFolder?: () => void }) {
  const [name, setName] = useState("");
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="project-creator" onSubmit={(e) => { e.preventDefault(); if (name.trim()) onCreate(name.trim()); }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-heading"><div><span className="eyebrow">{tx("newWorkspace").toUpperCase()}</span><h2>{tx("newWorkspaceTitle")}</h2></div><button type="button" onClick={onClose}>×</button></div>
        <p>{tx("workspaceHelp")}</p>
        <label>{tx("name")}<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Backend notes" /></label>
        <button className="create-workspace-primary" type="submit">{tx("createWorkspace")}</button>
        {onFolder && <button className="choose-folder-secondary" type="button" onClick={onFolder}>{tx("orOpenFolder")}</button>}
      </form>
    </div>
  );
}

function QuickNoteEditor({ initial, tx, onClose, onSave }: { initial: Entry; tx: Tx; onClose: () => void; onSave: (entry: Entry) => void }) {
  const [content, setContent] = useState(initial.content);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="quick-note-editor" onSubmit={(event) => {
        event.preventDefault();
        const cleaned = content.trim();
        if (!cleaned) return;
        onSave({ ...initial, title: cleaned.split("\n")[0].slice(0, 80), content: cleaned, description: "", tags: [], language: "text" });
      }} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-heading"><div><span className="eyebrow">✦ {tx("quickNote").toUpperCase()}</span><h2>{tx("quickNoteTitle")}</h2></div><button type="button" onClick={onClose}>×</button></div>
        <textarea autoFocus value={content} onChange={(event) => setContent(event.target.value)} placeholder={tx("quickNotePlaceholder")} />
        <div className="dialog-actions"><button type="button" onClick={onClose}>{tx("cancel")}</button><button className="primary-button" type="submit">{tx("saveQuickNote")}</button></div>
      </form>
    </div>
  );
}

function DeleteConfirmation({ entry, tx, onCancel, onConfirm }: { entry: Entry; tx: Tx; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div className="delete-dialog" role="alertdialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <span className="delete-dialog-icon">×</span>
        <span className="eyebrow">{tx("confirmDelete")}</span>
        <h2>{tx("deleteTitle")}</h2>
        <p>{tx("deleteHelp")}</p>
        <blockquote>{entry.kind === "quicknote" ? entry.content : entry.title}</blockquote>
        <div className="dialog-actions"><button onClick={onCancel}>{tx("cancel")}</button><button className="danger-button" onClick={onConfirm}>{tx("confirmDeleteButton")}</button></div>
      </div>
    </div>
  );
}

function LocaleControl({ locale, onChange, tx }: { locale: Locale; onChange: (locale: Locale) => void; tx: Tx }) {
  return (
    <div className="locale-control" aria-label={tx("changeLanguage")}>
      <button className={locale === "fr" ? "active" : ""} onClick={() => onChange("fr")} title={tx("french")}>FR</button>
      <button className={locale === "en" ? "active" : ""} onClick={() => onChange("en")} title={tx("english")}>EN</button>
    </div>
  );
}

function ThemeControl({ theme, onChange, tx }: { theme: Theme; onChange: (theme: Theme) => void; tx: Tx }) {
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button className="theme-control" onClick={() => onChange(next)} title={next === "light" ? tx("lightTheme") : tx("darkTheme")} aria-label={tx("changeTheme")}>
      <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
    </button>
  );
}

function Toast({ message }: { message: string }) {
  return <div className="toast" role="status"><span>✓</span>{message}</div>;
}

export default App;
