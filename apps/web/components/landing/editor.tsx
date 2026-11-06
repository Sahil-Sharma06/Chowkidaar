"use client";
/** A still code editor window: file tabs, line numbers, hand-rolled highlighting, one marked line. */
import { useRef, useState } from "react";
import { CopyButton, cx } from "@/lib/ui";

export type EditorFile = { id: string; name: string; lang: "ts" | "json" | "sh"; code: string; mark?: (line: string) => boolean };

type Tok = { t: string; c?: keyof typeof INK };
const INK = {
  kw: "text-[#b8a4ff]",
  str: "text-[#7fdcc4]",
  num: "text-[#fcb26e]",
  fn: "text-[#f2d58c]",
  prop: "text-[#e6e6ea]",
  punct: "text-[#8a8a95]",
  com: "italic text-[#80808b]",
  type: "text-[#8fc7ff]",
};
const KW = new Set(["import", "from", "const", "let", "await", "new", "export", "return", "async", "function", "true", "false", "null"]);

/** One line at a time is enough: none of these samples has a token that spans lines. */
function tokenize(line: string, lang: EditorFile["lang"]): Tok[] {
  const out: Tok[] = [];
  const re = lang === "json"
    ? /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?)|\b(true|false|null)\b|([{}[\],:])|(\s+)|(.)/g
    : /(\/\/.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)|([{}()[\];,.:=<>*+\-!?/])|(\s+)|(.)/g;
  if (lang === "sh") {
    // Shell: comments, the prompt, strings, flags, env assignments, line continuations.
    const sh = /(#.*$)|^(\$)|("(?:[^"\\]|\\.)*"|'[^']*')|(\s--?[\w-]+)|([A-Z_][A-Z0-9_]*)(=)|(\\$)|(\s+)|([^\s"'\\]+)/g;
    let k: RegExpExecArray | null;
    let first = true;
    while ((k = sh.exec(line))) {
      if (k[1]) out.push({ t: k[1], c: "com" });
      else if (k[2]) out.push({ t: k[2], c: "punct" });
      else if (k[3]) out.push({ t: k[3], c: "str" });
      else if (k[4]) out.push({ t: k[4], c: "kw" });
      else if (k[5]) { out.push({ t: k[5], c: "type" }); out.push({ t: k[6], c: "punct" }); }
      else if (k[7]) out.push({ t: k[7], c: "punct" });
      else if (k[9]) { out.push({ t: k[9], c: first ? "fn" : undefined }); first = false; }
      else out.push({ t: k[0] });
    }
    return out;
  }
  let m: RegExpExecArray | null;
  const prev = () => out.filter((x) => x.t.trim()).at(-1)?.t;
  while ((m = re.exec(line))) {
    if (lang === "json") {
      if (m[1]) { out.push({ t: m[1], c: m[2] ? "prop" : "str" }); if (m[2]) out.push({ t: m[2], c: "punct" }); }
      else if (m[3]) out.push({ t: m[3], c: "num" });
      else if (m[4]) out.push({ t: m[4], c: "kw" });
      else if (m[5]) out.push({ t: m[5], c: "punct" });
      else out.push({ t: m[0] });
      continue;
    }
    if (m[1]) out.push({ t: m[1], c: "com" });
    else if (m[2]) out.push({ t: m[2], c: "str" });
    else if (m[3]) out.push({ t: m[3], c: "num" });
    else if (m[4]) {
      const w = m[4];
      const rest = line.slice(re.lastIndex);
      out.push({
        t: w,
        c: KW.has(w) ? "kw" : /^\s*\(/.test(rest) ? "fn" : /^\s*:/.test(rest) && prev() !== "?" ? "prop"
          : /^[A-Z]/.test(w) ? "type" : prev() === "." ? "prop" : undefined,
      });
    } else if (m[5]) out.push({ t: m[5], c: "punct" });
    else out.push({ t: m[0] });
  }
  return out;
}

/** `quiet` uses a smaller shadow for use inside the app, where the editor is a tool, not a showpiece. */
export function CodeEditor({ files, label, quiet }: { files: EditorFile[]; label: string; quiet?: boolean }) {
  const [active, setActive] = useState(files[0].id);
  const tabs = useRef<Record<string, HTMLButtonElement | null>>({});
  const file = files.find((f) => f.id === active) ?? files[0];
  const lines = file.code.split("\n");
  const width = String(lines.length).length;

  // Roving tabindex: one tab stop for the tab list, arrow keys move between files.
  const onKey = (e: React.KeyboardEvent) => {
    const i = files.findIndex((f) => f.id === active);
    const n = e.key === "ArrowRight" ? (i + 1) % files.length : e.key === "ArrowLeft" ? (i - 1 + files.length) % files.length
      : e.key === "Home" ? 0 : e.key === "End" ? files.length - 1 : -1;
    if (n < 0) return;
    e.preventDefault();
    setActive(files[n].id);
    tabs.current[files[n].id]?.focus();
  };

  return (
    <div className={cx("theme-dark overflow-hidden rounded-2xl border border-rule-strong bg-surface-container-lowest",
      quiet ? "shadow-[0_8px_24px_-12px_rgb(16_16_20/0.25)]" : "shadow-[0_1px_2px_rgb(16_16_20/0.06),0_24px_48px_-28px_rgb(16_16_20/0.35)]")}>
      <style>{`@keyframes ck-caret{50%{opacity:0}} .ck-caret{animation:ck-caret 1.1s steps(1) infinite} @media (prefers-reduced-motion:reduce){.ck-caret{animation:none}}`}</style>
      {/* Title bar with the file tabs. */}
      <div className="flex items-end gap-3 pl-4 pr-2 pt-2">
        <div className="flex shrink-0 gap-1.5 self-center pb-1.5" aria-hidden>
          <span className="h-3 w-3 rounded-full bg-surface-container-highest" />
          <span className="h-3 w-3 rounded-full bg-surface-container-highest" />
          <span className="h-3 w-3 rounded-full bg-surface-container-highest" />
        </div>
        <div role="tablist" aria-label={label} onKeyDown={onKey} className="ml-2 flex min-w-0 flex-1 gap-0.5 overflow-x-auto [scrollbar-width:none]">
          {files.map((f) => {
            const on = f.id === active;
            return (
              <button key={f.id} ref={(el) => { tabs.current[f.id] = el; }} id={`ed-tab-${f.id}`} type="button" role="tab"
                aria-selected={on} aria-controls={`ed-panel-${f.id}`} tabIndex={on ? 0 : -1} onClick={() => setActive(f.id)}
                className={cx("relative h-10 shrink-0 whitespace-nowrap rounded-t-xl px-3.5 sm:px-4 font-mono text-[12.5px] transition-colors duration-150 focus-visible:-outline-offset-2",
                  on ? "bg-[#0f0f12] text-on-surface" : "text-outline hover:text-on-surface-variant")}>
                {f.name}
              </button>
            );
          })}
        </div>
        <div className="shrink-0 self-center pb-1"><CopyButton text={file.code} label="Copy code" /></div>
      </div>

      <div id={`ed-panel-${file.id}`} role="tabpanel" aria-labelledby={`ed-tab-${file.id}`} tabIndex={0}
        className="bg-[#0f0f12] py-5 font-mono text-[12px] leading-[1.7] sm:py-6 sm:text-[13px]">
        <span className="sr-only">{file.code}</span>
        <ol aria-hidden className="min-w-0">
          {lines.map((ln, i) => {
            const marked = file.mark?.(ln);
            const last = i === lines.length - 1;
            return (
              <li key={i} className={cx("relative flex", marked && "bg-white/[0.04]")}>
                {marked && <span className="absolute inset-y-0 left-0 w-0.5 bg-brand" />}
                <span className="money w-[calc(var(--w)*1ch+2.25rem)] shrink-0 select-none pr-4 text-right text-outline" style={{ ["--w" as string]: width }}>{i + 1}</span>
                <code className="min-w-0 flex-1 whitespace-pre-wrap pl-[2ch] pr-5 -indent-[2ch] [overflow-wrap:anywhere] sm:pr-6">
                  {ln === "" ? "​" : tokenize(ln, file.lang).map((tk, j) => <span key={j} className={tk.c && INK[tk.c]}>{tk.t}</span>)}
                  {last && <span className="ck-caret ml-px inline-block h-[1.15em] w-[2px] translate-y-[0.2em] bg-on-surface" />}
                </code>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-rule bg-[#0f0f12] px-4 py-2 text-xs text-outline" aria-hidden>
        <span>{file.lang === "ts" ? "TypeScript" : file.lang === "sh" ? "Shell" : "JSON"}</span>
        <span className="money flex gap-4"><span>UTF-8</span><span>Ln {lines.length}</span></span>
      </div>
    </div>
  );
}
