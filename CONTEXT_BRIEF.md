# MoodFusion Player - Developer Context Brief

## 🚀 Project Overview
**MoodFusion Player** is a React Native (Expo) app that generates AI music based on user mood and genre selections. It uses a Node.js/Express backend to proxy requests to the Suno API and handle real-time updates via Socket.io.

## 🎯 Current Mission
**Fixing the "Stuck in Generating" State:**
The app was successfully triggering track generation but failing to receive the "track ready" signal from the backend, leaving the UI stuck on the loading screen.

## 🏗️ Architecture & Data Flow
1.  **Trigger**: User taps "Generate" in App → App calls Backend (`/generate-track`).
2.  **Provider**: Backend calls Suno API with a **Callback URL**.
3.  **Callback**: Suno finishes generation and POSTs data to the **Callback URL**.
4.  **Real-time Update**: Backend receives webhook → Emits `suno:track` event via **Socket.io**.
5.  **Client Action**: App (`AppState.tsx`) listens for `suno:track` → Navigates to `PlayerScreen` → Auto-plays audio.

## 🛠️ Recent Fixes & Configuration
1.  **Tunnel Conflict**: The configured `ngrok` domain was in use/locked.
    *   *Fix*: The server auto-fallback logic switched to `Serveo` (ssh tunneling).
2.  **Callback URL Mismatch**: The app was requesting generation with an old/invalid callback URL.
    *   *Fix*: Updated `.env` with the new active Serveo URL (`https://b168afc352b2c4b0-196-119-218-70.serveousercontent.com/suno-callback`).
3.  **Socket Connectivity**:
    *   *Fix*: Verified app connects to `http://192.168.11.106:8788` (local IP) instead of `localhost` for real device support.

## 📂 Key Files
*   **[AppState.tsx](src/state/AppState.tsx)**: Manages global state, socket connection (`socketRef`), and handles the `suno:track` event to trigger navigation.
*   **[server/index.js](server/index.js)**: Express server handling API proxying, webhook callbacks, and broadcasting socket events.
*   **[.env](.env)**: Contains the `EXPO_PUBLIC_SUNO_CALLBACK_URL` and `EXPO_PUBLIC_API_URL`.

## ✅ Current Status
*   **Backend**: Running on port 8788.
*   **Tunnel**: Active via Serveo.
*   **Verification**: `scripts/test-flow.js` successfully simulated the full Trigger -> Callback -> Socket -> Client loop.
*   **Next Step**: Testing on a physical iOS device to confirm the fix in a real-world scenario.
