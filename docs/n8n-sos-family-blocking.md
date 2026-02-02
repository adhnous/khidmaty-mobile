# Khidmaty SOS: Family Group Linking + Blocking (n8n + Telegram)

Goal:
- Let a user send SOS to their **family Telegram group** (optional), otherwise fall back to the **community** group.
- Allow admins to **warn/block** abusive senders (by `deviceId`).

This stays free: Telegram bot + n8n (self-hosted) + simple storage.

## What the app sends

The mobile app sends a POST to your SOS webhook with:
- `message` (string)
- `lat` / `lon` (optional)
- `city` (optional)
- `deviceId` (string)
- `target` = `family` or `community`

## App env vars

Set in Vercel (mobile web app):
- `EXPO_PUBLIC_N8N_BASE_URL` = your n8n base url
- `EXPO_PUBLIC_N8N_SOS_WEBHOOK_PATH` = `/webhook/khidmaty-sos`
- `EXPO_PUBLIC_TELEGRAM_BOT_USERNAME` = your bot username (no @)

## Important concept

Telegram does not let the app automatically know the user’s family group.

So we use a simple linking flow:
1) User taps **Connect family group (Telegram)** in the app
2) The app opens your bot with `/start <deviceId>`
3) User adds the bot to their family group and sends `/link`
4) n8n stores: `deviceId -> familyChatId`

Now SOS can route to that group.

## Storage for links/blocks

Recommended: use n8n **Data Store** (if available in your n8n version).

Create 2 data stores:
1) `khidmaty_sos_user_device`
   - key: `tgUserId` (string)
   - value: `{ deviceId: string, linkedAt: string }`
2) `khidmaty_sos_device_prefs`
   - key: `deviceId` (string)
   - value: `{ familyChatId?: string, blocked?: boolean, blockedAt?: string, blockedReason?: string }`

If you do not have Data Store in your n8n, tell me and we will switch to Firestore (still free).

## Workflow A: Telegram Commands (Link / Block)

Trigger: **Telegram Trigger**

### A1) Handle /start <deviceId> (private chat)
When message starts with `/start` and contains a payload:
- `tgUserId = message.from.id`
- `deviceId = payload`
- Save to `khidmaty_sos_user_device`:
  - key = `String(tgUserId)`
  - value = `{ deviceId, linkedAt: new Date().toISOString() }`
- Reply to user:
  - "Connected. Now add this bot to your family group and send /link there."

### A2) Handle /link (in a group)
When message is `/link` inside a group:
- `tgUserId = message.from.id`
- Look up `khidmaty_sos_user_device` by `tgUserId`
  - If missing: reply "Open the bot from the app first (Connect), then try /link again."
- `familyChatId = message.chat.id`
- Save to `khidmaty_sos_device_prefs`:
  - key = `deviceId`
  - value = `{ familyChatId, linkedAt: ... }` (merge)
- Reply in group:
  - "Family group linked ✅"

### A3) Admin commands (community group only)
Pick ONE Telegram group/channel as your community SOS channel and note its `chatId`.

Only accept admin commands if `message.chat.id` equals that community `chatId`:
- `/block <deviceId>`:
  - set `{ blocked: true, blockedAt, blockedReason: "admin" }` in `khidmaty_sos_device_prefs`
  - reply "Blocked ✅"
- `/unblock <deviceId>`:
  - set `{ blocked: false }`
  - reply "Unblocked ✅"

Tip: include `Device: <deviceId>` in every SOS message so admins can copy/paste.

## Workflow B: SOS Webhook -> Telegram (Route + Block)

Trigger: **Webhook** `/webhook/khidmaty-sos`

Steps:
1) Normalize the payload (you already have this)
2) Read `khidmaty_sos_device_prefs` by `deviceId`
3) If `blocked === true`:
   - Respond `403` with `{ ok:false, error:"blocked" }`
4) Choose destination chatId:
   - If `target === "family"` and `familyChatId` exists -> send there
   - Else -> send to community chatId
5) Telegram Send
6) Respond OK

### Add a warning footer
Append something like:
"WARNING: False information may lead to blocking."

## Next step

If you want, paste screenshots of your n8n node list and I will tell you the exact node settings (chatId fields, Data Store config, and the small JS snippets).

