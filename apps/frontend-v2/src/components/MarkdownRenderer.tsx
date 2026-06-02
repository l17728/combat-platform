import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import MermaidBlock from "./MermaidBlock.js";
import { PlayCircleOutlined } from "@ant-design/icons";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

const YT_REGEX = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{11})/;
const BILIBILI_VIDEO_REGEX = /bilibili\.com\/video\/(BV[\w]+)/;
const BILIBILI_PLAYER_REGEX = /player\.bilibili\.com\/player\.html\?.*bvid=(BV[\w]+)/;
const ALLOWED_IFRAME_HOSTS = ["player.bilibili.com"];

function extractYtId(url: string): string | null {
  const m = url.match(YT_REGEX);
  return m ? m[1] : null;
}

function normalizeBilibiliUrl(src: string): string | null {
  const playerM = src.match(BILIBILI_PLAYER_REGEX);
  if (playerM) return src;
  const videoM = src.match(BILIBILI_VIDEO_REGEX);
  if (videoM) return `https://player.bilibili.com/player.html?bvid=${videoM[1]}&high_quality=1`;
  return null;
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

function YouTubeCard({ ytId, linkText }: { ytId: string; linkText: string }) {
  const thumbUrl = `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`;
  const watchUrl = `https://www.youtube.com/watch?v=${ytId}`;
  return (
    <a
      href={watchUrl}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "block",
        position: "relative",
        width: "100%",
        maxWidth: 560,
        borderRadius: 8,
        overflow: "hidden",
        marginBottom: 12,
        textDecoration: "none",
        border: "1px solid #f0f0f0",
      }}
    >
      <div style={{ position: "relative", paddingBottom: "56.25%", background: "#000" }}>
        <img
          src={thumbUrl}
          alt={linkText}
          style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover" }}
        />
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            fontSize: 48,
            color: "#fff",
            opacity: 0.9,
            filter: "drop-shadow(0 2px 8px rgba(0,0,0,0.5))",
          }}
        >
          <PlayCircleOutlined />
        </div>
      </div>
      <div style={{ padding: "8px 12px", background: "#fff", color: "#333", fontSize: 13 }}>{linkText}</div>
    </a>
  );
}

function LinkBlock({ href, children }: ComponentPropsWithoutRef<"a"> & { children?: ReactNode }) {
  if (!href) return <a>{children}</a>;
  const ytId = extractYtId(href);
  if (ytId) {
    const linkText = typeof children === "string" ? children : "在 YouTube 上观看此视频";
    return <YouTubeCard ytId={ytId} linkText={linkText} />;
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

function IframeBlock({ src, ...rest }: ComponentPropsWithoutRef<"iframe"> & { src?: string }) {
  if (!src) return null;
  const bilibiliUrl = normalizeBilibiliUrl(src);
  if (bilibiliUrl) {
    src = bilibiliUrl;
  } else {
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
  }
  return (
    <div style={{ position: "relative", width: "100%", paddingBottom: "56.25%", marginBottom: 12 }}>
      <iframe
        src={src}
        {...rest}
        allowFullScreen
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          border: 0,
          borderRadius: 8,
        }}
      />
    </div>
  );
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
