import React from "react";
import ReactDOM from "react-dom/client";
import { ConfigProvider, App as AntdApp } from "antd";
import App from "./App";
import "./index.css";
import { useStore } from "./store/useStore";
import { flushDesktopState, isDesktop } from "./lib/desktop";

const theme = {
  token: {
    colorPrimary: "#34A9AC",
    colorText: "#2A1C12",
    colorTextSecondary: "#827569",
    borderRadius: 12,
    fontFamily:
      '"Sarasa Gothic SC","PingFang SC","Microsoft YaHei",system-ui,sans-serif',
  },
};

const root = ReactDOM.createRoot(document.getElementById("root")!);

async function startApp() {
  try {
    await useStore.persist.rehydrate();
    if (!useStore.persist.hasHydrated()) throw new Error("收藏数据未能读取，原文件已保留。");
    if (isDesktop()) {
      // Persist the initial seed only after hydration succeeds, never over an unreadable file.
      useStore.setState({});
      await flushDesktopState();
    }
    root.render(
  <React.StrictMode>
    <ConfigProvider theme={theme}>
      <AntdApp>
        <App />
      </AntdApp>
    </ConfigProvider>
  </React.StrictMode>
    );
  } catch (error) {
    root.render(
      <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 px-8 text-brown">
        <h1 className="text-t1 font-semibold">暂时无法打开收藏</h1>
        <p className="text-t4 text-warmgray">{error instanceof Error ? error.message : String(error)}</p>
        <button className="self-start rounded-pill bg-mint px-5 py-2 text-white" onClick={() => { void startApp(); }}>重试</button>
      </div>
    );
  }
}

void startApp();
