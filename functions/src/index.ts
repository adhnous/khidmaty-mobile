import { onCall, type CallableRequest, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp, type DocumentReference } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

initializeApp();

const db = getFirestore();
const messaging = getMessaging();

function requireAuth(request: CallableRequest<any>) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Authentication required.");
  return uid;
}

function cleanEmail(v: unknown): string {
  return String(typeof v === "string" ? v : "")
    .trim()
    .toLowerCase();
}

function normalizePhone(v: unknown): string | null {
  const raw = String(typeof v === "string" ? v : "").trim();
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

function cleanString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  const n = Math.max(1, Math.trunc(size));
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  sound?: "default";
  priority?: "high";
  channelId?: string;
  data?: Record<string, any>;
};

async function sendExpoPush(messages: ExpoPushMessage[]) {
  if (messages.length === 0) return { ok: 0, errors: [] as any[] };

  const errors: any[] = [];
  let ok = 0;

  for (const batch of chunk(messages, 100)) {
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(batch),
    });

    const json = (await res.json().catch(() => null)) as any;
    if (!res.ok) {
      errors.push({ type: "http_error", status: res.status, body: json });
      continue;
    }

    const data = Array.isArray(json?.data) ? json.data : [];
    for (let i = 0; i < data.length; i += 1) {
      const r = data[i] as any;
      if (r?.status === "ok") ok += 1;
      else errors.push({ type: "expo_error", token: cleanString(batch[i]?.to), details: r });
    }
  }

  return { ok, errors };
}

async function sendFcmWebPush(input: { tokens: string[]; eventId: string }) {
  if (input.tokens.length === 0) return { ok: 0, errors: [] as any[] };

  const errors: any[] = [];
  let ok = 0;

  for (const batch of chunk(input.tokens, 500)) {
    const res = await messaging.sendEachForMulticast({
      tokens: batch,
      data: {
        type: "sos",
        eventId: input.eventId,
        title: "🚨 SOS Alert",
        body: "Tap to view location",
      },
      webpush: {
        headers: { Urgency: "high" },
      },
    });

    ok += Number(res?.successCount ?? 0) || 0;
    const responses = Array.isArray(res?.responses) ? res.responses : [];
    for (let i = 0; i < responses.length; i += 1) {
      const r = responses[i] as any;
      if (r?.success) continue;
      const err = r?.error;
      errors.push({
        type: "fcm_error",
        token: batch[i],
        code: typeof err?.code === "string" ? err.code : "",
        message: typeof err?.message === "string" ? err.message : "",
      });
    }
  }

  return { ok, errors };
}

export const lookupUserByEmail = onCall(async (request) => {
  requireAuth(request);

  const email = cleanEmail(request.data?.email);
  if (!email || email.length > 254) throw new HttpsError("invalid-argument", "Invalid email.");

  const snap = await db.collection("users").where("email", "==", email).limit(1).get();
  const uid = snap.empty ? null : snap.docs[0]?.id || null;
  return { uid };
});

export const lookupUserByPhone = onCall(async (request) => {
  requireAuth(request);

  const phone = normalizePhone(request.data?.phone);
  if (!phone) throw new HttpsError("invalid-argument", "Invalid phone number. Use +<countrycode>... (or 00...).");

  const snap = await db.collection("phone_index").doc(phone).get();
  const uidRaw = snap.exists ? snap.get("uid") : null;
  const uid = cleanString(uidRaw);
  return { uid };
});

export const setMyPhoneNumber = onCall(async (request) => {
  const uid = requireAuth(request);

  const phone = normalizePhone(request.data?.phone);
  if (!phone) throw new HttpsError("invalid-argument", "Invalid phone number. Use +<countrycode>... (or 00...).");

  const now = Timestamp.now();
  const userRef = db.collection("users").doc(uid);
  const phoneRef = db.collection("phone_index").doc(phone);

  await db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    const existingPhone = cleanString(userSnap.exists ? userSnap.get("phone") : null);
    if (existingPhone && existingPhone !== phone) {
      throw new HttpsError("failed-precondition", "Phone number is already set for this account.");
    }

    const phoneSnap = await tx.get(phoneRef);
    const existingUid = cleanString(phoneSnap.exists ? phoneSnap.get("uid") : null);
    if (existingUid && existingUid !== uid) {
      throw new HttpsError("already-exists", "Phone number is already in use.");
    }

    if (!phoneSnap.exists) {
      tx.set(phoneRef, { uid, createdAt: now, updatedAt: now });
    } else {
      tx.set(phoneRef, { uid, updatedAt: now }, { merge: true });
    }

    tx.set(userRef, { phone, phoneUpdatedAt: now, updatedAt: now }, { merge: true });
  });

  return { phone };
});

