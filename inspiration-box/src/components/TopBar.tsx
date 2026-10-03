import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, CloseX, HeartFilled } from "../icons";
import { useStore } from "../store/useStore";
import { SmartImage } from "./SmartImage";
import AddIdeaModal from "./AddIdeaModal";
import type { Idea } from "../types";

/** 搜索命中的最大展示条数 */
const MAX_HIT = 8;

export default function TopBar() {
  const [open, setOpen] = useState(false); // 收藏弹窗
  const [q, setQ] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const ideas = useStore((s) => s.ideas);
  const editingId = useStore((s) => s.editingId);
  const setEditingId = useStore((s) => s.setEditingId);
  const nav = useNavigate();
  const editingIdea = useMemo(
    () => ideas.find((i) => i.id === editingId) ?? null,
    [ideas, editingId]
  );

  const kw = q.trim().toLowerCase();

  /* 搜索站内图文卡片：标题 / 描述 / 分类 / 来源 全字段模糊匹配 */
  const hits = useMemo(() => {
    if (!kw) return [];
    return ideas
      .filter((i) =>
        [i.title, i.desc ?? "", i.category, i.platform]
          .join(" ")
          .toLowerCase()
          .includes(kw)
      )
      .sort(
        (a, b) =>
          Number(b.featured) - Number(a.featured) || b.createdAt - a.createdAt
      )
      .slice(0, MAX_HIT);
  }, [ideas, kw]);

  /* 空关键词时给个入口：最近收藏的几张 */
  const recent = useMemo(
    () => [...ideas].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5),
    [ideas]
  );

  /* 点击外部关闭结果面板 */
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  /* 滚轮：光标落在搜索框或结果面板上时，滚的是结果列表，而不是整个页面。
     列表滚到顶/底之后交还给页面，避免"卡住"。
     用原生监听是因为 React 的 onWheel 是被动监听，preventDefault 无效。 */
  useEffect(() => {
    const box = boxRef.current;
    if (!box || !searchOpen) return;
    const onWheel = (e: WheelEvent) => {
      const scroller = listRef.current;
      if (!scroller) return;
      if (scroller.scrollHeight <= scroller.clientHeight) return; // 不需要滚
      const atTop = scroller.scrollTop <= 0 && e.deltaY < 0;
      const atBottom =
        scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1 &&
        e.deltaY > 0;
      if (atTop || atBottom) return; // 到头了 → 让页面继续滚
      e.preventDefault();
      scroller.scrollTop += e.deltaY;
    };
    box.addEventListener("wheel", onWheel, { passive: false });
    return () => box.removeEventListener("wheel", onWheel);
  }, [searchOpen]);

  const goto = (i: Idea) => {
    setSearchOpen(false);
    inputRef.current?.blur();
    nav(`/category/${i.category}`);
  };

  const closeSearch = () => {
    setSearchOpen(false);
    inputRef.current?.blur();
  };

  const list = kw ? hits : recent;

  return (
    <header className="sticky top-0 z-[60] flex h-14 shrink-0 items-center gap-4 border-b border-border bg-white px-12 py-0">
      {/* 品牌字：24px，是唯一不进阶梯的字号（Logo 不是页面排版） */}
      <div
        data-topbar-logo
        className="shrink-0 text-2xl font-semibold tracking-tight text-brown"
      >
        i AM
      </div>

      {/* 搜索：站内图文卡片 */}
      <div ref={boxRef} className="relative min-w-0 max-w-[420px] flex-1">
        <div className="flex h-9 items-center gap-2 rounded-[20px] border border-border bg-mint-soft px-3.5 transition-colors focus-within:border-mint">
          <Search size={18} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Escape") closeSearch();
              if (e.key === "Enter" && hits[0]) goto(hits[0]);
            }}
            placeholder="搜索站内的灵感卡片…"
            aria-label="搜索站内的灵感卡片"
            className="min-w-0 w-full bg-transparent text-t3 text-brown placeholder:text-warmgray focus:outline-none"
          />
          {q && (
            <button
              type="button"
              onClick={() => {
                setQ("");
                inputRef.current?.focus();
              }}
              aria-label="清空搜索"
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-gray/25 transition-colors hover:bg-gray/40"
            >
              <CloseX size={10} />
            </button>
          )}
        </div>

        {searchOpen && (
          <div className="absolute left-0 right-0 top-full z-40 mt-1.5 overflow-hidden rounded-card border border-border bg-white shadow-[0_16px_40px_-12px_rgba(0,0,0,0.18)]">
            <div className="px-3.5 pb-1 pt-2.5 text-t6 font-medium text-warmgray">
              {kw ? `找到 ${hits.length} 条灵感` : "最近收藏"}
            </div>

            {list.length > 0 ? (
              <div
                ref={listRef}
                className="max-h-[320px] overflow-y-auto scroll-thin py-1"
              >
                {list.map((i) => (
                  <button
                    key={i.id}
                    type="button"
                    onClick={() => goto(i)}
                    className="flex w-full items-center gap-3 px-3.5 py-2 text-left transition-colors hover:bg-mint-soft/50"
                  >
                    <span
                      className="h-11 w-11 shrink-0 overflow-hidden rounded-[10px]"
                      style={{ background: i.color }}
                    >
                      {i.image && (
                        <SmartImage
                          src={i.image}
                          refUrl={i.link}
                          alt={i.title}
                          className="h-full w-full object-cover"
                        />
                      )}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-t4 font-semibold text-brown">
                        {i.title}
                      </span>
                      <span className="truncate text-t6 text-warmgray">
                        {i.category} · {i.platform}
                        {i.statusTag ? ` · ${i.statusTag}` : ""}
                      </span>
                    </span>
                    {i.featured && (
                      <span className="shrink-0">
                        <HeartFilled size={13} />
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <div className="px-3.5 py-6 text-center text-t5 text-warmgray">
                没有找到「{q.trim()}」相关的灵感
                <br />
                换个词试试，比如「衬衫」「旅行」
              </div>
            )}

          </div>
        )}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-1 rounded-[20px] bg-brown px-[18px] py-2 text-t3 font-semibold text-white transition-opacity hover:opacity-90"
        >
          收藏
        </button>
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brown text-t3 font-semibold text-white">
          雷
        </div>
      </div>

      <AddIdeaModal open={open} onClose={() => setOpen(false)} />
      <AddIdeaModal
        open={!!editingId}
        edit={editingIdea ?? undefined}
        onClose={() => setEditingId(null)}
      />
    </header>
  );
}
