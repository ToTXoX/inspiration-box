import type * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Modal, Input, App, Popconfirm } from "antd";
import {
  useStore,
  orderedOnBoard,
  normalizeRows,
  RULE_ROW_MAX,
  type CanvasPos,
  type LayoutMode,
} from "../store/useStore";
import { Idea, TextNote, NOTE_COLORS, NOTE_DEFAULT_COLOR } from "../types";
import { Plus, CloseX } from "../icons";
import ManageCategoryModal from "../components/ManageCategoryModal";
import {
  PageShell,
  Container,
  FilterBar,
  FilterRow,
  Segmented,
} from "../components/ui";
import { SmartImage, CoverPlaceholder } from "../components/SmartImage";

/* ============================================================
   自由排版 · 无边画布
   ------------------------------------------------------------
   相机模型：screen = world × k + (x, y)
   · 卡片 / 便签存的是「世界坐标」，可为负，四向无限延伸、允许互相交叠
   · 空白处拖拽 = 平移画布；滚轮 = 以光标为锚点缩放；双击空白 = 新建文本便签
   · 卡片宽度可拖（内容整体等比缩放），高度随内容走，不做旋转
   ============================================================ */

const BASE_W = 240; // 卡片基准宽（设计稿尺寸）
const IMG_H = 300; // 封面基准高（4:5 竖图，图片占卡片主体）
/** 卡片高度的估算比例（高 / 宽，实测约 1.43）；仅在 ResizeObserver 还没测到之前临时使用 */
const CARD_EST_H = 1.45;
const MIN_W = 130;
const MAX_W = 620;
const NOTE_W = 220; // 文本便签默认宽
const MIN_NOTE_W = 120;

/** 灵感库面板：每个品类板块最多陈列 2×3 = 6 个 1:1 缩略图，超出的在本板块内滚动
    （面板整体也相应收窄，把宽度让给画布） */
const PANEL_MAX = 6;
/** 面板板块的缩略图网格：2 列 */
const PANEL_GRID = "grid grid-cols-2 gap-2";
/** 超过 6 个时板块定高为 3 行 —— 高 = 3 行缩略图 + 2 道行距（缩略图 1:1，
    面板内容宽 180 → 单格 86 → 内容高 3×86 + 2×8 = 274），留几像素余量避免误出滚动条
    （注意 aspect-ratio 是「宽/高」，写 [x/y] 时 y 要大于 x 才是竖的） */
const PANEL_SCROLL_H = "aspect-[90/139]";
const MAX_NOTE_W = 620;
/** 新建元素（便签 / 从灵感库上板的卡片）落在视口纵向的这个比例处（偏上），避开中间那一大片 */
const NEW_ITEM_TOP_RATIO = 0.2;
/** 规则排版：列宽锁死（卡片不可缩放）+ 列间距 / 行间距 */
const RULE_COL_W = 184; // 单列宽度（世界单位）；调小 = 一排能放更多个
const COL_GAP = 28;
const ROW_GAP = 28;
/** 规则排版「适应」时四周留白（比自由排版紧，好让横向多铺几列） */
const RULE_PAD = 32;
const MIN_K = 0.2;
const MAX_K = 3;
const PAD = 70; // 「适应画布」时内容四周留白（世界坐标）

const clamp = (v: number, a: number, b: number) => Math.min(Math.max(v, a), b);

/** 规则排版网格里的一格：**只装图文卡片**（便签是自由元素，不进阵列） */
type GridCell = {
  id: string;
  idea: Idea;
  x: number;
  y: number;
  w: number;
  /** 处在第几行（自上而下从 0 数） */
  r: number;
  /** 处在该行的第几列（自左向右从 0 数） */
  c: number;
};

/**
 * 规则排版的阵列：按 `rows`（每行各放几张）逐行铺开。
 * 每一行都是从左边缘起排，所以列与列天然对齐；行高取行内最高者（规则排版下卡片等宽，
 * 高度本来就一致）。**行与行之间不要求张数相同** —— 第一行 6 个、第二行 4 个是允许的。
 */
function ruleFlow(
  queue: { cell: { id: string; idea: Idea; w: number }; h: number }[],
  rows: number[]
): GridCell[] {
  const out: GridCell[] = [];
  let i = 0;
  let y = 0;
  rows.forEach((count, r) => {
    const line = queue.slice(i, i + count);
    if (!line.length) return;
    const rowH = Math.max(...line.map((c) => c.h));
    line.forEach((c, ci) => {
      out.push({
        ...c.cell,
        r,
        c: ci,
        x: ci * (RULE_COL_W + COL_GAP),
        y,
      });
    });
    y += rowH + ROW_GAP;
    i += count;
  });
  return out;
}

type Cam = { x: number; y: number; k: number };
type Box = { x: number; y: number; w: number; h: number; color: string };

/* ---------- 卡片内容：图片占主体，信息区只留「标题 + ↗」，尺寸随宽度等比缩放 ---------- */
function IdeaCardBody({ idea, w }: { idea: Idea; w: number }) {
  const s = w / BASE_W;
  return (
    <>
      <div
        className="relative w-full shrink-0 overflow-hidden"
        style={{ height: IMG_H * s, background: idea.color }}
      >
        {idea.image ? (
          <SmartImage
            src={idea.image}
            refUrl={idea.link}
            alt={idea.title}
            className="h-full w-full object-cover"
            fallback={<CoverPlaceholder platform={idea.platform} />}
          />
        ) : (
          <CoverPlaceholder platform={idea.platform} />
        )}
      </div>
      <div
        className="flex items-center"
        style={{ padding: 12 * s, gap: 8 * s }}
      >
        <div
          className="min-w-0 flex-1 truncate font-semibold text-brown"
          style={{ fontSize: 14 * s, lineHeight: 1.35 }}
        >
          {idea.title}
        </div>
        {idea.link && (
          <a
            href={idea.link}
            target="_blank"
            rel="noreferrer"
            data-no-drag
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            title={`打开原帖：${idea.link}`}
            aria-label={`打开原帖：${idea.link}`}
            className="shrink-0 font-medium text-mint transition-opacity hover:opacity-70"
            style={{ fontSize: 14 * s, lineHeight: 1 }}
          >
            ↗
          </a>
        )}
      </div>
    </>
  );
}

