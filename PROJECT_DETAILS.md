# MoodFusion Player - Project & Context Documentation

## 1. Project Overview
**MoodFusion Player** is a cross-platform mobile application (React Native/Expo) that generates personalized AI music based on user mood and genre selections. It integrates with the Suno AI API for music generation and Supabase for user authentication and data persistence.

### **Core Functionality**
*   **User Onboarding**: Profile creation (Nickname, Avatar) via Supabase.
*   **Mood & Genre Selection**: Interactive UI for selecting emotional context and musical style.
*   **AI Music Generation**: Proxies requests to Suno API via a local Node.js backend.
*   **Real-time Updates**: Uses Socket.io to push "track ready" events from backend to client.
*   **Audio Playback**: Custom player interface with auto-play, pause, and history.
*   **Library & Favorites**: Persists user history and liked tracks in Supabase.

## 2. Tech Stack & Environment

### **Frontend (Mobile App)**
*   **Framework**: React Native 0.81.5 with Expo SDK 54.
*   **Language**: TypeScript.
*   **State Management**: React Context (`AppState.tsx`) + `useRef` for socket/audio persistence.
*   **Navigation**: React Navigation 7 (Native Stack).
*   **Audio**: `expo-av` for playback logic.
*   **Networking**: `axios` for API calls, `socket.io-client` for real-time events.
*   **UI Components**: `react-native-reanimated`, `lottie-react-native`, `expo-linear-gradient`.

### **Backend (Local Proxy Server)**
*   **Runtime**: Node.js.
*   **Framework**: Express.js.
*   **Real-time**: Socket.io (Server).
*   **Tunneling**: Serveo (fallback from ngrok) for exposing local callbacks to the public internet.
*   **Purpose**: Hides API keys, handles Suno webhooks, and broadcasts events to the app.

### **Infrastructure & Services**
*   **Database**: Supabase (PostgreSQL) for Profiles, Tracks, and History.
*   **AI Provider**: Suno API (via `api.box` proxy).
*   **Authentication**: Custom nickname-based auth with Supabase.

## 3. Directory Structure
```
/MoodFusion Player
├── .env                  # Environment variables (API keys, URLs)
├── App.tsx               # Root entry point, Navigation container
├── app.config.ts         # Expo configuration
├── package.json          # Dependencies
├── server/               # Node.js Backend
│   └── index.js          # Main server file (Express + Socket.io)
├── src/
│   ├── api/              # API Clients
│   │   ├── suno.ts       # Suno API wrapper
│   │   ├── supabase.ts   # Supabase DB operations
│   │   └── health.ts     # Backend health checks
│   ├── screens/          # Application Screens
│   │   ├── OnboardingScreen.tsx
│   │   ├── MoodSelectionScreen.tsx
│   │   ├── PlayerScreen.tsx
│   │   └── ...
│   ├── state/            # Global State
│   │   └── AppState.tsx  # Context provider, Socket listeners
│   ├── services/         # Background Services
│   │   └── audio.ts      # Audio playback controller
│   └── navigation.ts     # Navigation types & helpers
└── scripts/              # Utility scripts (testing flows)
```

## 4. Key Configuration Details (Current)
*   **Local Backend URL**: `http://192.168.11.106:8788` (Accessible on LAN).
*   **Public Callback URL**: `https://b168afc352b2c4b0-196-119-218-70.serveousercontent.com/suno-callback` (Serveo Tunnel).
*   **Socket Transport**: Websockets (verified working).
*   **Supabase Project**: `Moodfusionplayer` (ID: `wiekabbfmpmxjhiwyfzt`).

## 5. Critical Workflows
### **Track Generation Flow**
1.  **User Request**: `AppState` calls `sunoApi.generateTrack`.
2.  **Backend Proxy**: Server requests Suno API with `callback_url` pointing to the Serveo tunnel.
3.  **Webhook**: Suno posts result to Serveo URL → Local Server.
4.  **Broadcast**: Server emits `suno:track` event via Socket.io.
5.  **Client Update**: `AppState` receives event, updates state, navigates to `PlayerScreen`, and calls `audioService.play()`.

## 6. Current Status & Known Issues
*   **Status**: Operational. Generation flow verified via `scripts/test-flow.js`.
*   **Recent Fixes**:
    *   Resolved ngrok tunnel conflict by switching to Serveo.
    *   Fixed `localhost` vs LAN IP issue for physical device connectivity.
    *   Updated `.env` with correct callback URL.
*   **Pending**: User is currently verifying the fix on a physical iOS device.

## 7. Useful Commands
*   **Start App**: `npm start` (Runs Expo).
*   **Start Server**: `npm run server` (Runs Express + Tunnel).
*   **Test Flow**: `node scripts/test-flow.js` (Simulates full generation loop).
