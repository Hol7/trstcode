import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import "./App.css";

type Snippet = {
  id: string;
  title: string;
  command: string;
  language: string;
  project: string;
  tags: string[];
  favorite?: boolean;
  createdAt: number;
};

type Run = {
  id: string;
  command: string;
  directory: string;
  output: string;
  success: boolean;
  ranAt: number;
};

const seedSnippets: Snippet[] = [
  {
    id: "seed-1",
    title: "Start development server",
    command: "npm run dev",
    language: "shell",
    project: "trstcode",
    tags: ["dev", "npm"],
    favorite: true,
    createdAt: Date.now() - 1000,
  },
  {
    id: "seed-2",
    title: "Create an admin user",
    command:
      'User.create!(email: "admin@example.com", password: "change-me", role: :admin)',
    language: "ruby",
    project: "Rails app",
    tags: ["iex", "user"],
    createdAt: Date.now() - 2000,
  },
  {
    id: "seed-3",
    title: "Find slow queries",
    command:
      "SELECT query, calls, mean_exec_time\nFROM pg_stat_statements\nORDER BY mean_exec_time DESC\nLIMIT 10;",
    language: "sql",
    project: "Production DB",
    tags: ["postgres", "debug"],
    createdAt: Date.now() - 3000,
  },
];

