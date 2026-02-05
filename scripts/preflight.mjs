import fs from "fs";
import path from "path";

function fileExists(p) {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function parseEnvFile(text) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

function isLoopbackUrl(url) {
  try {
    const u = new URL(String(url || ""));
    return u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "::1";
  } catch {
    return false;
  }
}

function main() {
  const projectRoot = process.cwd();
  const envPath = path.join(projectRoot, ".env");
  const envExamplePath = path.join(projectRoot, ".env.example");
  const pkgPath = path.join(projectRoot, "package.json");

  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];

  if (!fileExists(pkgPath)) errors.push("Missing package.json (run from the repo root).");

  const pkg = fileExists(pkgPath) ? JSON.parse(fs.readFileSync(pkgPath, "utf8")) : null;
  const deps = pkg?.dependencies && typeof pkg.dependencies === "object" ? pkg.dependencies : {};

  if (!deps["expo"]) errors.push("Missing dependency: expo");
  if (!deps["expo-av"]) warnings.push("Missing dependency: expo-av (required for Panic Alarm sound).");
  if (!deps["expo-notifications"]) warnings.push("Missing dependency: expo-notifications (required for SOS push).");
  if (!deps["expo-device"]) warnings.push("Missing dependency: expo-device (required for SOS push registration).");
  if (!deps["expo-application"]) warnings.push("Missing dependency: expo-application (optional; improves device identity).");

  const sirenPath = path.join(projectRoot, "assets", "siren.wav");
  if (!fileExists(sirenPath)) errors.push("Missing asset: assets/siren.wav");

  const sosWorkflowPath = path.join(projectRoot, "docs", "n8n-sos-workflow.json");
  if (!fileExists(sosWorkflowPath)) warnings.push("Missing file: docs/n8n-sos-workflow.json (SOS webhook workflow template).");

  let env = {};
  if (!fileExists(envPath)) {
    warnings.push("Missing .env (Expo public env vars).");
  } else {
    env = parseEnvFile(fs.readFileSync(envPath, "utf8"));
  }

  const apiBase = env.EXPO_PUBLIC_API_BASE_URL || "";
  const n8nBase = env.EXPO_PUBLIC_N8N_BASE_URL || "";

  if (!apiBase) warnings.push("EXPO_PUBLIC_API_BASE_URL is not set (defaults to http://localhost:3000).");
  if (!n8nBase) warnings.push("EXPO_PUBLIC_N8N_BASE_URL is not set (defaults to http://localhost:5678).");

  if (apiBase && isLoopbackUrl(apiBase)) {
    warnings.push("EXPO_PUBLIC_API_BASE_URL points to localhost. This will not work on a real phone; use your laptop LAN IP.");
  }
  if (n8nBase && isLoopbackUrl(n8nBase)) {
    warnings.push("EXPO_PUBLIC_N8N_BASE_URL points to localhost. This will not work on a real phone; use your laptop LAN IP or a public n8n URL.");
  }

  console.log("");
  console.log("Khidmaty preflight");
  console.log("------------------");

  if (errors.length) {
    console.log("");
    console.log("Errors:");
    for (const e of errors) console.log(`- ${e}`);
  }

  if (warnings.length) {
    console.log("");
    console.log("Warnings:");
    for (const w of warnings) console.log(`- ${w}`);
  }

  console.log("");
  console.log("Next steps:");
  if (!fileExists(envPath)) {
    if (fileExists(envExamplePath)) console.log("- Copy .env.example -> .env (or run: npm run env:sync)");
    else console.log("- Create .env (or run: npm run env:sync)");
  } else {
    console.log("- If you changed .env: restart Expo (Ctrl+C then npm run start:clean:lan:ip)");
  }
  console.log("- Typecheck: npx tsc --noEmit");
  console.log("- Start Expo (LAN): npm run start:clean:lan");
  console.log("");

  process.exit(errors.length ? 1 : 0);
}

main();
