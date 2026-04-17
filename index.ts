import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

// Register TrackPlayer background service for notification controls (native only)
try {
  // Avoid static import to keep web build working
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const TrackPlayer = require('react-native-track-player');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { NativeModules } = require('react-native');
  if (NativeModules?.TrackPlayer && TrackPlayer && typeof TrackPlayer.registerPlaybackService === 'function') {
    TrackPlayer.registerPlaybackService(() => require('./src/services/trackPlayerService').default);
  }
} catch {}
