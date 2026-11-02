// Serialize snapshot rendering and coalesce notifications that arrive mid-refresh.
export function createRefreshQueue(refreshOnce) {
  let active = null, dirty = false;
  function refresh() {
    dirty = true;
    if (!active) {
      active = Promise.resolve().then(async () => {
        do { dirty = false; await refreshOnce(); } while (dirty);
      }).finally(() => { active = null; if (dirty) return refresh(); });
    }
    return active;
  }
  return refresh;
}
