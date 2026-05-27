import { registerRootComponent } from 'expo';
import App from './App';

// Register an FCM background handler at the top level (required by
// @react-native-firebase/messaging). Our pushes carry a `notification` block,
// so Android displays them automatically when the app is backgrounded/killed —
// this handler just satisfies the library and is a safe no-op.
try {
  const messaging = require('@react-native-firebase/messaging').default;
  messaging().setBackgroundMessageHandler(async () => {});
} catch {
  // messaging not available (e.g. Expo Go) — ignore.
}

registerRootComponent(App);
