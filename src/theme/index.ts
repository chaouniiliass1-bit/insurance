export const LightColors = {
  background: '#F7F7F9',
  text: '#0F1216',
  primary: '#3F59D9',
  card: '#EDEFF5',
};

export const DarkColors = {
  background: '#0A0C11',
  text: '#E4E6EA',
  primary: '#7E90FF',
  card: '#121824',
};

// Refined mood-to-color gradient mapping
export const MoodGradients = {
  Relaxed: ['#2A7C76', '#145B54'] as const, // darker teal
  Focused: ['#37476E', '#1D2943'] as const, // deeper indigo
  Happy: ['#B46B10', '#7A4A0B'] as const,   // warm amber, darker
  Chill: ['#3B5D87', '#1D3E66'] as const,    // cool blue, muted
  Melancholic: ['#2A3E55', '#1F2335'] as const, // moody twilight
  Energetic: ['#D24A2C', '#8B1E17'] as const, // warm orange-red gradient
  Default: ['#151821', '#2B2F3B'] as const,
};

// Mood-matched image/GIF mapping for Player visuals
export const MoodImages: Record<string, string> = {
  Relaxed: 'https://picsum.photos/id/1011/1200/800', // ocean-like
  Focused: 'https://picsum.photos/id/1033/1200/800', // geometric/lines
  Happy: 'https://picsum.photos/id/1025/1200/800', // colorful
  Chill: 'https://picsum.photos/id/1005/1200/800', // cool tones
  Melancholic: 'https://picsum.photos/id/1056/1200/800', // muted mood
  Energetic: 'https://picsum.photos/id/1035/1200/800', // warm vibrant tones
  Default: 'https://picsum.photos/id/1015/1200/800',
};