import { useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { xml } from "@codemirror/lang-xml";

export default function ResponseBodyEditor({ contentType, value, onChange }: { contentType: string; value: string; onChange: (value: string) => void }) {
  const extensions = useMemo(() => {
    if (contentType === "application/json") return [json()];
    if (contentType === "text/html") return [html()];
    if (contentType === "application/xml") return [xml()];
    return [];
  }, [contentType]);
  const isDark = document.documentElement.dataset.theme !== "light";

  return <div className="overflow-hidden rounded-md border border-white/10 bg-black/20 focus-within:border-amber-400/50 focus-within:ring-2 focus-within:ring-amber-400/10">
    <CodeMirror
      value={value}
      height="260px"
      theme={isDark ? "dark" : "light"}
      extensions={extensions}
      onChange={onChange}
      basicSetup={{
        lineNumbers: true,
        foldGutter: true,
        bracketMatching: true,
        closeBrackets: true,
        autocompletion: true,
        highlightActiveLine: true,
        highlightSelectionMatches: true,
      }}
      className="font-mono text-[13px] [&_.cm-editor]:outline-none [&_.cm-gutters]:border-r [&_.cm-gutters]:border-white/10"
    />
  </div>;
}
