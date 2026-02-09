import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";

// Vercel ignores any folder named `node_modules` (even inside static exports).
// Expo Web export currently places some image assets under:
//   dist/assets/node_modules/...
// which causes 404s in production. This script renames that folder and rewrites
// bundle references so the assets are served correctly.

const distDir = path.resolve(process.cwd(), "dist");
const fromDir = path.join(distDir, "assets", "node_modules");
const toDir = path.join(distDir, "assets", "nm");
const fromPrefix = "/assets/node_modules/";
const toPrefix = "/assets/nm/";
const dotEnvPath = path.resolve(process.cwd(), ".env");

function moveDir(from, to) {
  // On Windows, rename can fail with EPERM due to transient file locks.
  // Fall back to copy+delete.
  try {
    fs.renameSync(from, to);
    return;
  } catch (err) {
    const code = err?.code;
    if (code !== "EPERM" && code !== "EXDEV") throw err;
  }

  fs.cpSync(from, to, { recursive: true });
  fs.rmSync(from, { recursive: true, force: true });
}

function walkFiles(dir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkFiles(p, out);
    else if (ent.isFile()) out.push(p);
  }
  return out;
}

function replaceInFile(filePath, find, replace) {
  const buf = fs.readFileSync(filePath);
  const text = buf.toString("utf8");
  if (!text.includes(find)) return 0;
  const next = text.split(find).join(replace);
  fs.writeFileSync(filePath, next, "utf8");
  return 1;
}

function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

let crc32Table = null;

function crc32(buf) {
  if (!crc32Table) {
    crc32Table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crc32Table[i] = c >>> 0;
    }
  }

  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crc32Table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngFromRgba({ width, height, rgba }) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width >>> 0, 0);
  ihdr.writeUInt32BE(height >>> 0, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter type 0
    rgba.copy(raw, rowStart + 1, y * stride, y * stride + stride);
  }

  const idat = zlib.deflateSync(raw);

  function chunk(type, data) {
    const typeBuf = Buffer.from(type);
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length >>> 0, 0);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
    return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
  }

  return Buffer.concat([signature, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

function blendPixel({ buf, idx, r, g, b, a }) {
  if (a >= 255) {
    buf[idx] = r;
    buf[idx + 1] = g;
    buf[idx + 2] = b;
    buf[idx + 3] = 255;
    return;
  }
  if (a <= 0) return;
  const inv = 255 - a;
  buf[idx] = Math.round((r * a + buf[idx] * inv) / 255);
  buf[idx + 1] = Math.round((g * a + buf[idx + 1] * inv) / 255);
  buf[idx + 2] = Math.round((b * a + buf[idx + 2] * inv) / 255);
  buf[idx + 3] = 255;
}

function drawThickLine({ buf, size, x1, y1, x2, y2, thickness, color }) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 <= 0.000001) return;
  const radius = Math.max(1, thickness / 2);
  const radius2 = radius * radius;

  const minX = Math.max(0, Math.floor(Math.min(x1, x2) - radius - 1));
  const maxX = Math.min(size - 1, Math.ceil(Math.max(x1, x2) + radius + 1));
  const minY = Math.max(0, Math.floor(Math.min(y1, y2) - radius - 1));
  const maxY = Math.min(size - 1, Math.ceil(Math.max(y1, y2) + radius + 1));

  for (let y = minY; y <= maxY; y++) {
    const py = y + 0.5;
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;

      const wx = px - x1;
      const wy = py - y1;
      let t = (wx * dx + wy * dy) / len2;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const bx = x1 + t * dx;
      const by = y1 + t * dy;
      const ox = px - bx;
      const oy = py - by;
      const dist2 = ox * ox + oy * oy;
      if (dist2 > radius2) continue;

      const idx = (y * size + x) * 4;
      blendPixel({ buf, idx, r: color.r, g: color.g, b: color.b, a: color.a });
    }
  }
}

