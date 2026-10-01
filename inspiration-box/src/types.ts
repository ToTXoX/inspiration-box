/** 默认分类（种子）；用户可新建，实际分类列表以 store.categories 为准 */
export const CATEGORIES = [
  "穿搭",
  "美妆",
  "旅行",
  "发型",
  "家居",
  "画画",
  "手工",
  "读书",
  "电影",
] as const;

/** 分类为动态（可新建），故用 string 而非联合类型 */
export type CategoryId = string;

/** 灵感状态标签（可点击切换） */
export const STATUS_TAGS = ["想要", "已买", "已试", "已去"] as const;
export type StatusTag = (typeof STATUS_TAGS)[number];

/** 默认状态：未打过标的卡片统一显示「想要」 */
export const DEFAULT_STATUS_TAG: StatusTag = "想要";

/** 旧版词表兼容，用于迁移历史本地数据 */
export const LEGACY_STATUS_MAP: Record<string, StatusTag> = {
  还在想要: "想要",
  进行中: "已试",
  已购: "已买",
};

export const PLATFORMS = [
  "小红书",
  "抖音",
  "马蜂窝",
  "携程",
  "微博",
  "豆瓣",
  "B站",
  "个人文件夹",
  "其它",
] as const;
export type Platform = (typeof PLATFORMS)[number];

export interface Idea {
  id: string;
  title: string;
  desc?: string;
  category: CategoryId;
  platform: Platform;
  color: string; // 卡片图占位色
  image?: string; // 卡片图（上传的图片链接 或 抓取到的封面图）
  link?: string; // 原始笔记链接（其他平台）
  createdAt: number; // 时间戳
  featured: boolean; // 是否精选（红心 / 喜欢）
  featuredAt?: number; // 点亮「喜欢」的时间戳，用于灵感库「置顶」排序
  /**
   * 灵感库「手动排序」的名次（越小越靠前）。
   * 只在**同品类、同精选状态**的组内比较 —— 精选组整体置顶的前提由分组保证，
   * 所以精选组与未精选组的 order 各排各的、互不影响。
   * 未登记过 order 的（老数据 / 新上传）排在本组末尾。
   */
  order?: number;
  statusTag?: string; // 首页状态角标：想要 / 已买 / 已试 / 已去
  /**
   * 陈列规则（2026-09-30 起）：
   * 主题画板画布 = 该画板品类内所有 `featured` 的卡片。
   * 「精选」即「在画板陈列」，二者是同一个状态，不再有单独的手动上板。
   */
  x?: number; // 画布世界坐标（四向无限、可为负）；同一张卡在各画板共用同一落点
  y?: number;
  w?: number; // 画布上的卡片宽度；高度按内容等比例自适应
  z?: number; // 画布层序：越大越靠上（右键「置于上层/下层/顶层/底层」）
  boardId?: string | null; // 已废弃：旧版「手动上板」的归属，仅为兼容历史数据保留，不再读取
  rotation?: number; // 已废弃：无边画布下卡片不再旋转，仅为兼容旧数据保留
}

/**
 * 画布便签底色：奶油小清新一档。
 * 统一低饱和 + 高明度，保证棕色正文（#2a1c12）在每一档上都够清晰；
 * 不放进 @theme，因为它是「便签纸的颜色」，不是全局 UI 语义色。
 */
export const NOTE_COLORS = [
  { name: "奶油黄", value: "#fbf0c4" },
  { name: "奶白", value: "#f6f0e6" },
  { name: "薄荷奶", value: "#dcf0ea" },
  { name: "樱花粉", value: "#fbe2e4" },
  { name: "蜜桃", value: "#fbe1cd" },
  { name: "香芋", value: "#e9e4f5" },
] as const;

/** 便签初始底色（旧数据没有 color 字段时也回落到它） */
export const NOTE_DEFAULT_COLOR = NOTE_COLORS[0].value;

/** 画布上的文本便签（无边画布的第二类元素） */
export interface TextNote {
  id: string;
  boardId: string;
  text: string;
  /** 自由排版下的落点与宽度（世界坐标） */
  x: number;
  y: number;
  w: number; // 宽度可拖，高度随文字自适应
  /**
   * 规则排版下的落点与宽度：与自由排版**各自独立**。
   * 在规则排版里挪动便签只改这一组，不会把自由排版的位置带跑；
   * 旧数据没有这组字段时回落到 x / y / w。
   */
  gx?: number;
  gy?: number;
  gw?: number;
  z: number; // 层序（两种排版共用）
  color?: string; // 便签底色；旧数据可不填，渲染时回落 NOTE_DEFAULT_COLOR
  createdAt: number;
}

export interface Board {
  id: string;
  name: string;
  categories: CategoryId[]; // 该画板纳入的品类
  themeText?: string; // 主题文本框
  /**
   * 规则排版下的卡片阵列顺序（存卡片 id）。
   * 只影响「规则排版」的排布先后，不影响自由排版的坐标与层序；
   * 未登记的卡片按默认顺序追加在后面（所以上板 / 移出画布都不需要维护它）。
   */
  cardOrder?: string[];
  /**
   * 规则排版：**每一行各放几张**（数组按行序，和 = 当前陈列的卡片数）。
   * 每行独立 —— 第一行 6 个、第二行 4 个是允许的，不存在「一行几个就全都几个」的约束。
   * 缺省或与实际卡片数对不上时，由 `normalizeRows()` 补齐 / 裁剪。
   */
  ruleRows?: number[];
}

/** 灵感库排序方式；manual = 用户拖动卡片排出来的名次 */
export type LibrarySort = "new" | "old" | "title" | "manual";

export const DAY = 24 * 60 * 60 * 1000;
