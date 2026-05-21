import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
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
import { colors, providerStyle } from '../lib/theme';
import BalancePill from '../components/BalancePill';
import {
  extractList,
  gatewayKey,
  normalizeStatus,
  txnDate,
  withinDays,
} from '../lib/txn';

const DATE_PRESETS = [
  { key: 'today', label: 'Today',  days: 1 },
  { key: '7d',    label: '7 Days', days: 7 },
  { key: '30d',   label: '30 Days', days: 30 },
  { key: 'all',   label: 'All',    days: Infinity },
];

const TITLE = {
  pending:  'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  all:      'All Transactions',
};

export default function TransactionsScreen({
  authKey,
  filter = 'all',          // 'pending' | 'approved' | 'rejected' | 'all'
  balance,
  threshold,
  onBack,
  onOpenMenu,
  onOpenWallet,
  onSelectPending,
}) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);

  const [datePreset, setDatePreset] = useState('all');
  const [gateway, setGateway] = useState('all');

  const load = useCallback(async () => {
    try {
      const device_id = await getOrCreateDeviceId();
      let list = [];
      if (filter === 'pending') {
        const r = await api.poll({ auth_key: authKey, device_id });
        list = (r?.verifications || []).map((v) => ({ ...v, status: 'pending' }));
      } else {
        try {
          const r = await api.transactions({ auth_key: authKey, device_id });
          list = extractList(r);
        } catch (e) {
          if (e?.status === 404) list = [];
          else throw e;
        }
      }
      setRows(list);
      setError(null);
    } catch (e) {
      setError(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [authKey, filter]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const gateways = useMemo(() => {
    const set = new Set();
    rows.forEach((t) => set.add(gatewayKey(t)));
    return ['all', ...Array.from(set).sort()];
  }, [rows]);

  const filtered = useMemo(() => {
    const presetDays = DATE_PRESETS.find((p) => p.key === datePreset)?.days ?? Infinity;
    return rows.filter((t) => {
      const s = normalizeStatus(t.status);
      if (filter === 'approved' && s !== 'success') return false;
      if (filter === 'rejected' && s !== 'failed')  return false;
      if (filter === 'pending'  && s !== 'pending') return false;

      if (presetDays !== Infinity) {
        const d = txnDate(t);
        if (!d || !withinDays(d, presetDays)) return false;
      }

      if (gateway !== 'all' && gatewayKey(t) !== gateway) return false;
      return true;
    });
  }, [rows, filter, datePreset, gateway]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable onPress={onOpenMenu} hitSlop={10} style={styles.iconBtn}>
          <View style={styles.menuLine} />
          <View style={[styles.menuLine, { width: 14 }]} />
          <View style={[styles.menuLine, { width: 18 }]} />
        </Pressable>
        <Text style={styles.title}>{TITLE[filter] || 'Transactions'}</Text>
        <BalancePill balance={balance} threshold={threshold} onPress={onOpenWallet} />
      </View>

      {(filter === 'all' || filter === 'approved' || filter === 'rejected') ? (
        <View style={styles.filterBlock}>
          <Text style={styles.filterLabel}>Date</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {DATE_PRESETS.map((p) => (
              <Chip key={p.key} active={datePreset === p.key} onPress={() => setDatePreset(p.key)}>
                {p.label}
              </Chip>
            ))}
          </ScrollView>

          {gateways.length > 1 ? (
            <>
              <Text style={[styles.filterLabel, { marginTop: 10 }]}>Gateway</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                {gateways.map((g) => (
                  <Chip key={g} active={gateway === g} onPress={() => setGateway(g)}>
                    {g === 'all' ? 'All' : g}
                  </Chip>
                ))}
              </ScrollView>
            </>
          ) : null}
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.violet} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(t, i) => String(t.verification_id || t.id || `${t.txnid_submitted || ''}-${i}`)}
          contentContainerStyle={filtered.length === 0 ? styles.emptyWrap : styles.listWrap}
          refreshControl={<RefreshControl tintColor={colors.violet} refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No transactions</Text>
              <Text style={styles.emptyText}>Try a different filter or pull to refresh.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <Row
              item={item}
              onPress={
                normalizeStatus(item.status) === 'pending' && onSelectPending
                  ? () => onSelectPending(item)
                  : undefined
              }
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

function Chip({ active, onPress, children }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        active && styles.chipActive,
        pressed && { opacity: 0.85 },
      ]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
        {children}
      </Text>
    </Pressable>
  );
}

function Row({ item, onPress }) {
  const status = normalizeStatus(item.status);
  const prov   = providerStyle(item.provider);
  const amount = Number(item.amount || 0).toFixed(2);
  const d      = txnDate(item);
  const when   = d ? d.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

  const stColor =
    status === 'success' ? colors.green :
    status === 'failed'  ? colors.red   :
    colors.amber;
  const stBg =
    status === 'success' ? colors.greenSoft :
    status === 'failed'  ? colors.redSoft   :
    colors.amberSoft;
  const stLabel =
    status === 'success' ? 'APPROVED' :
    status === 'failed'  ? 'REJECTED' :
    status === 'pending' ? 'PENDING'  :
    String(item.status || 'UNKNOWN').toUpperCase();

  const Wrapper = onPress ? Pressable : View;
  return (
    <Wrapper
      onPress={onPress}
      style={({ pressed } = {}) => [
        styles.row,
        pressed && { opacity: 0.85 },
      ]}
    >
      <View style={styles.rowTop}>
        <View style={[styles.providerPill, { backgroundColor: prov.bg }]}>
          <Text style={[styles.providerPillText, { color: prov.fg }]}>{prov.label}</Text>
        </View>
        <View style={[styles.statusPill, { backgroundColor: stBg, borderColor: stColor + '66' }]}>
          <Text style={[styles.statusText, { color: stColor }]}>{stLabel}</Text>
        </View>
      </View>
      <View style={styles.rowMid}>
        <Text style={styles.amount}>{(item.currency || 'BDT')} {amount}</Text>
        {when ? <Text style={styles.when}>{when}</Text> : null}
      </View>
      {item.order_id ? <Text style={styles.meta}>{item.order_id}</Text> : null}
      {item.txnid_submitted ? <Text style={styles.metaMono}>{item.txnid_submitted}</Text> : null}
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  topBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    gap: 10,
  },
  iconBtn: { width: 28, height: 28, justifyContent: 'center', gap: 3 },
  menuLine: { height: 2, width: 22, backgroundColor: colors.muted, borderRadius: 2 },
  title: { flex: 1, color: colors.text, fontSize: 18, fontWeight: '700' },
  backTextBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  backText: { color: colors.muted, fontSize: 12 },

  filterBlock: {
    paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  filterLabel: { color: colors.muted, fontSize: 11, marginLeft: 6, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  chipRow: { paddingHorizontal: 4, gap: 8 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
    marginRight: 8,
  },
  chipActive: { backgroundColor: colors.violetSoft, borderColor: colors.violet },
  chipText: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: '#c7d2fe' },

  error: { color: '#fca5a5', padding: 12, fontSize: 13, textAlign: 'center' },

  listWrap: { padding: 12 },
  emptyWrap: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  empty: { alignItems: 'center' },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  emptyText: { color: colors.muted, fontSize: 13, marginTop: 6, textAlign: 'center' },

  row: {
    backgroundColor: colors.surface,
    borderRadius: 12, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: colors.border,
  },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  providerPill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6 },
  providerPillText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: 1 },
  statusText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6 },

  rowMid: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
    marginTop: 8,
  },
  amount: { color: colors.text, fontSize: 18, fontWeight: '800' },
  when: { color: colors.muted, fontSize: 11 },
  meta:    { color: colors.muted, fontSize: 12, marginTop: 4 },
  metaMono:{ color: colors.faint, fontSize: 12, marginTop: 2, letterSpacing: 0.4 },
});
