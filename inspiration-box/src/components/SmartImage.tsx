import { useState } from "react";
import type * as React from "react";
import { ImageGlyph } from "../icons";

/* ============================================================
   封面图 · 三级兜底
   外链主图直连会被图床防盗链拦掉（小红书 / 微博 / B站均校验 Referer），
   因此统一走服务端代理 /api/img；代理失败再退回直连原图；
   仍失败则降级为占位，保证卡片永远不出现裂图。
   ============================================================ */

/** 候选地址：本地上传 / data / blob 直连；外链先代理、后直连 */
export function coverCandidates(src?: string, refUrl?: string): string[] {
  if (!src) return [];
  if (/^(\/uploads\/|data:|blob:|\/api\/img)/i.test(src)) return [src];
  const q = `/api/img?url=${encodeURIComponent(src)}${
    refUrl ? `&ref=${encodeURIComponent(refUrl)}` : ""
  }`;
  return [q, src];
}

export function SmartImage({
  src,
  refUrl,
  alt,
  className,
  fallback = null,
}: {
  src?: string;
  /** 原笔记页地址，代理时用作伪装 Referer */
  refUrl?: string;
  alt?: string;
  className?: string;
  fallback?: React.ReactNode;
}) {
  const key = `${src ?? ""}|${refUrl ?? ""}`;
  const [st, setSt] = useState({ key: "", i: 0 });
  const i = st.key === key ? st.i : 0;

  const list = coverCandidates(src, refUrl);
  if (!list.length || i >= list.length) return <>{fallback}</>;

  return (
    <img
      key={key}
      src={list[i]}
      alt={alt ?? ""}
      className={className}
      loading="lazy"
      draggable={false}
      referrerPolicy="no-referrer"
      onError={() => setSt({ key, i: i + 1 })}
    />
  );
}

/** 无图 / 全部加载失败时的占位（图标 + 平台名，底色沿用卡片占位色） */
export function CoverPlaceholder({
  platform,
  compact = false,
}: {
  platform?: string;
  compact?: boolean;
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-brown/30">
      <ImageGlyph size={compact ? 22 : 28} />
      {platform && (
        <span className="text-t6 font-medium tracking-wide">
          {platform}
        </span>
      )}
    </div>
  );
}
