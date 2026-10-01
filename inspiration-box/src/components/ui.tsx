import type * as React from "react";
import { useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Popconfirm, App, Dropdown } from "antd";
import { useStore } from "../store/useStore";
import type { Idea } from "../types";
import { STATUS_TAGS, DEFAULT_STATUS_TAG } from "../types";
import { HeartFilled, HeartOutline, CloseX, Plus, ChevronDown, Pencil } from "../icons";
import TopBar from "./TopBar";
import { SmartImage, CoverPlaceholder } from "./SmartImage";

// 三页共用：卡片封面统一走「代理 → 直连 → 占位」三级兜底
export { SmartImage, CoverPlaceholder, coverCandidates } from "./SmartImage";

/* ============================================================
   统一设计系统 · 三页共用基础组件
   规范：容器 max-w-[1240px] / 内边距 32px / 8pt 间距节奏 /
        卡片圆角 16px / 图片比例 4:3 / 页面背景统一 bg-bg
   ============================================================ */

/* ---------- 容器：统一最大宽度与水平内边距 ---------- */
export function Container({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`mx-auto w-full max-w-[1240px] px-8 ${className}`}>
      {children}
    </div>
  );
}

/* ---------- 页面外壳：统一背景 + 统一顶栏 ---------- */
export function PageShell({
  children,
  showTopBar = true,
}: {
  children: React.ReactNode;
  showTopBar?: boolean;
}) {
  return (
    <div className="min-h-screen bg-bg">
      {showTopBar && <TopBar />}
      {children}
    </div>
  );
}

