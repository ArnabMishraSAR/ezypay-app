import React from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Logo from '../components/Logo';
import { ADMIN_URL } from '../lib/api';
import { colors } from '../lib/theme';

function formatTk(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return `BDT ${v.toFixed(2)}`;
}

export default function WalletEmptyScreen({
  balance,
  fee,
  threshold,
  checking,
  lastChecked,
  onRetryNow,
  onGoToDashboard,
  onUnbind,
}) {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.container}>
        <View style={styles.iconWrap}>
          <Logo size={64} radius={16} />
        </View>

        <Text style={styles.title}>Wallet empty</Text>

        <Text style={styles.sub}>
          Your EzyPay wallet doesn't have enough balance to process new
          verifications.{'\n'}Please top up from the admin site to resume.
        </Text>

        <Pressable
          onPress={() => Linking.openURL(ADMIN_URL).catch(() => {})}
          style={({ pressed }) => [styles.linkBtn, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.linkText} numberOfLines={1}>
            Top up wallet → {ADMIN_URL.replace(/^https?:\/\//, '')}
          </Text>
        </Pressable>

        <View style={styles.card}>
          <Row label="Balance"              value={formatTk(balance)}   accent={colors.red} />
          <Divider />
          <Row label="Per-verification fee" value={formatTk(fee)} />
          <Divider />
          <Row label="Minimum required"     value={formatTk(threshold)} accent={colors.amber} />
        </View>

        <View style={styles.statusRow}>
          {checking ? (
            <ActivityIndicator color={colors.violet} size="small" />
          ) : (
            <View style={[styles.dot, { backgroundColor: colors.amber }]} />
          )}
          <Text style={styles.statusText}>
            {checking
              ? 'Checking wallet status…'
              : lastChecked
                ? `Last checked ${new Date(lastChecked).toLocaleTimeString()} · auto-retry every 30s`
                : 'Will retry automatically'}
          </Text>
        </View>

        <Pressable
          onPress={onRetryNow}
          disabled={checking}
          style={({ pressed }) => [
            styles.btnPrimary,
            pressed && { opacity: 0.85 },
            checking && { opacity: 0.5 },
          ]}
        >
          <Text style={styles.btnPrimaryText}>Check now</Text>
        </Pressable>

        <Pressable
          onPress={onGoToDashboard}
          style={({ pressed }) => [
            styles.btnSecondary,
            pressed && { opacity: 0.85 },
          ]}
        >
          <Text style={styles.btnSecondaryText}>Go to Dashboard</Text>
        </Pressable>

        <Pressable onPress={onUnbind} style={styles.unbindBtn}>
          <Text style={styles.unbindText}>Unbind this device</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function Row({ label, value, accent }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, accent && { color: accent }]}>{value}</Text>
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 28,
    alignItems: 'center',
  },
  iconWrap: { marginBottom: 14 },
  title: { color: colors.text, fontSize: 24, fontWeight: '800' },
  sub: {
    color: colors.muted,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 8,
    lineHeight: 19,
  },

  linkBtn: {
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.violet + '88',
    backgroundColor: colors.violetSoft,
  },
  linkText: { color: '#c7d2fe', fontSize: 12, fontWeight: '600' },

  card: {
    alignSelf: 'stretch',
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 6,
    marginTop: 18,
    borderWidth: 1,
    borderColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  rowLabel: { color: colors.muted, fontSize: 13 },
  rowValue: { color: colors.text, fontSize: 15, fontWeight: '700' },
  divider: { height: 1, backgroundColor: colors.border },

  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { color: colors.muted, fontSize: 12 },

  btnPrimary: {
    marginTop: 18,
    alignSelf: 'stretch',
    backgroundColor: colors.violet,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  btnSecondary: {
    marginTop: 10,
    alignSelf: 'stretch',
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  btnSecondaryText: { color: colors.text, fontSize: 14, fontWeight: '600' },

  unbindBtn: {
    marginTop: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  unbindText: { color: colors.muted, fontSize: 12 },
});
