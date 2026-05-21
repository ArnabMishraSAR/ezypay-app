// Minimal pub/sub for cross-module signals (e.g. wallet-empty).
// Avoids pulling in React Native's NativeEventEmitter or a state library.

function createBus() {
  let listeners = [];
  return {
    subscribe(fn) {
      listeners.push(fn);
      return () => {
        listeners = listeners.filter((l) => l !== fn);
      };
    },
    emit(payload) {
      for (const l of listeners) {
        try { l(payload); } catch {}
      }
    },
  };
}

// Fired when an API call returns 402 with insufficient_balance:true.
// Payload: { balance, fee, threshold }
export const walletEmptyBus = createBus();

// Fired whenever an API response includes a `balance` field (200 or 402).
// Payload: { balance, fee?, threshold? }
export const balanceBus = createBus();
