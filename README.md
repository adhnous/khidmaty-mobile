# Khidmaty Mobile (Expo)

## Trusted SOS Alarm (Firebase + Expo Push)

This repo includes a **Trusted SOS** system:

- Only **accepted trusted contacts** receive SOS push notifications.
- Push routing is **server-side** (backend API + Firestore trusted graph).
- Tapping the notification opens the SOS details and starts a **siren + vibration** until stopped.

### Install deps (Expo SDK 54)

- `npx expo install expo-notifications expo-device expo-av expo-application`
- `npm install firebase`

### Firebase env vars

1) Copy `.env.example` -> `.env` (or run `npm run env:sync`).
2) Fill Firebase public config (from Firebase Console web app config):
- `EXPO_PUBLIC_FIREBASE_API_KEY`
- `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `EXPO_PUBLIC_FIREBASE_PROJECT_ID`
- `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `EXPO_PUBLIC_FIREBASE_APP_ID`

For standalone builds, also set:
- `EXPO_PUBLIC_EAS_PROJECT_ID` (used by `expo-notifications` to generate Expo push tokens)

### Deploy (Rules)

From repo root:
- Deploy Firestore rules: `firebase deploy --only firestore:rules`

### Server-side SOS API (required)

To preserve privacy, the client must **not** choose recipients or read other users' push tokens.
This app expects your backend (same host as `EXPO_PUBLIC_API_BASE_URL`) to provide:

- `POST /api/sos/lookup-user` (email/phone -> uid)
- `POST /api/sos/set-phone` (set current user's phone)
- `POST /api/sos/send` (send push to accepted trusted contacts)

If your backend is deployed on Vercel (recommended when Firebase is on Spark), set these env vars on the backend:

- `SOS_FIREBASE_ADMIN_PROJECT_ID`
- `SOS_FIREBASE_ADMIN_CLIENT_EMAIL`
- `SOS_FIREBASE_ADMIN_PRIVATE_KEY` (replace newlines with `\n`)

### Test checklist (2 real phones)

1) Phone A: Register + login, allow notifications.
2) Phone B: Register + login, allow notifications.
3) Phone A: `Trusted Contacts` -> add Phone B email or phone (sends request).
4) Phone B: `Incoming Requests` -> Accept.
5) Phone A: `SOS` -> `Use Location` -> `Send SOS to Trusted Contacts`.
6) Phone B: tap the push notification -> Incoming SOS screen opens, siren plays until `Stop Alarm`.

Notes:
- Push testing must be on **physical devices**.
- Expo Go can receive Expo push notifications; for production builds you must configure push credentials in Expo/EAS.
- Phone numbers must include country code (e.g. `+218...` or `00...`).

## Run on iPhone (same Wi-Fi)

If you see this error in Expo Go:

"There was a problem running the requested app.
Unknown error: Could not connect to the server.
exp://127.0.0.1:8081"

Do this:

1) On your laptop (from this repo folder):
- `npm run start:clean:lan`

2) On your iPhone:
- Open **Expo Go**
- Scan the QR code shown in the terminal

3) Confirm the connection mode is LAN:
- In Expo DevTools, ensure the connection is **LAN** (not Local).

4) If the phone still tries `exp://127.0.0.1:8081`:
- Stop Expo (`Ctrl+C`)
- Run `npm run start:clean:lan` again
- If it still prints `exp://127.0.0.1:8081`, force the hostname and start again:
  - `npm run start:clean:lan:ip`
- Scan the new QR code (old QR codes can point to 127.0.0.1)

Tip (Windows): you can also force it manually:
- `$env:REACT_NATIVE_PACKAGER_HOSTNAME="<YOUR_LAN_IP>"; npm run start:clean:lan`

### Common blockers (and fixes)

- VPN: Turn off VPN on both the phone and the laptop.
- Windows Defender Firewall: Allow **Node.js** on **Private** networks.
- Guest Wi-Fi / AP isolation: Use tunnel mode: `npm run start:tunnel`

### API base URL (important for real phones)

On a real phone, `localhost` / `127.0.0.1` points to the phone, not your laptop.
Set `EXPO_PUBLIC_API_BASE_URL` to your laptop LAN IP, e.g. `http://192.168.x.x:3000`.

Quick setup (recommended):
- `npm run env:sync` (creates `.env` using your current LAN IP; in a monorepo, it can also copy Firebase public keys from the web app env if present)

How to find your laptop IP:
- Windows: `ipconfig` -> **IPv4 Address**
- Mac: Wi-Fi settings -> **IP Address**

## Backend for mobile search

This repo is the Expo mobile app. For search to work, `EXPO_PUBLIC_API_BASE_URL` must point to a backend that serves:

- `GET /api/search` (reads from Firebase on the server)
- `GET /api/listing/details?type=service|item&id=...` (optional: enrich Listing Detail with description/thumb)
- `GET /api/blood-donors/list` (optional: blood donor directory)

Make sure your phone can reach it (replace with your backend host):
- `http://<YOUR_LAN_IP>:3000/api/search?q=test`

Optional clinics directory (Tripoli medical):
- Backend endpoint: `GET /api/osm/tripoli/medical` (returns a JSON array)
- App env var: `EXPO_PUBLIC_TRIPOLI_MEDICAL_URL=http://<YOUR_LAN_IP>:3000/api/osm/tripoli/medical`

## Panic Alarm (Siren)

The SOS screen includes a **Panic Alarm** button (loud siren + vibration) to attract attention.

Implementation:
- `lib/alarm.ts` (loops `assets/siren.wav` + vibration)

Notes:
- On iOS, the silent switch may still affect some audio routes; raise volume to test.
- Use only for real emergencies; test responsibly.
