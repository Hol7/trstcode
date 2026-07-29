import { FormEvent, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import ShikiViewer from "./ShikiViewer";
import TerminalPane from "./TerminalPane";
import "./App.css";

type Scope = "global" | "project";
type EntryKind = "command" | "code" | "note";
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
  if (kind === "note") return value.trim();
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
function shortPath(path?: string) {
  if (!path) return "Workspace only";
  const parts = path.split("/").filter(Boolean);
  return parts.length > 3 ? `…/${parts.slice(-2).join("/")}` : path;
}

const languageLabel: Record<string, string> = {
  shell: "$", sql: "SQL", ruby: "RB", elixir: "EX", typescript: "TS",
  javascript: "JS", python: "PY", json: "{}", text: "TXT", html: "<>", css: "CSS",
  rust: "RS", go: "GO", php: "PHP", yaml: "YML",
};
const kindLabel: Record<EntryKind, string> = { command: "Command", code: "Code", note: "Note" };

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
  const sendRef = useRef<(command: string) => Promise<void>>(async () => undefined);

  const project = projects.find((item) => item.id === activeProjectId);
  const active = entries.find((item) => item.id === activeId);
  const openedProjects = openedIds.map((id) => projects.find((item) => item.id === id)).filter(Boolean) as Project[];
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return entries
      .filter((item) => filter !== "starred" || item.favorite)
      .filter((item) => !["command", "code", "note"].includes(filter) || item.kind === filter)
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
      language: kind === "note" ? "text" : detectLanguage(prefill),
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
  }
  function selectEntry(entry: Entry) {
    setActiveId(entry.id);
    setCommand(entry.kind === "command" ? entry.content : "");
  }
  function deleteEntry(id: string) {
    if (!window.confirm("Delete this entry? This cannot be undone.")) return;
    persistEntries(entries.filter((item) => item.id !== id));
    setActiveId("");
    setCommand("");
  }

  if (!project) {
    return (
      <main className="onboarding">
        <header className="simple-header">
          <button className="brand brand-button" onClick={showHome}><span className="brand-mark">›_</span><strong>trstcode</strong></button>
          <span>local developer workspace</span>
        </header>
        <section className="onboarding-body">
          <div className="onboarding-copy">
            <span className="eyebrow">START HERE</span>
            <h1>Keep what matters.<br /><em>Run it when needed.</em></h1>
            <p>Create a simple workspace for notes and code, or connect a local folder when you also need a real terminal.</p>
            <div className="home-actions">
              <button className="open-project" onClick={chooseFolder}>Open project folder <b>→</b></button>
              <button className="workspace-only-button" onClick={() => setProjectCreator(true)}>New empty workspace</button>
            </div>
          </div>
          <div className="flow-card">
            <span className="eyebrow">YOU CAN KEEP</span>
            {[["›_", "Commands", "Run them in folder-backed projects"], ["{ }", "Code & scripts", "Read 100+ lines with syntax highlighting"], ["Aa", "Notes", "Save ideas, reminders and words"]].map(([icon, title, text]) => (
              <div className="content-kind" key={title}><b>{icon}</b><span><strong>{title}</strong><small>{text}</small></span></div>
            ))}
          </div>
          {projects.length > 0 && (
            <div className="recent-projects">
              <span className="eyebrow">YOUR WORKSPACES</span>
              {projects.map((item) => (
                <button key={item.id} onClick={() => activateProject(item)}>
                  <span className="folder-icon">{item.path ? "▰" : "◇"}</span>
                  <span><strong>{item.name}</strong><small>{shortPath(item.path)}</small></span><b>→</b>
                </button>
              ))}
            </div>
          )}
        </section>
        {projectCreator && <ProjectCreator onClose={() => setProjectCreator(false)} onCreate={(name) => addProject({ id: crypto.randomUUID(), name, createdAt: Date.now() })} />}
      </main>
    );
  }

  return (
    <main className="app-shell with-tabs">
      <header className="titlebar" data-tauri-drag-region>
        <button className="brand brand-button" onClick={showHome} title="Back to home"><span className="brand-mark">›_</span><strong>trstcode</strong></button>
        <div className="active-project-summary"><span className="status-dot" /><span><b>{project.name}</b><small>{shortPath(project.path)}</small></span></div>
        <div className="title-actions"><span className="local-badge">LOCAL ONLY</span>{project.path && <button onClick={() => setSessionKey((key) => key + 1)}>Restart terminal</button>}</div>
      </header>
      <nav className="project-tabs" aria-label="Open projects">
        <button className="home-tab" onClick={showHome} title="Home">⌂</button>
        {openedProjects.map((item) => (
          <button key={item.id} className={item.id === activeProjectId ? "active" : ""} onClick={() => activateProject(item)}>
            <span>{item.path ? "▰" : "◇"}</span>{item.name}
            <i onClick={(event) => { event.stopPropagation(); closeTab(item.id); }}>×</i>
          </button>
        ))}
        <button className="new-tab" onClick={() => setProjectCreator(true)} title="New workspace">＋</button>
      </nav>

      <section className="workspace">
        <aside className="vault panel">
          <div className="panel-heading"><div><span className="eyebrow">YOUR LIBRARY</span><h2>{project.name}</h2></div><button className="square-button" onClick={() => openCreate("command")}>+</button></div>
          <label className="search"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search commands, code, notes…" /></label>
          <div className="filters entry-filters">
            {(["all", "command", "code", "note", "starred"] as const).map((value) => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value === "all" ? "All" : value === "starred" ? "★" : kindLabel[value]}</button>)}
          </div>
          <div className="snippet-list">
            {filtered.map((entry) => (
              <button key={entry.id} aria-label={entry.title} className={`snippet ${activeId === entry.id ? "selected" : ""}`} onClick={() => selectEntry(entry)}>
                <span className={`lang kind-${entry.kind}`}>{entry.kind === "note" ? "Aa" : languageLabel[entry.language] || "TXT"}</span>
                <span><strong>{entry.title}</strong><code>{entry.content.replace(/\n/g, " ")}</code><small>{kindLabel[entry.kind]} · {entry.scope === "global" ? "Global" : project.name}</small></span>
                <i className={entry.favorite ? "on" : ""} onClick={(e) => { e.stopPropagation(); persistEntries(entries.map((item) => item.id === entry.id ? { ...item, favorite: !item.favorite } : item)); }}>★</i>
              </button>
            ))}
            {!filtered.length && <div className="list-empty">Nothing here yet.</div>}
          </div>
          <div className="create-entry-bar">
            <button onClick={() => openCreate("command")}>›_ Command</button>
            <button onClick={() => openCreate("code")}>{"{ }"} Code</button>
            <button onClick={() => openCreate("note")}>Aa Note</button>
          </div>
        </aside>

        <section className={`terminal-workspace panel ${active && active.kind !== "command" ? "viewing-entry" : !project.path ? "workspace-only" : ""}`}>
          {active?.kind === "code" && <EntryViewer entry={active} onEdit={() => setEditing(active)} onCopy={() => navigator.clipboard.writeText(active.content)} />}
          {active?.kind === "note" && <EntryViewer entry={active} onEdit={() => setEditing(active)} onCopy={() => navigator.clipboard.writeText(active.content)} />}
          {(!active || active.kind === "command") && project.path && (
            <>
              <div className="workspace-header"><div><span className="green-dot" /><b>Terminal</b><small>{shortPath(project.path)}</small></div><span>zsh · persistent session</span></div>
              <div className="guided-runner">
                <div className="runner-topline"><span className="eyebrow">{active ? `COMMAND / ${active.title}` : "GUIDED RUN"}</span><span className={`risk-pill ${assessRisk(command).level}`}>{assessRisk(command).level}</span></div>
                <textarea value={command} onChange={(e) => { setCommand(e.target.value); if (active && e.target.value !== active.content) setActiveId(""); }} placeholder="Paste a command here, or use the terminal directly below…" spellCheck={false} />
                <div className="runner-actions"><span>{languageLabel[detectLanguage(command)] || "TXT"} · Review before running.</span><div>{command.trim() && !active && <button onClick={() => openCreate("command", command)}>Save</button>}{active && <button onClick={() => setEditing(active)}>Edit</button>}<button className="run-button" onClick={() => execute()}>Run in {project.name} ↵</button></div></div>
              </div>
              <div className="terminal-label"><span>LIVE TERMINAL</span><span>Click below to type directly</span></div>
              <TerminalPane directory={project.path} sessionKey={sessionKey} onCommand={recordTerminalCommand} onReady={(send) => { sendRef.current = send; }} />
            </>
          )}
          {!active && !project.path && (
            <div className="workspace-welcome">
              <span className="eyebrow">WORKSPACE ONLY</span><h2>{project.name}</h2>
              <p>This workspace does not need a folder. Save code, scripts, notes, words and reusable commands here.</p>
              <div><button onClick={() => openCreate("code")}>Add code or script</button><button onClick={() => openCreate("note")}>Write a note</button><button onClick={chooseFolder}>Open a folder-backed project</button></div>
            </div>
          )}
        </section>

        <aside className="activity panel">
          <div className="panel-heading compact"><div><span className="eyebrow">{active ? "SELECTED" : "ACTIVITY"}</span><h2>{active ? kindLabel[active.kind] : "Command history"}</h2></div></div>
          {active ? (
            <div className="entry-inspector">
              <span className={`entry-kind-badge ${active.kind}`}>{kindLabel[active.kind]}</span><h3>{active.title}</h3>
              <p>{active.description || "No description yet."}</p>
              <dl><div><dt>Language</dt><dd>{active.kind === "note" ? "Plain text" : active.language}</dd></div><div><dt>Length</dt><dd>{active.content.split("\n").length} lines</dd></div><div><dt>Scope</dt><dd>{active.scope === "global" ? "Every workspace" : project.name}</dd></div></dl>
              <div className="tag-row">{active.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>
              <div className="inspector-actions"><button onClick={() => navigator.clipboard.writeText(active.content)}>Copy</button><button onClick={() => setEditing(active)}>Edit</button><button className="danger-text" onClick={() => deleteEntry(active.id)}>Delete</button></div>
            </div>
          ) : project.path ? (
            <div className="history-list">{runs.filter((run) => run.projectId === project.id).map((run) => <button key={run.id} className="history-item" onClick={() => { setCommand(run.command); setActiveId(""); }}><span className="history-arrow">↳</span><span><code>{run.command}</code><small>{new Date(run.ranAt).toLocaleString()}</small></span><b>＋</b></button>)}</div>
          ) : <div className="empty-history"><span>◇</span><strong>Your quiet workspace</strong><p>Select an entry to inspect it, or create your first note or code snippet.</p></div>}
        </aside>
      </section>

      {editing && <EntryEditor initial={editing} project={project} onClose={() => setEditing(null)} onSave={saveEntry} />}
      {projectCreator && <ProjectCreator onClose={() => setProjectCreator(false)} onCreate={(name) => addProject({ id: crypto.randomUUID(), name, createdAt: Date.now() })} onFolder={chooseFolder} />}
      {riskCommand && <div className="modal-backdrop"><div className="risk-dialog"><span className="risk-icon">!</span><span className="eyebrow">REVIEW BEFORE RUNNING</span><h2>This command needs your attention</h2><p>It will run inside <b>{project.path}</b>.</p><pre>{riskCommand}</pre><ul>{assessRisk(riskCommand).reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul><div className="dialog-actions"><button onClick={() => setRiskCommand("")}>Cancel</button><button className="danger-button" onClick={() => runApproved(riskCommand)}>I understand — run it</button></div></div></div>}
    </main>
  );
}

