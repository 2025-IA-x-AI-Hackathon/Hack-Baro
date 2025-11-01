import { BrowserWindow, app } from "electron";
import path from "path";
import { resolveHtmlPath } from "../util";

let dashboardWindow: BrowserWindow | null = null;

export const createDashboardWindow = (): BrowserWindow => {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.focus();
    return dashboardWindow;
  }

  const RESOURCES_PATH = app.isPackaged
    ? path.join(process.resourcesPath, "assets")
    : path.join(__dirname, "../../../assets");

  const getAssetPath = (...paths: string[]): string => {
    return path.join(RESOURCES_PATH, ...paths);
  };

  dashboardWindow = new BrowserWindow({
    show: false,
    width: 400,
    height: 600,
    resizable: false,
    title: "Progress Dashboard",
    icon: getAssetPath("icon.png"),
    webPreferences: {
      preload: app.isPackaged
        ? path.join(__dirname, "preload.js")
        : path.join(__dirname, "../../.erb/dll/preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: process.env.ELECTRON_SANDBOX === "true",
      webSecurity: true,
      enableBlinkFeatures: "SharedArrayBuffer",
    },
  });

  const baseUrl = resolveHtmlPath("index.html");
  const url = new URL(baseUrl);
  url.hash = "/dashboard";

  dashboardWindow.loadURL(url.toString());

  // Show window when ready
  dashboardWindow.once("ready-to-show", () => {
    dashboardWindow?.show();
  });

  dashboardWindow.on("closed", () => {
    dashboardWindow = null;
  });

  return dashboardWindow;
};

export const getDashboardWindow = (): BrowserWindow | null => dashboardWindow;

export const closeDashboardWindow = (): void => {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.close();
  }
};
