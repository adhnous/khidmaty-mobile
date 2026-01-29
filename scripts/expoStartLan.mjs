import os from "os";
import path from "path";
import { spawn } from "child_process";
import net from "net";

function isPrivateIpv4(ip) {
  if (typeof ip !== "string") return false;
  if (ip.startsWith("10.")) return true;
  if (ip.startsWith("192.168.")) return true;
  const m = ip.match(/^172\.(\d{1,3})\./);
  if (!m) return false;
  const second = Number(m[1]);
  return second >= 16 && second <= 31;
}

function scoreCandidate(interfaceName, ip) {
  const name = String(interfaceName).toLowerCase();
  let score = 0;

  if (ip.endsWith(".1")) score -= 10;
  if (ip.startsWith("10.")) score += 5;
  if (ip.startsWith("192.168.")) score += 3;
  if (ip.startsWith("172.")) score += 2;

  if (name.includes("wi-fi") || name.includes("wifi") || name.includes("wlan") || name.includes("wireless")) {
    score += 50;
  }
  if (name.includes("ethernet")) score += 20;

  if (
    name.includes("vmware") ||
    name.includes("virtualbox") ||
    name.includes("vbox") ||
    name.includes("vethernet") ||
    name.includes("hyper-v") ||
    name.includes("docker") ||
    name.includes("wsl") ||
    name.includes("loopback") ||
    name.includes("vpn") ||
    name.includes("tailscale") ||
    name.includes("hamachi")
  ) {
    score -= 50;
  }

  if (name.includes("*")) score -= 20;

  return score;
}

function pickLanIp() {
  const net = os.networkInterfaces();
  /** @type {{ ip: string; name: string; score: number }[]} */
  const candidates = [];

  for (const [name, addrs] of Object.entries(net)) {
    for (const addr of addrs ?? []) {
      const family = typeof addr.family === "string" ? addr.family : addr.family === 4 ? "IPv4" : "IPv6";
      if (family !== "IPv4") continue;
      if (addr.internal) continue;
      if (!addr.address) continue;
      if (addr.address.startsWith("169.254.")) continue;
      if (addr.address.startsWith("127.")) continue;
      if (!isPrivateIpv4(addr.address)) continue;

      candidates.push({ ip: addr.address, name, score: scoreCandidate(name, addr.address) });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.ip ?? null;
}

function parseArg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    // Bind to all interfaces so we detect conflicts on IPv4/IPv6.
    server.listen({ port }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function pickFreePort(preferred) {
  const base = Number(preferred);
  const start = Number.isFinite(base) ? Math.trunc(base) : 8081;
  for (let port = start; port <= start + 40; port += 1) {
    // eslint-disable-next-line no-await-in-loop
    if (await isPortFree(port)) return port;
  }
  return null;
}

const clear = process.argv.includes("--clear") || process.argv.includes("-c");
const requestedIp = parseArg("--ip");
const requestedPortRaw = parseArg("--port");
const requestedPort = requestedPortRaw ? Number(requestedPortRaw) : 8081;
const ip = requestedIp || process.env.REACT_NATIVE_PACKAGER_HOSTNAME || pickLanIp();

if (!ip) {
  console.error("Could not infer a LAN IPv4 address for Expo dev server.");
  console.error("Try: npm run start:tunnel");
  process.exit(1);
}

const port = await pickFreePort(requestedPort);
if (!port) {
  console.error(`Could not find a free port starting at ${requestedPort}.`);
  console.error("Stop other Expo/Metro servers and try again.");
  process.exit(1);
}

// Prefer running the CLI through Node directly to avoid Windows `.cmd` spawn quirks.
const cliEntry = path.join(process.cwd(), "node_modules", "expo", "bin", "cli");
const cmd = process.execPath;
const args = [cliEntry, "start", "--lan", "--port", String(port)];
if (clear) args.splice(2, 0, "-c");

console.log(`Using REACT_NATIVE_PACKAGER_HOSTNAME=${ip}`);
console.log(`Using port=${port}`);
console.log(`Expected Expo Go URL: exp://${ip}:${port}`);

const child = spawn(cmd, args, {
  stdio: "inherit",
  shell: false,
  env: {
    ...process.env,
    REACT_NATIVE_PACKAGER_HOSTNAME: ip,
    // Force the URL generator to use our LAN host/port even if auto IP detection fails.
    EXPO_PACKAGER_PROXY_URL: `http://${ip}:${port}`,
  },
});

child.on("exit", (code) => {
  process.exit(typeof code === "number" ? code : 1);
});