export const sendSos = onCall(async (request) => {
  const senderUid = requireAuth(request);

  const eventId = cleanString(request.data?.eventId);
  if (!eventId) throw new HttpsError("invalid-argument", "eventId is required.");

  // Rate limit: max 3 calls per 30 minutes per sender.
  const now = Timestamp.now();
  const rateRef = db.collection("sos_rate").doc(senderUid);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(rateRef);
    const windowStart = (snap.exists ? (snap.get("windowStart") as Timestamp | undefined) : undefined) || now;
    const countRaw = snap.exists ? Number(snap.get("count") ?? 0) : 0;
    const count = Number.isFinite(countRaw) ? Math.max(0, Math.trunc(countRaw)) : 0;

    const windowMs = 30 * 60 * 1000;
    const withinWindow = now.toMillis() - windowStart.toMillis() < windowMs;
    const nextWindowStart = withinWindow ? windowStart : now;
    const nextCount = withinWindow ? count + 1 : 1;

    if (withinWindow && count >= 3) throw new HttpsError("resource-exhausted", "Rate limit exceeded. Try again later.");

    tx.set(rateRef, { windowStart: nextWindowStart, count: nextCount }, { merge: true });
  });

  const eventRef = db.collection("sos_events").doc(eventId);
  const eventSnap = await eventRef.get();
  if (!eventSnap.exists) throw new HttpsError("not-found", "SOS event not found.");

  const event = eventSnap.data() as any;
  if (cleanString(event?.senderUid) !== senderUid) {
    throw new HttpsError("permission-denied", "Not allowed to send this SOS.");
  }

  const contactsSnap = await db.collection("trusted").doc(senderUid).collection("contacts").where("status", "==", "accepted").get();
  const trustedUids = contactsSnap.docs.map((d) => d.id).filter(Boolean);

  if (trustedUids.length === 0) {
    return { sent: 0, recipients: 0, tokens: 0, expoTokens: 0, webTokens: 0, errors: 0 };
  }

  const tokenDocs = await Promise.all(
    trustedUids.map(async (trustedUid) => {
      const snap = await db.collection("devices").doc(trustedUid).collection("tokens").get();
      return snap.docs
        .map((d) => ({
          ref: d.ref,
          expoPushToken: cleanString(d.get("expoPushToken")),
          webPushToken: cleanString(d.get("webPushToken")),
        }))
        .filter((x) => !!x.expoPushToken || !!x.webPushToken);
    }),
  );

  const expoTokenToRefs = new Map<string, DocumentReference[]>();
  const webTokenToRefs = new Map<string, DocumentReference[]>();
  for (const list of tokenDocs) {
    for (const { expoPushToken, webPushToken, ref } of list) {
      if (expoPushToken) {
        const arr = expoTokenToRefs.get(expoPushToken) || [];
        arr.push(ref);
        expoTokenToRefs.set(expoPushToken, arr);
      }
      if (webPushToken) {
        const arr = webTokenToRefs.get(webPushToken) || [];
        arr.push(ref);
        webTokenToRefs.set(webPushToken, arr);
      }
    }
  }

  const expoTokens = Array.from(expoTokenToRefs.keys());
  const webTokens = Array.from(webTokenToRefs.keys());

  const messages: ExpoPushMessage[] = expoTokens.map((t) => ({
    to: t,
    title: "🚨 SOS Alert",
    body: "Tap to view location",
    sound: "default",
    priority: "high",
    channelId: "sos",
    data: { type: "sos", eventId },
  }));

  const expoRes = await sendExpoPush(messages);
  const fcmRes = await sendFcmWebPush({ tokens: webTokens, eventId });

  // Cleanup invalid tokens.
  const invalidExpoTokens = new Set<string>();
  for (const e of expoRes.errors) {
    const token = cleanString(e?.token);
    if (!token) continue;
    const r = e?.details;
    const err = typeof r?.details?.error === "string" ? r.details.error : "";
    if (err === "DeviceNotRegistered" || err === "InvalidCredentials") invalidExpoTokens.add(token);
  }

  const invalidWebTokens = new Set<string>();
  for (const e of fcmRes.errors) {
    const token = cleanString(e?.token);
    if (!token) continue;
    const code = cleanString(e?.code);
    if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") {
      invalidWebTokens.add(token);
    }
  }

  if (invalidExpoTokens.size > 0) {
    const refs: DocumentReference[] = [];
    for (const t of invalidExpoTokens) refs.push(...(expoTokenToRefs.get(t) || []));
    for (const delChunk of chunk(refs, 450)) {
      const batch = db.batch();
      for (const ref of delChunk) batch.delete(ref);
      await batch.commit();
    }
  }

  if (invalidWebTokens.size > 0) {
    const refs: DocumentReference[] = [];
    for (const t of invalidWebTokens) refs.push(...(webTokenToRefs.get(t) || []));
    for (const delChunk of chunk(refs, 450)) {
      const batch = db.batch();
      for (const ref of delChunk) batch.delete(ref);
      await batch.commit();
    }
  }

  const sent = expoRes.ok + fcmRes.ok;
  const tokens = expoTokens.length + webTokens.length;
  const errors = expoRes.errors.length + fcmRes.errors.length;

  logger.info("sendSos", {
    senderUid,
    eventId,
    recipients: trustedUids.length,
    expoTokens: expoTokens.length,
    webTokens: webTokens.length,
    tokens,
    sent,
    errors,
    invalidExpoTokens: invalidExpoTokens.size,
    invalidWebTokens: invalidWebTokens.size,
  });

  return { sent, recipients: trustedUids.length, tokens, expoTokens: expoTokens.length, webTokens: webTokens.length, errors };
});