/* ---------- 画布卡片：可拖动、可等比缩放、右键调层 ---------- */
function CanvasIdeaCard({
  idea,
  at,
  k,
  locked = false,
  onRemove,
  onMenu,
  reportSize,
  onReorder,
  reorderActive = false,
  reorderOver = false,
}: {
  idea: Idea;
  /** 当前位置与尺寸：自由排版来自存储坐标，规则排版来自网格 */
  at: { x: number; y: number; w: number };
  k: number;
  /** 规则排版下锁定：不可缩放、不可自由挪位（位置由网格算），但仍可拖动调整阵列顺序 */
  locked?: boolean;
  onRemove: (id: string) => void;
  onMenu: (id: string, e: React.MouseEvent) => void;
  reportSize: (id: string, w: number, h: number) => void;
  /** 规则排版下拖拽 = 调整阵列位置：move 时持续回报卡片投影位置，drop 时提交。
      `box` 是卡片投影到**世界坐标**的左上角与宽度 —— 用它算落点在第几行第几格，
      比用指针位置准（指针可能压在卡片任意一角） */
  onReorder?: (
    id: string,
    clientX: number,
    clientY: number,
    phase: "move" | "drop",
    box?: { x: number; y: number; w: number }
  ) => void;
  /** 正在被拖起来的那张 */
  reorderActive?: boolean;
  /** 当前落点目标（会高亮） */
  reorderOver?: boolean;
}) {
  const moveNote = useStore((s) => s.moveNote);
  const resizeNote = useStore((s) => s.resizeNote);

  const rootRef = useRef<HTMLDivElement>(null);
  const posRef = useRef({ x: at.x, y: at.y });
  const wRef = useRef(at.w);
  const [pos, setPos] = useState(posRef.current);
  const [w, setW] = useState(wRef.current);
  /** 规则排版拖拽时的「提起来」位移（世界单位），只做视觉反馈 */
  const [lift, setLift] = useState<{ dx: number; dy: number } | null>(null);
  const g = useRef<{
    mode: "move" | "resize" | "reorder";
    sx: number;
    sy: number;
    ox: number;
    oy: number;
    ow: number;
    k: number;
    ax: number;
    ay: number;
    d0: number;
    lx: number;
    ly: number;
    /** 规则排版拖拽中：卡片投影到世界坐标的左上角 */
    px: number;
    py: number;
  } | null>(null);

  const setP = (p: { x: number; y: number }) => {
    posRef.current = p;
    setPos(p);
  };
  const setWid = (n: number) => {
    wRef.current = n;
    setW(n);
  };

  const begin = (
    e: React.PointerEvent,
    mode: "move" | "resize"
  ) => {
    const el = rootRef.current;
    if (!el) return;
    e.stopPropagation();
    const rect = el.getBoundingClientRect();
    const dist = Math.hypot(e.clientX - rect.left, e.clientY - rect.top);
    g.current = {
      mode,
      sx: e.clientX,
      sy: e.clientY,
      ox: posRef.current.x,
      oy: posRef.current.y,
      ow: wRef.current,
      k,
      ax: rect.left,
      ay: rect.top,
      d0: Math.max(dist, 1),
      lx: e.clientX,
      ly: e.clientY,
      px: posRef.current.x,
      py: posRef.current.y,
    };
    el.setPointerCapture(e.pointerId);
    document.body.classList.add("dragging");
  };

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
    if (locked) {
      // 规则排版：位置由网格算，拖动改为「调整阵列顺序」——整张卡片被提起来跟随指针
      if (!onReorder) return;
      e.stopPropagation();
      g.current = {
        mode: "reorder",
        sx: e.clientX,
        sy: e.clientY,
        ox: 0,
        oy: 0,
        ow: 0,
        k,
        ax: 0,
        ay: 0,
        d0: 1,
        lx: e.clientX,
        ly: e.clientY,
        px: posRef.current.x,
        py: posRef.current.y,
      };
      rootRef.current?.setPointerCapture(e.pointerId);
      document.body.classList.add("dragging");
      return;
    }
    begin(e, "move");
  };

  const onMove = (e: React.PointerEvent) => {
    const d = g.current;
    if (!d) return;
    if (d.mode === "reorder") {
      const dx = (e.clientX - d.sx) / d.k;
      const dy = (e.clientY - d.sy) / d.k;
      d.lx = e.clientX;
      d.ly = e.clientY;
      d.px = posRef.current.x + dx;
      d.py = posRef.current.y + dy;
      setLift({ dx, dy });
      onReorder?.(idea.id, e.clientX, e.clientY, "move", {
        x: d.px,
        y: d.py,
        w: wRef.current,
      });
      return;
    }
    if (d.mode === "move") {
      setP({
        x: d.ox + (e.clientX - d.sx) / d.k,
        y: d.oy + (e.clientY - d.sy) / d.k,
      });
    } else {
      const dist = Math.hypot(e.clientX - d.ax, e.clientY - d.ay);
      setWid(clamp(d.ow * (dist / d.d0), MIN_W, MAX_W));
    }
  };

  const onUp = () => {
    const d = g.current;
    g.current = null;
    document.body.classList.remove("dragging");
    if (!d) return;
    if (d.mode === "reorder") {
      setLift(null);
      onReorder?.(idea.id, d.lx, d.ly, "drop", {
        x: d.px,
        y: d.py,
        w: wRef.current,
      });
      return;
    }
    if (d.mode === "move") moveNote(idea.id, posRef.current.x, posRef.current.y);
    else resizeNote(idea.id, wRef.current);
  };

  // 外部位置/尺寸变动（换画板、切换排版模式、自动整理）时同步本地，拖拽中不打断
  useEffect(() => {
    if (g.current) return;
    if (at.x !== posRef.current.x || at.y !== posRef.current.y)
      setP({ x: at.x, y: at.y });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at.x, at.y]);

  useEffect(() => {
    if (g.current) return;
    if (at.w !== wRef.current) setWid(at.w);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at.w]);

  // 把真实尺寸回报给画布（小概览图与「适应画布」依赖它）
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const push = () => reportSize(idea.id, el.offsetWidth, el.offsetHeight);
    push();
    const ro = new ResizeObserver(push);
    ro.observe(el);
    return () => ro.disconnect();
  }, [idea.id, reportSize]);

  const inv = 1 / k; // 悬浮件保持屏幕尺寸恒定
  const s = w / BASE_W;

  return (
    <div
      ref={rootRef}
      data-canvas-item
      data-canvas-card
      data-card-id={idea.id}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onContextMenu={(e) => {
        e.preventDefault();
        if (locked) return; // 规则排版下没有层级菜单
        e.stopPropagation();
        onMenu(idea.id, e);
      }}
      className={[
        "group absolute touch-none select-none",
        reorderActive ? "cursor-grabbing" : "cursor-grab active:cursor-grabbing",
      ].join(" ")}
      style={{
        left: pos.x,
        top: pos.y,
        width: w,
        zIndex: reorderActive ? 999 : 1 + (idea.z ?? 0),
        transform: lift
          ? `translate3d(${lift.dx}px, ${lift.dy}px, 0) scale(1.02)`
          : undefined,
      }}
    >
      <div
        className={[
          "border bg-white transition-shadow",
          reorderActive
            ? "border-mint shadow-lg"
            : "border-border shadow-sm group-hover:shadow-md",
        ].join(" ")}
        style={{ borderRadius: 16 * s, overflow: "hidden" }}
      >
        <IdeaCardBody idea={idea} w={w} />
      </div>

      {/* 规则排版调序时：落点目标的高亮框 */}
      {reorderOver && (
        <div
          className="pointer-events-none absolute ring-2 ring-mint"
          style={{ inset: -6 * inv, borderRadius: 20 * s }}
        />
      )}

      {/* 移出画布（取消精选）：屏幕上恒定 19px，跟卡片（约 145~180px 宽）比例更协调 */}
      <button
        data-no-drag
        onClick={() => onRemove(idea.id)}
        aria-label="移出画布"
        title="移出画布（取消精选）"
        className="absolute flex items-center justify-center rounded-full bg-white/92 shadow opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
        style={{ width: 19 * inv, height: 19 * inv, right: 8 * inv, top: 8 * inv }}
      >
        <CloseX size={10 * inv} />
      </button>

      {/* 等比缩放（规则排版下锁定尺寸，不出现角柄） */}
      {!locked && (
        <button
          data-no-drag
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            begin(e, "resize");
          }}
          aria-label="等比缩放"
          title="拖拽等比缩放"
          className="absolute cursor-nwse-resize rounded-full border-2 border-white bg-mint opacity-0 shadow transition group-hover:opacity-100 focus-visible:opacity-100"
          style={{
            width: 18 * inv,
            height: 18 * inv,
            right: -9 * inv,
            bottom: -9 * inv,
          }}
        />
      )}
    </div>
  );
}

