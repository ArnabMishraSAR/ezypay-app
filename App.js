import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import BindScreen from './src/screens/BindScreen';
import HomeScreen from './src/screens/HomeScreen';
import VerifyPaymentScreen from './src/screens/VerifyPaymentScreen';
import TransactionsScreen from './src/screens/TransactionsScreen';
import WalletEmptyScreen from './src/screens/WalletEmptyScreen';
import Sidebar from './src/components/Sidebar';
import { session } from './src/lib/storage';
import { api } from './src/lib/api';
import { balanceBus, walletEmptyBus } from './src/lib/bus';
import { getOrCreateDeviceId } from './src/lib/device';
import { colors } from './src/lib/theme';
import {
  clearVerifierSession,
  startVerifyService,
  stopVerifyService,
} from './src/lib/backgroundService';
import {
  alreadyPromptedBattery,
  markBatteryPrompted,
  openBatterySettings,
} from './src/lib/battery';
import { registerFcmHandlers, registerBackgroundHandler } from './src/lib/fcm';

// Must be registered outside any component so it runs at JS bundle init time.
// Handles FCM data messages (e.g. server pings) when the app is killed/background.
registerBackgroundHandler();

const HEARTBEAT_MS = 30_000;

export default function App() {
  const [booting, setBooting] = useState(true);
  const [authKey, setAuthKey] = useState(null);
  const [merchantName, setMerchantName] = useState('');

  // route: 'home' | 'pending' | 'approved' | 'rejected' | 'all' | 'wallet'
  const [route, setRoute] = useState('home');
  const [selected, setSelected] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tick, setTick] = useState(0);

  // Live balance (from any API response that carries one)
  const [balance, setBalance]     = useState(null);
  const [fee, setFee]             = useState(null);
  const [threshold, setThreshold] = useState(null);

  // Wallet-empty state — drives auto-redirect to wallet screen on first hit
  const [walletEmpty, setWalletEmpty]       = useState(false);
  const [walletChecking, setWalletChecking] = useState(false);
  const [walletLastChecked, setWalletLastChecked] = useState(null);
  const walletShownOnce = useRef(false);
  const hbTimer = useRef(null);

  // On FCM token refresh, silently re-bind with the new token (using saved
  // binder identity) so pushes keep reaching this device.
  useEffect(() => {
    const unsub = registerFcmHandlers(async (newToken) => {
      try {
        const saved = await session.load();
        if (!saved.authKey || !newToken) return;
        const device_id = await getOrCreateDeviceId();
        await api.bind({
          auth_key: saved.authKey,
          device_id,
          binder_name: saved.binderName || 'Device',
          telegram: saved.telegram || '',
          whatsapp: saved.whatsapp || '',
          device_token: newToken,
        });
      } catch {}
    });
    return unsub;
  }, []);

  useEffect(() => {
    (async () => {
      const saved = await session.load();
      if (saved.authKey) {
        setAuthKey(saved.authKey);
        setMerchantName(saved.merchantName || '');
      }
      setBooting(false);
    })();
  }, []);

  // Start/stop the background foreground-service that keeps verifying when the
  // app is minimized or the screen is off. Runs whenever we have an auth key.
  // Deferred + guarded so a service hiccup never blocks first render.
  // (Permissions are requested by HomeScreen — we don't double-prompt here.)
  useEffect(() => {
    if (!authKey) {
      stopVerifyService();
      return;
    }
    const timer = setTimeout(async () => {
      try {
        await startVerifyService(authKey);
      } catch {}

      // One-time nudge to exempt PayVerify from battery optimization so OEM
      // battery managers don't kill the service.
      try {
        if (!(await alreadyPromptedBattery())) {
          await markBatteryPrompted();
          Alert.alert(
            'Keep EzyPay running',
            'To auto-verify payments even when the app is closed, allow EzyPay to run without battery restrictions on the next screen.',
            [
              { text: 'Later', style: 'cancel' },
              { text: 'Open settings', onPress: () => openBatterySettings() },
            ]
          );
        }
      } catch {}
    }, 3000);
    return () => clearTimeout(timer);
  }, [authKey]);

  // Any API response with a balance field updates the live pill
  useEffect(() => {
    const off = balanceBus.subscribe((p) => {
      if (typeof p?.balance    !== 'undefined') setBalance(p.balance);
      if (typeof p?.fee        !== 'undefined') setFee(p.fee);
      if (typeof p?.threshold  !== 'undefined') setThreshold(p.threshold);
    });
    return off;
  }, []);

  // Wallet-empty signal: mark state and (first time only) jump to wallet screen
  useEffect(() => {
    const off = walletEmptyBus.subscribe(() => {
      setWalletEmpty(true);
      if (!walletShownOnce.current) {
        walletShownOnce.current = true;
        setSelected(null);
        setRoute('wallet');
      }
    });
    return off;
  }, []);

  // Background heartbeat — only while wallet is empty
  useEffect(() => {
    if (!walletEmpty || !authKey) {
      if (hbTimer.current) { clearInterval(hbTimer.current); hbTimer.current = null; }
      return;
    }
    const beat = async () => {
      setWalletChecking(true);
      try {
        const device_id = await getOrCreateDeviceId();
        await api.heartbeat({ auth_key: authKey, device_id });
        // 200 → recovered. balance pill updates via balanceBus if backend sent it.
        setWalletEmpty(false);
        walletShownOnce.current = false;
      } catch {
        // 402 re-fires via the api request hook; nothing to do here
      } finally {
        setWalletLastChecked(Date.now());
        setWalletChecking(false);
      }
    };
    beat();
    hbTimer.current = setInterval(beat, HEARTBEAT_MS);
    return () => {
      if (hbTimer.current) { clearInterval(hbTimer.current); hbTimer.current = null; }
    };
  }, [walletEmpty, authKey]);

  const unbind = async () => {
    setDrawerOpen(false);
    // clear, not just stop: the auth key is mirrored into native storage so the
    // service can restart itself after a reboot. Leaving it there would let
    // BootReceiver bring the service back with a key the server has revoked.
    await clearVerifierSession();
    try {
      const device_id = await getOrCreateDeviceId();
      await api.unbind({ auth_key: authKey, device_id });
    } catch {}
    await session.clear();
    setAuthKey(null);
    setMerchantName('');
    setSelected(null);
    setRoute('home');
    setBalance(null); setFee(null); setThreshold(null);
    setWalletEmpty(false);
    walletShownOnce.current = false;
  };

  const goWalletNow = () => {
    setSelected(null);
    setRoute('wallet');
    setDrawerOpen(false);
  };

  if (booting) {
    return (
      <SafeAreaProvider>
        <View style={styles.boot}>
          <ActivityIndicator color={colors.violet} />
        </View>
        <StatusBar style="light" />
      </SafeAreaProvider>
    );
  }

  if (!authKey) {
    return (
      <SafeAreaProvider>
        <BindScreen
          onBound={({ authKey, merchantName }) => {
            setAuthKey(authKey);
            setMerchantName(merchantName);
          }}
        />
        <StatusBar style="light" />
      </SafeAreaProvider>
    );
  }

  const commonTopProps = {
    balance, threshold,
    onOpenWallet: goWalletNow,
    onOpenMenu:   () => setDrawerOpen(true),
  };

  let screen;
  if (selected) {
    screen = (
      <VerifyPaymentScreen
        key={`v-${tick}`}
        authKey={authKey}
        item={selected}
        onBack={() => setSelected(null)}
        onResolved={() => { setSelected(null); setTick((n) => n + 1); }}
      />
    );
  } else if (route === 'wallet') {
    screen = (
      <WalletEmptyScreen
        balance={balance}
        fee={fee}
        threshold={threshold}
        checking={walletChecking}
        lastChecked={walletLastChecked}
        onRetryNow={async () => {
          if (walletChecking) return;
          setWalletChecking(true);
          try {
            const device_id = await getOrCreateDeviceId();
            await api.heartbeat({ auth_key: authKey, device_id });
            setWalletEmpty(false);
            walletShownOnce.current = false;
          } catch {}
          finally {
            setWalletLastChecked(Date.now());
            setWalletChecking(false);
          }
        }}
        onGoToDashboard={() => setRoute('home')}
        onUnbind={unbind}
      />
    );
  } else if (route === 'home') {
    screen = (
      <HomeScreen
        key={`h-${tick}`}
        authKey={authKey}
        merchantName={merchantName}
        {...commonTopProps}
        onOpenPending={(item) => setSelected(item)}
      />
    );
  } else {
    screen = (
      <TransactionsScreen
        key={`t-${route}-${tick}`}
        authKey={authKey}
        filter={route}
        {...commonTopProps}
        onBack={() => setRoute('home')}
        onSelectPending={(item) => setSelected(item)}
      />
    );
  }

  return (
    <SafeAreaProvider>
      {screen}

      <Sidebar
        visible={drawerOpen}
        current={selected ? null : route}
        merchantName={merchantName}
        onClose={() => setDrawerOpen(false)}
        onNavigate={(r) => {
          setSelected(null);
          setRoute(r);
          setDrawerOpen(false);
          setTick((n) => n + 1);
        }}
        onUnbind={unbind}
      />

      <StatusBar style="light" />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
