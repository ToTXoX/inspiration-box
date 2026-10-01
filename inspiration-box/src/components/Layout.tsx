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
  return (
    <div className="min-h-screen flex flex-col bg-bg">
      <ScrollToTop />
      <main className="flex-1 pb-28">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}
