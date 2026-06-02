import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";

mermaid.initialize({ startOnLoad: false, theme: "default", securityLevel: "strict" });

let idCounter = 0;

export default function MermaidBlock({ code }: { code: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const id = `mermaid-${++idCounter}-${Date.now()}`;

    (async () => {
      try {
        const { svg } = await mermaid.render(id, code);
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message || "Mermaid 渲染失败");
        }
      }
    })();

    return () => {
      cancelled = true;
      // clean up the temp element mermaid may create
      const el = document.getElementById(id);
      if (el) el.remove();
    };
  }, [code]);

  if (error) {
    return (
      <pre style={{ color: "#cf1322", background: "#fff2f0", padding: 12, borderRadius: 6, fontSize: 12 }}>
        Mermaid 渲染错误: {error}
      </pre>
    );
  }

  return <div ref={containerRef} style={{ overflow: "auto" }} />;
}
