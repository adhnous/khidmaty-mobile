export function normalizeEmail(input: unknown): string {
  return String(typeof input === "string" ? input : "")
    .trim()
    .toLowerCase();
}

export function normalizePhone(input: unknown): string | null {
  const raw = String(typeof input === "string" ? input : "").trim();
  if (!raw) return null;

  const hasPlus = raw.startsWith("+");
  const has00 = raw.startsWith("00");

  const digits = raw.replace(/[^\d]+/g, "");
  if (!digits) return null;

  let e164 = "";
  if (hasPlus) e164 = `+${digits}`;
  else if (has00) e164 = `+${digits.slice(2)}`;
  else return null;

  if (!/^\+\d{8,15}$/.test(e164)) return null;
  return e164;
}

export function isProbablyEmail(input: unknown): boolean {
  return normalizeEmail(input).includes("@");
}

