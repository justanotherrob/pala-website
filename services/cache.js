// Simple in-memory cache with TTL for rarely-changing data (menu, settings, hours, allergens).
// Keeps Railway costs down by avoiding repeated DB queries on every page load.

const store = new Map();

const DEFAULT_TTL = 60 * 60 * 1000; // 1 hour

function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

function set(key, value, ttl = DEFAULT_TTL) {
  store.set(key, { value, expires: Date.now() + ttl });
}

function invalidate(prefix) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

function invalidateAll() {
  store.clear();
}

// Wraps a function with caching
function cached(key, fn, ttl = DEFAULT_TTL) {
  return function (...args) {
    const hit = get(key);
    if (hit !== null) return hit;
    const result = fn(...args);
    set(key, result, ttl);
    return result;
  };
}

module.exports = { get, set, invalidate, invalidateAll, cached };