/* ---------- 页头：三页统一结构（标题 + 副标 + 右侧操作） ---------- */
export function PageHeader({
  title,
  sub,
  right,
  className = "",
}: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex items-end justify-between gap-4 border-b border-border pb-5 pt-8 ${className}`}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="truncate text-t1 font-semibold leading-tight text-brown">
          {title}
        </h1>
        {sub && <div className="truncate text-t5 text-warmgray">{sub}</div>}
      </div>
      {right && <div className="flex shrink-0 items-center gap-3">{right}</div>}
    </div>
  );
}

/* ---------- 区块标题：页内次级区块 ---------- */
export function SectionHead({
  title,
  sub,
  right,
}: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 className="text-t2 font-semibold text-brown">{title}</h2>
        {sub && <div className="text-t5 text-warmgray">{sub}</div>}
      </div>
      {right}
    </div>
  );
}

/* ---------- 分段控件：分类 / 来源 / 排序统一视觉 ---------- */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  addItem,
  extra,
  onReorder,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
  /** 末尾追加的「+ 新建」虚线胶囊（如 +新建分类） */
  addItem?: { label: string; onClick: () => void };
  /** 「+ 新建」之后追加的自定义元素（如「管理品类」按钮） */
  extra?: React.ReactNode;
  /**
   * 传入后胶囊可**按住拖动**调整顺序，落点回传下标 from / to。
   * 拖动中经过哪一枚就实时换位，松手即定；只按不拖仍然是普通点击。
   */
  onReorder?: (from: number, to: number) => void;
}) {
  /* 拖动状态：ref 记「起点 / 是否已构成拖动」，state 只驱动高亮 */
  const drag = useRef<{ from: number; moved: boolean; x: number; y: number } | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  /* 拖动结束时浏览器还会补一个 click，用它把这次 click 吃掉，避免误触发切换 */
  const swallowClick = useRef(false);

  const onChipDown = (i: number, e: React.PointerEvent<HTMLButtonElement>) => {
    if (!onReorder || e.button !== 0) return;
    swallowClick.current = false;
    drag.current = { from: i, moved: false, x: e.clientX, y: e.clientY };
  };

  const onRowMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || !onReorder) return;
    // 先走一小段才算拖动，避免把「点一下」误判成拖
    if (!d.moved) {
      if (Math.abs(e.clientX - d.x) < 6 && Math.abs(e.clientY - d.y) < 6) return;
      d.moved = true;
      setDragIdx(d.from);
      // 捕获指针：拖出胶囊范围也不丢事件；个别环境不支持时忽略即可（容器本身仍在收事件）
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
    }
    const hit = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest(
      "[data-pill-idx]"
    ) as HTMLElement | null;
    if (!hit) return;
    const to = Number(hit.dataset.pillIdx);
    if (!Number.isFinite(to) || to === d.from) return;
    onReorder(d.from, to);
    d.from = to; // 跟着换位后的新下标走，指针下的那枚不会再跟别人对调
    setDragIdx(to);
  };

  const onRowUp = () => {
    if (drag.current?.moved) swallowClick.current = true;
    drag.current = null;
    setDragIdx(null);
  };

  const canDrag = !!onReorder;

  return (
    <div
      className="flex flex-wrap gap-2"
      onPointerMove={onRowMove}
      onPointerUp={onRowUp}
      onPointerCancel={onRowUp}
    >
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            data-pill-idx={canDrag ? i : undefined}
            data-pill-value={o.value}
            onPointerDown={(e) => onChipDown(i, e)}
            onClick={() => {
              if (swallowClick.current) {
                swallowClick.current = false;
                return;
              }
              onChange(o.value);
            }}
            title={canDrag ? "按住拖动可调整顺序" : undefined}
            style={canDrag ? { touchAction: "pan-y" } : undefined}
            className={[
              "rounded-pill transition-colors",
              /* sm 与 md 唯一的区别是「更紧凑的留白」——字号必须同为 t4。
                 早期 sm 用 t5(12px)，导致画板页里「自由排版/规则排版(12px)」
                 紧挨着「美貌/美家(13px)」，同排两种字号，视觉上很参差。 */
              size === "sm"
                ? "px-3 py-1 text-t4"
                : "px-3.5 py-1.5 text-t4",
              active
                ? "bg-mint font-semibold text-white"
                : "border border-border bg-white text-brown hover:bg-mint-soft/60",
              canDrag ? "cursor-grab select-none active:cursor-grabbing" : "",
              dragIdx === i ? "opacity-70 ring-2 ring-mint/40" : "",
            ].join(" ")}
          >
            {o.label}
          </button>
        );
      })}
      {addItem && (
        <button
          data-add-item={addItem.label}
          onClick={(e) => {
            e.stopPropagation();
            addItem.onClick();
          }}
          className={[
            "inline-flex items-center gap-1 rounded-pill border border-dashed border-mint/60 text-mint transition-colors hover:bg-mint-soft/60",
            size === "sm" ? "px-3 py-1 text-t4" : "px-3.5 py-1.5 text-t4",
          ].join(" ")}
        >
          <Plus size={size === "sm" ? 13 : 15} />
          {addItem.label}
        </button>
      )}
      {extra}
    </div>
  );
}

/* ---------- 来源：只留一个 ↗，鼠标悬停卡片时才出现，点击跳转原帖 ---------- */
function SourceLink({ idea }: { idea: Idea }) {
  if (!idea.link) return null;
  return (
    <span className="shrink-0 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100">
      <a
        href={idea.link}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        title={`打开原帖：${idea.link}`}
        aria-label={`打开原帖：${idea.link}`}
        className="block text-t4 font-medium leading-none text-mint transition-opacity hover:opacity-70"
      >
        ↗
      </a>
    </span>
  );
}

/* ---------- 统一图文卡片（三页共用） ---------- */
export function IdeaCard({
  idea,
  size = "md",
  meta = "none",
  showFavorite = false,
  favoriteReveal = "always",
  showDelete = false,
  showStatus = false,
  showEdit = false,
  alignDesc = false,
  width,
  onClick,
  onStatusChange,
  onFavoriteChange,
  onEdit,
}: {
  idea: Idea;
  size?: "sm" | "md";
  /** none=不显示 / slept=已沉睡N天 / date=添加于日期 */
  meta?: "none" | "slept" | "date";
  showFavorite?: boolean;
  /** always=常显（今天翻到）/ hover=悬停才显（最近想法） */
  favoriteReveal?: "always" | "hover";
  showDelete?: boolean;
  /** 常显状态 pill（未打标时默认「想要」） */
  showStatus?: boolean;
  /** 悬停显示「编辑」按钮（左上角），点开全局编辑弹窗改分类/标题等 */
  showEdit?: boolean;
  /**
   * 网格陈列专用：没有描述也预留出描述行的位置（固定一行高）。
   * 卡片描述有长有短，不预留的话「有描述 = 三排、没描述 = 两排」，
   * 同排卡片的底行就会参差不齐；留白后标题行与底行始终横向对齐。
   * 只预留一行：预留两行时，只有一行描述的卡片会多出一整行空白，
   * 描述与底行之间被撑得很空（2026-09-30 修正）。
   */
  alignDesc?: boolean;
  /** 固定宽度（横向滚动列表用）；不传则自适应填满网格 */
  width?: number;
  onClick?: () => void;
  /** 传入后，状态标签可点击切换（想要 / 已买 / 已试 / 已去） */
  onStatusChange?: (id: string, tag: string) => void;
  /** 精选心切换后的回调，回传新状态（用于「刚取消精选」的卡片保留展示） */
  onFavoriteChange?: (id: string, featured: boolean) => void;
  /** 点「编辑」按钮的回调，回传卡片 id（由父级打开全局编辑弹窗） */
  onEdit?: (id: string) => void;
}) {
  const toggleFeatured = useStore((s) => s.toggleFeatured);
  const deleteIdea = useStore((s) => s.deleteIdea);
  const { message } = App.useApp();
  // 图片预览弹窗（本地态，仅被点击的那张卡会打开）
  const [preview, setPreview] = useState(false);
  // 图片区：单击=预览（延迟 240ms 以让位于双击取消），双击=编辑。二者互斥。
  const previewTimer = useRef<number | null>(null);
  const clearPreviewTimer = () => {
    if (previewTimer.current !== null) {
      window.clearTimeout(previewTimer.current);
      previewTimer.current = null;
    }
  };

  const pad = size === "sm" ? "p-2.5" : "p-3";
  const titleCls = size === "sm" ? "text-t4" : "text-t3";
  const sleptDays = Math.floor((Date.now() - idea.createdAt) / 86400000);
  const dateStr = new Date(idea.createdAt).toLocaleDateString("zh-CN");
  const statusText = idea.statusTag ?? DEFAULT_STATUS_TAG;
  const showStatusPill = showStatus || !!idea.statusTag;

  // 卡片根：单击（延迟 240ms）跳转灵感库，双击编辑灵感。
  // 图片区已 stopPropagation，不会触发这里的跳转/编辑。
  const clickTimer = useRef<number | null>(null);
  const handleCardClick = (e: React.MouseEvent) => {
    if (clickTimer.current !== null) {
      window.clearTimeout(clickTimer.current);
      clickTimer.current = null;
    }
    clickTimer.current = window.setTimeout(() => {
      clickTimer.current = null;
      onClick?.();
    }, 240);
  };
  const handleCardDoubleClick = (e: React.MouseEvent) => {
    if (clickTimer.current !== null) {
      window.clearTimeout(clickTimer.current);
      clickTimer.current = null;
    }
    onEdit?.(idea.id);
  };

  // 卸载时清掉挂起的定时器，避免对已卸载组件调用回调
  useEffect(() => {
    return () => {
      if (clickTimer.current !== null) window.clearTimeout(clickTimer.current);
      if (previewTimer.current !== null) window.clearTimeout(previewTimer.current);
    };
  }, []);

  // 用 div + role=button，避免内部按钮（状态标签/删除/精选）产生 button 嵌套
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={handleCardClick}
      onDoubleClick={handleCardDoubleClick}
      onKeyDown={
        onClick
          ? (e: React.KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      style={width ? { width } : undefined}
      title={showEdit ? "单击图片预览 · 双击编辑灵感" : undefined}
      data-idea-id={idea.id}
      className={[
        // 卡片整体可点，但光标保持默认箭头（只有内部交互件才是手型）
        "group relative flex shrink-0 cursor-default flex-col overflow-hidden rounded-card border border-border bg-white text-left transition-shadow hover:shadow-[0_8px_22px_-8px_rgba(0,0,0,0.16)]",
        width ? "" : "w-full",
      ].join(" ")}
    >
      {/* 图片区：统一 4:3 比例，随宽度自适应（不再固定像素高） */}
      <div
        className="relative w-full cursor-zoom-in overflow-hidden"
        style={{
          aspectRatio: "4 / 3",
          background: idea.color,
        }}
        onClick={(e) => {
          // 点图 = 放大预览；停止冒泡，避免触发卡片根跳转
          e.stopPropagation();
          clearPreviewTimer();
          previewTimer.current = window.setTimeout(() => {
            previewTimer.current = null;
            setPreview(true);
          }, 240);
        }}
        onDoubleClick={(e) => {
          // 双击图片 = 直接编辑灵感，不预览、不跳转
          e.stopPropagation();
          clearPreviewTimer();
          onEdit?.(idea.id);
        }}
      >
        {idea.image && (
          <SmartImage
            src={idea.image}
            refUrl={idea.link}
            alt={idea.title}
            className="h-full w-full object-cover"
            fallback={
              <CoverPlaceholder
                platform={idea.platform}
                compact={size === "sm"}
              />
            }
          />
        )}

        {showDelete && (
          <div className="absolute right-2 top-2 hidden group-hover:flex">
            <Popconfirm
              title="删除这条灵感？"
              okText="删除"
              cancelText="取消"
              onConfirm={(e) => {
                e?.stopPropagation();
                deleteIdea(idea.id);
                message.success("已删除");
              }}
              onCancel={(e) => e?.stopPropagation()}
            >
              <button
                onClick={(e) => e.stopPropagation()}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white/95 shadow hover:bg-white"
                aria-label="删除"
              >
                <CloseX size={15} />
              </button>
            </Popconfirm>
          </div>
        )}

        {showEdit && (
          <div className="absolute left-2 top-2 hidden group-hover:flex">
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onEdit?.(idea.id);
              }}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-white/95 text-warmgray shadow transition-colors hover:bg-white hover:text-brown"
              aria-label="编辑"
            >
              <Pencil size={14} />
            </button>
          </div>
        )}

      </div>

      {/* 信息区 */}
      <div className={`flex flex-col gap-1 ${pad}`}>
        <div className={`${titleCls} font-semibold leading-snug text-brown line-clamp-1`}>
          {idea.title}
        </div>
        {size === "md" && (alignDesc || idea.desc) && (
          <div
            className={
              alignDesc
                ? // 固定一行高（12px 字 × 17px 行距）：有描述占满、没描述留白，顶行与底行因此对齐
                  "h-[17px] text-t5 leading-[17px] text-warmgray line-clamp-1"
                : "text-t5 leading-snug text-warmgray line-clamp-2"
            }
          >
            {idea.desc ?? ""}
          </div>
        )}

        {/* 信息行：左=状态/沉睡/日期，右=来源或打开原帖 + 精选心 */}
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <span className="shrink-0 whitespace-nowrap text-t6 text-gray">
            {meta === "slept" ? (
              <>已沉睡 {sleptDays} 天</>
            ) : meta === "date" ? (
              <>添加于 {dateStr}</>
            ) : showStatusPill ? (
              onStatusChange ? (
                <Dropdown
                  trigger={["click"]}
                  menu={{
                    items: STATUS_TAGS.map((t) => ({ key: t, label: t })),
                    onClick: ({ key, domEvent }) => {
                      domEvent.stopPropagation();
                      onStatusChange(idea.id, String(key));
                    },
                  }}
                >
                  <button
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-0.5 rounded-pill bg-mint-soft px-2 py-0.5 text-t6 font-medium text-mint transition-colors hover:bg-mint hover:text-white"
                  >
                    {statusText}
                    <ChevronDown size={11} />
                  </button>
                </Dropdown>
              ) : (
                <span className="rounded-pill bg-mint-soft px-2 py-0.5 text-t6 font-medium text-mint">
                  {statusText}
                </span>
              )
            ) : null}
          </span>

          <span className="flex min-w-0 items-center justify-end gap-1.5">
            <SourceLink idea={idea} />
            {showFavorite && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFeatured(idea.id);
                  onFavoriteChange?.(idea.id, !idea.featured);
                }}
                aria-label={idea.featured ? "取消精选置顶" : "精选置顶"}
                aria-pressed={idea.featured}
                className={[
                  "shrink-0 transition-all active:scale-90",
                  favoriteReveal === "hover"
                    ? "opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                    : "",
                ].join(" ")}
              >
                {idea.featured ? (
                  <HeartFilled size={size === "sm" ? 14 : 16} />
                ) : (
                  <HeartOutline size={size === "sm" ? 14 : 16} />
                )}
              </button>
            )}
          </span>
        </div>
      </div>

      {/* 图片预览灯箱：用 portal 挂到 body，脱离卡片的事件冒泡与 overflow 裁剪 */}
      {preview &&
        createPortal(
          <div
            className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 p-4"
            data-preview-overlay
            onClick={() => setPreview(false)}
          >
          <div
            className="overflow-hidden rounded-card bg-[#241f19] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex max-h-[78vh] items-center justify-center bg-[#1c1813]">
              {idea.image ? (
                <SmartImage
                  src={idea.image}
                  refUrl={idea.link}
                  alt={idea.title}
                  className="block max-h-[78vh] max-w-full object-contain"
                />
              ) : (
                <div
                  className="flex h-[55vh] w-full items-center justify-center"
                  style={{ background: idea.color }}
                >
                  <CoverPlaceholder platform={idea.platform} />
                </div>
              )}
            </div>
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="truncate text-t3 font-semibold text-white/95">{idea.title}</div>
                {idea.platform && (
                  <div className="text-t6 text-white/55">来源 · {idea.platform}</div>
                )}
              </div>
              {idea.link && (
                <a
                  href={idea.link}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="shrink-0 rounded-pill bg-white/10 px-3 py-1 text-t6 text-white/85 transition-colors hover:bg-white/20"
                >
                  打开原帖 ↗
                </a>
              )}
              <button
                onClick={() => setPreview(false)}
                className="shrink-0 rounded-pill bg-white/15 px-3 py-1 text-t6 text-white/90 transition-colors hover:bg-white/25"
              >
                关闭
              </button>
            </div>
          </div>
        </div>,
          document.body,
        )}
    </div>
  );
}

/* ---------- 上传灵感空卡（统一视觉） ---------- */
export function UploadCard({
  onClick,
  minH = 240,
}: {
  onClick: () => void;
  minH?: number;
}) {
  return (
    <button
      onClick={onClick}
      style={{ minHeight: minH }}
      className="group flex w-full flex-col items-center justify-center gap-2.5 rounded-card border-2 border-dashed border-gray/50 bg-white/50 text-warmgray transition-colors hover:border-mint hover:bg-mint-soft/40 hover:text-mint"
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-mint-soft/70 text-mint transition-colors group-hover:bg-mint group-hover:text-white">
        <Plus size={22} />
      </span>
      <span className="text-t3 font-semibold">上传灵感</span>
      <span className="px-2 text-center text-t6 leading-snug">
        图片 或 其他平台笔记链接
      </span>
    </button>
  );
}

/* ---------- 次要文字按钮（换一批 / 管理分类 等） ---------- */
export function TextAction({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="text-t4 font-medium text-mint transition-opacity hover:opacity-70"
    >
      {children}
    </button>
  );
}

/* ---------- 横向滚动卡片行（首页统一间距） ---------- */
export function CardRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 flex gap-4 overflow-x-auto scroll-thin pb-2">
      {children}
    </div>
  );
}

/* ---------- 区块容器（统一上下间距） ---------- */
export function Section({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <section className={`pt-8 ${className}`}>{children}</section>;
}

/* ---------- 去库里翻翻 / 空态卡片 ---------- */
export function SoftPanel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center gap-3 rounded-card border border-dashed border-border bg-white/60 py-7 ${className}`}
    >
      {children}
    </div>
  );
}

