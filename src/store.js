/**
 * Sandboxed frames and private browsing can make storage throw on access, not
 * just on write, so every read goes through here too.
 */
export const store = {
  get(key, fallback = null) {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* preferences just will not persist */
    }
  },
};
