import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '../lib/api';
import { getOrCreateDeviceId } from '../lib/device';
import { colors, providerStyle } from '../lib/theme';

export default function VerifyPaymentScreen({ authKey, item, onBack, onResolved }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const prov = providerStyle(item?.provider);
  const amount = Number(item?.amount || 0).toFixed(2);

  async function resolve(result, reason) {
    setError(null);
    setBusy(result);
    try {
      const device_id = await getOrCreateDeviceId();
      const trimmed = String(reason || '').trim().slice(0, 240);
      const payload = {
        auth_key: authKey,
        device_id,
        verification_id: item.verification_id,
        result,
      };
      // Same convention as web manualResolve: `failure_reason` is the
      // free-form note column for BOTH approve and reject.
      if (result === 'success') {
        payload.matched_sms = 'Manually approved from mobile';
      } else {
        payload.failure_reason = trimmed || 'Manually rejected from mobile';
      }
      await api.report(payload);
      onResolved?.(item.verification_id, result);
    } catch (e) {
      if (e?.status === 404) {
        onResolved?.(item.verification_id, result);
        return;
      }
      setError(e?.message || 'Failed to update');
    } finally {
      setBusy(null);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable onPress={onBack} hitSlop={10} style={styles.backBtn}>
          <Text style={styles.backText}>←</Text>
        </Pressable>
        <Text style={styles.topTitle}>Verify Payment</Text>
        <View style={{ width: 28 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.amountCard, { backgroundColor: prov.bg }]}>
          <Text style={[styles.provider, { color: prov.fg }]}>{prov.label}</Text>
          <Text style={styles.amount}>{(item?.currency || 'BDT')} {amount}</Text>
          <View style={styles.statusPill}>
            <Text style={styles.statusText}>PENDING</Text>
          </View>
        </View>

        <View style={styles.fields}>
          <Field label="Customer"  value={item?.customer_name || 'N/A'} />
          <Field label="Phone"     value={item?.customer_phone || 'N/A'} />
          <Field label="Order ID"  value={item?.order_id || '—'} mono />
          <Field label="Txn ID"    value={item?.txnid_submitted || '—'} mono />
          <Field label="Account"   value={item?.account_number || '—'} mono />
          {item?.variant ? <Field label="Variant" value={String(item.variant).toUpperCase()} /> : null}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          onPress={() => resolve('success')}
          disabled={!!busy}
          style={({ pressed }) => [
            styles.approveBtn,
            (busy && busy !== 'success') && { opacity: 0.5 },
            pressed && { opacity: 0.85 },
          ]}
        >
          {busy === 'success' ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.approveText}>APPROVE PAYMENT</Text>
          )}
        </Pressable>

        <Pressable
          onPress={() => { setRejectReason(''); setError(null); setRejectOpen(true); }}
          disabled={!!busy}
          style={({ pressed }) => [
            styles.rejectBtn,
            (busy && busy !== 'failed') && { opacity: 0.5 },
            pressed && { opacity: 0.85 },
          ]}
        >
          {busy === 'failed' ? (
            <ActivityIndicator color={colors.red} />
          ) : (
            <Text style={styles.rejectText}>REJECT / MARK FAILED</Text>
          )}
        </Pressable>
      </ScrollView>
      </KeyboardAvoidingView>

      {/* Rejection reason popup */}
      <Modal
        visible={rejectOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setRejectOpen(false)}
        statusBarTranslucent
      >
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Reject payment</Text>
            <Text style={styles.modalSub}>
              {(item?.currency || 'BDT')} {amount} · {item?.txnid_submitted || '—'}
            </Text>

            <Text style={styles.modalLabel}>Reason for rejection (required)</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g. No matching SMS · Wrong amount · Customer admitted no payment"
              placeholderTextColor={colors.faint}
              value={rejectReason}
              onChangeText={setRejectReason}
              multiline
              numberOfLines={3}
              maxLength={240}
              autoFocus
              editable={busy !== 'failed'}
              textAlignVertical="top"
            />

            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setRejectOpen(false)}
                disabled={busy === 'failed'}
                style={({ pressed }) => [styles.modalCancel, pressed && { opacity: 0.85 }]}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={async () => {
                  if (!rejectReason.trim()) return;
                  await resolve('failed', rejectReason);
                  setRejectOpen(false);
                }}
                disabled={busy === 'failed' || !rejectReason.trim()}
                style={({ pressed }) => [
                  styles.modalReject,
                  pressed && { opacity: 0.85 },
                  (busy === 'failed' || !rejectReason.trim()) && { opacity: 0.5 },
                ]}
              >
                {busy === 'failed' ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.modalRejectText}>Confirm reject</Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function Field({ label, value, mono }) {
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={[styles.fieldValue, mono && styles.mono]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: 16, paddingBottom: 32 },

  topBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 10,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backText: { color: colors.text, fontSize: 22, lineHeight: 22 },
  topTitle: { flex: 1, color: colors.text, fontSize: 18, fontWeight: '700' },

  amountCard: {
    borderRadius: 18,
    paddingVertical: 28,
    alignItems: 'center',
    marginTop: 6,
  },
  provider: { fontSize: 13, letterSpacing: 4, fontWeight: '700' },
  amount: { color: '#fff', fontSize: 40, fontWeight: '800', marginTop: 6 },
  statusPill: {
    marginTop: 10,
    paddingHorizontal: 14, paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  statusText: { color: '#fff', fontSize: 11, letterSpacing: 1, fontWeight: '700' },

  fields: { marginTop: 22 },
  fieldRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  fieldLabel: { color: colors.muted, fontSize: 14 },
  fieldValue: { color: colors.text, fontSize: 14, fontWeight: '600', maxWidth: '60%', textAlign: 'right' },
  mono: { fontFamily: undefined, letterSpacing: 0.5 },

  error: { color: '#fca5a5', marginTop: 12, fontSize: 13, textAlign: 'center' },

  /* Reject reason modal */
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1, borderColor: colors.border,
  },
  modalTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  modalSub: { color: colors.muted, fontSize: 12, marginTop: 4 },
  modalLabel: {
    color: colors.muted, fontSize: 12, marginTop: 16, marginBottom: 6,
    textTransform: 'uppercase', letterSpacing: 0.6,
  },
  modalInput: {
    backgroundColor: colors.bg,
    borderWidth: 1, borderColor: colors.border, borderRadius: 10,
    color: colors.text,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, minHeight: 80,
  },
  modalActions: {
    flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 18,
  },
  modalCancel: {
    paddingHorizontal: 16, paddingVertical: 12, borderRadius: 10,
  },
  modalCancelText: { color: colors.muted, fontSize: 14, fontWeight: '600' },
  modalReject: {
    paddingHorizontal: 18, paddingVertical: 12, borderRadius: 10,
    backgroundColor: colors.red, minWidth: 130, alignItems: 'center',
  },
  modalRejectText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  approveBtn: {
    marginTop: 26,
    backgroundColor: colors.green,
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
  },
  approveText: { color: '#052e16', fontWeight: '800', letterSpacing: 0.5 },

  rejectBtn: {
    marginTop: 12,
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1, borderColor: colors.red,
  },
  rejectText: { color: colors.red, fontWeight: '800', letterSpacing: 0.5 },
});
