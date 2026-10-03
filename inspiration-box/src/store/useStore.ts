import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { appStorage } from "../lib/desktop";
import { Idea, Board, CategoryId, Platform, TextNote, LibrarySort, CATEGORIES, DEFAULT_STATUS_TAG, LEGACY_STATUS_MAP, NOTE_DEFAULT_COLOR } from "../types";
import { buildSeedIdeas, SEED_BOARDS } from "../data/seed";

/** 层序操作：置顶 / 上移一层 / 下移一层 / 置底 */
export type LayerAction = "front" | "forward" | "backward" | "back";

/** 画布元素在世界坐标里的落点与宽度 */
export type CanvasPos = { x: number; y: number; w: number };

/** 排版模式：决定便签把位置写进哪一组字段（自由 x/y/w ↔ 规则 gx/gy/gw） */
export type LayoutMode = "free" | "grid";

/** 规则排版：默认一行铺几张 · 单行上限（拖得再远也不会超过） */
export const RULE_ROW_DEFAULT = 5;
export const RULE_ROW_MAX = 12;

/**
 * 规整「每行几张」，让它和实际卡片数吻合。
 * 阵列**没有固定列数** —— 每一行各放几张是独立的一组数，不要求行行相等。
 * · 没记录过 → 每行 RULE_ROW_DEFAULT 张
 * · 卡片变多 → 先把最后一行补到默认宽度，再往下开新行（不动用户已调好的行）
 * · 卡片变少 → 从末尾裁掉
 */
export function normalizeRows(n: number, rows?: number[]): number[] {
  const out = (rows ?? [])
    .map((r) => Math.round(r))
    .filter((r) => r > 0)
    .map((r) => Math.min(r, RULE_ROW_MAX));
  if (n <= 0) return [];
  let sum = out.reduce((a, b) => a + b, 0);
  while (sum < n) {
    const last = out.length ? out[out.length - 1] : 0;
    const add =
      last > 0 && last < RULE_ROW_DEFAULT
        ? Math.min(RULE_ROW_DEFAULT - last, n - sum)
        : Math.min(RULE_ROW_DEFAULT, n - sum);
    if (last > 0 && last < RULE_ROW_DEFAULT) out[out.length - 1] = last + add;
    else out.push(add);
    sum += add;
  }
  while (sum > n && out.length) {
    const last = out[out.length - 1];
    if (last <= sum - n) {
      out.pop();
      sum -= last;
    } else {
      out[out.length - 1] = last - (sum - n);
      sum = n;
    }
  }
  return out;
}

/** 画布卡片基准宽（设计稿尺寸）；实际宽度由用户拖拽决定，内容整体等比缩放 */
export const CANVAS_BASE_W = 240;
/** 文本便签默认宽 */
export const CANVAS_NOTE_W = 220;

/* ---------- 自动落位网格 ----------
   与种子卡片的初始坐标对齐（x = 20 + c*264，y = 180 + r*420），
   新上板的卡片按「先横向填满一行、再换行」找第一个不重叠的格子。
   卡片高度按 宽 × 1.45 估算（240 → 348，实测约 343），只用于避让，不要求精确。 */
const SLOT_X0 = 20;
const SLOT_Y0 = 180;
const SLOT_DX = 264;
const SLOT_DY = 420;
const SLOT_COLS = 4;
const SLOT_ROWS = 80;
const CARD_H_RATIO = 1.45;
const estH = (w: number) => w * CARD_H_RATIO;

type BoxLike = { x: number; y: number; w: number; h: number };

function findFreeSlot(occupied: BoxLike[], w: number, h: number) {
  const hitAt = (x: number, y: number) =>
    occupied.some(
      (o) => !(x + w <= o.x || o.x + o.w <= x || y + h <= o.y || o.y + o.h <= y)
    );
  for (let r = 0; r < SLOT_ROWS; r++) {
    for (let c = 0; c < SLOT_COLS; c++) {
      const x = SLOT_X0 + c * SLOT_DX;
      const y = SLOT_Y0 + r * SLOT_DY;
      if (!hitAt(x, y)) return { x, y };
    }
  }
  return { x: SLOT_X0, y: SLOT_Y0 + SLOT_ROWS * SLOT_DY };
}

/** 某画板上正在陈列的卡片：品类命中 且 已精选 */
function shownOnBoard(ideas: Idea[], board?: Board) {
  if (!board) return [];
  return ideas.filter(
    (i) => i.featured && board.categories.includes(i.category)
  );
}

