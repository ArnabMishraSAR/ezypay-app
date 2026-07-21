import { registerRootComponent } from 'expo';
import App from './App';

// NOTE — do NOT register an FCM background handler here.
//
// There used to be a `setBackgroundMessageHandler(async () => {})` no-op in this
// file, and it was silently breaking device liveness. `setBackgroundMessageHandler`
// stores exactly ONE handler and the last caller wins. Because `import App from
// './App'` is hoisted and runs before this module's body, App.js registered the
// real handler first — then this file immediately overwrote it with the no-op.
//
// The consequence: the server's 5-minute liveness ping is a DATA-ONLY message
// (`{type:'ping'}`, no notification block), so it is delivered straight to the
// background handler. With the no-op installed, every ping arrived and did
// nothing. `/api/device/pong` was never called, `last_ping_ack` never advanced,
// and the dashboard showed every backgrounded phone as Offline forever — which
// is the normal state for these devices, since they sit in a drawer reading SMS.
//
// The real handler lives in src/lib/fcm.js and is registered at module scope in
// App.js. Keep it in exactly one place.

registerRootComponent(App);
