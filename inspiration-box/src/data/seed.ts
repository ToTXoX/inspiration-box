import { Idea, Board, CategoryId, Platform, DAY } from "../types";

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

type Seed = {
  title: string;
  desc?: string;
  category: CategoryId;
  platform: Platform;
  daysAgo: number;
  featured?: boolean;
  statusTag?: string;
  /**
   * 画布初始坐标（世界坐标）。
   * 归属由「精选 + 品类」推导：卡片会出现在所有包含其品类的画板上；
   * 已经给过坐标的卡片不再被自动排布挪动，没给坐标的由 `ensureBoardPlacements` 落位。
   */
  x?: number;
  y?: number;
  /** 封面图文件名（落在 server/uploads/，对外路径 /uploads/xxx） */
  img?: string;
};

// 今天翻到：沉睡较久的候选（>90 天）
const SEED: Seed[] = [
  // —— 穿搭 ——
  { title: "真丝衬衫", desc: "米白真丝，通勤也能很松弛", category: "穿搭", platform: "小红书", daysAgo: 4, featured: true, statusTag: "已买", x: 20, y: 180, img: "cover-silk.jpg" },
  { title: "通勤托特包", desc: "能装下笔记本的极简托特", category: "穿搭", platform: "小红书", daysAgo: 12, statusTag: "想要" },
  { title: "醋酸半裙", desc: "垂感好，不容易起静电", category: "穿搭", platform: "B站", daysAgo: 96, featured: true, x: 284, y: 180, img: "cover-skirt.jpg" },
  { title: "针织开衫", desc: "奶茶色，春秋叠穿神器", category: "穿搭", platform: "小红书", daysAgo: 30, statusTag: "已试" },
  { title: "老钱风西装", desc: "剪裁利落，少logo", category: "穿搭", platform: "微博", daysAgo: 150 },
  { title: "乐福鞋", desc: "软底，久走不累", category: "穿搭", platform: "小红书", daysAgo: 8, featured: true, x: 548, y: 180, img: "cover-loafers.jpg" },
  { title: "阔腿裤", desc: "高腰显比例", category: "穿搭", platform: "抖音", daysAgo: 200 },
  { title: "基础白T", desc: "支数高，不透光", category: "穿搭", platform: "小红书", daysAgo: 18, statusTag: "已买" },

  // —— 美妆 ——
  { title: "大地色眼影盘", desc: "日常消肿，一盘搞定", category: "美妆", platform: "小红书", daysAgo: 6, featured: true, statusTag: "想要" },
  { title: "伪素颜底妆", desc: "薄、贴、不卡粉", category: "美妆", platform: "抖音", daysAgo: 22 },
  { title: "唇泥", desc: "雾感，不拔干", category: "美妆", platform: "小红书", daysAgo: 110, featured: true },
  { title: "睫毛增长液", desc: "坚持一个月看看", category: "美妆", platform: "微博", daysAgo: 40, statusTag: "已试" },
  { title: "定妆喷雾", desc: "夏天不脱妆", category: "美妆", platform: "小红书", daysAgo: 130 },

  // —— 旅行 ——
  { title: "京都赏枫", desc: "十一月，岚山小火车", category: "旅行", platform: "马蜂窝", daysAgo: 60, featured: true, statusTag: "想要" },
  { title: "冰岛极光", desc: "追光路线收藏", category: "旅行", platform: "携程", daysAgo: 175 },
  { title: "大理洱海", desc: "环湖骑行两天", category: "旅行", platform: "马蜂窝", daysAgo: 14, statusTag: "已试" },
  { title: "镰仓一日", desc: "江之电+海岸线", category: "旅行", platform: "小红书", daysAgo: 95 },
  { title: "清迈古城", desc: "寺庙+咖啡慢游", category: "旅行", platform: "携程", daysAgo: 220 },

  // —— 发型 ——
  { title: "锁骨发", desc: "好打理，显脸小", category: "发型", platform: "小红书", daysAgo: 9, statusTag: "想要" },
  { title: "奶茶棕", desc: "低调不挑皮", category: "发型", platform: "抖音", daysAgo: 33 },
  { title: "法式烫", desc: "蓬松氛围感", category: "发型", platform: "小红书", daysAgo: 120, featured: true },
  { title: "狼尾剪", desc: "酷一点试试", category: "发型", platform: "微博", daysAgo: 55 },

  // —— 家居 ——
  { title: "原木书架", desc: "开放格，随手放书", category: "家居", platform: "小红书", daysAgo: 16, featured: true, statusTag: "已买", x: 20, y: 180, img: "cover-shelf.jpg" },
  { title: "香薰蜡烛", desc: "雪松味，助眠", category: "家居", platform: "小红书", daysAgo: 100 },
  { title: "亚麻沙发套", desc: "可拆洗，耐脏", category: "家居", platform: "抖音", daysAgo: 25, statusTag: "已试" },
  { title: "藤编收纳", desc: "杂物也有秩序", category: "家居", platform: "小红书", daysAgo: 140, featured: true, x: 284, y: 180, img: "cover-rattan.jpg" },

  // —— 画画 ——
  { title: "水彩小景", desc: "周末随手画", category: "画画", platform: "小红书", daysAgo: 11, statusTag: "已试" },
  { title: "速写本", desc: "随身带，画路人", category: "画画", platform: "B站", daysAgo: 88, featured: true, x: 20, y: 180, img: "cover-sketch.jpg" },
  { title: "色铅笔", desc: "72色，够用很久", category: "画画", platform: "豆瓣", daysAgo: 45 },
  { title: "插画课", desc: "系统学构图", category: "画画", platform: "B站", daysAgo: 160 },

  // —— 手工 ——
  // 手工同属 b2 / b3 两个画板，落点要避开两张家居卡，因此给到第三格
  { title: "戳戳绣", desc: "解压，一朵小花", category: "手工", platform: "小红书", daysAgo: 7, featured: true, statusTag: "已试", x: 548, y: 180, img: "cover-punch.jpg" },
  { title: "黏土杯垫", desc: "莫兰迪色一套", category: "手工", platform: "抖音", daysAgo: 70 },
  { title: "手账拼贴", desc: "票根+胶带", category: "手工", platform: "小红书", daysAgo: 125, featured: true },
  { title: "羊毛毡", desc: "戳一只小熊", category: "手工", platform: "豆瓣", daysAgo: 190 },

  // —— 读书 ——
  { title: "存在主义咖啡馆", desc: "轻松的哲学入门", category: "读书", platform: "豆瓣", daysAgo: 20, statusTag: "已买" },
  { title: "被讨厌的勇气", desc: "课题分离", category: "读书", platform: "豆瓣", daysAgo: 105 },
  { title: "置身事内", desc: "看懂中国经济", category: "读书", platform: "豆瓣", daysAgo: 50, featured: true },
  { title: "沉默的大多数", desc: "王小波杂文", category: "读书", platform: "豆瓣", daysAgo: 170 },

  // —— 电影 ——
  { title: "花样年华", desc: "旗袍与暧昧", category: "电影", platform: "豆瓣", daysAgo: 13, statusTag: "想要" },
  { title: "小森林", desc: "自给自足的治愈", category: "电影", platform: "B站", daysAgo: 90, featured: true },
  { title: "海街日记", desc: "是枝裕和，慢生活", category: "电影", platform: "豆瓣", daysAgo: 135 },
  { title: "地球最后的夜晚", desc: "3D长镜头", category: "电影", platform: "豆瓣", daysAgo: 210 },
];

