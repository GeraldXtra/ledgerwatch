const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("ledgerwatchShell", { kind: "desktop", platform: process.platform });
