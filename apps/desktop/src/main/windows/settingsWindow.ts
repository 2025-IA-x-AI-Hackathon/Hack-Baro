import { BrowserWindow, app } from "electron";
import path from "path";
import { resolveHtmlPath } from "../util";

let settingsWindow: BrowserWindow | null = null;

export const createSettingsWindow = (): BrowserWindow => {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return settingsWindow;
  }

  const RESOURCES_PATH = app.isPackaged
    ? path.join(process.resourcesPath, "assets")
    : path.join(__dirname, "../../../assets");

  const getAssetPath = (...paths: string[]): string => {
    return path.join(RESOURCES_PATH, ...paths);
  };

  settingsWindow = new BrowserWindow({
    show: false,
    width: 600,
    height: 500,
    resizable: false,
    title: "Settings",
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
  url.hash = "/settings";

  settingsWindow.loadURL(url.toString());

  // Show window when ready
  settingsWindow.once("ready-to-show", () => {
    settingsWindow?.show();
  });

  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });

  return settingsWindow;
};

export const getSettingsWindow = (): BrowserWindow | null => settingsWindow;

export const closeSettingsWindow = (): void => {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.close();
  }
};
