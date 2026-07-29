import { useEffect, useRef } from "react";
import { basicSetup, EditorView } from "codemirror";
import { Compartment, EditorState } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { oneDark } from "@codemirror/theme-one-dark";

type Props = {
  value: string;
  language: string;
  theme: "dark" | "light";
  className?: string;
  autoFocus?: boolean;
  onChange: (value: string) => void;
  onBlur?: () => void;
  onSave?: () => void;
  onCancel?: () => void;
};

const lightTheme = EditorView.theme({
  "&": { color: "#252620", backgroundColor: "#fffef5" },
  ".cm-content": { caretColor: "#5f7f1d" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#5f7f1d" },
  ".cm-gutters": { backgroundColor: "#efeddf", color: "#77796f", borderRight: "1px solid #c7c5b8" },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "#e8edda" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "#cddda9" },
});

function normalizedLanguage(language: string) {
  const aliases: Record<string, string> = {
    shell: "shell",
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
  return aliases[language] || "text";
}

export default function CodeEditor({
  value,
  language,
  theme,
  className = "",
  autoFocus,
  onChange,
  onBlur,
  onSave,
  onCancel,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const languageSlot = useRef(new Compartment());
  const themeSlot = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  const onBlurRef = useRef(onBlur);
  const onSaveRef = useRef(onSave);
  const onCancelRef = useRef(onCancel);

  onChangeRef.current = onChange;
  onBlurRef.current = onBlur;
  onSaveRef.current = onSave;
  onCancelRef.current = onCancel;

  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          languageSlot.current.of([]),
          themeSlot.current.of(theme === "dark" ? oneDark : lightTheme),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
          EditorView.domEventHandlers({
            blur: () => {
              onBlurRef.current?.();
              return false;
            },
          }),
          keymap.of([
            {
              key: "Mod-Enter",
              run: () => {
                onSaveRef.current?.();
                return true;
              },
            },
            {
              key: "Escape",
              run: () => {
                onCancelRef.current?.();
                return true;
              },
            },
          ]),
        ],
      }),
    });
    viewRef.current = view;
    if (autoFocus) requestAnimationFrame(() => view.focus());
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || value === view.state.doc.toString()) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: themeSlot.current.reconfigure(theme === "dark" ? oneDark : lightTheme) });
  }, [theme]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    let active = true;
    const description = LanguageDescription.matchLanguageName(languages, normalizedLanguage(language), true);
    if (!description) {
      view.dispatch({ effects: languageSlot.current.reconfigure([]) });
      return;
    }
    description.load().then((support) => {
      if (active && viewRef.current) {
        view.dispatch({ effects: languageSlot.current.reconfigure(support) });
      }
    });
    return () => {
      active = false;
    };
  }, [language]);

  return <div ref={hostRef} className={`code-editor ${className}`} />;
}
