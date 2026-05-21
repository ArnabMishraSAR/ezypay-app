import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { colors } from '../lib/theme';

// To use a real logo image:
//   1. Save your PNG at mobile/assets/logo.png
//   2. Replace the line below with:
//        const LOGO_SRC = require('../../assets/logo.png');
//   3. Reload the app.
const LOGO_SRC = require('../../assets/logo.png');

export default function Logo({ size = 32, radius }) {
  const r = radius ?? Math.round(size / 3.8);

  if (LOGO_SRC) {
    return (
      <Image
        source={LOGO_SRC}
        style={{ width: size, height: size, borderRadius: r }}
        resizeMode="contain"
      />
    );
  }

  // Programmatic wallet-card logo: stacked rounded rectangles
  // (orange + pink behind, violet on top). No assets required.
  const cardR = Math.max(2, Math.round(r * 0.7));
  return (
    <View
      style={[
        styles.container,
        { width: size, height: size, borderRadius: r },
      ]}
    >
      <View
        style={[
          styles.cardBack,
          {
            width: size * 0.78,
            height: size * 0.5,
            borderRadius: cardR,
            top: size * 0.18,
            left: size * 0.11,
            backgroundColor: '#f97316',
          },
        ]}
      />
      <View
        style={[
          styles.cardMid,
          {
            width: size * 0.78,
            height: size * 0.5,
            borderRadius: cardR,
            top: size * 0.30,
            left: size * 0.11,
            backgroundColor: '#ec4899',
          },
        ]}
      />
      <View
        style={[
          styles.cardFront,
          {
            width: size * 0.78,
            height: size * 0.5,
            borderRadius: cardR,
            top: size * 0.42,
            left: size * 0.11,
            backgroundColor: colors.violet,
          },
        ]}
      />
      <View
        style={[
          styles.stripe,
          {
            width: size * 0.42,
            height: size * 0.06,
            top: size * 0.56,
            left: size * 0.20,
            borderRadius: size * 0.03,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1e1b4b',
    overflow: 'hidden',
    position: 'relative',
  },
  cardBack:  { position: 'absolute' },
  cardMid:   { position: 'absolute' },
  cardFront: { position: 'absolute' },
  stripe:    { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.5)' },
});
