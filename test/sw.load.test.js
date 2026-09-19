// Reproduces the MV3 service-worker environment: shared.js and background.js evaluated as classic scripts in ONE global scope.
const vm = require("vm"), fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
let listener = null;
const ctx = vm.createContext({ console, fetch, crypto: globalThis.crypto,
  chrome: { storage: { sync: { get: async d => d }, local: { get: async d => (typeof d === "object" ? d : {}), set: async () => {} } },
            runtime: { onMessage: { addListener: fn => { listener = fn; } }, onInstalled: { addListener() {} }, openOptionsPage() {} },
            action: { setBadgeText() {}, setBadgeBackgroundColor() {} } } });
ctx.globalThis = ctx;
ctx.importScripts = f => vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f });
vm.runInContext(fs.readFileSync(path.join(root, "background.js"), "utf8"), ctx, { filename: "background.js" });
if (typeof listener !== "function") { console.log("FAIL: no onMessage listener registered"); process.exit(1); }
console.log("PASS: background.js evaluates in a shared global scope and registers its listener");
