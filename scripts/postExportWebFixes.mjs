import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

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

function main() {
  if (!fs.existsSync(distDir)) {
    console.error(`dist folder not found: ${distDir}`);
    process.exit(1);
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

  console.log(`postExportWebFixes: rewrote ${changed} JS file(s)`);
}

main();
