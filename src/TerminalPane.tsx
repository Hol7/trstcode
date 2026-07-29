import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

type TerminalEvent = {
  sessionId: string;
  data: string;
};

type Props = {
  directory: string;
  sessionKey: number;
  onCommand: (command: string) => void;
  onReady: (send: (command: string) => Promise<void>) => void;
};

export default function TerminalPane({
  directory,
  sessionKey,
  onCommand,
  onReady,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<string>("");
  const lineRef = useRef("");

  useEffect(() => {
    if (!hostRef.current || !directory) return;

    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      convertEol: true,
      fontFamily: '"DM Mono", "SFMono-Regular", Menlo, Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.35,
      scrollback: 5000,
      allowProposedApi: false,
      theme: {
        background: "#111211",
        foreground: "#d9dad4",
        cursor: "#c7f464",
        cursorAccent: "#111211",
        selectionBackground: "#56683c99",
        black: "#171817",
        red: "#ff6f6f",
        green: "#c7f464",
        yellow: "#efcb68",
        blue: "#75a7ff",
        magenta: "#c792ea",
        cyan: "#72d5cc",
        white: "#e8e7e2",
        brightBlack: "#686c65",
        brightRed: "#ff8d8d",
        brightGreen: "#d8ff80",
        brightYellow: "#ffe08c",
        brightBlue: "#91b8ff",
        brightMagenta: "#d9a7f2",
        brightCyan: "#91e8df",
        brightWhite: "#ffffff",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(hostRef.current);
    fit.fit();
    terminal.focus();

    let disposed = false;
    let unlisten = () => {};
    let resizeObserver: ResizeObserver | undefined;

    const start = async () => {
      try {
        unlisten = await listen<TerminalEvent>("terminal-output", (event) => {
          if (event.payload.sessionId === sessionRef.current) {
            terminal.write(event.payload.data);
          }
        });
        const sessionId = await invoke<string>("start_terminal", {
          directory,
          cols: terminal.cols,
          rows: terminal.rows,
        });
        if (disposed) {
          await invoke("stop_terminal", { sessionId }).catch(() => undefined);
          return;
        }
        sessionRef.current = sessionId;
        onReady(async (command: string) => {
          if (!sessionRef.current) return;
          await invoke("write_terminal", {
            sessionId: sessionRef.current,
            data: `${command}\r`,
          });
        });
      } catch (error) {
        terminal.writeln("\x1b[31mCould not start the desktop terminal.\x1b[0m");
        terminal.writeln(String(error));
      }
    };

    const dataDisposable = terminal.onData(async (data) => {
      if (!sessionRef.current) return;
      for (const character of data) {
        if (character === "\r" || character === "\n") {
          const entered = lineRef.current.trim();
          if (entered) onCommand(entered);
          lineRef.current = "";
        } else if (character === "\u007f") {
          lineRef.current = lineRef.current.slice(0, -1);
        } else if (character !== "\u001b" && character >= " ") {
          lineRef.current += character;
        }
      }
      await invoke("write_terminal", {
        sessionId: sessionRef.current,
        data,
      }).catch(() => undefined);
    });

    resizeObserver = new ResizeObserver(() => {
      fit.fit();
      if (sessionRef.current) {
        invoke("resize_terminal", {
          sessionId: sessionRef.current,
          cols: terminal.cols,
          rows: terminal.rows,
        }).catch(() => undefined);
      }
    });
    resizeObserver.observe(hostRef.current);
    start();

    return () => {
      disposed = true;
      dataDisposable.dispose();
      resizeObserver?.disconnect();
      unlisten();
      terminal.dispose();
      if (sessionRef.current) {
        invoke("stop_terminal", { sessionId: sessionRef.current }).catch(
          () => undefined,
        );
      }
      sessionRef.current = "";
    };
  }, [directory, sessionKey]);

  return <div className="xterm-host" ref={hostRef} />;
}
