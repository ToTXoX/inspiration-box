import { useEffect, useRef, useState } from "react";
import { Modal, Form, Input, Select, Upload, App } from "antd";
import type { UploadProps } from "antd";
import { useStore } from "../store/useStore";
import { PLATFORMS, CategoryId, Platform, Idea } from "../types";
import { Plus, Pencil } from "../icons";
import { SmartImage, CoverPlaceholder } from "./SmartImage";
import { cancelPreview, extractSharedURL, previewLink, saveUploadedImage } from "../lib/desktop";

const PLATFORM_MAP: Record<string, Platform> = {
  "xiaohongshu.com": "小红书",
  "xhslink.com": "小红书",
  "douyin.com": "抖音",
  "iesdouyin.com": "抖音",
  "mafengwo.cn": "马蜂窝",
  "ctrip.com": "携程",
  "trip.com": "携程",
  "weibo.com": "微博",
  "weibo.cn": "微博",
  "douban.com": "豆瓣",
  "bilibili.com": "B站",
  "b23.tv": "B站",
};

function detectPlatform(link: string): Platform | null {
  try {
    const h = new URL(link).hostname.toLowerCase();
    for (const k of Object.keys(PLATFORM_MAP)) if (h === k || h.endsWith(`.${k}`)) return PLATFORM_MAP[k];
    return null;
  } catch {
    return null;
  }
}

