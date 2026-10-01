import { useEffect, useState } from "react";
import { flushDesktopState } from "../lib/desktop";

export default function PersistenceNotice() {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const handler = (event: Event) => setError((event as CustomEvent<string | null>).detail);
    window.addEventListener("inspiration-save-status", handler);
    return () => window.removeEventListener("inspiration-save-status", handler);
  }, []);
  if (!error) return null;
  return (
    <div role="alert" className="fixed bottom-24 left-1/2 z-50 flex max-w-[90vw] -translate-x-1/2 items-center gap-3 rounded-xl border border-red bg-white px-4 py-3 text-t4 text-red shadow-lg">
      <span>修改尚未保存：{error}</span>
      <button className="shrink-0 underline" onClick={() => { void flushDesktopState().catch(() => {}); }}>重试保存</button>
    </div>
  );
}
