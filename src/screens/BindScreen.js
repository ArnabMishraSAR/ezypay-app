import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
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

export default function BindScreen({ onBound }) {
  const [authKey, setAuthKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleBind() {
    const key = authKey.trim();
    if (!key) {
      setError('Please paste your device auth key.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const device_id = await getOrCreateDeviceId();
      const payload = {
        auth_key: key,
        device_id,
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
        <View style={styles.container}>
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

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              style={({ pressed }) => [
                styles.button,
                (loading || !authKey.trim()) && styles.buttonDisabled,
                pressed && !loading && styles.buttonPressed,
              ]}
              onPress={handleBind}
              disabled={loading || !authKey.trim()}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Bind</Text>
              )}
            </Pressable>
          </View>

          <Text style={styles.footer}>{API_BASE_URL}</Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
  },
  brandBlock: { alignItems: 'center', marginBottom: 36, gap: 12 },
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
  error: { color: '#fca5a5', marginTop: 10, fontSize: 13 },
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
