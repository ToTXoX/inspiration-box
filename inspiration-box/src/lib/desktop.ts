import type { StateStorage } from "zustand/middleware";

declare global {
  interface Window {
    webkit?: { messageHandlers?: { inspiration?: { postMessage: (body: unknown) => Promise<unknown> } } };
    __inspirationFlush?: () => Promise<void>;
  }
}

export const isDesktop = () => Boolean(window.webkit?.messageHandlers?.inspiration);

async function nativeCall<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  const handler = window.webkit?.messageHandlers?.inspiration;
  if (!handler) throw new Error("请在灵感匣 macOS 客户端中使用此功能。");
  try {
    return await handler.postMessage({ method, ...args }) as T;
  } catch (error) {
    const message = error && typeof error === "object" && "message" in error ? String(error.message) : String(error);
    throw new Error(message);
  }
}

export interface PreviewResult {
  title?: string; image?: string; images?: string[]; finalUrl?: string; description?: string; warning?: string;
}

export function extractSharedURL(text: string): string | null {
  const match = text.replace(/\\&/g, "&").match(/https?:\/\/[^\s<>"'，。；！？【】「」“”]+/i);
  if (!match) return null;
  const value = match[0].replace(/[)\],;.]+$/, "");
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && url.hostname ? url.href : null;
  } catch { return null; }
}

export async function previewLink(url: string, requestID: string, signal: AbortSignal): Promise<PreviewResult> {
  if (isDesktop()) return nativeCall<PreviewResult>("preview", { url, requestID });
  const response = await fetch(`/api/preview?url=${encodeURIComponent(url)}`, { signal });
  if (!response.ok) throw new Error("链接解析失败，请重试或在 macOS 客户端中收藏。");
  const result = await response.json();
  if (result.error) throw new Error("未能获取链接预览，请重试。");
  return result;
}

export function cancelPreview(requestID: string | null) {
  if (requestID && isDesktop()) void nativeCall("cancelPreview", { requestID }).catch(() => {});
}

export async function saveUploadedImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/") || file.size > 12 * 1024 * 1024) {
    throw new Error("请选择不超过 12 MB 的图片。");
  }
  if (isDesktop()) {
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = () => reject(new Error("图片读取失败。"));
      reader.readAsDataURL(file);
    });
    return nativeCall<string>("saveImage", { base64 });
  }
  const data = new FormData();
  data.append("file", file);
  const response = await fetch("/api/upload", { method: "POST", body: data });
  if (!response.ok) throw new Error("图片上传失败。");
  const result = await response.json();
  if (typeof result.url !== "string") throw new Error("图片上传未完成，请重试。");
  return result.url;
}

let pendingState: { value: string } | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saving: Promise<void> | null = null;

function reportSaveError(message: string | null) {
  window.dispatchEvent(new CustomEvent("inspiration-save-status", { detail: message }));
}

export async function flushDesktopState(): Promise<void> {
  clearTimeout(saveTimer);
  if (saving) return saving;
  saving = (async () => {
    while (pendingState) {
      const current = pendingState;
      await nativeCall("writeState", { value: current.value });
      if (pendingState === current) pendingState = null;
    }
    reportSaveError(null);
  })().catch((error: Error) => {
    reportSaveError(error.message);
    throw error;
  }).finally(() => { saving = null; });
  await saving;
}

export const appStorage: StateStorage = {
  getItem: (name) => isDesktop() ? nativeCall<string | null>("readState") : localStorage.getItem(name),
  setItem: (name, value) => {
    if (!isDesktop()) { localStorage.setItem(name, value); return; }
    pendingState = { value };
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { void flushDesktopState().catch(() => {}); }, 200);
  },
  removeItem: (name) => {
    if (isDesktop()) throw new Error("客户端暂不提供清空存储操作。");
    localStorage.removeItem(name);
  },
};

window.__inspirationFlush = flushDesktopState;