/* ---------- 画布文本便签：便签式，双击编辑、随文字增高、空内容自动消失 ---------- */
function CanvasTextNote({
  note,
  at,
  k,
  editing,
  onEdit,
  onCommit,
  onMenu,
  onPlace,
  reportSize,
}: {
  note: TextNote;
  /** 当前位置与宽度：按当前排版模式取对应那一组（两种排版各自独立） */
  at: { x: number; y: number; w: number };
  k: number;
  editing: boolean;
  onEdit: (id: string) => void;
  onCommit: (id: string, text: string) => void;
  onMenu: (id: string, e: React.MouseEvent) => void;
  /** 拖完 / 拖宽后回写位置；由画布决定写进自由排版那组还是规则排版那组 */
  onPlace: (id: string, pos: CanvasPos) => void;
  reportSize: (id: string, w: number, h: number) => void;
}) {
  const removeTextNote = useStore((s) => s.removeTextNote);
  const updateTextNote = useStore((s) => s.updateTextNote);

  const rootRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const posRef = useRef({ x: at.x, y: at.y });
  const wRef = useRef(at.w);
  const textRef = useRef(note.text);
  const [pos, setPos] = useState(posRef.current);
  const [w, setW] = useState(at.w);
  const [text, setText] = useState(note.text);
  const g = useRef<{
    mode: "move" | "resize";
    sx: number;
    sy: number;
    ox: number;
    oy: number;
    ow: number;
    k: number;
  } | null>(null);

  const autoSize = () => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  useEffect(() => {
    if (!editing) return;
    const el = taRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    autoSize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  useEffect(() => {
    if (g.current) return;
    if (at.x !== posRef.current.x || at.y !== posRef.current.y) {
      posRef.current = { x: at.x, y: at.y };
      setPos({ x: at.x, y: at.y });
    }
  }, [at.x, at.y]);

  useEffect(() => {
    if (g.current) return;
    if (at.w !== wRef.current) {
      wRef.current = at.w;
      setW(at.w);
    }
  }, [at.w]);

  useEffect(() => {
    if (editing) return;
    if (note.text !== textRef.current) {
      textRef.current = note.text;
      setText(note.text);
    }
  }, [note.text, editing]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const push = () => reportSize(note.id, el.offsetWidth, el.offsetHeight);
    push();
    const ro = new ResizeObserver(push);
    ro.observe(el);
    return () => ro.disconnect();
  }, [note.id, reportSize]);

  const onDown = (e: React.PointerEvent) => {
    if (editing) {
      e.stopPropagation();
      return;
    }
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
    e.stopPropagation();
    g.current = {
      mode: "move",
      sx: e.clientX,
      sy: e.clientY,
      ox: posRef.current.x,
      oy: posRef.current.y,
      ow: wRef.current,
      k,
    };
    rootRef.current?.setPointerCapture(e.pointerId);
    document.body.classList.add("dragging");
  };

  const onHandleDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    g.current = {
      mode: "resize",
      sx: e.clientX,
      sy: e.clientY,
      ox: posRef.current.x,
      oy: posRef.current.y,
      ow: wRef.current,
      k,
    };
    rootRef.current?.setPointerCapture(e.pointerId);
    document.body.classList.add("dragging");
  };

  const onMove = (e: React.PointerEvent) => {
    const d = g.current;
    if (!d) return;
    if (d.mode === "move") {
      const p = {
        x: d.ox + (e.clientX - d.sx) / d.k,
        y: d.oy + (e.clientY - d.sy) / d.k,
      };
      posRef.current = p;
      setPos(p);
    } else {
      // 角柄拖拽 = 只改宽度，高度随文字重排
      const nw = clamp(d.ow + (e.clientX - d.sx) / d.k, MIN_NOTE_W, MAX_NOTE_W);
      wRef.current = nw;
      setW(nw);
    }
  };

  const endDrag = () => {
    const d = g.current;
    g.current = null;
    document.body.classList.remove("dragging");
    if (!d) return;
    onPlace(note.id, {
      x: posRef.current.x,
      y: posRef.current.y,
      w: wRef.current,
    });
  };

  const inv = 1 / k;
  const color = note.color ?? NOTE_DEFAULT_COLOR;

  return (
    <div
      ref={rootRef}
      data-canvas-item
      data-canvas-note
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onEdit(note.id);
      }}
      onContextMenu={(e) => {
        // 便签在两种排版下都是自由元素：右键照样能调叠放层级（可以压到卡片下方）
        e.preventDefault();
        e.stopPropagation();
        onMenu(note.id, e);
      }}
      className={[
        "group absolute touch-none select-none rounded-xl shadow-sm ring-1 transition",
        editing ? "ring-mint/70" : "ring-transparent hover:ring-mint/40",
      ].join(" ")}
      style={{
        left: pos.x,
        top: pos.y,
        width: w,
        zIndex: 1 + note.z,
        padding: "12px 14px",
        background: color,
        cursor: editing ? "text" : "grab",
      }}
    >
      {/* 编辑态：便签上方浮出一条奶油色卡，换底色不用退出编辑 */}
      {editing && (
        <div
          data-no-drag
          onPointerDown={(e) => {
            // 阻止冒泡，同时不让 textarea 失焦（否则一改色就提交了）
            e.preventDefault();
            e.stopPropagation();
          }}
          className="absolute flex items-center gap-1 rounded-pill border border-border bg-white px-1.5 py-1 shadow-md"
          style={{
            left: 0,
            bottom: `calc(100% + ${9 * inv}px)`,
            transform: `scale(${inv})`,
            transformOrigin: "left bottom",
          }}
        >
          {NOTE_COLORS.map((c) => {
            const active = c.value.toLowerCase() === color.toLowerCase();
            return (
              <button
                key={c.value}
                type="button"
                title={c.name}
                aria-label={`便签底色：${c.name}`}
                aria-pressed={active}
                onClick={() => updateTextNote(note.id, { color: c.value })}
                className="block rounded-full transition"
                style={{
                  width: 20,
                  height: 20,
                  background: c.value,
                  boxShadow: active
                    ? "0 0 0 1px #fff, 0 0 0 3px var(--color-mint)"
                    : "inset 0 0 0 1px rgba(42,28,18,0.10)",
                }}
              />
            );
          })}
        </div>
      )}

      {editing ? (
        <textarea
          ref={taRef}
          data-no-drag
          value={text}
          placeholder="写点什么…"
          onChange={(e) => {
            setText(e.target.value);
            textRef.current = e.target.value;
            autoSize();
          }}
          onBlur={() => onCommit(note.id, text)}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          className="block w-full resize-none bg-transparent text-[15px] leading-[1.6] text-brown outline-none placeholder:text-brown/35"
          rows={1}
        />
      ) : (
        <div className="whitespace-pre-wrap break-words text-[15px] leading-[1.6] text-brown">
          {text}
        </div>
      )}

      {!editing && (
        <>
          <button
            data-no-drag
            onClick={() => removeTextNote(note.id)}
            aria-label="删除便签"
            title="删除便签"
            className="absolute flex items-center justify-center rounded-full border-2 border-white bg-white shadow opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
            style={{
              width: 19 * inv,
              height: 19 * inv,
              right: -9.5 * inv,
              top: -9.5 * inv,
            }}
          >
            <CloseX size={10 * inv} />
          </button>
          {/* 拖宽角柄：便签是自由元素，两种排版下都在 */}
          <button
            data-no-drag
            onPointerDown={onHandleDown}
            aria-label="调整便签宽度"
            title="拖拽调整宽度"
            className="absolute cursor-ew-resize rounded-full border-2 border-white bg-mint opacity-0 shadow transition group-hover:opacity-100 focus-visible:opacity-100"
            style={{
              width: 16 * inv,
              height: 16 * inv,
              right: -8 * inv,
              bottom: -8 * inv,
            }}
          />
        </>
      )}
    </div>
  );
}

/* ---------- 左上角无边画布小概览图 ----------
   宽度 = HUD 面板内宽（面板 158，减去左右各 1px 边框）。
   自身不再画边框/圆角，由外层面板统一负责，和缩放条视觉上成为一体。 */
/* 小概览图尺寸：收到 130×88 —— 再大就会盖住主画面左上角那片卡片 */
const MM_W = 130;
const MM_H = 88;