function generateKhidmatyIconRgba({ size }) {
  const buf = Buffer.alloc(size * size * 4);
  const bg = { r: 0xd9, g: 0x78, b: 0x00 };
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const maxDist = Math.sqrt(cx * cx + cy * cy);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.min(1, Math.sqrt(dx * dx + dy * dy) / (maxDist || 1));
      const light = 0.14 * (1 - d);
      const r = Math.round(bg.r + (255 - bg.r) * light);
      const g = Math.round(bg.g + (255 - bg.g) * light);
      const b = Math.round(bg.b + (255 - bg.b) * light);
      const idx = (y * size + x) * 4;
      buf[idx] = r;
      buf[idx + 1] = g;
      buf[idx + 2] = b;
      buf[idx + 3] = 255;
    }
  }

  const w = size;
  const h = size;
  const thickness = size * 0.12;

  const vx = w * 0.36;
  const yTop = h * 0.22;
  const yBot = h * 0.78;
  const midY = h * 0.5;
  const armX = w * 0.7;
  const armTopY = h * 0.24;
  const armBotY = h * 0.76;

  const shadow = { r: 0, g: 0, b: 0, a: 70 };
  const fg = { r: 255, g: 255, b: 255, a: 245 };
  const off = size * 0.02;

  drawThickLine({ buf, size, x1: vx + off, y1: yTop + off, x2: vx + off, y2: yBot + off, thickness, color: shadow });
  drawThickLine({
    buf,
    size,
    x1: vx + thickness * 0.05 + off,
    y1: midY + off,
    x2: armX + off,
    y2: armTopY + off,
    thickness,
    color: shadow,
  });
  drawThickLine({
    buf,
    size,
    x1: vx + thickness * 0.05 + off,
    y1: midY + off,
    x2: armX + off,
    y2: armBotY + off,
    thickness,
    color: shadow,
  });

  drawThickLine({ buf, size, x1: vx, y1: yTop, x2: vx, y2: yBot, thickness, color: fg });
  drawThickLine({
    buf,
    size,
    x1: vx + thickness * 0.05,
    y1: midY,
    x2: armX,
    y2: armTopY,
    thickness,
    color: fg,
  });
  drawThickLine({
    buf,
    size,
    x1: vx + thickness * 0.05,
    y1: midY,
    x2: armX,
    y2: armBotY,
    thickness,
    color: fg,
  });

  return buf;
}

