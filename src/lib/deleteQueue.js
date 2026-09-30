export function createDeleteQueue({
  animationDuration = 300,
  setTimer = (callback, delay) => setTimeout(callback, delay),
  clearTimer = (timerId) => clearTimeout(timerId),
  onDelete,
} = {}) {
  const pendingIds = [];
  const timers = new Map();
  let version = 0;
  const listeners = new Set();

  function emitChange() {
    version += 1;
    listeners.forEach((listener) => listener());
  }

  function removePending(id) {
    const index = pendingIds.indexOf(id);
    if (index !== -1) {
      pendingIds.splice(index, 1);
    }
  }

  function completeDelete(id) {
    timers.delete(id);
    removePending(id);
    emitChange();
    onDelete?.(id);
  }

  function cancel(id) {
    const timerId = timers.get(id);
    if (timerId !== undefined) {
      clearTimer(timerId);
      timers.delete(id);
      removePending(id);
      emitChange();
      return true;
    }
    return false;
  }

  return {
    requestDelete(id) {
      if (pendingIds.includes(id)) {
        return;
      }

      pendingIds.push(id);
      timers.set(
        id,
        setTimer(() => completeDelete(id), animationDuration),
      );
      emitChange();
    },
    cancel,
    getPendingIds() {
      return pendingIds.slice();
    },
    getVersion() {
      return version;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      timers.forEach((timerId) => clearTimer(timerId));
      timers.clear();
      pendingIds.length = 0;
      listeners.clear();
    },
  };
}