function Minimap({
  boxes,
  view,
  onNavigate,
  onFit,
}: {
  boxes: Box[];
  /** 当前视口在世界坐标里的位置 */
  view: { x: number; y: number; w: number; h: number };
  onNavigate: (wx: number, wy: number) => void;
  onFit: () => void;
}) {
  // 世界取景框：只按「内容」算，平移时缩放比例保持稳定，不会跟着抖
  const all = boxes.length
    ? boxes.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h }))
    : [view];
  const x0 = Math.min(...all.map((a) => a.x));
  const y0 = Math.min(...all.map((a) => a.y));
  const x1 = Math.max(...all.map((a) => a.x + a.w));
  const y1 = Math.max(...all.map((a) => a.y + a.h));
  const bw = Math.max(x1 - x0, 1);
  const bh = Math.max(y1 - y0, 1);
  const s = Math.min((MM_W - 12) / bw, (MM_H - 12) / bh);
  const ox = (MM_W - bw * s) / 2;
  const oy = (MM_H - bh * s) / 2;
  const tx = (x: number) => (x - x0) * s + ox;
  const ty = (y: number) => (y - y0) * s + oy;

  const jump = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    onNavigate(
      x0 + (e.clientX - r.left - ox) / s,
      y0 + (e.clientY - r.top - oy) / s
    );
  };

  return (
    <div
      data-hud
      title="单击定位 · 双击让所有卡片完整显示"
      onPointerDown={(e) => {
        e.stopPropagation();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        jump(e);
      }}
      onPointerMove={(e) => {
        if (e.buttons === 1) jump(e);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onFit();
      }}
      className="block cursor-pointer"
    >
      <svg width={MM_W} height={MM_H} className="block">
        <defs>
          <clipPath id="mm-clip">
            <rect x="0" y="0" width={MM_W} height={MM_H} />
          </clipPath>
        </defs>
        <g clipPath="url(#mm-clip)">
          <rect x="0" y="0" width={MM_W} height={MM_H} fill="#f7fbfa" />
          {boxes.map((b, i) => (
            <rect
              key={i}
              x={tx(b.x)}
              y={ty(b.y)}
              width={Math.max(b.w * s, 1.5)}
              height={Math.max(b.h * s, 1.5)}
              rx="1.5"
              fill={b.color}
            />
          ))}
          <rect
            x={tx(view.x)}
            y={ty(view.y)}
            width={Math.max(view.w * s, 6)}
            height={Math.max(view.h * s, 6)}
            fill="var(--color-mint)"
            fillOpacity="0.09"
            stroke="var(--color-mint)"
            strokeWidth="1.4"
            rx="2"
          />
        </g>
      </svg>
    </div>
  );
}

