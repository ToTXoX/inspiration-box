import { useLocation, useNavigate } from "react-router-dom";

const SEGMENTS = [
  { no: "01", label: "博物架", match: (p: string) => p === "/", to: "/" },
  {
    no: "02",
    label: "灵感库",
    match: (p: string) => p.startsWith("/category"),
    to: "/category/穿搭",
  },
  {
    no: "03",
    label: "主题画板",
    match: (p: string) => p.startsWith("/board"),
    to: "/board/b1",
  },
];

export default function BottomNav() {
  const { pathname } = useLocation();
  const nav = useNavigate();
  const activeIdx = SEGMENTS.findIndex((s) => s.match(pathname));

  return (
    <div className="fixed bottom-6 left-0 right-0 z-30 flex justify-center pointer-events-none">
      <nav className="pointer-events-auto flex gap-1 rounded-[26px] bg-white border border-border p-1 shadow-[0_8px_24px_-4px_rgba(0,0,0,0.1)]">
        {SEGMENTS.map((s, i) => {
          const active = i === activeIdx;
          return (
            <button
              key={s.label}
              onClick={() => nav(s.to)}
              className={[
                "flex items-center gap-1 rounded-2xl px-[18px] py-2.5 transition-colors",
                active ? "bg-mint text-white" : "text-brown hover:bg-mint-soft/60",
              ].join(" ")}
            >
              <span
                className={[
                  "text-t6 leading-none",
                  active ? "text-white/85" : "text-warmgray",
                ].join(" ")}
              >
                {s.no}
              </span>
              <span
                className={[
                  "text-t3",
                  active ? "font-semibold" : "font-normal",
                ].join(" ")}
              >
                {s.label}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
