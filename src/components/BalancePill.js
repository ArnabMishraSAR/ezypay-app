import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../lib/theme';

function fmt(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toFixed(2);
}

export default function BalancePill({ balance, threshold, onPress }) {
  const v = Number(balance);
  const known = Number.isFinite(v);
  const t = Number(threshold);

  let bg = colors.surface2;
  let border = colors.border;
  let fg = colors.muted;

  if (known) {
    if (v <= 0)                          { bg = '#450a0a'; border = '#7f1d1d'; fg = '#fecaca'; }
    else if (Number.isFinite(t) && v < t){ bg = '#451a03'; border = '#92400e'; fg = '#fde68a'; }
    else                                  { bg = '#052e16'; border = '#14532d'; fg = '#86efac'; }
  }

  const inner = (
    <View style={[styles.pill, { backgroundColor: bg, borderColor: border }]}>
      <Text style={[styles.label, { color: fg }]}>BDT</Text>
      <Text style={[styles.value, { color: fg }]}>{known ? fmt(v) : '—'}</Text>
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} hitSlop={4}>
        {inner}
      </Pressable>
    );
  }
  return inner;
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  label: { fontSize: 10, fontWeight: '700', letterSpacing: 0.4 },
  value: { fontSize: 12, fontWeight: '700' },
});
