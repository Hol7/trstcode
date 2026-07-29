import { FormEvent, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import TerminalPane from "./TerminalPane";
import "./App.css";

type Scope = "global" | "project";
type Snippet = {
  id: string;
  title: string;
  command: string;
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
  directory: string;
  source: "vault" | "terminal";
  ranAt: number;
};
type Risk = { level: "safe" | "careful" | "danger"; reasons: string[] };

const seedSnippets: Snippet[] = [
  {
    id: "seed-1",
    title: "Start development server",
    command: "npm run dev",
    language: "shell",
    project: "",
    scope: "global",
    description: "Start the current application in development mode.",
    tags: ["dev", "npm"],
    favorite: true,
    createdAt: Date.now() - 1000,
  },
  {
    id: "seed-2",
    title: "Inspect repository status",
    command: "git status --short --branch",
    language: "shell",
    project: "",
    scope: "global",
    description: "Show the active branch and a compact list of changes.",
    tags: ["git", "check"],
    favorite: true,
    createdAt: Date.now() - 2000,
  },
  {
    id: "seed-3",
    title: "Find slow PostgreSQL queries",
    command:
      "SELECT query, calls, mean_exec_time\nFROM pg_stat_statements\nORDER BY mean_exec_time DESC\nLIMIT 10;",
    language: "sql",
    project: "",
    scope: "global",
    description: "Review the ten queries with the highest average execution time.",
    tags: ["postgres", "diagnostic"],
    favorite: false,
    createdAt: Date.now() - 3000,
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

function detectLanguage(value: string) {
  const code = value.trim().toLowerCase();
  if (/^(select|insert|update|delete|alter|drop|create table|with)\b/.test(code))
    return "sql";
  if (/\b(defmodule|mix |iex|ecto|IO\.|Repo\.)\b/i.test(value)) return "elixir";
  if (/\b(def |puts |bundle exec|rails )/.test(code)) return "ruby";
  if (/\b(const |let |interface |console\.log|=>)/.test(code)) return "typescript";
  if (/\b(import |from |print\(|pip |python)/.test(code)) return "python";
  if (/^(ssh|sudo|docker|git|cd|ls|curl|chmod|systemctl|npm|pnpm|yarn)\b/.test(code))
    return "shell";
  if ((code.startsWith("{") && code.endsWith("}")) || code.startsWith("["))
    return "json";
  return "text";
}

function formatSnippet(value: string, language: string) {
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
      .replace(/\s+(LEFT JOIN|RIGHT JOIN|INNER JOIN|JOIN)\s+/gi, "\n$1 ")
      .replace(/\b(select|from|where|order by|group by|limit|join|as)\b/gi, (word) =>
        word.toUpperCase(),
      );
  }
  return trimmed;
}

function assessRisk(command: string): Risk {
  const reasons: string[] = [];
  const normalized = command.toLowerCase();
  if (/\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b/.test(normalized))
    reasons.push("Recursively deletes files");
  if (/\b(drop\s+(table|database)|truncate\s+table)\b/.test(normalized))
    reasons.push("Destroys database data");
  if (/\b(delete\s+from)\b/.test(normalized) && !/\bwhere\b/.test(normalized))
    reasons.push("Deletes every matching database row");
  if (/\b(sudo|shutdown|reboot|mkfs|dd\s+if=)\b/.test(normalized))
    reasons.push("Uses elevated or system-level operations");
  if (/(token|password|secret|api[_-]?key)\s*[=:]\s*\S+/i.test(command))
    reasons.push("May contain a secret");
  if (reasons.length) return { level: "danger", reasons };
  if (/\b(deploy|migrate|ssh|kubectl|terraform apply|git push)\b/.test(normalized))
    return { level: "careful", reasons: ["May change a remote or shared environment"] };
  return { level: "safe", reasons: [] };
}

function projectName(path: string) {
  return path.split("/").filter(Boolean).pop() || "Project";
}

function shortPath(path: string) {
  const parts = path.split("/").filter(Boolean);
  return parts.length > 3 ? `…/${parts.slice(-2).join("/")}` : path;
}

const languageLabel: Record<string, string> = {
  shell: "$", sql: "SQL", ruby: "RB", elixir: "EX", typescript: "TS",
  python: "PY", json: "{}", text: "TXT",
};

function App() {
  const [snippets, setSnippets] = useState<Snippet[]>(() =>
    store.read("trstcode.snippets.v2", seedSnippets),
  );
  const [runs, setRuns] = useState<Run[]>(() => store.read("trstcode.runs.v2", []));
  const [recentProjects, setRecentProjects] = useState<string[]>(() =>
    store.read("trstcode.projects", []),
  );
  const [projectPath, setProjectPath] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "starred" | "project">("all");
  const [activeId, setActiveId] = useState("");
  const [command, setCommand] = useState("");
  const [sessionKey, setSessionKey] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Snippet | null>(null);
  const [riskCommand, setRiskCommand] = useState("");
  const sendRef = useRef<(command: string) => Promise<void>>(async () => undefined);

  const currentProject = projectName(projectPath);
  const active = snippets.find((item) => item.id === activeId);
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return snippets
      .filter((item) => filter !== "starred" || item.favorite)
      .filter((item) => filter !== "project" || item.project === projectPath)
      .filter((item) => item.scope === "global" || item.project === projectPath)
      .filter((item) =>
        [item.title, item.command, item.description, ...item.tags]
          .join(" ")
          .toLowerCase()
          .includes(term),
      );
  }, [filter, projectPath, query, snippets]);

  function persistSnippets(next: Snippet[]) {
    setSnippets(next);
    store.write("trstcode.snippets.v2", next);
  }
  function persistRuns(next: Run[]) {
    const limited = next.slice(0, 150);
    setRuns(limited);
    store.write("trstcode.runs.v2", limited);
  }

  function prependRun(run: Run) {
    setRuns((current) => {
      const next = [run, ...current].slice(0, 150);
      store.write("trstcode.runs.v2", next);
      return next;
    });
  }

  async function chooseProject() {
    if (!("__TAURI_INTERNALS__" in window)) {
      const manual = window.prompt("Project folder path");
      if (manual) openProject(manual);
      return;
    }
    try {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected !== "string") return;
      openProject(selected);
    } catch {
      const manual = window.prompt("Project folder path");
      if (manual) openProject(manual);
    }
  }

  function openProject(path: string) {
    setProjectPath(path);
    setCommand("");
    setActiveId("");
    const next = [path, ...recentProjects.filter((item) => item !== path)].slice(0, 8);
    setRecentProjects(next);
    store.write("trstcode.projects", next);
  }

  async function execute(value = command) {
    const cleaned = value.trim();
    if (!cleaned) return;
    const risk = assessRisk(cleaned);
    if (risk.level !== "safe") {
      setRiskCommand(cleaned);
      return;
    }
    await runApproved(cleaned, active ? "vault" : "terminal");
  }

  async function runApproved(value: string, source: Run["source"]) {
    await sendRef.current(value);
    prependRun({
      id: crypto.randomUUID(),
      command: value,
      directory: projectPath,
      source,
      ranAt: Date.now(),
    });
    setRiskCommand("");
  }

  function recordTerminalCommand(value: string) {
    prependRun({
      id: crypto.randomUUID(),
      command: value,
      directory: projectPath,
      source: "terminal",
      ranAt: Date.now(),
    });
  }

  function openCreate(prefill = command) {
    setEditing({
      id: "",
      title: "",
      command: prefill,
      language: detectLanguage(prefill),
      project: projectPath,
      scope: projectPath ? "project" : "global",
      description: "",
      tags: [],
      favorite: false,
      createdAt: Date.now(),
    });
    setEditorOpen(true);
  }

  function saveSnippet(snippet: Snippet) {
    const formatted = formatSnippet(snippet.command, snippet.language);
    const completed = { ...snippet, command: formatted };
    const next = snippet.id
      ? snippets.map((item) => (item.id === snippet.id ? completed : item))
      : [{ ...completed, id: crypto.randomUUID() }, ...snippets];
    persistSnippets(next);
    setEditorOpen(false);
    setEditing(null);
  }

  function deleteSnippet(id: string) {
    if (!window.confirm("Delete this saved command? This cannot be undone.")) return;
    persistSnippets(snippets.filter((item) => item.id !== id));
    setActiveId("");
    setCommand("");
  }

  if (!projectPath) {
    return (
      <main className="onboarding">
        <header className="simple-header">
          <div className="brand"><span className="brand-mark">›_</span><strong>trstcode</strong></div>
          <span>local command workspace</span>
        </header>
        <section className="onboarding-body">
          <div className="onboarding-copy">
            <span className="eyebrow">START HERE</span>
            <h1>Open a project.<br /><em>Keep the commands that matter.</em></h1>
            <p>trstcode gives each project a real terminal, a reusable command vault, and a history you can return to.</p>
            <button className="open-project" onClick={chooseProject}>Open project folder <b>→</b></button>
          </div>
          <div className="flow-card">
            <span className="eyebrow">THE FLOW</span>
            {["Choose a project", "Find or type a command", "Review and run", "Save it for later"].map((step, index) => (
              <div className="flow-step" key={step}><b>0{index + 1}</b><span>{step}</span>{index < 3 && <i>↓</i>}</div>
            ))}
          </div>
          {recentProjects.length > 0 && (
            <div className="recent-projects">
              <span className="eyebrow">RECENT PROJECTS</span>
              {recentProjects.map((path) => (
                <button key={path} onClick={() => openProject(path)}>
                  <span className="folder-icon">▰</span>
                  <span><strong>{projectName(path)}</strong><small>{shortPath(path)}</small></span>
                  <b>→</b>
                </button>
              ))}
            </div>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="titlebar" data-tauri-drag-region>
        <div className="brand"><span className="brand-mark">›_</span><strong>trstcode</strong></div>
        <button className="project-switcher" onClick={chooseProject}>
          <span className="status-dot" />
          <span><b>{currentProject}</b><small>{shortPath(projectPath)}</small></span>
          <i>⌄</i>
        </button>
        <div className="title-actions">
          <span className="local-badge">LOCAL ONLY</span>
          <button onClick={() => setSessionKey((key) => key + 1)}>Restart terminal</button>
        </div>
      </header>

      <section className="workspace">
        <aside className="vault panel">
          <div className="panel-heading">
            <div><span className="eyebrow">COMMAND VAULT</span><h2>{currentProject}</h2></div>
            <button className="square-button" onClick={() => openCreate()}>+</button>
          </div>
          <label className="search"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search commands…" /></label>
          <div className="filters">
            <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>All</button>
            <button className={filter === "project" ? "active" : ""} onClick={() => setFilter("project")}>Project</button>
            <button className={filter === "starred" ? "active" : ""} onClick={() => setFilter("starred")}>Starred</button>
          </div>
          <div className="snippet-list">
            {filtered.map((snippet) => (
              <button
                key={snippet.id}
                className={`snippet ${activeId === snippet.id ? "selected" : ""}`}
                onClick={() => { setActiveId(snippet.id); setCommand(snippet.command); }}
              >
                <span className="lang">{languageLabel[snippet.language] || "TXT"}</span>
                <span><strong>{snippet.title}</strong><code>{snippet.command.replace(/\n/g, " ")}</code><small>{snippet.scope === "global" ? "Global" : currentProject} · {snippet.tags.join(" · ")}</small></span>
                <i className={snippet.favorite ? "on" : ""} onClick={(e) => { e.stopPropagation(); persistSnippets(snippets.map((item) => item.id === snippet.id ? { ...item, favorite: !item.favorite } : item)); }}>★</i>
              </button>
            ))}
            {filtered.length === 0 && <div className="list-empty">No commands match this view.</div>}
          </div>
          <button className="save-command" onClick={() => openCreate()}>＋ Save a command</button>
        </aside>

        <section className="terminal-workspace panel">
          <div className="workspace-header">
            <div><span className="green-dot" /><b>Terminal</b><small>{shortPath(projectPath)}</small></div>
            <span>zsh · persistent session</span>
          </div>
          <div className="guided-runner">
            <div className="runner-topline">
              <span className="eyebrow">{active ? `FROM VAULT / ${active.title}` : "GUIDED RUN"}</span>
              <span className={`risk-pill ${assessRisk(command).level}`}>{assessRisk(command).level}</span>
            </div>
            <textarea value={command} onChange={(e) => { setCommand(e.target.value); if (active && e.target.value !== active.command) setActiveId(""); }} placeholder="Paste a command here, or use the terminal directly below…" spellCheck={false} />
            <div className="runner-actions">
              <span>{languageLabel[detectLanguage(command)] || "TXT"} · Review the command and active folder before running.</span>
              <div>
                {command.trim() && !active && <button onClick={() => openCreate(command)}>Save</button>}
                {active && <button onClick={() => { setEditing(active); setEditorOpen(true); }}>Edit</button>}
                <button className="run-button" onClick={() => execute()}>Run in {currentProject} ↵</button>
              </div>
            </div>
          </div>
          <div className="terminal-label"><span>LIVE TERMINAL</span><span>Click below to type directly</span></div>
          <TerminalPane
            directory={projectPath}
            sessionKey={sessionKey}
            onCommand={recordTerminalCommand}
            onReady={(send) => { sendRef.current = send; }}
          />
        </section>

        <aside className="activity panel">
          <div className="panel-heading compact"><div><span className="eyebrow">ACTIVITY</span><h2>Command history</h2></div><button className="text-button" onClick={() => persistRuns([])}>Clear</button></div>
          <div className="history-list">
            {runs.filter((run) => run.directory === projectPath).map((run) => (
              <button key={run.id} className="history-item" onClick={() => { setCommand(run.command); setActiveId(""); }}>
                <span className="history-arrow">↳</span>
                <span><code>{run.command}</code><small>{new Date(run.ranAt).toLocaleString([], { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" })} · {run.source}</small></span>
                <b>＋</b>
              </button>
            ))}
            {!runs.some((run) => run.directory === projectPath) && <div className="empty-history"><span>↯</span><strong>No commands yet</strong><p>Run something in the guided field or directly in the terminal. It will appear here.</p></div>}
          </div>
          {active && (
            <div className="command-inspector">
              <span className="eyebrow">SELECTED COMMAND</span>
              <h3>{active.title}</h3>
              <p>{active.description || "No usage notes yet."}</p>
              <div className="tag-row">{active.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>
              <div className="inspector-actions">
                <button onClick={() => navigator.clipboard.writeText(active.command)}>Copy</button>
                <button onClick={() => { setEditing(active); setEditorOpen(true); }}>Edit</button>
                <button className="danger-text" onClick={() => deleteSnippet(active.id)}>Delete</button>
              </div>
            </div>
          )}
        </aside>
      </section>

      {editorOpen && editing && <SnippetEditor initial={editing} projectName={currentProject} onClose={() => setEditorOpen(false)} onSave={saveSnippet} />}

      {riskCommand && (
        <div className="modal-backdrop">
          <div className="risk-dialog">
            <span className="risk-icon">!</span>
            <span className="eyebrow">REVIEW BEFORE RUNNING</span>
            <h2>{assessRisk(riskCommand).level === "danger" ? "This command may be destructive" : "This command may affect another environment"}</h2>
            <p>It will run inside <b>{projectPath}</b>.</p>
            <pre>{riskCommand}</pre>
            <ul>{assessRisk(riskCommand).reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
            <div className="dialog-actions"><button onClick={() => setRiskCommand("")}>Cancel</button><button className="danger-button" onClick={() => runApproved(riskCommand, active ? "vault" : "terminal")}>I understand — run it</button></div>
          </div>
        </div>
      )}
    </main>
  );
}

function SnippetEditor({ initial, projectName, onClose, onSave }: { initial: Snippet; projectName: string; onClose: () => void; onSave: (snippet: Snippet) => void }) {
  const [value, setValue] = useState(initial);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!value.title.trim() || !value.command.trim()) return;
    onSave({ ...value, language: value.language || detectLanguage(value.command), tags: value.tags.filter(Boolean) });
  }
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="snippet-editor" onSubmit={submit} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-heading"><div><span className="eyebrow">{value.id ? "EDIT COMMAND" : "NEW COMMAND"}</span><h2>{value.id ? value.title : "Save to your vault"}</h2></div><button type="button" onClick={onClose}>×</button></div>
        <label>Title<input autoFocus value={value.title} onChange={(e) => setValue({ ...value, title: e.target.value })} placeholder="Start development server" /></label>
        <label>Description<textarea className="notes" value={value.description} onChange={(e) => setValue({ ...value, description: e.target.value })} placeholder="When should you use this command?" /></label>
        <label>Command or code<textarea className="code-input" value={value.command} onChange={(e) => setValue({ ...value, command: e.target.value, language: detectLanguage(e.target.value) })} placeholder="npm run dev" spellCheck={false} /></label>
        <div className="editor-row">
          <label>Language<select value={value.language} onChange={(e) => setValue({ ...value, language: e.target.value })}>{["shell", "sql", "elixir", "ruby", "typescript", "python", "json", "text"].map((lang) => <option key={lang}>{lang}</option>)}</select></label>
          <label>Availability<select value={value.scope} onChange={(e) => setValue({ ...value, scope: e.target.value as Scope, project: e.target.value === "project" ? initial.project : "" })}><option value="project">{projectName} only</option><option value="global">Every project</option></select></label>
        </div>
        <label>Tags<input value={value.tags.join(", ")} onChange={(e) => setValue({ ...value, tags: e.target.value.split(",").map((tag) => tag.trim()) })} placeholder="dev, npm, local" /></label>
        <div className="format-note">Detected as <b>{value.language}</b>. JSON and SQL are formatted when saved.</div>
        <div className="dialog-actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit">Save command</button></div>
      </form>
    </div>
  );
}

export default App;