/* ---------- 页面 ---------- */
export default function BoardPage() {
  const { id } = useParams();
  const boardId = id ?? "b1";
  const nav = useNavigate();
  const { message } = App.useApp();

  const boards = useStore((s) => s.boards);
  const ideas = useStore((s) => s.ideas);
  const canvasNotes = useStore((s) => s.canvasNotes);
  const placeOnBoard = useStore((s) => s.placeOnBoard);
  const removeFromBoard = useStore((s) => s.removeFromBoard);
  const addTextNote = useStore((s) => s.addTextNote);
  const updateTextNote = useStore((s) => s.updateTextNote);
  const removeTextNote = useStore((s) => s.removeTextNote);
  const reorderLayer = useStore((s) => s.reorderLayer);
  const placeCardInRow = useStore((s) => s.placeCardInRow);
  const addBoard = useStore((s) => s.addBoard);
  const moveBoard = useStore((s) => s.moveBoard);
  const deleteIdea = useStore((s) => s.deleteIdea);
  const categories = useStore((s) => s.categories);

  const board = boards.find((b) => b.id === boardId) ?? boards[0];

  const [free, setFree] = useState(true);
  const [manageOpen, setManageOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [cam, setCam] = useState<Cam>({ x: 0, y: 0, k: 1 });
  /** 画布平移过渡：只在「程序化移动」（新卡上板后把它带进视野）时开一下，拖拽时保持即时 */
  const [gliding, setGliding] = useState(false);
  const glideRef = useRef(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(
    null
  );
  /** 规则排版拖拽：被拖起的卡片 + 它当前投影到阵列的哪一格（虚线格会画在那里） */
  const [reorder, setReorder] = useState<{
    id: string;
    cell: { r: number; c: number } | null;
  } | null>(null);

  const viewportRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(
    null
  );
  const [panning, setPanning] = useState(false);
  const sizeRef = useRef({ w: 0, h: 0 });
  const [size, setSize] = useState({ w: 0, h: 0 });

  /* 实测尺寸表：小概览图与「适应画布」用真实高度，避免估算偏差 */
  const sizesRef = useRef(new Map<string, { w: number; h: number }>());
  const rafRef = useRef(0);
  const [tickN, tick] = useState(0);
  const reportSize = useCallback((id: string, w: number, h: number) => {
    const prev = sizesRef.current.get(id);
    if (prev && Math.abs(prev.w - w) < 0.5 && Math.abs(prev.h - h) < 0.5) return;
    sizesRef.current.set(id, { w, h });
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      tick((n) => n + 1);
    });
  }, []);

  // 跟踪画布可视区尺寸（相机换算、缩放锚点、适应画布都要用）
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const update = () => {
      const s = { w: el.clientWidth, h: el.clientHeight };
      const prev = sizeRef.current;
      // 窗口缩放时保留世界坐标的视野中心与当前倍率。
      if (prev.w > 0 && prev.h > 0 && s.w > 0 && s.h > 0) {
        setCam((c) => ({ ...c, x: c.x + (s.w - prev.w) / 2, y: c.y + (s.h - prev.h) / 2 }));
      }
      sizeRef.current = s;
      setSize(s);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [free, board?.id]);

  /* 画布陈列什么：该画板品类内「精选」的卡片。精选即上板，不需要手动加入 */
  const onBoard = useMemo(
    () =>
      board
        ? ideas.filter((i) => i.featured && board.categories.includes(i.category))
        : [],
    [ideas, board]
  );
  const notes = useMemo(
    () => canvasNotes.filter((n) => n.boardId === board?.id),
    [canvasNotes, board?.id]
  );

  /* 新上板的卡片还没有坐标 → 补一个不重叠的落点（幂等，无缺失时不写仓库） */
  const ensureBoardPlacements = useStore((s) => s.ensureBoardPlacements);
  useEffect(() => {
    // 规则排版用网格算位置，但坐标照旧补齐（切回自由排版时才有的可用）
    if (board) ensureBoardPlacements(board.id);
  }, [board, ideas, ensureBoardPlacements]);

  /* 世界包围盒（含实测尺寸，未测到的高度按卡片比例估一个） */
  const measured = useCallback(
    (id: string, fallbackW: number, fallbackH: number) =>
      sizesRef.current.get(id) ?? { w: fallbackW, h: fallbackH },
    []
  );

  /* 规则排版的阵列顺序：用户手动调过序就按 cardOrder 走，否则用默认顺序 */
  const ordered = useMemo(() => orderedOnBoard(ideas, board), [ideas, board]);

  /* 规则排版：**每一行各放几张**由画板自己记（缺省每行 5 个）。
     和卡片数对不上时由 normalizeRows 补齐 / 裁剪，所以上板、移出画布都不用额外维护 */
  const ruleRows = useMemo(
    () => normalizeRows(ordered.length, board?.ruleRows),
    [ordered.length, board?.ruleRows]
  );

  /* 规则排版的阵列落点：**只排图文卡片**（便签是自由元素，不进阵列）。
     行高优先用实测值（未测到再估算），所以 tickN 变了要重算 */
  const gridCells = useMemo(() => {
    if (free) return [];
    const queue = ordered.map((i) => ({
      cell: { id: i.id, idea: i, w: RULE_COL_W },
      h: measured(i.id, RULE_COL_W, RULE_COL_W * CARD_EST_H).h,
    }));
    return ruleFlow(queue, ruleRows);
  }, [free, ordered, ruleRows, measured, tickN]);

  const gridMap = useMemo(
    () =>
      new Map(gridCells.map((c) => [c.id, { x: c.x, y: c.y, w: c.w, r: c.r, c: c.c }])),
    [gridCells]
  );

  /* 阵列的行高：规则排版下卡片等宽等高，取第一张的实测高度即可
     （拖拽时换算「指针落在第几行」要用到） */
  const gridRowH = useMemo(() => {
    const first = ordered[0];
    if (!first) return RULE_COL_W * CARD_EST_H;
    return measured(first.id, RULE_COL_W, RULE_COL_W * CARD_EST_H).h;
  }, [ordered, measured, tickN]);

  /* 拖拽落点那一格上压着谁（会被高亮）—— 被拖的那张自己不算 */
  const reorderOverId = useMemo(() => {
    const cell = reorder?.cell;
    if (!cell || !reorder) return null;
    const hit = gridCells.find((g) => g.r === cell.r && g.c === cell.c);
    return hit && hit.id !== reorder.id ? hit.id : null;
  }, [reorder, gridCells]);

  /* 卡片「当前实际在哪」：自由排版读存储坐标，规则排版读网格坐标。
     便签两种排版下都读存储坐标（自由元素，不进阵列），所以传进来没有网格条目。 */
  const placeOf = useCallback(
    (id: string, stored: CanvasPos) =>
      free ? stored : gridMap.get(id) ?? stored,
    [free, gridMap]
  );

  /* 便签「当前实际在哪」：两种排版各存一组坐标（G 组缺省时回落到自由排版那组）。
     这样在规则排版里挪便签，不会把自由排版的摆位带跑，反之亦然 */
  const noteAt = useCallback(
    (n: TextNote): CanvasPos =>
      free
        ? { x: n.x, y: n.y, w: n.w }
        : { x: n.gx ?? n.x, y: n.gy ?? n.y, w: n.gw ?? n.w },
    [free]
  );

  /* 便签落点回写：只写当前排版对应的那一组字段 */
  const placeNote = useCallback(
    (id: string, p: CanvasPos) =>
      updateTextNote(
        id,
        free ? { x: p.x, y: p.y, w: p.w } : { gx: p.x, gy: p.y, gw: p.w }
      ),
    [free, updateTextNote]
  );

  /** 当前排版模式（决定便签新建时把坐标写进哪一组） */
  const mode: LayoutMode = free ? "free" : "grid";

  /* 画布内容的世界包围盒（小概览图与「适应画布」共用同一份数据） */
  const layoutBoxes: Box[] = useMemo(
    () => [
      ...onBoard.map((i) => {
        const at = placeOf(i.id, { x: i.x ?? 0, y: i.y ?? 0, w: i.w ?? BASE_W });
        const m = measured(i.id, at.w, at.w * CARD_EST_H);
        return { x: at.x, y: at.y, w: m.w, h: m.h, color: i.color };
      }),
      ...notes.map((n) => {
        // 便签永远是自由元素：按当前排版取对应那一组坐标
        const at = noteAt(n);
        const m = measured(n.id, at.w, 90);
        return {
          x: at.x,
          y: at.y,
          w: m.w,
          h: m.h,
          color: n.color ?? NOTE_DEFAULT_COLOR,
        };
      }),
    ],
    [onBoard, notes, placeOf, noteAt, measured, tickN]
  );

  const fitAll = useCallback(
    (maxK = 1) => {
      const { w: vw, h: vh } = sizeRef.current;
      if (!vw || !vh) return;
      const list = layoutBoxes;
      if (!list.length) {
        setCam({ x: vw / 2, y: vh / 2, k: 1 });
        return;
      }
      // 规则排版四周留白收紧，好让横向多铺几列
      const pad = free ? PAD : RULE_PAD;
      const x0 = Math.min(...list.map((b) => b.x)) - pad;
      const y0 = Math.min(...list.map((b) => b.y)) - pad;
      const x1 = Math.max(...list.map((b) => b.x + b.w)) + pad;
      const y1 = Math.max(...list.map((b) => b.y + b.h)) + pad;
      const bw = Math.max(x1 - x0, 1);
      const bh = Math.max(y1 - y0, 1);
      const k = clamp(Math.min(vw / bw, vh / bh), MIN_K, Math.min(MAX_K, maxK));
      setCam({
        k,
        x: vw / 2 - ((x0 + x1) / 2) * k,
        y: vh / 2 - ((y0 + y1) / 2) * k,
      });
    },
    [layoutBoxes, free]
  );

  // fitAll 每次渲染都会换个新函数，定时器里必须拿最新的那个，否则会用到旧画板的 onBoard
  const fitRef = useRef(fitAll);
  useEffect(() => {
    fitRef.current = fitAll;
  }, [fitAll]);

  // 切换排版模式：两套坐标系完全不同（存储坐标 ↔ 网格坐标），切完自动适应一次
  useEffect(() => {
    setReorder(null);
    const t = window.setTimeout(() => fitRef.current(1), 120);
    return () => window.clearTimeout(t);
  }, [free]);

  // 换画板：先把「已精选但还没有落点」的卡片安排下去，再等首帧测量完成后适应视野
  useEffect(() => {
    setCam({ x: 0, y: 0, k: 1 });
    setEditingId(null);
    setMenu(null);
    setReorder(null);
    setManageOpen(false);
    setNewOpen(false);
    if (board) ensureBoardPlacements(board.id);
    const t = window.setTimeout(() => fitRef.current(1), 160);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board?.id]);

  /* 兜底：结束编辑后仍为空的便签一律清掉（新建后没输入就点走的情况） */
  useEffect(() => {
    if (!board) return;
    canvasNotes
      .filter(
        (n) => n.boardId === board.id && !n.text.trim() && n.id !== editingId
      )
      .forEach((n) => removeTextNote(n.id));
  }, [canvasNotes, editingId, board, removeTextNote]);

  /* 滚轮缩放：以光标为锚点，光标下的那一点始终不动（两种排版通用） */
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setCam((c) => {
        const k2 = clamp(c.k * Math.exp(-e.deltaY * 0.0016), MIN_K, MAX_K);
        if (k2 === c.k) return c;
        const wx = (mx - c.x) / c.k;
        const wy = (my - c.y) / c.k;
        return { k: k2, x: mx - wx * k2, y: my - wy * k2 };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  /* 右键菜单 / Esc 关闭 */
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  /* 缩放按钮：以视口中心为锚点 */
  const zoomBy = (f: number) =>
    setCam((c) => {
      const k2 = clamp(c.k * f, MIN_K, MAX_K);
      if (k2 === c.k) return c;
      const cx = sizeRef.current.w / 2;
      const cy = sizeRef.current.h / 2;
      const wx = (cx - c.x) / c.k;
      const wy = (cy - c.y) / c.k;
      return { k: k2, x: cx - wx * k2, y: cy - wy * k2 };
    });

  /* 视口指针：拖拽 = 平移画布（卡片 / 便签自己接管拖动：自由排版是挪位，规则排版是调序） */
  const onViewportDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    const t = e.target as HTMLElement;
    if (t.closest("[data-hud]") || t.closest("a")) return;
    if (t.closest("[data-canvas-item]")) return;
    setMenu(null);
    panRef.current = { sx: e.clientX, sy: e.clientY, ox: cam.x, oy: cam.y };
    setPanning(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onViewportMove = (e: React.PointerEvent) => {
    const p = panRef.current;
    if (!p) return;
    setCam((c) => ({
      ...c,
      x: p.ox + (e.clientX - p.sx),
      y: p.oy + (e.clientY - p.sy),
    }));
  };
  const onViewportUp = () => {
    panRef.current = null;
    setPanning(false);
  };

  const toWorld = (clientX: number, clientY: number) => {
    const r = viewportRef.current!.getBoundingClientRect();
    return {
      x: (clientX - r.left - cam.x) / cam.k,
      y: (clientY - r.top - cam.y) / cam.k,
    };
  };

  /* 双击空白：新建文本便签并立即进入编辑（两种排版通用；便签是自由元素，落在点击处） */
  const onViewportDoubleClick = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest("[data-canvas-item]") || t.closest("[data-hud]")) return;
    const p = toWorld(e.clientX, e.clientY);
    const nid = addTextNote(
      board.id,
      { x: p.x - NOTE_W / 2, y: p.y - 18, w: NOTE_W },
      mode
    );
    setEditingId(nid);
  };

  /* 新建文本便签：落在视野「偏上」处并立即进入编辑（右上角「文本」按钮走这条）
     放上部是为了避开中间那片图文卡片 —— 落在正中会跟卡片糊在一起、看不出来。
     便签不受阵列影响，所以落点直接按当前相机换算，不用重新适应 */
  const addNoteAtTop = () => {
    const c = sizeRef.current;
    const nid = addTextNote(
      board.id,
      {
        x: (c.w / 2 - cam.x) / cam.k - NOTE_W / 2,
        y: (c.h * NEW_ITEM_TOP_RATIO - cam.y) / cam.k,
        w: NOTE_W,
      },
      mode
    );
    setEditingId(nid);
  };

  /* 回到 100%（以视口中心为锚点） */
  const resetZoom = () =>
    setCam((c) => {
      const cx = sizeRef.current.w / 2;
      const cy = sizeRef.current.h / 2;
      const wx = (cx - c.x) / c.k;
      const wy = (cy - c.y) / c.k;
      return { k: 1, x: cx - wx, y: cy - wy };
    });

  const commitNote = (nid: string, text: string) => {
    if (!text.trim()) removeTextNote(nid);
    else updateTextNote(nid, { text });
    setEditingId((cur) => (cur === nid ? null : cur));
  };

  /* 移出画布 = 取消精选（卡片回到右侧灵感库，位置留着，重新精选会回原位） */
  const takeOff = (id: string) => {
    removeFromBoard(id);
    message.success("已移出画布 · 可在右侧灵感库找回");
  };

  /* 把某个格子挪进视野（阵列往右 / 往下长出一格时，那一格可能在画面外） */
  const revealCell = (r: number, c: number) => {
    const vp = sizeRef.current;
    if (!vp.w || !vp.h) return;
    const GAPX = RULE_COL_W + COL_GAP;
    const GAPY = gridRowH + ROW_GAP;
    const M = 24;
    const sx = c * GAPX * cam.k + cam.x;
    const sy = r * GAPY * cam.k + cam.y;
    const sw = RULE_COL_W * cam.k;
    const sh = gridRowH * cam.k;
    let dx = 0;
    let dy = 0;
    if (sx < M) dx = M - sx;
    else if (sx + sw > vp.w - M) dx = vp.w - M - (sx + sw);
    if (sy < M) dy = M - sy;
    else if (sy + sh > vp.h - M) dy = vp.h - M - (sy + sh);
    if (!dx && !dy) return;
    setGliding(true);
    window.clearTimeout(glideRef.current);
    glideRef.current = window.setTimeout(() => setGliding(false), 320);
    setCam((cur) => ({ ...cur, x: cur.x + dx, y: cur.y + dy }));
  };

  /* 规则排版下拖卡片：按卡片**投影的位置**算出它落在第几行第几格，松手就放到那一格。
     阵列没有固定列数 —— 落到某行右边的空格上，这一行就多一个（从下一行借），
     所以「每一行各放几张」可以自由调；位置依旧由网格算，松手后卡片自己归位。 */
  const handleCardReorder = (
    id: string,
    _clientX: number,
    _clientY: number,
    phase: "move" | "drop",
    box?: { x: number; y: number; w: number }
  ) => {
    if (!box) return;
    const GAPX = RULE_COL_W + COL_GAP;
    const GAPY = gridRowH + ROW_GAP;
    // 卡片左上角落在哪个格：列取最近的列心，行取卡片纵向中心所在的那一条带
    const c = clamp(Math.round(box.x / GAPX), 0, RULE_ROW_MAX - 1);
    const r = clamp(
      Math.floor((box.y + gridRowH / 2) / GAPY),
      0,
      ruleRows.length
    );

    if (phase === "move") {
      setReorder((prev) =>
        prev && prev.id === id && prev.cell?.r === r && prev.cell?.c === c
          ? prev
          : { id, cell: { r, c } }
      );
      return;
    }

    setReorder(null);
    const cur = gridMap.get(id);
    if (cur && cur.r === r && cur.c === c) return; // 落回原来那一格，不必改

    placeCardInRow(board.id, id, r, c);
    message.success("已调整阵列顺序");

    /* 落点可能把阵列撑大（这一行多了一个 / 多出一行）：
       · 撑到当前缩放下装不下 → 重新适应一次，让整个阵列完整可见
       · 还装得下 → 只把落点那一格平移进视野（不做缩放，避免画面无故跳动） */
    const cols = Math.max(0, ...ruleRows, c + 1);
    const rowsN = Math.max(ruleRows.length, r + 1);
    const vp = sizeRef.current;
    const fits =
      cols * (RULE_COL_W + COL_GAP) - COL_GAP <= (vp.w - 48) / cam.k &&
      rowsN * (gridRowH + ROW_GAP) - ROW_GAP <= (vp.h - 48) / cam.k;
    window.setTimeout(() => (fits ? revealCell(r, c) : fitRef.current(1)), fits ? 0 : 160);
  };

  /* 灵感库面板里删除一条灵感：直接从库里删掉（画布上若有它的卡片也会一并消失） */
  const removeFromPanel = (idea: Idea) => {
    deleteIdea(idea.id);
    message.success(`已删除「${idea.title}」`);
  };

  /* 从灵感库上板：落点在视口「上方居中」的空位。
     原先落在视口正中再往下推 100px，新卡会贴着下缘、很难被看到。
     空位候选不是固定网格，而是「每张已有卡片的右侧 / 下方」—— 贴着已有内容排才塞得进去；
     若最终落点仍不在舒适可视区（比如顶部一排已被占满、只能往下挤），就把画布平移过去。 */
  const addFromPanel = (idea: Idea) => {
    const c = sizeRef.current;
    const w = idea.w ?? BASE_W;
    const h = measured(idea.id, w, w * CARD_EST_H).h;
    const anchorX = (c.w / 2 - cam.x) / cam.k - w / 2;
    const anchorY = (c.h * NEW_ITEM_TOP_RATIO - cam.y) / cam.k;
    const GAP = 24;
    const taken = [
      ...onBoard.map((i) => ({
        x: i.x ?? 0,
        y: i.y ?? 0,
        w: i.w ?? BASE_W,
        h: measured(i.id, i.w ?? BASE_W, (i.w ?? BASE_W) * CARD_EST_H).h,
      })),
      ...notes.map((n) => ({ x: n.x, y: n.y, w: n.w, h: measured(n.id, n.w, 90).h })),
    ];
    const isFree = (x: number, y: number) =>
      !taken.some(
        (t) => !(x + w <= t.x || t.x + t.w <= x || y + h <= t.y || t.y + t.h <= y)
      );

    const seen = new Set<string>();
    const cands: { x: number; y: number }[] = [];
    const push = (x: number, y: number) => {
      const key = `${Math.round(x)},${Math.round(y)}`;
      if (seen.has(key)) return;
      seen.add(key);
      cands.push({ x, y });
    };
    push(anchorX, anchorY);
    for (const t of taken) {
      push(t.x + t.w + GAP, t.y); // 右边
      push(t.x, t.y + t.h + GAP); // 下边
    }
    const dist = (p: { x: number; y: number }) =>
      Math.abs(p.y - anchorY) * 2 + Math.abs(p.x - anchorX);
    const spot =
      cands
        .filter((p) => isFree(p.x, p.y))
        .sort((a, b) => dist(a) - dist(b))[0] ?? { x: anchorX, y: anchorY };

    placeOnBoard(idea.id, board.id, spot.x, spot.y);
    message.success(`已陈列到「${board.name}」`);

    if (!free) {
      // 规则排版下坐标由网格算，重新适应一次把新卡带进视野
      window.setTimeout(() => fitRef.current(1), 120);
      return;
    }

    // 落点不在舒适区（尤其被挤到下侧）→ 平移画布，让新卡出现在视野上方居中
    const sw = w * cam.k;
    const sy = spot.y * cam.k + cam.y;
    const sx = spot.x * cam.k + cam.x;
    const needY = sy < 8 || sy > c.h * 0.3;
    const needX = sx < 8 || sx + sw > c.w - 8;
    if (!needY && !needX) return;
    setGliding(true);
    window.clearTimeout(glideRef.current);
    glideRef.current = window.setTimeout(() => setGliding(false), 320);
    setCam((cur) => {
      let nx = cur.x;
      let ny = cur.y;
      const cy2 = spot.y * cur.k + cur.y;
      if (cy2 < 8 || cy2 > c.h * 0.3)
        ny = cur.y + (c.h * NEW_ITEM_TOP_RATIO - cy2);
      const cx2 = spot.x * cur.k + cur.x;
      const cw2 = w * cur.k;
      if (cx2 < 8) nx = cur.x + (8 - cx2);
      else if (cx2 + cw2 > c.w - 8) nx = cur.x + (c.w - 8 - (cx2 + cw2));
      if (nx === cur.x && ny === cur.y) return cur;
      return { x: nx, y: ny, k: cur.k };
    });
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const pid = e.dataTransfer.getData("text/idea-id");
    if (!pid || !viewportRef.current) return;
    const p = toWorld(e.clientX, e.clientY);
    placeOnBoard(pid, board.id, p.x - BASE_W / 2, p.y - 60);
  };

  const createBoard = () => {
    if (!newName.trim()) return;
    addBoard(newName.trim());
    message.success("已新建画板");
    setNewOpen(false);
    setNewName("");
  };

  if (!board) {
    return (
      <PageShell workspace>
        <Container className="min-h-0 flex-1 overflow-y-auto">
          <div className="py-12 text-center text-t4 text-warmgray">
            该画板不存在或已被清空
          </div>
        </Container>
      </PageShell>
    );
  }

  /* 灵感库面板 = 本品类里「还没精选上板」的候选 */
  const pool = ideas.filter(
    (i) => board.categories.includes(i.category) && !i.featured
  );
  /* 板块顺序跟「分类导航」的全局顺序走：在博物架 / 灵感库拖着改了顺序，这里的板块跟着换位 */
  const poolByCat = categories
    .filter((c) => board.categories.includes(c))
    .map((c) => ({ cat: c, items: pool.filter((i) => i.category === c) }))
    .filter((g) => g.items.length > 0);

  const viewBox = {
    x: -cam.x / cam.k,
    y: -cam.y / cam.k,
    w: size.w / cam.k,
    h: size.h / cam.k,
  };

  const menuIsNote = menu ? notes.some((n) => n.id === menu.id) : false;

  return (
    <PageShell workspace>
      <Container className="flex min-h-0 flex-1 flex-col">
        {/* 画板栏：按住画板胶囊拖动可调整顺序（顺序持久保存） */}
        <FilterBar className="board-selector scroll-thin max-h-20 overflow-y-auto">
          <FilterRow label="画板" right={
            <Segmented
              size="sm"
              value={free ? "free" : "grid"}
              onChange={(v) => {
                setFree(v === "free");
                setEditingId(null);
                setMenu(null);
              }}
              options={[
                { value: "free", label: "自由排版" },
                { value: "grid", label: "规则排版" },
              ]}
            />
          }>
            <Segmented
              size="sm"
              value={board.id}
              onChange={(v) => nav(`/board/${v}`)}
              options={boards.map((b) => ({ value: b.id, label: b.name }))}
              addItem={{ label: "新建画板", onClick: () => setNewOpen(true) }}
              extra={
                <button
                  onClick={() => setManageOpen(true)}
                  className="rounded-pill border border-border bg-white px-3 py-1 text-t4 font-semibold text-brown hover:bg-mint-soft/50"
                >
                  管理品类
                </button>
              }
              onReorder={moveBoard}
            />
          </FilterRow>
        </FilterBar>

        <div className="page-content board-workspace grid min-h-0 flex-1 grid-rows-[minmax(0,3fr)_minmax(0,2fr)] gap-6 pb-4 md:grid-cols-[minmax(0,1fr)_220px] md:grid-rows-[minmax(0,1fr)]">
          {/* ============ 画布 ============ */}
          <div
            ref={viewportRef}
            onPointerDown={onViewportDown}
            onPointerMove={onViewportMove}
            onPointerUp={onViewportUp}
            onPointerCancel={onViewportUp}
            onLostPointerCapture={onViewportUp}
            onDoubleClick={onViewportDoubleClick}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            onContextMenu={(e) => {
              // 画布上不弹系统菜单；层级菜单由卡片/便签自己触发（仅自由排版）
              e.preventDefault();
            }}
            className="dot-grid relative min-h-0 min-w-0 touch-none overflow-hidden rounded-card border border-border"
            style={{
              backgroundPosition: `${cam.x}px ${cam.y}px`,
              backgroundSize: `${22 * cam.k}px ${22 * cam.k}px`,
              cursor: panning ? "grabbing" : "default",
            }}
          >
            <>
                {/* 世界层：整体平移 + 缩放。自由排版 / 规则排版共用同一套相机，只是落点来源不同 */}
                <div
                  className="absolute left-0 top-0 origin-top-left"
                  style={{
                    transform: `translate3d(${cam.x}px, ${cam.y}px, 0) scale(${cam.k})`,
                    transition: gliding
                      ? "transform 280ms cubic-bezier(.22,.8,.24,1)"
                      : "none",
                  }}
                >
                  {/* 按阵列顺序渲染（规则排版下 DOM 顺序 = 网格顺序；自由排版下层序由 z 控制，与顺序无关） */}
                  {ordered.map((i) => (
                    <CanvasIdeaCard
                      key={i.id}
                      idea={i}
                      at={placeOf(i.id, {
                        x: i.x ?? 0,
                        y: i.y ?? 0,
                        w: i.w ?? BASE_W,
                      })}
                      k={cam.k}
                      locked={!free}
                      onReorder={free ? undefined : handleCardReorder}
                      reorderActive={reorder?.id === i.id}
                      reorderOver={reorderOverId === i.id}
                      onRemove={takeOff}
                      onMenu={(id, e) => {
                        const r = viewportRef.current!.getBoundingClientRect();
                        setMenu({
                          id,
                          x: clamp(e.clientX - r.left, 0, Math.max(size.w - 156, 0)),
                          y: clamp(e.clientY - r.top, 0, Math.max(size.h - 190, 0)),
                        });
                      }}
                      reportSize={reportSize}
                    />
                  ))}
                  {notes.map((n) => (
                    /* 便签是自由元素：两种排版下都能拖 / 拖宽 / 调色，不受阵列影响 */
                    <CanvasTextNote
                      key={n.id}
                      note={n}
                      at={noteAt(n)}
                      k={cam.k}
                      editing={editingId === n.id}
                      onEdit={setEditingId}
                      onCommit={commitNote}
                      onPlace={placeNote}
                      onMenu={(id, e) => {
                        const r = viewportRef.current!.getBoundingClientRect();
                        setMenu({
                          id,
                          x: clamp(e.clientX - r.left, 0, Math.max(size.w - 156, 0)),
                          y: clamp(e.clientY - r.top, 0, Math.max(size.h - 190, 0)),
                        });
                      }}
                      reportSize={reportSize}
                    />
                  ))}

                  {/* 规则排版拖拽中：预览「松手后卡片会落在哪一格」（虚线格）。
                      落到某行右边的空格上，这一行就多一个 —— 每行的张数由此自由调整 */}
                  {reorder?.cell && (
                    <div
                      data-ghost-cell
                      className="pointer-events-none absolute rounded-[16px] border-2 border-dashed border-mint/70 bg-mint-soft/50"
                      style={{
                        left: reorder.cell.c * (RULE_COL_W + COL_GAP),
                        top: reorder.cell.r * (gridRowH + ROW_GAP),
                        width: RULE_COL_W,
                        height: gridRowH,
                      }}
                    />
                  )}
                </div>

                {/* 空态 */}
                {onBoard.length === 0 && notes.length === 0 && (
                  <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2.5 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-mint-soft">
                      <Plus size={22} />
                    </div>
                    <div className="text-t3 font-semibold text-brown">
                      还没有精选的灵感，画布任意方向都能延伸
                    </div>
                    <div className="text-t5 text-warmgray">
                      点右侧灵感库的卡片即可上板 · 右上角「文本」加便签
                    </div>
                  </div>
                )}

                {/* 左上角 HUD：只放「导航」两件事 —— 缩放条 + 小概览图 */}
                <div
                  data-hud
                  className="absolute left-4 top-4 z-40 w-[132px] overflow-hidden rounded-xl border border-border bg-white/92 shadow-sm backdrop-blur"
                >
                  {/* 缩放（面板跟着小概览图一起收窄，所以按钮同步缩一号） */}
                  <div className="flex items-center px-1 py-1">
                    <button
                      onClick={() => zoomBy(1 / 1.25)}
                      aria-label="缩小"
                      className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-t3 leading-none text-brown hover:bg-mint-soft"
                    >
                      −
                    </button>
                    <button
                      onClick={resetZoom}
                      title="回到 100%"
                      className="min-w-0 flex-1 text-center text-t6 tabular-nums text-brown hover:text-mint"
                    >
                      {Math.round(cam.k * 100)}%
                    </button>
                    <button
                      onClick={() => zoomBy(1.25)}
                      aria-label="放大"
                      className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-t3 leading-none text-brown hover:bg-mint-soft"
                    >
                      ＋
                    </button>
                    <span className="mx-0.5 h-3 w-px shrink-0 bg-border" />
                    <button
                      onClick={() => fitAll(1)}
                      title="让所有卡片完整显示"
                      className="shrink-0 rounded-full px-1 py-1 text-t6 font-medium text-brown hover:bg-mint-soft"
                    >
                      适应
                    </button>
                  </div>

                  <Minimap
                    boxes={layoutBoxes}
                    view={viewBox}
                    onNavigate={(wx, wy) =>
                      setCam((c) => ({
                        ...c,
                        x: sizeRef.current.w / 2 - wx * c.k,
                        y: sizeRef.current.h / 2 - wy * c.k,
                      }))
                    }
                    onFit={() => fitAll(1)}
                  />
                </div>

                {/* 右上角：创建类工具（导航在左上、创建在右上，不压中间那片卡片）。
                    尺寸取中间档 —— 之前 42px 的版本在画布上偏大，抢了内容的重心 */}
                <div data-hud className="absolute right-4 top-4 z-40">
                  <button
                    onClick={addNoteAtTop}
                    title="新建文本便签（也可以双击画布空白处）"
                    className="flex items-center rounded-pill border border-border bg-white/95 px-3.5 py-2 text-t4 font-semibold leading-tight text-brown shadow-sm backdrop-blur transition-colors hover:bg-mint-soft hover:text-mint"
                  >
                    <Plus size={14} />
                    文本
                  </button>
                </div>

                {/* 右键层级菜单 */}
                {menu && (
                  <div
                    data-hud
                    onPointerDown={(e) => e.stopPropagation()}
                    onContextMenu={(e) => e.preventDefault()}
                    className="absolute z-50 w-[152px] overflow-hidden rounded-xl border border-border bg-white py-1 shadow-lg"
                    style={{ left: menu.x, top: menu.y }}
                  >
                    {(
                      [
                        ["front", "置于顶层"],
                        ["forward", "置于上层"],
                        ["backward", "置于下层"],
                        ["back", "置于底层"],
                      ] as const
                    ).map(([act, label]) => (
                      <button
                        key={act}
                        onClick={() => {
                          reorderLayer(menu.id, board.id, act);
                          setMenu(null);
                        }}
                        className="block w-full px-3 py-1.5 text-left text-t4 text-brown hover:bg-mint-soft/70"
                      >
                        {label}
                      </button>
                    ))}
                    <div className="my-1 h-px bg-border" />
                    <button
                      onClick={() => {
                        if (menuIsNote) removeTextNote(menu.id);
                        else takeOff(menu.id);
                        setMenu(null);
                      }}
                      className="block w-full px-3 py-1.5 text-left text-t4 text-red hover:bg-red/5"
                    >
                      {menuIsNote ? "删除便签" : "移出画布"}
                    </button>
                  </div>
                )}
            </>
          </div>

          {/* ============ 灵感库面板 ============ */}
          <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-border">
            <div className="flex shrink-0 flex-col gap-1 p-5">
              <div className="text-t2 font-semibold text-brown">灵感库</div>
              <div className="text-t5 text-warmgray">
                本品类还没精选的灵感 · 点一下即陈列
              </div>
            </div>
            <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pb-5">
              {poolByCat.length === 0 && (
                <div className="py-8 text-center text-t4 text-warmgray">
                  该画板品类的灵感都已陈列在画布上啦 🎉
                </div>
              )}
              {poolByCat.map((g) => {
                const scrolls = g.items.length > PANEL_MAX;
                return (
                  <div
                    key={g.cat}
                    data-panel-group
                    data-panel-cat={g.cat}
                    className="flex max-w-[280px] shrink-0 flex-col gap-2"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      {/* 品类分组标题与博物架「最近想法」里的分类名同层（t3） */}
                      <div className="text-t3 font-semibold text-brown">
                        {g.cat}
                      </div>
                      {/* 计数与首页分组计数同层（t5） */}
                      <div className="text-t5 tabular-nums text-warmgray">
                        {g.items.length} 件
                      </div>
                    </div>
                    {/* 每板块最多陈列 2×3 = 6 个；超出的在本板块内滚动
                        （滚动链是默认行为，滚到底会自然带动外层面板） */}
                    <div className="relative">
                      <div
                        data-panel-scroll
                        className={`scroll-thin overflow-y-auto ${
                          scrolls ? PANEL_SCROLL_H : ""
                        }`}
                      >
                        <div data-panel-grid className={PANEL_GRID}>
                          {g.items.map((i) => (
                            <PanelThumb
                              key={i.id}
                              idea={i}
                              onAdd={() => addFromPanel(i)}
                              onRemove={() => removeFromPanel(i)}
                            />
                          ))}
                        </div>
                      </div>
                      {scrolls && (
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-7 bg-gradient-to-t from-bg via-bg/70 to-transparent" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </aside>
        </div>
      </Container>

      <ManageCategoryModal
        boardId={board.id}
        open={manageOpen}
        onClose={() => setManageOpen(false)}
      />
      <Modal
        title="新建画板"
        open={newOpen}
        onOk={createBoard}
        onCancel={() => setNewOpen(false)}
        okText="创建"
        cancelText="取消"
        centered
      >
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="画板名称，如：周末出行"
          maxLength={12}
        />
      </Modal>
    </PageShell>
  );
}

/* 右侧灵感库面板中的 1:1 缩略图：只出图，不带标题 / 平台名等信息
   （点一下陈列到画布，也可以拖到画布上指定位置；标题走原生 title 提示）
   悬浮于该缩略图时，右上角浮出「×」，点击后先弹确认再删除这条图文卡片 */
function PanelThumb({
  idea,
  onAdd,
  onRemove,
}: {
  idea: Idea;
  onAdd: () => void;
  onRemove: () => void;
}) {
  /* 确认气泡打开时鼠标已经离开卡片（挪到气泡上了），
     这时 group-hover 失效、× 会淡出，所以用状态把它按住 */
  const [confirming, setConfirming] = useState(false);
  return (
    <div
      data-panel-thumb
      data-idea-id={idea.id}
      className="group relative aspect-square w-full overflow-hidden rounded-lg border border-border transition-colors hover:border-mint"
      style={{ background: idea.color }}
    >
      {/* 点击 / 拖拽都落在这层：点一下 = 陈列到画布，拖出去 = 落到画布指定位置 */}
      <button
        type="button"
        draggable
        data-panel-add
        title={`${idea.title} · 点一下陈列到画布`}
        onDragStart={(e) => e.dataTransfer.setData("text/idea-id", idea.id)}
        onClick={onAdd}
        className="block h-full w-full cursor-grab focus-visible:outline-none active:cursor-grabbing"
      >
        {idea.image ? (
          <SmartImage
            src={idea.image}
            refUrl={idea.link}
            alt={idea.title}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.05]"
            fallback={<CoverPlaceholder platform={idea.platform} compact />}
          />
        ) : (
          <CoverPlaceholder platform={idea.platform} compact />
        )}
      </button>

      {/* 删除：与画布卡片右上角的 × 同一套视觉，仅悬浮该卡片时显现 */}
      <Popconfirm
        title="删除这条灵感？"
        description="会从灵感库中移除，不可恢复"
        okText="删除"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        open={confirming}
        onOpenChange={(o) => setConfirming(o)}
        onConfirm={() => onRemove()}
      >
        <button
          type="button"
          data-panel-remove
          aria-label="删除这条灵感"
          title="删除这条灵感"
          className={[
            "absolute right-1 top-1 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-white/92 shadow transition",
            confirming ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            "focus-visible:opacity-100",
          ].join(" ")}
        >
          <CloseX size={10} />
        </button>
      </Popconfirm>
    </div>
  );
}