function EntryViewer({ entry, onEdit, onCopy }: { entry: Entry; onEdit: () => void; onCopy: () => void }) {
  return (
    <div className={`entry-viewer ${entry.kind}`}>
      <header><div><span className="eyebrow">{kindLabel[entry.kind]} / {entry.kind === "note" ? "PLAIN TEXT" : entry.language.toUpperCase()}</span><h1>{entry.title}</h1><p>{entry.description}</p></div><div><button onClick={onCopy}>Copy</button><button onClick={onEdit}>Edit</button></div></header>
      {entry.kind === "code" ? <ShikiViewer code={entry.content} language={entry.language} /> : <article className="note-view">{entry.content}</article>}
      <footer><span>{entry.content.split("\n").length} lines</span><span>{entry.content.length} characters</span></footer>
    </div>
  );
}

function EntryEditor({ initial, project, onClose, onSave }: { initial: Entry; project: Project; onClose: () => void; onSave: (entry: Entry) => void }) {
  const [value, setValue] = useState(initial);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!value.title.trim() || !value.content.trim()) return;
    onSave({ ...value, language: value.kind === "note" ? "text" : value.language || detectLanguage(value.content), tags: value.tags.filter(Boolean) });
  }
  const codeLike = value.kind !== "note";
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="snippet-editor large-editor" onSubmit={submit} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-heading"><div><span className="eyebrow">{value.id ? "EDIT ENTRY" : "NEW ENTRY"}</span><h2>{value.id ? value.title : `Save ${kindLabel[value.kind].toLowerCase()}`}</h2></div><button type="button" onClick={onClose}>×</button></div>
        <div className="kind-picker">{(["command", "code", "note"] as EntryKind[]).map((kind) => <button type="button" key={kind} className={value.kind === kind ? "active" : ""} onClick={() => setValue({ ...value, kind, language: kind === "note" ? "text" : value.language === "text" ? detectLanguage(value.content) : value.language })}>{kind === "command" ? "›_ Command" : kind === "code" ? "{ } Code / script" : "Aa Note"}</button>)}</div>
        <label>Title<input autoFocus value={value.title} onChange={(e) => setValue({ ...value, title: e.target.value })} placeholder={value.kind === "note" ? "Deployment checklist" : "User creation helper"} /></label>
        <label>Description<input value={value.description} onChange={(e) => setValue({ ...value, description: e.target.value })} placeholder="When or why is this useful?" /></label>
        <label>{value.kind === "command" ? "Command" : value.kind === "code" ? "Code or script" : "Note"}<textarea className={`code-input ${value.kind === "code" ? "long-code-input" : ""}`} value={value.content} onChange={(e) => setValue({ ...value, content: e.target.value, language: value.kind === "note" ? "text" : detectLanguage(e.target.value) })} placeholder={value.kind === "note" ? "Write anything you want to remember…" : "Paste your code here…"} spellCheck={value.kind === "note"} /></label>
        <div className="editor-row">
          {codeLike && <label>Language<select value={value.language} onChange={(e) => setValue({ ...value, language: e.target.value })}>{["shell", "typescript", "javascript", "elixir", "python", "ruby", "sql", "json", "html", "css", "rust", "go", "php", "yaml", "text"].map((lang) => <option key={lang}>{lang}</option>)}</select></label>}
          <label>Availability<select value={value.scope} onChange={(e) => setValue({ ...value, scope: e.target.value as Scope, project: e.target.value === "project" ? project.id : "" })}><option value="project">{project.name} only</option><option value="global">Every workspace</option></select></label>
        </div>
        <label>Tags<input value={value.tags.join(", ")} onChange={(e) => setValue({ ...value, tags: e.target.value.split(",").map((tag) => tag.trim()) })} placeholder="elixir, auth, helper" /></label>
        <div className="format-note">{value.kind === "code" ? <>Detected as <b>{value.language}</b> · {value.content.split("\n").length} lines · Shiki preview after saving.</> : "Notes are saved as readable plain text."}</div>
        <div className="dialog-actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit">Save {kindLabel[value.kind].toLowerCase()}</button></div>
      </form>
    </div>
  );
}

function ProjectCreator({ onClose, onCreate, onFolder }: { onClose: () => void; onCreate: (name: string) => void; onFolder?: () => void }) {
  const [name, setName] = useState("");
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="project-creator" onSubmit={(e) => { e.preventDefault(); if (name.trim()) onCreate(name.trim()); }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-heading"><div><span className="eyebrow">NEW WORKSPACE</span><h2>What are you keeping?</h2></div><button type="button" onClick={onClose}>×</button></div>
        <p>A workspace can hold notes, code and commands without being connected to a folder.</p>
        <label>Name<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Backend notes" /></label>
        <button className="create-workspace-primary" type="submit">Create empty workspace</button>
        {onFolder && <button className="choose-folder-secondary" type="button" onClick={onFolder}>Or open a local project folder</button>}
      </form>
    </div>
  );
}

export default App;
