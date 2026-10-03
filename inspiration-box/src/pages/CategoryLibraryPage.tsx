import type * as React from "react";
import { useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useStore } from "../store/useStore";
import { PLATFORMS, CategoryId, Idea, LibrarySort } from "../types";
import {
  PageShell,
  Container,
  FilterBar,
  FilterRow,
  Segmented,
  IdeaCard,
  UploadCard,
} from "../components/ui";
import AddIdeaModal from "../components/AddIdeaModal";
import NewCategoryModal from "../components/NewCategoryModal";

type SortKey = LibrarySort;

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "new", label: "最新" },
  { value: "old", label: "最早" },
  { value: "title", label: "按标题" },
  { value: "manual", label: "自定义" },
];

/** 非精选组的排序规则（精选组另有自己的规则，见下）；manual 不走这里 */
const chosenCmp = (key: SortKey) => (a: Idea, b: Idea) =>
  key === "old"
    ? a.createdAt - b.createdAt
    : key === "title"
    ? a.title.localeCompare(b.title, "zh")
    : b.createdAt - a.createdAt;

const byOrder = (a: Idea, b: Idea) =>
  (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER);

export default function CategoryLibraryPage() {
  const { id } = useParams();
  const category = (id as CategoryId) ?? "穿搭";
  const nav = useNavigate();
  const ideas = useStore((s) => s.ideas);
  const categories = useStore((s) => s.categories);
  const setEditingId = useStore((s) => s.setEditingId);
  const moveCategory = useStore((s) => s.moveCategory);
  const setIdeaOrder = useStore((s) => s.setIdeaOrder);
  const moveIdea = useStore((s) => s.moveIdea);
  const [source, setSource] = useState<string>("全部");
  /** 排序方式存在全局：手动排完序刷新后仍是手动顺序，不会跳回「最新添加」 */
  const sort = useStore((s) => s.librarySort);
  const setSort = useStore((s) => s.setLibrarySort);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [catOpen, setCatOpen] = useState(false);

  const inCat = useMemo(
    () => ideas.filter((i) => i.category === category),
    [ideas, category]
  );

  /**
   * 卡片顺序：**精选组永远整体置顶**，两组各自排序，互不穿越。
   * · 手动排序：两组都按 order（用户拖出来的名次）
   * · 其它排序：精选组按点亮时间倒序，未精选组按所选规则
   */
  const shown = useMemo(() => {
    const list =
      source === "全部" ? inCat : inCat.filter((i) => i.platform === source);
    const pinned = list.filter((i) => i.featured);
    const rest = list.filter((i) => !i.featured);
    if (sort === "manual") {
      return [...pinned.sort(byOrder), ...rest.sort(byOrder)];
    }
    return [
      ...pinned.sort((a, b) => (b.featuredAt ?? 0) - (a.featuredAt ?? 0)),
      ...rest.sort(chosenCmp(sort)),
    ];
  }, [inCat, source, sort]);

  /* ---------- 按住卡片拖动调序 ----------
     与分类胶囊同一套手势：按住挪动超过阈值才算拖动，经过哪张就换到哪张的位置，
     松手即定；只按不拖仍是原来的点击（爱心 / 删除 / 来源照常工作）。 */
  const gridRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; moved: boolean; x: number; y: number } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  /** 拖动结束浏览器还会补一次 click，用它吃掉，避免误触卡片里的按钮 */
  const swallowClick = useRef(false);

  /** 首次拖动时把「现在看到的顺序」固化成手动名次，否则会按旧名次跳一下 */
  const freezeOrder = () => {
    // 已经是手动排序 —— 名次就是用户排的，再固化一次会把排好的顺序冲掉
    if (sort === "manual") return;
    const pinned = inCat
      .filter((i) => i.featured)
      .sort((a, b) => (b.featuredAt ?? 0) - (a.featuredAt ?? 0));
    const rest = inCat.filter((i) => !i.featured).sort(chosenCmp(sort));
    setIdeaOrder([...pinned, ...rest].map((i, idx) => ({ id: i.id, order: idx })));
    setSort("manual");
  };

  const onCardDown = (ideaId: string, e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    swallowClick.current = false;
    drag.current = { id: ideaId, moved: false, x: e.clientX, y: e.clientY };
  };

  const onGridMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved) {
      // 先走一小段才算拖动，避免把「点一下」误判成拖
      if (Math.abs(e.clientX - d.x) < 8 && Math.abs(e.clientY - d.y) < 8) return;
      d.moved = true;
      freezeOrder();
      setDragId(d.id);
      try {
        gridRef.current?.setPointerCapture(e.pointerId);
      } catch {
        /* 个别环境不支持指针捕获，忽略即可（容器本身仍在收事件） */
      }
    }
    const hit = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest(
      "[data-idea-id]"
    ) as HTMLElement | null;
    const to = hit?.dataset.ideaId;
    if (!to || to === d.id) return;
    moveIdea(d.id, to);
  };

  const onGridUp = () => {
    if (drag.current?.moved) swallowClick.current = true;
    drag.current = null;
    setDragId(null);
  };

  return (
    <PageShell>
      <Container>
        {/* 分类切换 + 来源筛选：统一 Segmented 视觉
            分类行与博物架的「分类导航」共用同一份顺序：新建、拖动调序都同步生效 */}
        <FilterBar>
          <FilterRow label="分类" right={
            <Segmented
              size="sm"
              options={SORT_OPTIONS}
              value={sort}
              onChange={setSort}
            />
          }>
            <Segmented
              size="sm"
              value={category}
              onChange={(v) => nav(`/category/${v}`)}
              options={categories.map((c) => ({ value: c, label: c }))}
              addItem={{ label: "新建分类", onClick: () => setCatOpen(true) }}
              onReorder={moveCategory}
            />
          </FilterRow>
          <FilterRow label="来源">
            <Segmented
              size="sm"
              value={source}
              onChange={setSource}
              options={["全部", ...PLATFORMS].map((p) => ({
                value: p,
                label: p,
              }))}
            />
          </FilterRow>
        </FilterBar>

        {/* 卡片网格：5 列紧凑（1440 视口），图片 4:3 自适应
            拖动任意卡片可调整顺序（自动切到「手动排序」），精选组始终置顶 */}
        <div
          ref={gridRef}
          onPointerMove={onGridMove}
          onPointerUp={onGridUp}
          onPointerCancel={onGridUp}
          onClickCapture={(e) => {
            if (swallowClick.current) {
              swallowClick.current = false;
              e.stopPropagation();
              e.preventDefault();
            }
          }}
          className="page-content grid grid-cols-2 gap-4 pb-12 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
        >
          <UploadCard onClick={() => setUploadOpen(true)} />
          {shown.map((i) => (
            <div
              key={i.id}
              data-idea-id={i.id}
              onPointerDown={(e) => onCardDown(i.id, e)}
              title="按住拖动可调整顺序"
              style={{ touchAction: "pan-y" }}
              className={[
                "relative select-none rounded-card",
                dragId === i.id ? "opacity-60 ring-2 ring-mint/40" : "",
              ].join(" ")}
            >
              <IdeaCard
                idea={i}
                size="md"
                meta="date"
                showFavorite
                showDelete
                showEdit
                onEdit={setEditingId}
                alignDesc
              />
            </div>
          ))}
        </div>
      </Container>

      <AddIdeaModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        defaultCategory={category}
      />
      <NewCategoryModal open={catOpen} onClose={() => setCatOpen(false)} />
    </PageShell>
  );
}
