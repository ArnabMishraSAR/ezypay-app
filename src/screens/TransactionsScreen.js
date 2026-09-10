import React, { useCallback, useEffect, useState } from 'react';
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
  normalizeStatus,
  presetRange,
  txnDate,
} from '../lib/txn';

const DATE_PRESETS = [
  { key: 'today',     label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d',        label: '7 Days' },
  { key: '30d',       label: '30 Days' },
  { key: 'all',       label: 'All' },
];

// Rows per page the merchant can choose between.
const PAGE_SIZES = [20, 50, 100];

const TITLE = {
  pending:  'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  all:      'All Transactions',
};

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const gatewayLabel = (g) =>
  `${cap(g.provider)}${g.variant ? ' ' + g.variant : ''} ${g.account_number || ''}`.trim();
const formatBDT = (n) =>
  'BDT ' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
  const isPending = filter === 'pending';

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);

  const [datePreset, setDatePreset] = useState('all');
  const [gateway, setGateway] = useState('all');   // gateway_id or 'all'
  const [gateways, setGateways] = useState([]);     // distinct list from server
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(0);              // 0-based; page 0 = newest
  const [total, setTotal] = useState(0);

  // Everything below (status/date/gateway filtering + paging) is resolved by
  // the backend, so a page reaches the whole history rather than a capped
  // recent slice. Rows arrive newest-first.
  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const device_id = await getOrCreateDeviceId();
      if (isPending) {
        const r = await api.poll({ auth_key: authKey, device_id });
        const list = (r?.verifications || []).map((v) => ({ ...v, status: 'pending' }));
        setRows(list);
        setTotal(list.length);
      } else {
        const statusParam =
          filter === 'approved' ? 'success' :
          filter === 'rejected' ? 'failed'  : undefined;
        try {
          const r = await api.transactions({
            auth_key: authKey,
            device_id,
            status: statusParam,
            ...presetRange(datePreset),
            gateway_id: gateway !== 'all' ? gateway : undefined,
            limit: pageSize,
            offset: page * pageSize,
          });
          setRows(extractList(r));
          setTotal(Number(r.total) || 0);
          setGateways(Array.isArray(r.gateways) ? r.gateways : []);
        } catch (e) {
          if (e?.status === 404) { setRows([]); setTotal(0); setGateways([]); }
          else throw e;
        }
      }
    } catch (e) {
      setError(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [authKey, filter, isPending, datePreset, gateway, pageSize, page]);

  useEffect(() => { load(); }, [load]);

  // If the chosen gateway no longer appears in the current date view, fall back
  // to All so the merchant isn't stranded on an empty, invisible selection.
  useEffect(() => {
    if (gateway !== 'all' && gateways.length && !gateways.some((g) => g.id === gateway)) {
      setGateway('all');
      setPage(0);
    }
  }, [gateways]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Snap back into range if a filter change shrank the result set below the
  // current page (e.g. was on page 5, new filter only has 2 pages).
  useEffect(() => {
    if (page > totalPages - 1) setPage(totalPages - 1);
  }, [totalPages]); // eslint-disable-line react-hooks/exhaustive-deps

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const firstRow = total === 0 ? 0 : page * pageSize + 1;
  const lastRow  = Math.min(total, (page + 1) * pageSize);
  const totalApproved = gateways.reduce((s, g) => s + Number(g.approved_amount || 0), 0);

  // Filter changes reset to the first (newest) page.
  const selectDate     = (key) => { setDatePreset(key); setPage(0); };
  const selectGateway  = (id)  => { setGateway(id);     setPage(0); };
  const selectPageSize = (n)   => { setPageSize(n);     setPage(0); };
  const goNewer = () => setPage((p) => Math.max(0, p - 1));
  const goOlder = () => setPage((p) => (p + 1 < totalPages ? p + 1 : p));

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

      {!isPending ? (
        <View style={styles.filterBlock}>
          <Text style={styles.filterLabel}>Date</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {DATE_PRESETS.map((p) => (
              <Chip key={p.key} active={datePreset === p.key} onPress={() => selectDate(p.key)}>
                {p.label}
              </Chip>
            ))}
          </ScrollView>

          {gateways.length > 0 ? (
            <>
              <Text style={[styles.filterLabel, { marginTop: 10 }]}>Gateway · approved in range</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                <GatewayChip
                  active={gateway === 'all'} onPress={() => selectGateway('all')}
                  title="All accounts" amount={formatBDT(totalApproved)}
                />
                {gateways.map((g) => (
                  <GatewayChip
                    key={g.id}
                    active={gateway === g.id} onPress={() => selectGateway(g.id)}
                    title={gatewayLabel(g)} amount={formatBDT(g.approved_amount)}
                  />
                ))}
              </ScrollView>
            </>
          ) : null}

          {/* Per page and the pager share one row: paging used to live at the
              very bottom, which meant scrolling the whole list to reach it. */}
          <View style={styles.perPageHeader}>
            <Text style={[styles.filterLabel, { marginBottom: 0 }]}>Per page</Text>
            {total > 0 ? (
              <Text style={styles.pagerCountInline}>
                {firstRow}–{lastRow} of {total}
                <Text style={styles.pagerPageInline}>  ·  Page {page + 1}/{totalPages}</Text>
              </Text>
            ) : null}
          </View>

          <View style={styles.perPageRow}>
            <View style={styles.chipRowStatic}>
              {PAGE_SIZES.map((n) => (
                <Chip key={n} active={pageSize === n} onPress={() => selectPageSize(n)}>{String(n)}</Chip>
              ))}
            </View>

            {total > 0 ? (
              <View style={styles.pagerInline}>
                <Pressable
                  onPress={goNewer}
                  disabled={page <= 0 || loading}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel="Newer transactions"
                  accessibilityState={{ disabled: page <= 0 || loading }}
                  style={({ pressed }) => [
                    styles.pagerBtnSm,
                    (page <= 0 || loading) && styles.pagerBtnDisabled,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Text style={styles.pagerBtnSmText}>‹ Newer</Text>
                </Pressable>

                <Pressable
                  onPress={goOlder}
                  disabled={page >= totalPages - 1 || loading}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel="Older transactions"
                  accessibilityState={{ disabled: page >= totalPages - 1 || loading }}
                  style={({ pressed }) => [
                    styles.pagerBtnSm,
                    (page >= totalPages - 1 || loading) && styles.pagerBtnDisabled,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Text style={styles.pagerBtnSmText}>Older ›</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {loading && rows.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.violet} />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(t, i) => String(t.verification_id || t.id || `${t.txnid_submitted || ''}-${i}`)}
          contentContainerStyle={rows.length === 0 ? styles.emptyWrap : styles.listWrap}
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

// Two-line gateway chip: the account on top, its approved (money-in) total for
// the current date range below.
function GatewayChip({ active, onPress, title, amount }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.gwChip,
        active && styles.chipActive,
        pressed && { opacity: 0.85 },
      ]}
    >
      <Text style={[styles.gwChipTitle, active && styles.chipTextActive]} numberOfLines={1}>{title}</Text>
      <Text style={styles.gwChipAmount} numberOfLines={1}>{amount}</Text>
    </Pressable>
  );
}

/**
 * Compare what arrived against what was asked for.
 *
 * `expected_amount` is only sent by newer backends and is null on rows that
 * predate it, so anything we can't compare is reported as 'exact' — an older
 * server must never make every row look like a mismatch.
 *
 * Returns { kind: 'exact' | 'short' | 'over', expected, received, diff }.
 */
function amountState(item) {
  const received = Number(item?.amount);
  const expected = item?.expected_amount == null ? null : Number(item.expected_amount);
  const none = { kind: 'exact', expected: 0, received: 0, diff: 0 };

  if (!Number.isFinite(received) || expected == null || !Number.isFinite(expected)) return none;
  if (String(item?.status) === 'pending') return none;   // nothing has arrived yet

  const diff = Math.round((received - expected) * 100) / 100;
  if (Math.abs(diff) <= 0.01) return none;
  return {
    kind: diff < 0 ? 'short' : 'over',
    expected,
    received,
    diff: Math.abs(diff),
  };
}

function Row({ item, onPress }) {
  const status = normalizeStatus(item.status);
  const prov   = providerStyle(item.provider);
  const amount = Number(item.amount || 0).toFixed(2);
  const cur    = item.currency || 'BDT';
  const d      = txnDate(item);
  const when   = d ? d.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

  // How the amount that arrived compares with the amount that was asked for.
  // An overpayment settles as 'success', so the badge can't be read off the
  // status alone — the two figures are what separate it from an exact match.
  const money = amountState(item);

  const stColor =
    money.kind === 'short' || money.kind === 'over' ? colors.amber :
    status === 'success' ? colors.green :
    status === 'failed'  ? colors.red   :
    colors.amber;
  const stBg =
    money.kind === 'short' || money.kind === 'over' ? colors.amberSoft :
    status === 'success' ? colors.greenSoft :
    status === 'failed'  ? colors.redSoft   :
    colors.amberSoft;
  const stLabel =
    money.kind === 'short' ? 'UNDERPAID' :
    money.kind === 'over'  ? 'OVERPAID'  :
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
        <Text style={styles.amount}>{cur} {amount}</Text>
        {when ? <Text style={styles.when}>{when}</Text> : null}
      </View>
      {/* The big figure above is what arrived. When that isn't what was asked
          for, spell out both — "BDT 100.00" alone is misleading on its own. */}
      {money.kind !== 'exact' ? (
        <Text style={styles.amountNote}>
          Expected {cur} {money.expected.toFixed(2)}
          <Text style={styles.amountNoteDim}>  ·  </Text>
          {money.kind === 'short'
            ? `short ${cur} ${money.diff.toFixed(2)}`
            : `extra ${cur} ${money.diff.toFixed(2)}`}
        </Text>
      ) : null}
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
  // flexShrink lets the chips give way before the pager does, so the row can
  // never overflow on a narrow handset.
  chipRowStatic: { flexDirection: 'row', paddingHorizontal: 4, flexShrink: 1 },
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

  gwChip: {
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 14,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
    marginRight: 8,
    minWidth: 130,
  },
  gwChipTitle: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  gwChipAmount: { color: colors.green, fontSize: 13, fontWeight: '800', marginTop: 2 },

  error: { color: '#fca5a5', padding: 12, fontSize: 13, textAlign: 'center' },

  // Per-page chips on the left, pager on the right, on one row — so paging is
  // reachable without scrolling past the whole list.
  perPageHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 10, marginBottom: 6, marginLeft: 6, paddingRight: 4,
  },
  perPageRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: 8,
  },
  pagerInline: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 4, flexShrink: 0 },
  pagerBtnSm: {
    paddingHorizontal: 10, paddingVertical: 7,
    borderRadius: 10, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pagerBtnDisabled: { opacity: 0.4 },
  pagerBtnSmText: { color: colors.text, fontSize: 12, fontWeight: '700' },
  pagerCountInline: { color: colors.text, fontSize: 11, fontWeight: '700' },
  pagerPageInline: { color: colors.muted, fontSize: 11, fontWeight: '600' },

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
  // Amber to tie it to the UNDERPAID / OVERPAID pill on the same row.
  amountNote:    { color: colors.amber, fontSize: 12, fontWeight: '600', marginTop: 3 },
  amountNoteDim: { color: colors.muted, fontWeight: '400' },
  meta:    { color: colors.muted, fontSize: 12, marginTop: 4 },
  metaMono:{ color: colors.faint, fontSize: 12, marginTop: 2, letterSpacing: 0.4 },
});
