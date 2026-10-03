import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import BottomNav from "./BottomNav";

/**
 * 换页回到顶部。
 * 浏览器默认会保留滚动位置 —— 从博物架底部的「去库里翻翻」跳灵感库时，
 * 会直接落在灵感库的底部（看起来像"跳错了"）。路由一变就把滚动归零。
 */
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export default function Layout() {
  const { pathname } = useLocation();
  const workspace = pathname.startsWith("/board");
  return (
    <div className={`flex flex-col bg-bg ${workspace ? "h-dvh min-h-0 overflow-hidden" : "min-h-screen"}`}>
      <ScrollToTop />
      <main className={workspace ? "min-h-0 flex-1" : "flex-1 pb-28"}>
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}
