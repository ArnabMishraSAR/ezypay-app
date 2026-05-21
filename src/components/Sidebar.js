import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Logo from './Logo';
import { colors } from '../lib/theme';

const WIDTH = 290;

export default function Sidebar({ visible, onClose, current, merchantName, onNavigate, onUnbind }) {
  const tx = useRef(new Animated.Value(-WIDTH)).current;

  useEffect(() => {
    Animated.timing(tx, {
      toValue: visible ? 0 : -WIDTH,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, tx]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Animated.View
          style={[styles.drawer, { transform: [{ translateX: tx }] }]}
          // Stop touches on the drawer from closing
          onStartShouldSetResponder={() => true}
        >
          <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
            <View style={styles.brandBlock}>
              <Logo size={42} />
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text style={styles.brand}>AdminPanel</Text>
                {merchantName ? (
                  <Text style={styles.brandSub} numberOfLines={1}>
                    {merchantName}
                  </Text>
                ) : null}
              </View>
            </View>

            <View style={styles.divider} />

            <NavItem label="Dashboard"        icon="▦" active={current === 'home'}      onPress={() => onNavigate('home')} />
            <NavItem label="Pending"          icon="◷" active={current === 'pending'}   onPress={() => onNavigate('pending')} />
            <NavItem label="Approved"         icon="✓" active={current === 'approved'}  onPress={() => onNavigate('approved')} />
            <NavItem label="Rejected"         icon="✕" active={current === 'rejected'}  onPress={() => onNavigate('rejected')} />
            <NavItem label="All Transactions" icon="≣" active={current === 'all'}       onPress={() => onNavigate('all')} />
            <NavItem label="Wallet"           icon="₿" active={current === 'wallet'}    onPress={() => onNavigate('wallet')} />

            <View style={{ flex: 1 }} />
            <View style={styles.divider} />
            <NavItem label="Unbind device" icon="⎋" danger onPress={onUnbind} />
            <Text style={styles.footer}>EzyPay · v0.1</Text>
          </SafeAreaView>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

function NavItem({ label, icon, active, danger, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.item,
        active && styles.itemActive,
        pressed && { opacity: 0.85 },
      ]}
    >
      <View
        style={[
          styles.itemIcon,
          active   && { backgroundColor: colors.violet + '33', borderColor: colors.violet },
          danger   && { backgroundColor: colors.redSoft, borderColor: colors.red + '88' },
        ]}
      >
        <Text
          style={[
            styles.itemIconText,
            active && { color: colors.violet },
            danger && { color: colors.red },
          ]}
        >
          {icon}
        </Text>
      </View>
      <Text style={[styles.itemLabel, active && { color: colors.text }, danger && { color: colors.red }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  drawer: {
    width: WIDTH,
    height: '100%',
    backgroundColor: colors.surface,
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  brandBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  brand: { color: colors.text, fontSize: 18, fontWeight: '800' },
  brandSub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 4 },

  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginHorizontal: 8,
    borderRadius: 10,
  },
  itemActive: { backgroundColor: colors.violetSoft },
  itemIcon: {
    width: 30, height: 30, borderRadius: 8,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface2,
    alignItems: 'center', justifyContent: 'center',
    marginRight: 12,
  },
  itemIconText: { color: colors.muted, fontSize: 14, fontWeight: '700' },
  itemLabel: { color: colors.muted, fontSize: 14, fontWeight: '600' },

  footer: { color: colors.faint, fontSize: 11, textAlign: 'center', paddingVertical: 12 },
});