/**
 * 规则排版的阵列顺序：先按 `board.cardOrder` 排，没登记过的卡片保持默认顺序追加在后。
 * 这样「上板 / 移出画布」都不需要维护这个数组，只有用户手动调序才写入。
 */
export function orderedOnBoard(ideas: Idea[], board?: Board) {
  const shown = shownOnBoard(ideas, board);
  const order = board?.cardOrder ?? [];
  if (!order.length) return shown;
  const idx = new Map(order.map((id, i) => [id, i]));
  return shown
    .map((i, i0) => ({ i, k: idx.get(i.id) ?? order.length + i0 }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.i);
}

/** 某画板上便签的层序集合 */
const noteZs = (notes: TextNote[], board?: Board) =>
  notes.filter((n) => n.boardId === board?.id).map((n) => n.z ?? 0);

/**
 * 便签层序：永远落在最上层 —— 「文本便签默认压在图文卡片上方」。
 * 想反过来（便签钻到卡片下面）用右键的「置于下层 / 置于底层」。
 */
function nextNoteZ(ideas: Idea[], notes: TextNote[], board?: Board) {
  const zs = [
    ...shownOnBoard(ideas, board).map((i) => i.z ?? 0),
    ...noteZs(notes, board),
  ];
  return zs.length ? Math.max(...zs) + 1 : 0;
}

/**
 * 图文卡片层序：叠在其它卡片之上，但**不越过便签** ——
 * 否则「后上板的卡片」会把便签压住，和「便签默认在上方」的约定打架。
 * 画板上还没有卡片时，直接落到最低那张便签的下方。
 */
function nextCardZ(ideas: Idea[], notes: TextNote[], board?: Board) {
  const cards = shownOnBoard(ideas, board).map((i) => i.z ?? 0);
  if (cards.length) return Math.max(...cards) + 1;
  const ns = noteZs(notes, board);
  return ns.length ? Math.min(...ns) - 1 : 0;
}

/**
 * 把数组里 `from` 位置的元素挪到 `to` 位置。
 * 分类 / 画板的顺序调整共用这一份实现（拖拽落点 → 新数组）。
 */
/**
 * 灵感库手动排序的比较器：order 小的在前，没登记过的排在本组末尾
 * （稳定排序保证它们之间维持数组原序，不会因为拖动整组乱跳）。
 */
const byIdeaOrder = (a: Idea, b: Idea) =>
  (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER);

export function moveItem<T>(arr: T[], from: number, to: number): T[] {
  const next = [...arr];
  if (from < 0 || from >= next.length) return next;
  const clamped = Math.max(0, Math.min(to, next.length - 1));
  if (from === clamped) return next;
  const [x] = next.splice(from, 1);
  next.splice(clamped, 0, x);
  return next;
}

interface State {
  ideas: Idea[];
  boards: Board[];
  categories: string[]; // 动态分类（可新建）
  /** 画布上的文本便签 */
  canvasNotes: TextNote[];
  /** 当前正在编辑的卡片 id（全局编辑弹窗据此预填）；为 null 时弹窗关闭 */
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  addCategory: (name: string) => void;
  /**
   * 调整分类顺序。**分类顺序只有这一份**（存在 categories 数组里），
   * 博物架的分类导航、灵感库的分类行、主题画板的品类都读它，
   * 所以在这里改一次三页同时生效。
   */
  moveCategory: (from: number, to: number) => void;
  /** 调整画板顺序（主题画板的画板栏） */
  moveBoard: (from: number, to: number) => void;
  /**
   * 灵感库的排序方式。放在全局是为了**跨刷新保持** ——
   * 手动排完序刷新一下又跳回「最新添加」的话，用户会以为白拖了。
   */
  librarySort: LibrarySort;
  setLibrarySort: (key: LibrarySort) => void;
  /**
   * 灵感库「手动排序」：把一批卡片的 order 一次性写成给定名次。
   * 用户从别的排序方式切到手动排序时，用它把「当前看到的顺序」固化下来，
   * 否则一上手拖会按旧的手动名次跳一下。
   */
  setIdeaOrder: (updates: { id: string; order: number }[]) => void;
  /**
   * 灵感库手动调序：把 dragId 插到 targetId 的位置上。
   * 只在**同品类 + 同精选状态**的组内让位 —— 「精选始终置顶」由分组保证，
   * 精选与未精选两组永远不会互相穿越；改完把该品类重新编号，名次始终从 0 连续。
   */
  moveIdea: (dragId: string, targetId: string) => void;
  setStatusTag: (id: string, tag: string) => void;
  addIdea: (input: {
    title: string;
    desc?: string;
    category: CategoryId;
    platform: Platform;
    color?: string;
    image?: string;
    images?: string[];
    link?: string;
  }) => void;
  /** 编辑已有卡片：分类选错、标题/来源想改，都走这里（patch 只覆盖传进来的字段） */
  updateIdea: (id: string, patch: Partial<Idea>) => void;
  deleteIdea: (id: string) => void;
  toggleFeatured: (id: string) => void;
  /** 让卡片在画板上陈列（= 精选）并落到指定世界坐标 */
  placeOnBoard: (id: string, boardId: string, x: number, y: number) => void;
  /** 从画布移出（= 取消精选）。坐标保留，重新精选会回到原位 */
  removeFromBoard: (id: string) => void;
  /** 给本画板上「还没有坐标」的陈列卡片补一个不重叠的落点（幂等，无改动时不触发更新） */
  ensureBoardPlacements: (boardId: string) => void;
  moveNote: (id: string, x: number, y: number) => void;
  resizeNote: (id: string, w: number) => void;
  /** 在画布上新建一个文本便签，返回新 id（调用方拿到后立即进入编辑态）。
      mode 决定位置写进哪一组字段 —— 自由排版与规则排版各自独立 */
  addTextNote: (boardId: string, pos: CanvasPos, mode: LayoutMode) => string;
  updateTextNote: (id: string, patch: Partial<TextNote>) => void;
  removeTextNote: (id: string) => void;
  /** 右键菜单：调整卡片 / 便签的叠放层级（需带当前画板，卡片归属由品类推导） */
  reorderLayer: (id: string, boardId: string, action: LayerAction) => void;
  /**
   * 规则排版：把卡片放到「第 row 行的第 col 格」。
   * 阵列没有固定列数 —— 落到某行右侧这一行就变长、源行相应变短（卡片总数不变），
   * 所以每一行各放几张可以自由调。位置随后仍由网格算，松手即归位。
   */
  placeCardInRow: (
    boardId: string,
    draggedId: string,
    row: number,
    col: number
  ) => void;
  addBoard: (name: string) => void;
  toggleBoardCategory: (boardId: string, category: CategoryId) => void;
  updateBoardTheme: (boardId: string, text: string) => void;
  resetAll: () => void;
}

const PALETTE = [
  "#C9E4E1",
  "#B7DCD9",
  "#D8EAE6",
  "#E2F2F1",
  "#CFE3DF",
  "#C7B7A6",
  "#E8DFD2",
  "#DCE7E0",
];

export const useStore = create<State>()(
  persist(
    (set) => ({
      ideas: buildSeedIdeas(),
      boards: SEED_BOARDS,
      categories: [...CATEGORIES],
      canvasNotes: [],
      editingId: null,
      librarySort: "new",

      setLibrarySort: (key) => set({ librarySort: key }),

      setEditingId: (id) => set({ editingId: id }),

      addCategory: (name) =>
        set((s) => {
          const n = name.trim();
          if (!n || s.categories.includes(n)) return s;
          return { categories: [...s.categories, n] };
        }),

      moveCategory: (from, to) =>
        set((s) => ({ categories: moveItem(s.categories, from, to) })),

      moveBoard: (from, to) =>
        set((s) => ({ boards: moveItem(s.boards, from, to) })),

      setIdeaOrder: (updates) =>
        set((s) => {
          if (!updates.length) return s;
          const map = new Map(updates.map((u) => [u.id, u.order]));
          return {
            ideas: s.ideas.map((i) =>
              map.has(i.id) ? { ...i, order: map.get(i.id) } : i
            ),
          };
        }),

      moveIdea: (dragId, targetId) =>
        set((s) => {
          const drag = s.ideas.find((i) => i.id === dragId);
          const target = s.ideas.find((i) => i.id === targetId);
          if (!drag || !target || drag.id === target.id) return s;
          // 只允许「同品类 + 同精选状态」之间调序：精选组整体置顶，两组互不穿越
          if (drag.category !== target.category) return s;
          if (!!drag.featured !== !!target.featured) return s;

          const sameCat = s.ideas.filter((i) => i.category === drag.category);
          const feat = sameCat.filter((i) => i.featured).sort(byIdeaOrder);
          const rest = sameCat.filter((i) => !i.featured).sort(byIdeaOrder);
          const group = drag.featured ? feat : rest;
          const from = group.findIndex((i) => i.id === dragId);
          const to = group.findIndex((i) => i.id === targetId);
          if (from < 0 || to < 0) return s;

          const moved = moveItem(group, from, to);
          // 重新编号：精选组从 0 起，未精选组紧接其后（分组排序决定实际展示顺序）
          const ordered = drag.featured ? [...moved, ...rest] : [...feat, ...moved];
          const orderMap = new Map(ordered.map((i, idx) => [i.id, idx]));
          return {
            ideas: s.ideas.map((i) =>
              orderMap.has(i.id) ? { ...i, order: orderMap.get(i.id) } : i
            ),
          };
        }),

      setStatusTag: (id, tag) =>
        set((s) => ({
          ideas: s.ideas.map((i) =>
            i.id === id ? { ...i, statusTag: tag } : i
          ),
        })),

      addIdea: (input) =>
        set((s) => {
          const id = `i${Date.now()}`;
          const idea: Idea = {
            id,
            title: input.title,
            desc: input.desc,
            category: input.category,
            platform: input.platform,
            color: input.color ?? PALETTE[Math.floor(Math.random() * PALETTE.length)],
            image: input.image,
            images: input.images,
            link: input.link,
            createdAt: Date.now(),
            featured: false,
            // 手动排序下新卡片落在最前面（名次取现有最小值再往前一位）
            order: s.ideas.reduce((m, i) => Math.min(m, i.order ?? 0), 0) - 1,
            statusTag: DEFAULT_STATUS_TAG,
            boardId: null,
          };
          return { ideas: [idea, ...s.ideas] };
        }),

      deleteIdea: (id) =>
        set((s) => ({ ideas: s.ideas.filter((i) => i.id !== id) })),

      updateIdea: (id, patch) =>
        set((s) => ({
          ideas: s.ideas.map((i) => (i.id === id ? { ...i, ...patch } : i)),
        })),

      toggleFeatured: (id) =>
        set((s) => ({
          ideas: s.ideas.map((i) =>
            i.id === id
              ? i.featured
                ? { ...i, featured: false, featuredAt: undefined }
                : { ...i, featured: true, featuredAt: Date.now() }
              : i
          ),
        })),

      // 「上板」= 精选 + 落位。落位坐标跨画板共用，所以同一张卡在各画板位置一致
      placeOnBoard: (id, boardId, x, y) =>
        set((s) => {
          const board = s.boards.find((b) => b.id === boardId);
          return {
            ideas: s.ideas.map((i) =>
              i.id === id
                ? {
                    ...i,
                    boardId: null, // 旧字段不再使用
                    x,
                    y,
                    w: i.w ?? CANVAS_BASE_W,
                    z: nextCardZ(s.ideas, s.canvasNotes, board),
                    featured: true,
                    featuredAt: i.featured ? i.featuredAt : Date.now(),
                  }
                : i
            ),
          };
        }),

      // 「下板」= 取消精选。坐标不清，重新精选会回到原来的位置
      removeFromBoard: (id) =>
        set((s) => ({
          ideas: s.ideas.map((i) =>
            i.id === id ? { ...i, featured: false, featuredAt: undefined } : i
          ),
        })),

      ensureBoardPlacements: (boardId) =>
        set((s) => {
          const board = s.boards.find((b) => b.id === boardId);
          if (!board) return s;
          const shown = shownOnBoard(s.ideas, board);
          const missing = shown.filter((i) => i.x == null || i.y == null);
          if (!missing.length) return s;

          /* 避让范围用「所有已经有坐标的卡片」而不是只算本画板：
             坐标是跨画板共用的，只算本画板会在另一个画板上撞车。便签是本画板独占，一并算进。 */
          const occupied: BoxLike[] = [
            ...s.ideas
              .filter((i) => i.x != null && i.y != null)
              .map((i) => {
                const w = i.w ?? CANVAS_BASE_W;
                return { x: i.x as number, y: i.y as number, w, h: estH(w) };
              }),
            ...s.canvasNotes
              .filter((n) => n.boardId === boardId)
              .map((n) => ({ x: n.x, y: n.y, w: n.w, h: 96 })),
          ];

          /* 一批新卡要整批落在便签下方，所以这里从「便签最低层 - 本批数量」起算 */
          const cardZs = shownOnBoard(s.ideas, board).map((i) => i.z ?? 0);
          const ns = noteZs(s.canvasNotes, board);
          let z = cardZs.length
            ? Math.max(...cardZs) + 1
            : ns.length
              ? Math.min(...ns) - missing.length
              : 0;
          const spots = new Map<string, { x: number; y: number; z: number }>();
          for (const idea of missing) {
            const w = idea.w ?? CANVAS_BASE_W;
            const spot = findFreeSlot(occupied, w, estH(w));
            occupied.push({ ...spot, w, h: estH(w) });
            spots.set(idea.id, { ...spot, z: z++ });
          }
          return {
            ideas: s.ideas.map((i) =>
              spots.has(i.id) ? { ...i, ...spots.get(i.id)! } : i
            ),
          };
        }),

      moveNote: (id, x, y) =>
        set((s) => ({
          ideas: s.ideas.map((i) => (i.id === id ? { ...i, x, y } : i)),
        })),

      resizeNote: (id, w) =>
        set((s) => ({
          ideas: s.ideas.map((i) => (i.id === id ? { ...i, w } : i)),
        })),

      addTextNote: (boardId, pos, mode) => {
        const id = `t${Date.now()}${Math.floor(Math.random() * 1000)}`;
        set((s) => ({
          canvasNotes: [
            ...s.canvasNotes,
            {
              id,
              boardId,
              text: "",
              /* 两组坐标都给上初始值，之后两种排版各改各的（互不覆盖） */
              x: pos.x,
              y: pos.y,
              w: pos.w,
              ...(mode === "grid" ? { gx: pos.x, gy: pos.y, gw: pos.w } : null),
              color: NOTE_DEFAULT_COLOR,
              z: nextNoteZ(
                s.ideas,
                s.canvasNotes,
                s.boards.find((b) => b.id === boardId)
              ),
              createdAt: Date.now(),
            },
          ],
        }));
        return id;
      },

      updateTextNote: (id, patch) =>
        set((s) => ({
          canvasNotes: s.canvasNotes.map((n) =>
            n.id === id ? { ...n, ...patch } : n
          ),
        })),

      removeTextNote: (id) =>
        set((s) => ({ canvasNotes: s.canvasNotes.filter((n) => n.id !== id) })),

      /* 叠放层级：把同一画板上的陈列卡片 + 便签拉平成一条有序队列，移动一位后重排 z */
      reorderLayer: (id, boardId, action) =>
        set((s) => {
          const board = s.boards.find((b) => b.id === boardId);
          if (!board) return s;

          const queue = [
            ...shownOnBoard(s.ideas, board).map((i) => ({
              id: i.id,
              z: i.z ?? 0,
            })),
            ...s.canvasNotes
              .filter((n) => n.boardId === boardId)
              .map((n) => ({ id: n.id, z: n.z ?? 0 })),
          ].sort((a, b) => a.z - b.z);

          const idx = queue.findIndex((q) => q.id === id);
          if (idx < 0) return s;
          const [item] = queue.splice(idx, 1);
          if (action === "front") queue.push(item);
          else if (action === "back") queue.unshift(item);
          else if (action === "forward") queue.splice(Math.min(idx + 1, queue.length), 0, item);
          else queue.splice(Math.max(idx - 1, 0), 0, item);

          const zmap = new Map(queue.map((q, i) => [q.id, i]));
          const onBoard = new Set(queue.map((q) => q.id));
          return {
            ideas: s.ideas.map((i) =>
              onBoard.has(i.id) ? { ...i, z: zmap.get(i.id) ?? i.z } : i
            ),
            canvasNotes: s.canvasNotes.map((n) =>
              n.boardId === boardId ? { ...n, z: zmap.get(n.id) ?? n.z } : n
            ),
          };
        }),

      /* 规则排版：把卡片放到指定的「行 / 列」格子上。
         阵列是一组**每行独立**的宽度（board.ruleRows）：
         卡片从原行摘出、插进目标行的第 col 格 —— 目标行变长、源行变短，总数不变。
         先把当前行宽实体化成 ruleRows，之后新上板的卡片由 normalizeRows 追加到末尾。 */
      placeCardInRow: (boardId, draggedId, row, col) =>
        set((s) => {
          const board = s.boards.find((b) => b.id === boardId);
          if (!board) return s;
          const flat = orderedOnBoard(s.ideas, board).map((i) => i.id);
          const from = flat.indexOf(draggedId);
          if (from < 0) return s;

          // 按当前行宽切成一组一组
          const groups: string[][] = [];
          let k = 0;
          for (const n of normalizeRows(flat.length, board.ruleRows)) {
            groups.push(flat.slice(k, k + n));
            k += n;
          }
          if (k < flat.length) groups.push(flat.slice(k));

          const srcRow = groups.findIndex((g) => g.includes(draggedId));
          if (srcRow < 0) return s;
          const srcCol = groups[srcRow].indexOf(draggedId);
          groups[srcRow].splice(srcCol, 1);

          let r = Math.max(0, Math.round(row));
          let c = Math.max(0, Math.round(col));
          // 只修正行号：源行被摘空后，它后面的行整体前移一行。
          // 列不用修正 —— 行内的列号就是它在该行里的次序，摘掉卡片后次序自然重排。
          const living = groups.filter((g) => g.length);
          if (srcRow < r && groups[srcRow].length === 0) r -= 1;
          r = Math.max(0, Math.min(r, living.length));
          while (living.length < r) living.push([]);
          if (!living[r]) living[r] = [];
          c = Math.max(0, Math.min(c, living[r].length));
          living[r].splice(c, 0, draggedId);

          const kept = living.filter((g) => g.length);
          return {
            boards: s.boards.map((b) =>
              b.id === boardId
                ? {
                    ...b,
                    cardOrder: kept.flat(),
                    ruleRows: kept.map((g) => g.length),
                  }
                : b
            ),
          };
        }),

      addBoard: (name) =>
        set((s) => ({
          boards: [
            ...s.boards,
            { id: `b${Date.now()}`, name, categories: [], themeText: "" },
          ],
        })),

      toggleBoardCategory: (boardId, category) =>
        set((s) => ({
          boards: s.boards.map((b) => {
            if (b.id !== boardId) return b;
            const has = b.categories.includes(category);
            return {
              ...b,
              categories: has
                ? b.categories.filter((c) => c !== category)
                : [...b.categories, category],
            };
          }),
        })),

      updateBoardTheme: (boardId, text) =>
        set((s) => ({
          boards: s.boards.map((b) =>
            b.id === boardId ? { ...b, themeText: text } : b
          ),
        })),

      resetAll: () =>
        set({
          ideas: buildSeedIdeas(),
          boards: SEED_BOARDS,
          categories: [...CATEGORIES],
          canvasNotes: [],
          librarySort: "new",
        }),
    }),
    {
      name: "inspiration-box-v1",
      storage: createJSONStorage(() => appStorage),
      skipHydration: true,
      // editingId 是瞬时 UI 态（编辑弹窗开关），不应持久化：
      // 否则上次没关的编辑弹窗会在刷新/重开后自动重新弹出。
      partialize: (state) => {
        const { editingId: _editingId, ...rest } = state;
        return rest;
      },
      // 兼容：旧版 localStorage 数据没有 categories 字段，这里兜底为默认分类
      //       旧版状态词（还在想要 / 进行中 / 已购）按 LEGACY_STATUS_MAP 迁移到新词表
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<State>;
        // 种子卡片新增了封面图：老数据里对应 id 若还没有 image，就补上（只补不改，幂等）
        const seedImage = new Map(
          buildSeedIdeas()
            .filter((s) => s.image)
            .map((s) => [s.id, s.image as string])
        );
        const seedIds = new Set(buildSeedIdeas().map((s) => s.id));
        const ideas = (Array.isArray(p.ideas) ? p.ideas : current.ideas).map(
          (i) => {
            let next: Idea =
              i.statusTag && LEGACY_STATUS_MAP[i.statusTag]
                ? { ...i, statusTag: LEGACY_STATUS_MAP[i.statusTag] }
                : i;
            const img = seedImage.get(next.id);
            if (!next.image && img) next = { ...next, image: img };
            // 旧版用 boardId 表示「已放到画板」；新规则下「在画板 = 精选」，把种子卡补齐，
            // 否则升级后原本摆在画布上的卡会整批消失
            if (next.boardId && !next.featured && seedIds.has(next.id))
              next = { ...next, featured: true, featuredAt: next.featuredAt ?? Date.now() };
            return next;
          }
        );
        return {
          ...current,
          ...p,
          ideas,
          canvasNotes: Array.isArray(p.canvasNotes) ? p.canvasNotes : [],
          categories:
            Array.isArray(p.categories) && p.categories.length
              ? p.categories
              : [...CATEGORIES],
          librarySort: p.librarySort ?? "new",
        };
      },
    }
  )
);