/**
 * 为种子数据生成「原帖链接」。
 * 真实场景下用户粘贴的是具体笔记链接（小红书/抖音某篇笔记）；
 * 这里用各平台的站内搜索页代替，保证链接真实可跳转、可验证功能。
 */
function linkFor(s: Seed): string {
  const q = encodeURIComponent(s.title);
  switch (s.platform) {
    case "小红书":
      return `https://www.xiaohongshu.com/search_result?keyword=${q}`;
    case "抖音":
      return `https://www.douyin.com/search/${q}`;
    case "B站":
      return `https://search.bilibili.com/all?keyword=${q}`;
    case "豆瓣":
      if (s.category === "读书")
        return `https://search.douban.com/book/subject_search?search_text=${q}`;
      if (s.category === "电影")
        return `https://search.douban.com/movie/subject_search?search_text=${q}`;
      return `https://www.douban.com/search?q=${q}`;
    case "马蜂窝":
      return `https://www.mafengwo.cn/search/q.php?q=${q}`;
    case "携程":
      return `https://you.ctrip.com/searchsite/all?query=${q}`;
    case "微博":
      return `https://s.weibo.com/weibo?q=${q}`;
    default:
      return `https://www.xiaohongshu.com/search_result?keyword=${q}`;
  }
}

export function buildSeedIdeas(): Idea[] {
  const now = Date.now();
  return SEED.map((s, i) => ({
    id: `i${i + 1}`,
    title: s.title,
    desc: s.desc,
    category: s.category,
    platform: s.platform,
    color: PALETTE[i % PALETTE.length],
    createdAt: now - s.daysAgo * DAY,
    featured: !!s.featured,
    statusTag: s.statusTag,
    link: linkFor(s),
    x: s.x,
    y: s.y,
    image: s.img ? `/uploads/${s.img}` : undefined,
  }));
}

export const SEED_BOARDS: Board[] = [
  { id: "b1", name: "美貌", categories: ["穿搭", "美妆", "发型"], themeText: "本周主题：通勤也要有质感，少买多穿。" },
  { id: "b2", name: "美家", categories: ["家居", "手工"], themeText: "把家变成想回去的地方。" },
  { id: "b3", name: "动手做", categories: ["画画", "手工", "读书"], themeText: "动手，比想更解压。" },
];