const storage = {
  read<T>(key: string, fallback: T): T {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
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
  if (/^(select|insert|update|delete|alter|create table|with)\b/.test(code))
    return "sql";
  if (/\b(def|end|puts|create!|rails|bundle exec)\b/.test(code)) return "ruby";
  if (/\b(const|let|interface|console\.log|npm|pnpm|yarn)\b/.test(code))
    return code.includes("npm ") || code.includes("pnpm ") ? "shell" : "typescript";
  if (/^(ssh|sudo|docker|git|cd|ls|curl|chmod|systemctl|mix|iex)\b/.test(code))
    return "shell";
  if (/\b(import|from|print|pip|python)\b/.test(code)) return "python";
  return "text";
}

const languageMark: Record<string, string> = {
  shell: "$",
  sql: "SQL",
  ruby: "RB",
  typescript: "TS",
  python: "PY",
  text: "TXT",
};

function shortPath(path: string) {
  if (!path) return "No folder selected";
  const parts = path.split("/");
  return parts.length > 3 ? `…/${parts.slice(-2).join("/")}` : path;
}

function App() {
  const [snippets, setSnippets] = useState<Snippet[]>(() =>
    storage.read("trstcode.snippets", seedSnippets),
  );
  const [runs, setRuns] = useState<Run[]>(() =>
    storage.read("trstcode.runs", []),
  );
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState(snippets[0]?.id ?? "");
  const [command, setCommand] = useState(snippets[0]?.command ?? "");
  const [projectPath, setProjectPath] = useState(() =>
    storage.read("trstcode.projectPath", ""),
  );
  const [isRunning, setIsRunning] = useState(false);
  const [showComposer, setShowComposer] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftCommand, setDraftCommand] = useState("");
  const [draftTags, setDraftTags] = useState("");
  const commandRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => storage.write("trstcode.snippets", snippets), [snippets]);
  useEffect(() => storage.write("trstcode.runs", runs), [runs]);
  useEffect(() => storage.write("trstcode.projectPath", projectPath), [projectPath]);

  const active = snippets.find((item) => item.id === activeId);
  const filtered = useMemo(() => {
    const term = query.toLowerCase().trim();
    return snippets.filter((item) =>
      [item.title, item.command, item.project, ...item.tags]
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [query, snippets]);

  function chooseSnippet(snippet: Snippet) {
    setActiveId(snippet.id);
    setCommand(snippet.command);
    commandRef.current?.focus();
  }

  async function chooseFolder() {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === "string") setProjectPath(selected);
    } catch {
      const manual = window.prompt("Enter the project folder path:", projectPath);
      if (manual) setProjectPath(manual);
    }
  }

  async function runCommand(event?: FormEvent) {
    event?.preventDefault();
    if (!command.trim() || isRunning) return;
    if (!projectPath) {
      await chooseFolder();
      return;
    }

    setIsRunning(true);
    try {
      const result = await invoke<{ output: string; success: boolean }>(
        "run_command",
        { command, directory: projectPath },
      );
      setRuns((current) => [
        {
          id: crypto.randomUUID(),
          command,
          directory: projectPath,
          output: result.output,
          success: result.success,
          ranAt: Date.now(),
        },
        ...current,
      ].slice(0, 80));
    } catch (error) {
      setRuns((current) => [
        {
          id: crypto.randomUUID(),
          command,
          directory: projectPath,
          output: String(error),
          success: false,
          ranAt: Date.now(),
        },
        ...current,
      ]);
    } finally {
      setIsRunning(false);
    }
  }

  function addSnippet(event: FormEvent) {
    event.preventDefault();
    if (!draftTitle.trim() || !draftCommand.trim()) return;
    const snippet: Snippet = {
      id: crypto.randomUUID(),
      title: draftTitle.trim(),
      command: draftCommand.trim(),
      language: detectLanguage(draftCommand),
      project: projectPath.split("/").pop() || "General",
      tags: draftTags.split(",").map((tag) => tag.trim()).filter(Boolean),
      createdAt: Date.now(),
    };
    setSnippets((current) => [snippet, ...current]);
    setActiveId(snippet.id);
    setCommand(snippet.command);
    setDraftTitle("");
    setDraftCommand("");
    setDraftTags("");
    setShowComposer(false);
  }

  function toggleFavorite(id: string) {
    setSnippets((current) =>
      current.map((item) =>
        item.id === id ? { ...item, favorite: !item.favorite } : item,
      ),
    );
  }

  return (
    <main className="app-shell">
      <header className="titlebar" data-tauri-drag-region>
        <div className="brand">
          <span className="brand-mark">›_</span>
          <strong>trstcode</strong>
          <span className="version">local / v0.1</span>
        </div>
        <button className="path-chip" onClick={chooseFolder}>
          <span className="status-dot" />
          {shortPath(projectPath)}
          <span className="keycap">⌘O</span>
        </button>
        <div className="title-actions">
          <button className="icon-button" title="Command palette">⌘K</button>
          <button className="avatar" title="GitHub sync comes later">FB</button>
        </div>
      </header>

      <section className="workspace">
        <aside className="sidebar panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">VAULT</span>
              <h1>Commands</h1>
            </div>
            <button className="square-button" onClick={() => setShowComposer(true)}>+</button>
          </div>
          <label className="search">
            <span>⌕</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search everything…"
            />
            <span className="keycap">⌘K</span>
          </label>
          <div className="filter-row">
            <button className="filter active">All <span>{snippets.length}</span></button>
            <button className="filter">★ Starred</button>
          </div>
          <div className="snippet-list">
            {filtered.map((snippet, index) => (
              <button
                key={snippet.id}
                className={`snippet ${activeId === snippet.id ? "selected" : ""}`}
                onClick={() => chooseSnippet(snippet)}
              >
                <span className="snippet-index">{String(index + 1).padStart(2, "0")}</span>
                <span className="snippet-copy">
                  <strong>{snippet.title}</strong>
                  <code>{snippet.command.replace(/\n/g, " ")}</code>
                  <span className="meta">
                    <b>{languageMark[snippet.language] ?? "TXT"}</b>
                    {snippet.project}
                  </span>
                </span>
                <span
                  role="button"
                  className={`star ${snippet.favorite ? "on" : ""}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleFavorite(snippet.id);
                  }}
                >★</span>
              </button>
            ))}
          </div>
          <button className="new-command" onClick={() => setShowComposer(true)}>
            <span>＋</span> Save new command
          </button>
        </aside>

        <section className="terminal panel">
          <div className="terminal-tabs">
            <button className="tab active"><span className="green-dot" /> Terminal 01</button>
            <button className="tab">＋</button>
            <div className="terminal-actions"><button>Split</button><button>•••</button></div>
          </div>

          <div className="terminal-body">
            <div className="welcome-card">
              <div>
                <span className="eyebrow">TRSTCODE / READY</span>
                <h2>Your commands.<br /><em>Right where you need them.</em></h2>
              </div>
              <div className="ascii-art" aria-hidden="true">
                <span>┌────────┐</span>
                <span>│  ›_    │</span>
                <span>└───┬────┘</span>
                <span>    └─ run</span>
              </div>
            </div>

            <div className="session-info">
              <span className="prompt-mark">›</span>
              <div>
                <strong>{projectPath ? projectPath.split("/").pop() : "Choose a project folder"}</strong>
                <span>{shortPath(projectPath)}</span>
              </div>
              <button onClick={chooseFolder}>Change folder</button>
            </div>

            <form className="command-line" onSubmit={runCommand}>
              <div className="line-gutter">
                <span>{languageMark[detectLanguage(command)] ?? "TXT"}</span>
                <b>›</b>
              </div>
              <textarea
                ref={commandRef}
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    runCommand();
                  }
                }}
                spellCheck={false}
                placeholder="Type a command, or pick one from your vault…"
              />
              <div className="run-strip">
                <span>Enter to run · Shift Enter for newline</span>
                <button type="submit" disabled={isRunning}>
                  {isRunning ? "Running…" : "Run"} <b>↵</b>
                </button>
              </div>
            </form>

            <div className="latest-output">
              <div className="output-heading">
                <span>OUTPUT</span>
                {runs[0] && <b className={runs[0].success ? "success" : "failure"}>
                  {runs[0].success ? "EXIT 0" : "FAILED"}
                </b>}
              </div>
              <pre>{runs[0]?.output || "Run a command to see its output here."}</pre>
            </div>
          </div>

          <footer className="statusbar">
            <span><b>●</b> local vault</span>
            <span>{snippets.length} commands</span>
            <span className="spacer" />
            <span>UTF-8</span>
            <span>trstcode</span>
          </footer>
        </section>

        <aside className="history panel">
          <div className="panel-heading compact">
            <div>
              <span className="eyebrow">SESSION</span>
              <h2>Run history</h2>
            </div>
            <button className="ghost-button" onClick={() => setRuns([])}>Clear</button>
          </div>
          <div className="history-list">
            {runs.length === 0 && (
              <div className="empty-state">
                <span>↯</span>
                <strong>Nothing run yet</strong>
                <p>Your command history will appear here. Click any entry to put it back on the line.</p>
              </div>
            )}
            {runs.map((run) => (
              <button key={run.id} className="history-item" onClick={() => setCommand(run.command)}>
                <span className={`run-status ${run.success ? "ok" : "bad"}`} />
                <span>
                  <code>{run.command}</code>
                  <small>{new Date(run.ranAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {shortPath(run.directory)}</small>
                </span>
                <b>↵</b>
              </button>
            ))}
          </div>
          {active && (
            <div className="inspector">
              <span className="eyebrow">SELECTED</span>
              <h3>{active.title}</h3>
              <div className="tag-row">{active.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>
              <button onClick={() => navigator.clipboard.writeText(active.command)}>Copy command</button>
            </div>
          )}
        </aside>
      </section>

      {showComposer && (
        <div className="modal-backdrop" onMouseDown={() => setShowComposer(false)}>
          <form className="composer" onSubmit={addSnippet} onMouseDown={(event) => event.stopPropagation()}>
            <div className="composer-heading">
              <div><span className="eyebrow">NEW ENTRY</span><h2>Save to your vault</h2></div>
              <button type="button" onClick={() => setShowComposer(false)}>×</button>
            </div>
            <label>Title<input autoFocus value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} placeholder="Deploy production app" /></label>
            <label>Command or code<textarea value={draftCommand} onChange={(e) => setDraftCommand(e.target.value)} placeholder="fly deploy --remote-only" spellCheck={false} /></label>
            <div className="detected">Detected: <b>{detectLanguage(draftCommand)}</b></div>
            <label>Tags<input value={draftTags} onChange={(e) => setDraftTags(e.target.value)} placeholder="deploy, production, fly" /></label>
            <div className="composer-actions"><button type="button" onClick={() => setShowComposer(false)}>Cancel</button><button className="primary" type="submit">Save command</button></div>
          </form>
        </div>
      )}
    </main>
  );
}

export default App;
