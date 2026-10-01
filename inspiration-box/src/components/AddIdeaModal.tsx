import { useEffect, useRef, useState } from "react";
import { Modal, Form, Input, Select, Upload, App } from "antd";
import type { UploadProps } from "antd";
import { useStore } from "../store/useStore";
import { PLATFORMS, CategoryId, Platform, Idea } from "../types";
import { Plus, Pencil } from "../icons";
import { SmartImage, CoverPlaceholder } from "./SmartImage";

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
    for (const k of Object.keys(PLATFORM_MAP)) if (h.includes(k)) return PLATFORM_MAP[k];
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

  useEffect(() => {
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
  }, [open, defaultCategory, form, edit]);

  const handleOk = async () => {
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

  // 链接解析（防抖）：自动填标题/封面、识别平台
  const onLinkChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    window.clearTimeout(previewTimer.current);
    if (!/^https?:\/\//i.test(val)) {
      setLinkState("idle");
      return;
    }
    // 直接图片链接：无需请求，直接作为封面
    if (/\.(jpg|jpeg|png|gif|webp|avif|svg)(\?.*)?$/i.test(val)) {
      form.setFieldValue("image", val);
      setThumb(val);
      setLinkState("ok");
      return;
    }
    setLinkState("loading");
    previewTimer.current = window.setTimeout(async () => {
      try {
        const r = await fetch(`/api/preview?url=${encodeURIComponent(val)}`);
        const d = await r.json();
        if (d.title && !form.getFieldValue("title")) form.setFieldValue("title", d.title);
        if (d.image && !form.getFieldValue("image")) {
          form.setFieldValue("image", d.image);
          setThumb(d.image);
          setThumbRef(d.finalUrl || val);
          setLinkState("ok");
        } else {
          setLinkState("noimg");
        }
        const p = detectPlatform(val);
        if (p) form.setFieldValue("platform", p);
      } catch {
        setLinkState("error");
      }
    }, 600);
  };

  const uploadProps: UploadProps = {
    accept: "image/*",
    showUploadList: false,
    beforeUpload: (file) => {
      const localUrl = URL.createObjectURL(file);
      setThumb(localUrl);
      setThumbRef(null);
      setUploading(true);
      const fd = new FormData();
      fd.append("file", file);
      fetch("/api/upload", { method: "POST", body: fd })
        .then((r) => r.json())
        .then((d) => {
          if (d.url) form.setFieldValue("image", d.url);
          message.success("图片已上传");
        })
        .catch(() => message.error("上传失败"))
        .finally(() => setUploading(false));
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
        <Form.Item name="link" label="其他平台笔记链接（选填）" className="mt-4">
          <Input
            placeholder="https:// 粘贴小红书 / 豆瓣…链接，自动识别平台与封面"
            onChange={onLinkChange}
            maxLength={500}
          />
        </Form.Item>
        <div className="-mt-2 mb-1 text-t5 leading-snug">
          {linkState === "loading" && (
            <span className="text-warmgray">正在解析链接，自动抓取主图…</span>
          )}
          {linkState === "ok" && (
            <span className="text-mint">✓ 已自动抓取链接主图，将作为卡片封面</span>
          )}
          {linkState === "noimg" && (
            <span className="text-warmgray">
              该链接未提供主图，可点上方「上传」选一张封面（不影响收藏）
            </span>
          )}
          {linkState === "error" && (
            <span style={{ color: "#C25C5C" }}>
              该平台不允许抓取封面，可点上方「上传」选一张（不影响收藏）
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
