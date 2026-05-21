import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '../lib/api';
import { getOrCreateDeviceId } from '../lib/device';
import Logo from '../components/Logo';
import BalancePill from '../components/BalancePill';
import {
  colors,
  greetingFor,
  longDate,
  providerStyle,
} from '../lib/theme';
import {
  extractList,
  isToday,
  normalizeStatus,
  txnDate,
} from '../lib/txn';
import {
  checkSmsPermissions,
  requestSmsPermissions,
  requestNotificationPermission,
} from '../lib/permissions';
import { isSmsAvailable } from '../lib/sms';
import { runVerifyCycle } from '../lib/verifyLoop';

const POLL_MS = 10_000;

export default function HomeScreen({
  authKey,
  merchantName,
  balance,
  threshold,
  onOpenMenu,
  onOpenPending,
  onOpenWallet,
}) {
  const [deviceId, setDeviceId] = useState(null);
  const [items, setItems] = useState([]);
  const [today, setToday] = useState({ total: 0, success: 0, failed: 0 });
  const [allTime, setAllTime] = useState({ total: 0, success: 0, failed: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [smsReady, setSmsReady] = useState(false);
  const [lastMatch, setLastMatch] = useState(null); // { txnid, when }
  const [scan, setScan] = useState(null);            // { smsCount, matched, note }

  const pollTimer = useRef(null);
  const mounted   = useRef(true);

  useEffect(() => {
    (async () => {
      const id = await getOrCreateDeviceId();
      if (!mounted.current) return;
      setDeviceId(id);

      await requestNotificationPermission();
      let ok = await checkSmsPermissions();
      if (!ok) ok = await requestSmsPermissions();
      if (mounted.current) setSmsReady(ok && isSmsAvailable());
    })();
    return () => { mounted.current = false; };
  }, []);

  const requestSms = async () => {
    const ok = await requestSmsPermissions();
    setSmsReady(ok && isSmsAvailable());
  };

  // Re-check SMS permission whenever the app comes back to foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (state) => {
      if (state === 'active') {
        const ok = await checkSmsPermissions();
        if (mounted.current) setSmsReady(ok);
      }
    });
    return () => sub.remove();
  }, []);

  const fetchAll = useCallback(async () => {
    if (!deviceId) return;
    try {
      // Single shared cycle: poll → read SMS → match → report.
      const cycle = await runVerifyCycle(authKey);
      if (!mounted.current) return;

      if (cycle.permsOk !== smsReady) setSmsReady(cycle.permsOk);
      setItems(cycle.pending || []);
      setScan({
        smsCount: cycle.smsCount || 0,
        matched: (cycle.matchedIds || []).length,
        note: cycle.note,
      });
      if (cycle.matchedIds && cycle.matchedIds.length) {
        setLastMatch({ txnid: cycle.matchedIds.length + ' payment(s)', when: Date.now() });
      }

      let txnList = null;
      try {
        const t = await api.transactions({ auth_key: authKey, device_id: deviceId });
        txnList = extractList(t);
      } catch { /* endpoint optional */ }

      if (Array.isArray(txnList)) {
        const tStats = { total: 0, success: 0, failed: 0 };
        const aStats = { total: 0, success: 0, failed: 0 };
        for (const t of txnList) {
          const s = normalizeStatus(t.status);
          aStats.total += 1;
          if (s === 'success') aStats.success += 1;
          else if (s === 'failed') aStats.failed += 1;
          if (isToday(txnDate(t))) {
            tStats.total += 1;
            if (s === 'success') tStats.success += 1;
            else if (s === 'failed') tStats.failed += 1;
          }
        }
        setToday(tStats);
        setAllTime(aStats);
      }
      setError(cycle.error || null);
    } catch (e) {
      if (!mounted.current) return;
      setError(e?.message || 'Failed to fetch');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [authKey, deviceId, smsReady]);

  useEffect(() => {
    if (!deviceId) return;
    fetchAll();
    pollTimer.current = setInterval(fetchAll, POLL_MS);
    return () => { if (pollTimer.current) clearInterval(pollTimer.current); };
  }, [deviceId, fetchAll, smsReady]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchAll();
    setRefreshing(false);
  };

  const greeting = useMemo(() => greetingFor(), []);
  const dateStr  = useMemo(() => longDate(), []);

  const initial = (merchantName || 'A').trim().charAt(0).toUpperCase();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable onPress={onOpenMenu} hitSlop={10} style={styles.iconBtn}>
          <View style={styles.menuLine} />
          <View style={[styles.menuLine, { width: 14 }]} />
          <View style={[styles.menuLine, { width: 18 }]} />
        </Pressable>

        <View style={styles.brandWrap}>
          <Logo size={30} />
          <Text style={styles.brandText}>AdminPanel</Text>
        </View>

        <View style={styles.topRight}>
          <BalancePill balance={balance} threshold={threshold} onPress={onOpenWallet} />
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
        </View>
      </View>

      {error ? <Text style={styles.errorBanner}>{error}</Text> : null}

      {!smsReady ? (
        <Pressable onPress={requestSms} style={styles.smsBanner}>
          <Text style={styles.smsBannerTitle}>SMS permission needed</Text>
          <Text style={styles.smsBannerText}>
            Tap to grant SMS access so payments can be auto-verified.
          </Text>
        </Pressable>
      ) : lastMatch ? (
        <View style={styles.smsOk}>
          <Text style={styles.smsOkText}>
            Auto-verified {lastMatch.txnid} · {new Date(lastMatch.when).toLocaleTimeString()}
          </Text>
        </View>
      ) : null}

      {scan ? (
        <View style={styles.debugStrip}>
          <Text style={styles.debugText} numberOfLines={2}>
            Last scan: {scan.smsCount ?? 0} SMS read{scan.matched != null ? ` · ${scan.matched} matched` : ''}
            {scan.note ? `\n${scan.note}` : ''}
          </Text>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.violet} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl tintColor={colors.violet} refreshing={refreshing} onRefresh={onRefresh} />
          }
        >
          {/* Today's Summary */}
          <View style={styles.todayCard}>
            <View style={styles.todayHeader}>
              <Text style={styles.todayTitle}>Today's Summary</Text>
              <Text style={styles.todayDate}>{shortDate()}</Text>
            </View>
            <View style={styles.todayRow}>
              <Mini label="Total"    value={today.total}   color={colors.cyan} />
              <Divider />
              <Mini label="Approved" value={today.success} color={colors.green} />
              <Divider />
              <Mini label="Rejected" value={today.failed}  color={colors.red} />
              <Divider />
              <Mini label="Pending"  value={items.length}  color={colors.amber} />
            </View>
          </View>

          <View style={styles.greetCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.greetHi}>{greeting}</Text>
              <Text style={styles.greetTitle}>Admin Dashboard</Text>
              <Text style={styles.greetDate}>{dateStr}</Text>
            </View>
            <View style={styles.greetGlyph}>
              <View style={[styles.glyphDot, { backgroundColor: '#a5b4fc' }]} />
              <View style={[styles.glyphDot, { backgroundColor: '#c4b5fd' }]} />
              <View style={[styles.glyphDot, { backgroundColor: '#818cf8' }]} />
              <View style={[styles.glyphDot, { backgroundColor: '#a78bfa' }]} />
            </View>
          </View>

          {/* All-time stat tiles */}
          <View style={styles.statsGrid}>
            <StatTile label="Total"   value={allTime.total}   sub="All-time"  accent={colors.cyan}  glyph="▦" />
            <StatTile label="Success" value={allTime.success} sub="Completed" accent={colors.green} glyph="✓" />
            <StatTile label="Failed"  value={allTime.failed}  sub="Declined"  accent={colors.red}   glyph="✕" />
            <StatTile label="Pending" value={items.length}    sub="Awaiting"  accent={colors.amber} glyph="◷" />
          </View>

          <View style={styles.unreadCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.unreadLabel}>Unread</Text>
              <Text style={[styles.unreadValue, { color: colors.violet }]}>{items.length}</Text>
              <Text style={styles.unreadSub}>New</Text>
            </View>
            <View style={styles.unreadGlyph}>
              <Text style={{ color: colors.violet, fontSize: 16 }}>✉</Text>
            </View>
          </View>

          <Text style={styles.sectionTitle}>Pending Approvals</Text>
          <Text style={styles.sectionSub}>Payments awaiting verification</Text>

          {items.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>All clear</Text>
              <Text style={styles.emptyText}>
                New approvals appear here within {POLL_MS / 1000}s of a customer submitting a TxnID.
              </Text>
            </View>
          ) : (
            items.map((item) => (
              <PendingCard
                key={String(item.verification_id)}
                item={item}
                onPress={() => onOpenPending?.(item)}
              />
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function StatTile({ label, value, sub, accent, glyph }) {
  return (
    <View style={styles.statTile}>
      <View style={styles.statHeader}>
        <Text style={styles.statLabel}>{label}</Text>
        <View style={[styles.statGlyph, { backgroundColor: accent + '22', borderColor: accent + '55' }]}>
          <Text style={[styles.statGlyphText, { color: accent }]}>{glyph}</Text>
        </View>
      </View>
      <Text style={[styles.statValue, { color: accent }]}>{value}</Text>
      <Text style={styles.statSub}>{sub}</Text>
    </View>
  );
}

function Mini({ label, value, color }) {
  return (
    <View style={styles.mini}>
      <Text style={[styles.miniValue, { color }]}>{value}</Text>
      <Text style={styles.miniLabel}>{label}</Text>
    </View>
  );
}

function Divider() { return <View style={styles.miniDivider} />; }

function shortDate() {
  return new Date().toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
}

function PendingCard({ item, onPress }) {
  const prov = providerStyle(item.provider);
  const amount = Number(item.amount).toFixed(2);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.approval, pressed && { opacity: 0.85 }]}
    >
      <View style={styles.approvalRow}>
        <View style={[styles.providerPill, { backgroundColor: prov.bg }]}>
          <Text style={[styles.providerPillText, { color: prov.fg }]}>{prov.label}</Text>
        </View>
        <Text style={styles.chev}>›</Text>
      </View>
      <Text style={styles.approvalAmount}>{(item.currency || 'BDT')} {amount}</Text>
      {item.order_id ? (
        <Text style={styles.approvalOrder}>{item.order_id}</Text>
      ) : (
        <Text style={styles.approvalOrder} numberOfLines={1}>{item.txnid_submitted}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 16, paddingBottom: 32 },

  topBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    gap: 10,
  },
  iconBtn: { width: 28, height: 28, justifyContent: 'center', gap: 3 },
  menuLine: { height: 2, width: 22, backgroundColor: colors.muted, borderRadius: 2 },
  brandWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandText: { color: colors.text, fontSize: 18, fontWeight: '700' },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  onlinePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 999, borderWidth: 1,
    borderColor: '#14532d', backgroundColor: '#052e16',
  },
  onlineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.green },
  onlineText: { color: colors.green, fontSize: 11, fontWeight: '600' },
  avatar: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: colors.violetSub, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontWeight: '700' },

  errorBanner: {
    color: '#fecaca', backgroundColor: '#7f1d1d',
    paddingHorizontal: 16, paddingVertical: 8, fontSize: 12,
  },
  smsBanner: {
    backgroundColor: colors.amberSoft,
    borderBottomWidth: 1, borderBottomColor: colors.amber + '55',
    paddingHorizontal: 16, paddingVertical: 10,
  },
  smsBannerTitle: { color: colors.amber, fontSize: 13, fontWeight: '700' },
  smsBannerText:  { color: '#fde68a', fontSize: 12, marginTop: 2 },
  smsOk: {
    backgroundColor: colors.greenSoft,
    paddingHorizontal: 16, paddingVertical: 6,
  },
  smsOkText: { color: '#86efac', fontSize: 11, fontWeight: '600' },
  debugStrip: {
    backgroundColor: colors.surface2,
    paddingHorizontal: 16, paddingVertical: 6,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  debugText: { color: colors.muted, fontSize: 10, fontFamily: undefined },

  todayCard: {
    marginTop: 14,
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1, borderColor: colors.border,
  },
  todayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 12,
  },
  todayTitle: { color: colors.text, fontSize: 14, fontWeight: '700' },
  todayDate:  { color: colors.muted, fontSize: 12 },
  todayRow: { flexDirection: 'row', alignItems: 'center' },
  mini: { flex: 1, alignItems: 'center' },
  miniValue: { fontSize: 22, fontWeight: '800' },
  miniLabel: { color: colors.muted, fontSize: 11, marginTop: 2 },
  miniDivider: { width: 1, height: 30, backgroundColor: colors.border },

  greetCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    borderRadius: 16,
    padding: 18,
    backgroundColor: colors.violetSoft,
    borderWidth: 1, borderColor: '#312e81',
  },
  greetHi: { color: '#c7d2fe', fontSize: 13 },
  greetTitle: { color: '#fff', fontSize: 24, fontWeight: '800', marginTop: 2 },
  greetDate: { color: '#a5b4fc', fontSize: 12, marginTop: 6 },
  greetGlyph: {
    width: 56, height: 56, borderRadius: 12,
    backgroundColor: '#312e81',
    flexDirection: 'row', flexWrap: 'wrap',
    padding: 8, gap: 4, alignContent: 'center', justifyContent: 'center',
  },
  glyphDot: { width: 16, height: 16, borderRadius: 4 },

  statsGrid: {
    marginTop: 14,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 12,
  },
  statTile: {
    width: '48.5%',
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1, borderColor: colors.border,
  },
  statHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statLabel: { color: colors.muted, fontSize: 13 },
  statGlyph: {
    width: 28, height: 28, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1,
  },
  statGlyphText: { fontSize: 14, fontWeight: '700' },
  statValue: { fontSize: 28, fontWeight: '800', marginTop: 10 },
  statSub: { color: colors.faint, fontSize: 12, marginTop: 2 },

  unreadCard: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1, borderColor: colors.border,
  },
  unreadLabel: { color: colors.muted, fontSize: 13 },
  unreadValue: { fontSize: 28, fontWeight: '800', marginTop: 6 },
  unreadSub: { color: colors.faint, fontSize: 12, marginTop: 2 },
  unreadGlyph: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: '#1e1b4b', borderWidth: 1, borderColor: '#312e81',
    alignItems: 'center', justifyContent: 'center',
  },

  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '700', marginTop: 22 },
  sectionSub:   { color: colors.muted, fontSize: 12, marginTop: 2, marginBottom: 12 },

  approval: {
    backgroundColor: colors.violetSoft,
    borderRadius: 14, padding: 16, marginBottom: 10,
    borderWidth: 1, borderColor: '#312e81',
  },
  approvalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  providerPill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6 },
  providerPillText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6 },
  chev: { color: colors.muted, fontSize: 20, lineHeight: 20 },
  approvalAmount: { color: '#fff', fontSize: 20, fontWeight: '800', marginTop: 10 },
  approvalOrder: { color: '#a5b4fc', fontSize: 12, marginTop: 2 },

  empty: { alignItems: 'center', paddingHorizontal: 16, paddingVertical: 24 },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  emptyText: { color: colors.muted, fontSize: 13, textAlign: 'center', marginTop: 6 },
});
