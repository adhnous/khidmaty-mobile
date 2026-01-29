# Khidmaty Mobile (Expo)

## Run on iPhone (same Wi-Fi)

If you see this error in Expo Go:

"There was a problem running the requested app.
Unknown error: Could not connect to the server.
exp://127.0.0.1:8081"

Do this:

1) On your laptop:
- `cd khidmaty-mobile`
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
- `npm run env:sync` (creates `khidmaty-mobile/.env` using your current LAN IP and copies Firebase public keys from the web app env if present)

How to find your laptop IP:
- Windows: `ipconfig` -> **IPv4 Address**
- Mac: Wi-Fi settings -> **IP Address**

## Run the backend (Khidmaty) for mobile search

The mobile app calls your Next.js API: `GET /api/search` (which reads from Firebase on the server).

From the repo root (one folder above `khidmaty-mobile/`):
- `npm run dev`

Make sure your phone can reach it:
- `http://<YOUR_LAN_IP>:3000/api/search?q=test`
