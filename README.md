# PayVerify Mobile (Expo)

React Native (Expo) app for the PayVerify SMS-reader device.

- Backend base URL: `https://checkout.ezypay.it.com`
- Endpoint used on first launch: `POST /api/device/bind`

## What's in this first cut

1. **Splash / Bind screen** — single input for the merchant's **device auth key** + **Bind** button.
2. On Bind, the app:
   - Generates / reuses a stable `device_id` (Android ID / iOS vendor ID, fallback random).
   - Calls `POST /api/device/bind` with `{ auth_key, device_id, model, manufacturer, os_version }`.
   - On success, persists `auth_key` and `merchant_name` with AsyncStorage and switches to a placeholder Home screen.
3. On next launch, if a saved `auth_key` exists, the bind screen is skipped.

The next steps (poll loop, SMS reader, report) are not implemented yet — only the bind flow you asked for.

## Run

```bash
cd mobile
npm install
npx expo start
```

Then:
- Press **a** to open in an Android emulator, or
- Scan the QR code with **Expo Go** on your phone.

To run on a physical Android device with SMS later, you'll need a development build (Expo Go cannot access SMS).

## Configuration

The API base URL lives in `app.json` under `expo.extra.API_BASE_URL` and is read by `src/lib/api.js`. Override per-environment by editing that value.
