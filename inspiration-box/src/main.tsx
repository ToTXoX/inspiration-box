import React from "react";
import ReactDOM from "react-dom/client";
import { ConfigProvider, App as AntdApp } from "antd";
import App from "./App";
import "./index.css";

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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider theme={theme}>
      <AntdApp>
        <App />
      </AntdApp>
    </ConfigProvider>
  </React.StrictMode>
);
