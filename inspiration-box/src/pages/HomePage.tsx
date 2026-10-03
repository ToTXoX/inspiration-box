import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../store/useStore";
import { DAY, Idea } from "../types";
import {
  PageShell,
  Container,
  FilterBar,
  FilterRow,
  Section,
  SectionHead,
  Segmented,
  CardRow,
  IdeaCard,
  SoftPanel,
  TextAction,
} from "../components/ui";
import NewCategoryModal from "../components/NewCategoryModal";

export default function HomePage() {
  const ideas = useStore((s) => s.ideas);
  const categories = useStore((s) => s.categories);
  const setEditingId = useStore((s) => s.setEditingId);
  const setStatusTag = useStore((s) => s.setStatusTag);
  const moveCategory = useStore((s) => s.moveCategory);
  const nav = useNavigate();

  const go = (cat: string) => nav(`/category/${cat}`);
  const categoryRefs = useRef(new Map<string, HTMLDivElement>());
  const [categoryNavigation, setCategoryNavigation] = useState({
    category: "",
    request: 0,
  });

  // 在分组渲染后定位，重复点击同一分类也能重新滚动；为顶栏留出 64px。
  useEffect(() => {
    categoryRefs.current.get(categoryNavigation.category)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, [categoryNavigation]);

  /* —— 今天翻到：沉睡较久的灵感，随机 3 张 ——
     只存 id，卡片数据实时从仓库取：点爱心能立刻反映成红/灰。 */
  const oldIds = useMemo(
    () =>
      ideas.filter((i) => Date.now() - i.createdAt > 60 * DAY).map((i) => i.id),
    [ideas]
  );
  const pick = (ids: string[]) =>
    [...ids].sort(() => Math.random() - 0.5).slice(0, 3);

  const [resurrectIds, setResurrectIds] = useState<string[]>(() => pick(oldIds));
  const resurrect = useMemo(
    () =>
      resurrectIds
        .map((id) => ideas.find((i) => i.id === id))
        .filter((i): i is Idea => Boolean(i)),
    [resurrectIds, ideas]
  );
  const reshuffle = () => setResurrectIds(pick(oldIds));

  /* —— 最近想法：精选置顶，按分类分组；数量 = 精选 / 该分类总数 ——
     顺序在会话内锁定在 slots 里：取消精选后卡片留在原位显示灰心，
     再点红也不跳位。刷新页面后按「精选置顶」重排，未精选的卡片消失。 */
  const [held, setHeld] = useState<string[]>([]);

  // 签名只跟「有哪些卡片、属于哪个分类」有关，与精选状态无关 —— 切爱心不触发重排
  const orderSig = useMemo(
    () => ideas.map((i) => `${i.id}:${i.category}`).join("|"),
    [ideas]
  );

  const buildSlots = () =>
    [...ideas]
      .sort((a, b) => {
        if (a.featured !== b.featured) return a.featured ? -1 : 1;
        return (b.featuredAt ?? 0) - (a.featuredAt ?? 0);
      })
      .map((i) => i.id);

  const [slots, setSlots] = useState<string[]>(buildSlots);

  useEffect(() => {
    setSlots(buildSlots());
    // 仅在卡片集合变化时重建顺序；精选切换不重排
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderSig]);

  const groups = useMemo(() => {
    const heldSet = new Set(held);
    const slotIndex = new Map(slots.map((id, idx) => [id, idx]));
    return categories
      .map((cat) => {
        const all = ideas.filter((i) => i.category === cat);
        const items = all
          .filter((i) => i.featured || heldSet.has(i.id))
          .sort((a, b) => (slotIndex.get(a.id) ?? 0) - (slotIndex.get(b.id) ?? 0));
        return {
          cat,
          items,
          chosen: all.filter((i) => i.featured).length,
          total: all.length,
        };
      })
      .filter((g) => g.items.length > 0 || g.cat === categoryNavigation.category);
  }, [ideas, categories, held, slots, categoryNavigation.category]);

  const onFavoriteChange = (id: string, featured: boolean) =>
    setHeld((h) => (featured ? h.filter((x) => x !== id) : [...h, id]));

  /* —— 新建分类 —— */
  const [catOpen, setCatOpen] = useState(false);

  return (
    <PageShell>
      <Container>
        {/* 分类导航：末尾可新建分类；按住胶囊拖动可调整顺序 */}
        <FilterBar>
          <FilterRow label="分类">
            <Segmented
              size="sm"
              value={categoryNavigation.category}
              onChange={(category) => setCategoryNavigation((prev) => ({
                category,
                request: prev.request + 1,
              }))}
              options={categories.map((c) => ({ value: c, label: c }))}
              addItem={{ label: "新建分类", onClick: () => setCatOpen(true) }}
              onReorder={moveCategory}
            />
          </FilterRow>
        </FilterBar>

        {/* 今天翻到 */}
        <Section className="page-content">
          <SectionHead
            title="今天翻到"
            sub="你 3 个月前存的，还想要吗？"
            right={<TextAction onClick={reshuffle}>换一批</TextAction>}
          />
          <CardRow>
            {resurrect.map((i) => (
              <IdeaCard
                key={i.id}
                idea={i}
                size="md"
                meta="slept"
                showFavorite
                showEdit
                favoriteReveal="always"
                width={220}
                onEdit={setEditingId}
                onFavoriteChange={onFavoriteChange}
              />
            ))}
          </CardRow>
        </Section>

        {/* 最近想法：精选置顶，按分类收好，类别标签可跳转 */}
        <Section>
          <SectionHead title="最近想法" sub="最近想做的，按分类收好" />
          <div className="mt-5 flex flex-col gap-6">
            {groups.map((g) => (
              <div
                key={g.cat}
                data-recent-category={g.cat}
                ref={(el) => {
                  if (el) categoryRefs.current.set(g.cat, el);
                  else categoryRefs.current.delete(g.cat);
                }}
                className="flex scroll-mt-16 flex-col gap-2.5"
              >
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => go(g.cat)}
                    className="group flex items-center gap-1 text-t3 font-semibold text-brown transition-colors hover:text-mint"
                  >
                    {g.cat}
                    <span className="text-t6 text-gray opacity-0 transition-opacity group-hover:opacity-100">
                      ›
                    </span>
                  </button>
                  <span className="text-t5 text-warmgray">
                    ♡ {g.chosen} 件 · 共 {g.total} 件
                  </span>
                </div>
                {g.items.length === 0 ? (
                  <div className="rounded-card border border-dashed border-border px-4 py-6 text-t4 text-warmgray">
                    这个分类还没有精选灵感
                  </div>
                ) : (
                  <CardRow>
                    {g.items.map((i) => (
                      <IdeaCard
                        key={i.id}
                        idea={i}
                        size="sm"
                        meta="none"
                        showStatus
                        showFavorite
                        showEdit
                        favoriteReveal="hover"
                        width={196}
                        onEdit={setEditingId}
                        onStatusChange={setStatusTag}
                        onFavoriteChange={onFavoriteChange}
                      />
                    ))}
                  </CardRow>
                )}
              </div>
            ))}
          </div>
        </Section>

        {/* 库入口 */}
        <Section className="pb-12">
          <SoftPanel>
            <div className="text-t4 text-warmgray">
              库里共有 {ideas.length} 件灵感，不焦虑，慢慢来
            </div>
            <button
              onClick={() => go(categories[0] ?? "穿搭")}
              className="rounded-pill border border-border bg-white px-4 py-1.5 text-t4 font-semibold text-mint transition-colors hover:bg-mint-soft/60"
            >
              去库里翻翻
            </button>
          </SoftPanel>
        </Section>
      </Container>

      <NewCategoryModal open={catOpen} onClose={() => setCatOpen(false)} />
    </PageShell>
  );
}