export default function AddIdeaModal({
  open,
  onClose,
  defaultCategory,
  edit,
}: {
  open: boolean;
  onClose: () => void;
  defaultCategory?: CategoryId;
  /** 传入即进入「编辑」模式：预填该卡片字段，保存走 updateIdea */
  edit?: Idea;
}) {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const addIdea = useStore((s) => s.addIdea);
  const updateIdea = useStore((s) => s.updateIdea);
  const categories = useStore((s) => s.categories);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [thumb, setThumb] = useState<string | null>(null);
  // 预览图对应的原笔记页地址（图片代理用作伪装 Referer，绕过图床防盗链）
  const [thumbRef, setThumbRef] = useState<string | null>(null);
  const [linkState, setLinkState] = useState<
    "idle" | "loading" | "ok" | "noimg" | "error"
  >("idle");
  const previewTimer = useRef<number>();
  const previewAbort = useRef<AbortController | null>(null);
  const previewID = useRef<string | null>(null);
  const generation = useRef(0);
  const uploadGeneration = useRef(0);
  const autoTitle = useRef<string | null>(null);
  const autoImage = useRef<string | null>(null);
  const [linkError, setLinkError] = useState("");

  const stopPreview = () => {
    generation.current += 1;
    window.clearTimeout(previewTimer.current);
    previewAbort.current?.abort();
    previewAbort.current = null;
    cancelPreview(previewID.current);
    previewID.current = null;
  };

  useEffect(() => () => { stopPreview(); uploadGeneration.current += 1; }, []);

  useEffect(() => {
    stopPreview();
    uploadGeneration.current += 1;
    setUploading(false);
    autoTitle.current = null;
    autoImage.current = null;
    setLinkError("");
    if (open) {
      if (edit) {
        // 编辑模式：用现有卡片预填
        form.setFieldValue("title", edit.title);
        form.setFieldValue("desc", edit.desc ?? "");
        form.setFieldValue("category", edit.category);
        form.setFieldValue("platform", edit.platform);
        form.setFieldValue("link", edit.link ?? "");
        form.setFieldValue("image", edit.image ?? "");
        setThumb(edit.image ?? null);
        setThumbRef(edit.link ?? null);
        setLinkState(edit.image ? "ok" : "idle");
      } else {
        form.setFieldValue("category", defaultCategory ?? categories[0]);
        if (!form.getFieldValue("platform")) form.setFieldValue("platform", "小红书");
      }
    } else {
      setThumb(null);
      setThumbRef(null);
      setLinkState("idle");
      form.resetFields();
    }
  }, [open, defaultCategory, form, edit?.id]);

  const handleOk = async () => {
    if (uploading || linkState === "loading") return;
    try {
      const v = await form.validateFields();
      setLoading(true);
      if (edit) {
        updateIdea(edit.id, {
          title: v.title,
          desc: v.desc,
          category: v.category as CategoryId,
          platform: v.platform as Platform,
          image: v.image?.trim() || undefined,
          link: v.link?.trim() || undefined,
        });
        message.success("已保存修改");
      } else {
        addIdea({
          title: v.title,
          desc: v.desc,
          category: v.category as CategoryId,
          platform: v.platform as Platform,
          image: v.image?.trim() || undefined,
          link: v.link?.trim() || undefined,
        });
        message.success("已收藏到灵感匣");
      }
      form.resetFields();
      setThumb(null);
      setThumbRef(null);
      onClose();
    } catch {
      /* 校验失败 */
    } finally {
      setLoading(false);
    }
  };

  const parseLink = (text: string) => {
    stopPreview();
    const token = generation.current;
    const val = extractSharedURL(text);
    setLinkError("");
    // Only replace fields we filled automatically; user edits and uploaded covers survive.
    if (autoTitle.current && form.getFieldValue("title") === autoTitle.current) form.setFieldValue("title", "");
    if (autoImage.current && form.getFieldValue("image") === autoImage.current) {
      form.setFieldValue("image", "");
      setThumb(null);
      setThumbRef(null);
    }
    autoTitle.current = null;
    autoImage.current = null;
    if (!val) {
      setLinkState("idle");
      return;
    }
    const platform = detectPlatform(val);
    if (platform) form.setFieldValue("platform", platform);
    // 直接图片链接：无需请求，直接作为封面
    if (/\.(jpg|jpeg|png|gif|webp|avif|svg)(\?.*)?$/i.test(val)) {
      if (!form.getFieldValue("image")) {
        form.setFieldValue("image", val);
        autoImage.current = val;
        setThumb(val);
      }
      setLinkState("ok");
      return;
    }
    setLinkState("loading");
    previewTimer.current = window.setTimeout(async () => {
      const id = `preview-${Date.now()}-${token}`;
      const controller = new AbortController();
      previewID.current = id;
      previewAbort.current = controller;
      try {
        const d = await previewLink(val, id, controller.signal);
        if (generation.current !== token) return;
        if (d.title && !form.getFieldValue("title")) {
          form.setFieldValue("title", d.title);
          autoTitle.current = d.title;
        }
        if (d.image && !form.getFieldValue("image")) {
          form.setFieldValue("image", d.image);
          autoImage.current = d.image;
          setThumb(d.image);
          setThumbRef(d.finalUrl || val);
        }
        setLinkState(d.image ? "ok" : "noimg");
        const p = detectPlatform(d.finalUrl || val) ?? detectPlatform(val);
        if (p) form.setFieldValue("platform", p);
      } catch (error) {
        if (generation.current !== token) return;
        setLinkError(error instanceof Error ? error.message : "解析失败，请重试。");
        setLinkState("error");
      } finally {
        if (generation.current === token) { previewID.current = null; previewAbort.current = null; }
      }
    }, 600);
  };
  const onLinkChange = (e: React.ChangeEvent<HTMLInputElement>) => parseLink(e.target.value);

  const uploadProps: UploadProps = {
    accept: "image/*",
    showUploadList: false,
    beforeUpload: (file) => {
      const token = ++uploadGeneration.current;
      const localUrl = URL.createObjectURL(file);
      setThumb(localUrl);
      setThumbRef(null);
      setUploading(true);
      autoImage.current = null;
      saveUploadedImage(file)
        .then((url) => {
          if (uploadGeneration.current !== token) return;
          form.setFieldValue("image", url);
          setThumb(url);
          message.success("图片已保存");
        })
        .catch((error) => {
          if (uploadGeneration.current !== token) return;
          setThumb(form.getFieldValue("image") || null);
          message.error(error instanceof Error ? error.message : "图片保存失败");
        })
        .finally(() => {
          URL.revokeObjectURL(localUrl);
          if (uploadGeneration.current === token) setUploading(false);
        })
      return false; // 阻止 antd 自动上传，改用手动 fetch
    },
  };

  return (
    <Modal
      title={edit ? "编辑灵感" : "收藏一条灵感"}
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      okText={edit ? "保存" : "收藏"}
      cancelText="取消"
      confirmLoading={loading}
      okButtonProps={{ disabled: uploading || linkState === "loading" }}
      centered
    >
      <Form form={form} layout="vertical" className="pt-2">
        <Form.Item
          name="title"
          label="标题"
          rules={[{ required: true, message: "写点什么吧" }]}
        >
          <Input placeholder="例如：真丝衬衫 / 可自动从链接获取" maxLength={40} />
        </Form.Item>
        <Form.Item name="desc" label="描述（可选）">
          <Input.TextArea
            placeholder="补充说明…"
            autoSize={{ minRows: 2, maxRows: 4 }}
            maxLength={200}
          />
        </Form.Item>

        {/* 上传图片 */}
        <div className="mb-1 text-t4 font-medium text-brown">图片（选填）</div>
        <div className="flex items-center gap-3">
          <Upload {...uploadProps} disabled={uploading}>
            <button
              type="button"
              className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border bg-mint-soft/40 text-mint transition-colors hover:border-mint"
            >
              {uploading ? (
                <span className="text-t5">上传中…</span>
              ) : (
                <>
                  <Plus size={22} />
                  <span className="text-t6">上传</span>
                </>
              )}
            </button>
          </Upload>
          {thumb && (
            <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-border bg-mint-soft/40">
              <SmartImage
                src={thumb}
                refUrl={thumbRef ?? undefined}
                alt="预览"
                className="h-full w-full object-cover"
                fallback={<CoverPlaceholder compact />}
              />
            </div>
          )}
          <span className="text-t5 leading-relaxed text-warmgray">
            点击上传本地图片
            <br />
            或粘贴下方链接自动抓封面
          </span>
        </div>

        {/* 链接 */}
        <Form.Item name="link" label="其他平台笔记链接（选填）" className="mt-4"
          normalize={(value: string) => extractSharedURL(value) ?? value.trim()}
          rules={[{ validator: async (_, value: string) => {
            if (value && !extractSharedURL(value)) throw new Error("请粘贴有效的网页链接。");
          } }]}
        >
          <Input
            placeholder="粘贴网址或分享文案，自动获取标题与封面"
            onChange={onLinkChange}
            maxLength={4000}
          />
        </Form.Item>
        <div className="-mt-2 mb-1 text-t5 leading-snug">
          {linkState === "loading" && (
            <span className="text-warmgray">正在解析链接，自动抓取主图…</span>
          )}
          {linkState === "ok" && (
            <span className="text-mint">✓ 预览已获取，可检查标题和封面后收藏</span>
          )}
          {linkState === "noimg" && (
            <span className="text-warmgray">
              该链接未提供主图，可点上方「上传」选一张封面（不影响收藏）
            </span>
          )}
          {linkState === "error" && (
            <span style={{ color: "#C25C5C" }}>
              {linkError} 可手动填写并上传封面。
              <button type="button" className="ml-2 underline" onClick={() => parseLink(form.getFieldValue("link") || "")}>重试解析</button>
            </span>
          )}
        </div>

        {/* 隐藏 image 字段，由上传或链接解析写入 */}
        <Form.Item name="image" hidden>
          <Input />
        </Form.Item>

        <div className="flex gap-3">
          <Form.Item
            name="category"
            label="分类"
            className="flex-1"
            rules={[{ required: true }]}
          >
            <Select
              placeholder="选择分类"
              options={categories.map((c) => ({ value: c, label: c }))}
            />
          </Form.Item>
          <Form.Item
            name="platform"
            label="来源"
            className="flex-1"
            rules={[{ required: true }]}
          >
            <Select
              placeholder="来源平台"
              options={PLATFORMS.map((p) => ({ value: p, label: p }))}
            />
          </Form.Item>
        </div>
      </Form>
    </Modal>
  );
}
