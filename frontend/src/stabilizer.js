// A gesture counts once it has been held; it must be released before it can fire again.
export function createStabilizer({ holdMs = 900, releaseMs = 400 } = {}) {
  let candidate = null;
  let since = 0;
  let lastSeen = 0;
  let fired = false;

  return (label, now) => {
    const active = label && label !== 'none' ? label : null;

    if (active && active === candidate) {
      lastSeen = now;
      if (!fired && now - since >= holdMs) {
        fired = true;
        return { fire: active, progress: 1 };
      }
      return { fire: null, progress: fired ? 1 : (now - since) / holdMs };
    }

    // One bad frame must not restart the hold.
    if (candidate && now - lastSeen < releaseMs) {
      return { fire: null, progress: fired ? 1 : (lastSeen - since) / holdMs };
    }

    candidate = active;
    since = now;
    lastSeen = now;
    fired = false;
    return { fire: null, progress: 0 };
  };
}
