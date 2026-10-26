const { app, BrowserWindow, Menu, shell } = require("electron");
const path = require("path");

const APP_URL = process.env.LEDGERWATCH_URL || "https://www.useledgerwatch.co/app";
const ORIGIN = new URL(APP_URL).origin;
const APP_ID = "co.useledgerwatch.desktop";

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

app.setAppUserModelId(APP_ID);

let win = null;

function userAgentFor(contents) {
  const base = contents
    .getUserAgent()
    .replace(/ ?Electron\/[\d.]+/i, "")
    .replace(/ ?ledgerwatch(-desktop)?\/[\d.]+/i, "")
    .trim();
  return `${base} LedgerWatchDesktop/${app.getVersion()}`;
}

function isHttps(url) {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 360,
    minHeight: 600,
    title: "LedgerWatch",
    icon: path.join(__dirname, "icons", "icon.png"),
    backgroundColor: "#F7F7F7",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.webContents.setUserAgent(userAgentFor(win.webContents));

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(ORIGIN)) {
      win.loadURL(url);
      return { action: "deny" };
    }
    if (isHttps(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (!isHttps(url)) event.preventDefault();
  });

  win.webContents.on("did-fail-load", (event, code, description, validatedUrl, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    win.loadFile(path.join(__dirname, "offline.html"), { query: { reason: description, url: APP_URL } });
  });

  win.webContents.on("page-title-updated", (event) => event.preventDefault());

  win.once("ready-to-show", () => win.show());
  win.on("closed", () => {
    win = null;
  });

  win.loadURL(APP_URL);
}

app.on("second-instance", () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
