import { useEffect, useState } from "react";
import { codeToHtml } from "shiki";

const aliases: Record<string, string> = {
  shell: "bash",
  text: "text",
  typescript: "typescript",
  javascript: "javascript",
  elixir: "elixir",
  python: "python",
  ruby: "ruby",
  sql: "sql",
  json: "json",
  html: "html",
  css: "css",
  rust: "rust",
  go: "go",
  php: "php",
  yaml: "yaml",
};

export default function ShikiViewer({
  code,
  language,
}: {
  code: string;
  language: string;
}) {
  const [html, setHtml] = useState("");

  useEffect(() => {
    let cancelled = false;
    codeToHtml(code || " ", {
      lang: aliases[language] || "text",
      theme: "vitesse-dark",
    })
      .then((value) => {
        if (!cancelled) setHtml(value);
      })
      .catch(() => {
        if (!cancelled) {
          setHtml(`<pre class="shiki-fallback"><code>${escapeHtml(code)}</code></pre>`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [code, language]);

  return (
    <div
      className="shiki-viewer"
      aria-label={`${language} code preview`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