function ensurePwaAssets() {
  const indexPath = path.join(distDir, "index.html");
  if (!fs.existsSync(indexPath)) return;

  const appName = "Khidmaty";
  const themeColor = "#D97800";
  const backgroundColor = "#ffffff";

  const icon192 = pngFromRgba({ width: 192, height: 192, rgba: generateKhidmatyIconRgba({ size: 192 }) });
  const icon512 = pngFromRgba({ width: 512, height: 512, rgba: generateKhidmatyIconRgba({ size: 512 }) });
  const appleTouch = pngFromRgba({ width: 180, height: 180, rgba: generateKhidmatyIconRgba({ size: 180 }) });

  fs.writeFileSync(path.join(distDir, "pwa-192.png"), icon192);
  fs.writeFileSync(path.join(distDir, "pwa-512.png"), icon512);
  fs.writeFileSync(path.join(distDir, "apple-touch-icon.png"), appleTouch);

  const manifest = {
    name: appName,
    short_name: appName,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: backgroundColor,
    theme_color: themeColor,
    icons: [
      { src: "/pwa-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
      { src: "/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
    ],
  };
  fs.writeFileSync(path.join(distDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

  const html = fs.readFileSync(indexPath, "utf8");
  if (html.includes('rel="manifest"')) return;

  const injected = [
    `  <link rel="manifest" href="/manifest.json" />`,
    `  <link rel="icon" href="/pwa-192.png" />`,
    `  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />`,
    `  <meta name="apple-mobile-web-app-capable" content="yes" />`,
    `  <meta name="apple-mobile-web-app-title" content="${appName}" />`,
    `  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />`,
    `  <meta name="mobile-web-app-capable" content="yes" />`,
  ].join("\n");

  const next = html.replace(/<\/head>/i, `${injected}\n</head>`);
  fs.writeFileSync(indexPath, next, "utf8");
}

function cleanString(v) {
  const s = typeof v === "string" ? v : "";
  if (!s) return "";
  return s.replace(/\\r/g, "\r").replace(/\\n/g, "\n").trim();
}

function parseDotEnv(text) {
  const out = {};
  const lines = String(text || "").split(/\r?\n/);
  for (const line of lines) {
    const raw = line.trim();
    if (!raw || raw.startsWith("#")) continue;
    const idx = raw.indexOf("=");
    if (idx === -1) continue;
    const key = raw.slice(0, idx).trim();
    let val = raw.slice(idx + 1).trim();
    if (!key) continue;
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function getEnvValue(key, dotEnvMap) {
  const fromProcess = cleanString(process.env[key]);
  if (fromProcess) return fromProcess;
  const fromFile = cleanString(dotEnvMap?.[key]);
  if (fromFile) return fromFile;

  // Monorepo compatibility: allow NEXT_PUBLIC_* to back-fill EXPO_PUBLIC_*.
  if (key.startsWith("EXPO_PUBLIC_")) {
    const nextKey = key.replace(/^EXPO_PUBLIC_/, "NEXT_PUBLIC_");
    const nextFromProcess = cleanString(process.env[nextKey]);
    if (nextFromProcess) return nextFromProcess;
    const nextFromFile = cleanString(dotEnvMap?.[nextKey]);
    if (nextFromFile) return nextFromFile;
  }

  return "";
}

function writeFirebaseMessagingServiceWorker({ dotEnvMap }) {
  const apiKey = getEnvValue("EXPO_PUBLIC_FIREBASE_API_KEY", dotEnvMap);
  const authDomain = getEnvValue("EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN", dotEnvMap);
  const projectId = getEnvValue("EXPO_PUBLIC_FIREBASE_PROJECT_ID", dotEnvMap);
  const storageBucket = getEnvValue("EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET", dotEnvMap);
  const messagingSenderId = getEnvValue("EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID", dotEnvMap);
  const appId = getEnvValue("EXPO_PUBLIC_FIREBASE_APP_ID", dotEnvMap);

  const missing = [];
  if (!apiKey) missing.push("EXPO_PUBLIC_FIREBASE_API_KEY");
  if (!authDomain) missing.push("EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN");
  if (!projectId) missing.push("EXPO_PUBLIC_FIREBASE_PROJECT_ID");
  if (!storageBucket) missing.push("EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET");
  if (!messagingSenderId) missing.push("EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID");
  if (!appId) missing.push("EXPO_PUBLIC_FIREBASE_APP_ID");
  if (missing.length > 0) {
    console.warn(`postExportWebFixes: skipping firebase-messaging-sw.js (missing ${missing.join(", ")})`);
    return;
  }

  const firebaseVersion = "10.12.2";
  const swPath = path.join(distDir, "firebase-messaging-sw.js");

  const sw = `/* eslint-disable */
/* Auto-generated by scripts/postExportWebFixes.mjs */
importScripts("https://www.gstatic.com/firebasejs/${firebaseVersion}/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/${firebaseVersion}/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: ${JSON.stringify(apiKey)},
  authDomain: ${JSON.stringify(authDomain)},
  projectId: ${JSON.stringify(projectId)},
  storageBucket: ${JSON.stringify(storageBucket)},
  messagingSenderId: ${JSON.stringify(messagingSenderId)},
  appId: ${JSON.stringify(appId)},
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const data = payload && payload.data ? payload.data : {};
  const title = (data && data.title) || "🚨 SOS Alert";
  const body = (data && data.body) || "Tap to view location";
  const eventId = (data && data.eventId) || "";
  const type = (data && data.type) || "";

  self.registration.showNotification(title, {
    body,
    data: { type, eventId },
    requireInteraction: true,
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = (event.notification && event.notification.data) || {};
  const eventId = typeof data.eventId === "string" ? data.eventId : "";
  const url = eventId ? "/?sosEventId=" + encodeURIComponent(eventId) : "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client && "navigate" in client) {
          client.navigate(url);
          if ("focus" in client) return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    }),
  );
});
`;

  fs.writeFileSync(swPath, sw, "utf8");
}

function validateFirebaseConfigInExport({ dotEnvMap }) {
  const projectId = getEnvValue("EXPO_PUBLIC_FIREBASE_PROJECT_ID", dotEnvMap);
  const messagingSenderId = getEnvValue("EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID", dotEnvMap);
  const appId = getEnvValue("EXPO_PUBLIC_FIREBASE_APP_ID", dotEnvMap);
  if (!projectId || !messagingSenderId || !appId) return;

  try {
    const jsDir = path.join(distDir, "_expo", "static", "js", "web");
    if (!fs.existsSync(jsDir)) return;

    const entries = fs.readdirSync(jsDir);
    const appEntry = entries.find((n) => /^AppEntry-[a-f0-9]+\.js$/.test(n));
    if (!appEntry) return;

    const text = fs.readFileSync(path.join(jsDir, appEntry), "utf8");
    const missing = [];
    if (!text.includes(projectId)) missing.push("projectId");
    if (!text.includes(messagingSenderId)) missing.push("messagingSenderId");
    if (!text.includes(appId)) missing.push("appId");

    if (missing.length > 0) {
      console.warn(
        `postExportWebFixes: Firebase config may be out of sync with the exported bundle (${missing.join(
          ", ",
        )} not found in ${appEntry}). Ensure EXPO_PUBLIC_FIREBASE_* env vars are set before running expo export.`,
      );
    }
  } catch (err) {
    console.warn("postExportWebFixes: failed to validate Firebase config in export:", err?.message || err);
  }
}

function main() {
  if (!fs.existsSync(distDir)) {
    console.error(`dist folder not found: ${distDir}`);
    process.exit(1);
  }

  let dotEnvMap = {};
  try {
    if (fs.existsSync(dotEnvPath)) {
      dotEnvMap = parseDotEnv(fs.readFileSync(dotEnvPath, "utf8"));
    }
  } catch {
    dotEnvMap = {};
  }

  // Move dist/assets/node_modules -> dist/assets/nm
  if (fs.existsSync(fromDir)) {
    if (fs.existsSync(toDir)) {
      fs.rmSync(toDir, { recursive: true, force: true });
    }
    moveDir(fromDir, toDir);
  }

  // Rewrite bundle references.
  const files = walkFiles(distDir).filter((p) => p.endsWith(".js"));
  let changed = 0;
  for (const f of files) {
    changed += replaceInFile(f, fromPrefix, toPrefix);
  }

  // Expo uses hashed bundle filenames and Vercel/browsers may cache them as immutable.
  // Since we just mutated the JS bundle contents, re-hash and rename AppEntry so clients
  // always fetch the updated bundle.
  try {
    const jsDir = path.join(distDir, "_expo", "static", "js", "web");
    if (fs.existsSync(jsDir)) {
      const entries = fs.readdirSync(jsDir);
      const appEntryFiles = entries.filter((n) => /^AppEntry-[a-f0-9]+\.js$/.test(n));
      for (const oldName of appEntryFiles) {
        const oldPath = path.join(jsDir, oldName);
        const buf = fs.readFileSync(oldPath);
        const nextHash = sha256Hex(buf).slice(0, 32);
        const newName = `AppEntry-${nextHash}.js`;
        if (newName === oldName) continue;

        const newPath = path.join(jsDir, newName);
        fs.writeFileSync(newPath, buf);
        fs.unlinkSync(oldPath);

        // Update index.html to point at the renamed bundle.
        const idx = path.join(distDir, "index.html");
        if (fs.existsSync(idx)) {
          replaceInFile(
            idx,
            `/_expo/static/js/web/${oldName}`,
            `/_expo/static/js/web/${newName}`,
          );
        }
      }
    }
  } catch (err) {
    console.warn("postExportWebFixes: failed to re-hash AppEntry bundle:", err?.message || err);
  }

  // Ensure firebase-messaging-sw.js exists in the static export so web push can work.
  try {
    writeFirebaseMessagingServiceWorker({ dotEnvMap });
  } catch (err) {
    console.warn("postExportWebFixes: failed to write firebase-messaging-sw.js:", err?.message || err);
  }

  // PWA manifest + icons (helps iOS "Add to Home Screen" and web push requirements).
  try {
    ensurePwaAssets();
  } catch (err) {
    console.warn("postExportWebFixes: failed to write PWA assets:", err?.message || err);
  }

  // Warn if the exported JS bundle doesn't contain the expected Firebase config.
  validateFirebaseConfigInExport({ dotEnvMap });

  console.log(`postExportWebFixes: rewrote ${changed} JS file(s)`);
}

main();
