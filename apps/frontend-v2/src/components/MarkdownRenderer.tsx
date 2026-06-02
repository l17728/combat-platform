import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import MermaidBlock from "./MermaidBlock.js";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

const YT_REGEX = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{11})/;
const ALLOWED_IFRAME_HOSTS = [
  "www.youtube.com",
  "youtube.com",
  "youtu.be",
  "player.bilibili.com",
  "www.bilibili.com",
  "bilibili.com",
];

function extractYtId(url: string): string | null {
  const m = url.match(YT_REGEX);
  return m ? m[1] : null;
}

const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "video", "source", "iframe"],
  attributes: {
    ...(defaultSchema.attributes ?? {}),
    video: ["controls", "width", "height", "style", "autoplay", "muted", "loop", "poster", "preload"],
    source: ["src", "type"],
    iframe: ["src", "width", "height", "frameborder", "allow", "allowfullscreen", "scrolling", "style", "title"],
    "*": ["style"],
  },
};

function CodeBlock({ className, children, ...rest }: ComponentPropsWithoutRef<"code"> & { className?: string }) {
  const lang = className?.replace("language-", "");
  if (lang === "mermaid") {
    return <MermaidBlock code={String(children).replace(/\n$/, "")} />;
  }
  return (
    <code className={className} {...rest}>
      {children}
    </code>
  );
}

function LinkBlock({ href, children }: ComponentPropsWithoutRef<"a"> & { children?: ReactNode }) {
  if (!href) return <a>{children}</a>;
  const ytId = extractYtId(href);
  if (ytId) {
    return (
      <div style={{ position: "relative", width: "100%", paddingBottom: "56.25%", marginBottom: 12 }}>
        <iframe
          src={`https://www.youtube.com/embed/${ytId}`}
          title="YouTube video"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: 0, borderRadius: 8 }}
        />
      </div>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

function IframeBlock({ src, ...rest }: ComponentPropsWithoutRef<"iframe"> & { src?: string }) {
  if (!src) return null;
  try {
    const u = new URL(src);
    if (!ALLOWED_IFRAME_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith("." + h))) {
      return (
        <a href={src} target="_blank" rel="noopener noreferrer">
          {src}
        </a>
      );
    }
  } catch {
    return null;
  }
  return <iframe src={src} {...rest} />;
}

function ParagraphBlock({ children }: ComponentPropsWithoutRef<"p"> & { children?: ReactNode }) {
  const arr = Array.isArray(children) ? children : [children];
  if (arr.length === 1) {
    const child = arr[0];
    if (child && typeof child === "object" && "props" in (child as any)) {
      const linkProps = (child as any).props;
      if (linkProps?.href && extractYtId(linkProps.href)) {
        return <>{children}</>;
      }
      if (linkProps?.src) {
        return <>{children}</>;
      }
    }
  }
  return <p>{children}</p>;
}

const components = { code: CodeBlock, a: LinkBlock, iframe: IframeBlock, p: ParagraphBlock };

export default function MarkdownRenderer({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
      components={components}
    >
      {children}
    </ReactMarkdown>
  );
}
