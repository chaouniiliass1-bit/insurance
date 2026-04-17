const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

/**
 * Metro configuration
 * - Aliases the deep import used by react-native-track-player web implementation
 *   to the actual file within shaka-player's dist.
 */
const config = getDefaultConfig(__dirname);

// Ensure common source extensions include .js for deep imports
config.resolver.sourceExts = config.resolver.sourceExts || ['js', 'jsx', 'ts', 'tsx'];

// Explicitly map the UI bundle path used by the library to the resolved file
config.resolver.extraNodeModules = Object.assign({}, config.resolver.extraNodeModules, {
  'shaka-player/dist/shaka-player.ui': path.resolve(__dirname, 'node_modules/shaka-player/dist/shaka-player.ui.js'),
});

module.exports = config;