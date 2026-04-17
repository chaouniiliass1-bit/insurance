import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Modal, Platform } from 'react-native';
import { audioService } from '../services/audio';

type Props = {
  visible: boolean;
  onClose: () => void;
  url: string;
  title?: string | null;
};

export default function MiniPlayerModal({ visible, onClose, url, title }: Props) {
  const [isPlaying, setIsPlaying] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await audioService.setQueue([url]);
        await audioService.load();
        await audioService.play();
        setIsPlaying(true);
      } catch {}
    })();
    return () => {
      mounted = false;
      (async () => {
        try { await audioService.stop(); } catch {}
      })();
    };
  }, [url]);

  const onToggle = async () => {
    try {
      if (isPlaying) { await audioService.pause(); setIsPlaying(false); }
      else { await audioService.play(); setIsPlaying(true); }
    } catch {}
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{title || 'Now Playing'}</Text>
          <View style={styles.controls}>
            <Pressable style={styles.btn} onPress={onToggle}><Text style={styles.btnText}>{isPlaying ? 'Pause' : 'Play'}</Text></Pressable>
            <Pressable style={[styles.btn, styles.close]} onPress={onClose}><Text style={styles.btnText}>Close</Text></Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { width: '96%', borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.95)', padding: 14, marginBottom: Platform.OS === 'ios' ? 20 : 8 },
  title: { color: '#1b1b1b', fontSize: 16, fontWeight: '700', textAlign: 'center', marginBottom: 8 },
  controls: { flexDirection: 'row', justifyContent: 'center' },
  btn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.08)', marginHorizontal: 6 },
  close: { backgroundColor: 'rgba(0,0,0,0.15)' },
  btnText: { color: '#1b1b1b', fontWeight: '600' },
});