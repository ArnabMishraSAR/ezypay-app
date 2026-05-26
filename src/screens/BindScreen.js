import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Application from 'expo-application';

import { api, API_BASE_URL } from '../lib/api';
import { getOrCreateDeviceId } from '../lib/device';
import { session } from '../lib/storage';
import { colors } from '../lib/theme';
import Logo from '../components/Logo';

// Normalize a Telegram handle the same way the backend does.
function normalizeTelegram(raw) {
  return String(raw || '')
    .trim()
    .replace(/^https?:\/\/(t\.me|telegram\.me)\//i, '')
    .replace(/^@/, '')
    .trim();
}

// Normalize a WhatsApp number to digits only (drop +, spaces, wa.me/ etc).
function normalizeWhatsapp(raw) {
  return String(raw || '')
    .replace(/^https?:\/\/wa\.me\//i, '')
    .replace(/[^\d]/g, '');
}

export default function BindScreen({ onBound }) {
  const [authKey, setAuthKey] = useState('');
  const [binderName, setBinderName] = useState('');
  const [telegram, setTelegram] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const tgClean = normalizeTelegram(telegram);
  const waClean = normalizeWhatsapp(whatsapp);

  const tgValid = tgClean === '' || /^[a-zA-Z0-9_]{4,32}$/.test(tgClean);
  const waValid = waClean === '' || (waClean.length >= 8 && waClean.length <= 15);
  const hasContact = tgClean !== '' || waClean !== '';

  const canSubmit =
    authKey.trim().length > 0 &&
    binderName.trim().length >= 2 &&
    tgValid && waValid && hasContact;

  async function handleBind() {
    const key = authKey.trim();
    const name = binderName.trim();
    if (!key) { setError('Please paste your device auth key.'); return; }
    if (name.length < 2) { setError('Enter the binder name (min 2 characters).'); return; }
    if (!hasContact) {
      setError('Add at least a WhatsApp number or Telegram username.');
      return;
    }
    if (!tgValid) {
      setError('Telegram username must be 4–32 letters, digits or _.');
      return;
    }
    if (!waValid) {
      setError('WhatsApp must be a valid international number (8–15 digits).');
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const device_id = await getOrCreateDeviceId();
      const payload = {
        auth_key: key,
        device_id,
        binder_name: name,
        telegram: tgClean,
        whatsapp: waClean,
        model: Platform.OS === 'android' ? Application.nativeApplicationVersion : undefined,
        manufacturer: Platform.OS,
        os_version: String(Platform.Version || ''),
      };
      const res = await api.bind(payload);
      await session.save({
        authKey: key,
        merchantName: res?.merchant_name || '',
      });
      onBound?.({
        authKey: key,
        merchantName: res?.merchant_name || '',
        device: res?.device,
      });
    } catch (e) {
      if (e?.status === 401) setError('Invalid device auth key.');
      else if (e?.status === 403) setError('Merchant account is suspended.');
      else setError(e?.message || 'Bind failed. Check your connection.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.brandBlock}>
            <Logo size={64} radius={16} />
            <Text style={styles.brand}>EzyPay</Text>
            <Text style={styles.tagline}>SMS verification device</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>Device Auth Key</Text>
            <TextInput
              style={styles.input}
              placeholder="PV-XXXXXX"
              placeholderTextColor="#6b7280"
              autoCapitalize="characters"
              autoCorrect={false}
              autoComplete="off"
              value={authKey}
              onChangeText={setAuthKey}
              editable={!loading}
            />

            <Text style={[styles.label, styles.labelGap]}>Binder Name</Text>
            <TextInput
              style={styles.inputText}
              placeholder="e.g. Rahim (Shop counter)"
              placeholderTextColor="#6b7280"
              autoCapitalize="words"
              value={binderName}
              onChangeText={setBinderName}
              editable={!loading}
              maxLength={60}
            />

            <Text style={[styles.label, styles.labelGap]}>WhatsApp Number</Text>
            <TextInput
              style={styles.inputText}
              placeholder="8801712345678"
              placeholderTextColor="#6b7280"
              keyboardType="phone-pad"
              autoCorrect={false}
              autoComplete="off"
              value={whatsapp}
              onChangeText={setWhatsapp}
              editable={!loading}
              maxLength={20}
            />

            <Text style={[styles.label, styles.labelGap]}>Telegram Username</Text>
            <TextInput
              style={styles.inputText}
              placeholder="@rahim_pay"
              placeholderTextColor="#6b7280"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              value={telegram}
              onChangeText={setTelegram}
              editable={!loading}
              maxLength={40}
            />
            <Text style={styles.hint}>
              Add at least one — used to contact the person who bound this device.
            </Text>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              style={({ pressed }) => [
                styles.button,
                (loading || !canSubmit) && styles.buttonDisabled,
                pressed && !loading && styles.buttonPressed,
              ]}
              onPress={handleBind}
              disabled={loading || !canSubmit}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Bind</Text>
              )}
            </Pressable>
          </View>

          <Text style={styles.footer}>{API_BASE_URL}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingVertical: 32,
    justifyContent: 'center',
  },
  brandBlock: { alignItems: 'center', marginBottom: 28, gap: 12 },
  brand: {
    color: colors.text,
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  tagline: { color: colors.muted, marginTop: 6, fontSize: 14 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  label: {
    color: '#cbd5e1',
    fontSize: 13,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  labelGap: { marginTop: 16 },
  input: {
    backgroundColor: colors.bg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    color: colors.text,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    letterSpacing: 1,
  },
  inputText: {
    backgroundColor: colors.bg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    color: colors.text,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  hint: { color: colors.faint, fontSize: 12, marginTop: 6 },
  error: { color: '#fca5a5', marginTop: 12, fontSize: 13 },
  button: {
    backgroundColor: colors.violet,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 18,
  },
  buttonPressed: { backgroundColor: colors.indigo },
  buttonDisabled: { backgroundColor: colors.violetSub, opacity: 0.6 },
  buttonText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
  footer: {
    color: colors.faint,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 24,
  },
});
