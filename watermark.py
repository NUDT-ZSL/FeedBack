"""watermark: embeddable streaming watermark & late-event reordering kernel.

Windows are keyed by event time, not arrival order:

    engine = WindowEngine(allowed_lateness=20, window_size=100,
                          max_out_of_order=1000)
    engine.push({"key": "a", "ts": 95, "value": 1})   -> [emitted windows]
    engine.advance_watermark(130)                     -> [emitted windows]
    engine.flush()                                    -> [remaining windows]
    engine.pending()  -> {"watermark", "open_windows", "buffered"}

Semantics
---------
* Windows are left-closed, right-open: [start, start + window_size) with
  start = ts - ts % window_size.  Values aggregate per (key, window_start).
* The watermark only moves via advance_watermark() and is monotonic
  (max of all values ever passed).
* A window closes when watermark >= window_end + allowed_lateness.
  Late events arriving before that point merge into the original window.
* Buffer limit: when the number of buffered events (events living in open
  windows) reaches max_out_of_order, push() first force-closes the oldest
  window below the watermark and emits it, then accepts the new event.
  A force-closed window is emitted early but NOT destroyed: it moves to a
  closed-but-mergeable area so later events for the same (key, window)
  still merge in — no event is ever silently dropped, and the final
  flush() output is independent of arrival order.  If a force-closed
  window received late merges, its final total is re-emitted when the
  watermark truly passes it (downstream should treat the latest record
  for a (key, window_start) as authoritative).
* An event with ts < watermark - allowed_lateness belongs to a fully
  closed window: push() raises ValueError naming the key and ts.

Every emitted record is
    {"key", "window_start", "window_end", "sum", "count"}
and result lists are sorted by (window_start, key).
"""


class WindowEngine:
    def __init__(self, allowed_lateness, window_size, max_out_of_order):
        for name, val in (("allowed_lateness", allowed_lateness),
                          ("window_size", window_size),
                          ("max_out_of_order", max_out_of_order)):
            if not isinstance(val, int) or isinstance(val, bool):
                raise ValueError("%s must be an int, got %r" % (name, val))
        if window_size <= 0:
            raise ValueError("window_size must be > 0, got %d" % window_size)
        if allowed_lateness < 0:
            raise ValueError("allowed_lateness must be >= 0, got %d"
                             % allowed_lateness)
        if max_out_of_order < 0:
            raise ValueError("max_out_of_order must be >= 0, got %d"
                             % max_out_of_order)
        self._lateness = allowed_lateness
        self._size = window_size
        self._max_buffered = max_out_of_order
        self._watermark = 0
        # (key, window_start) -> [sum, count]
        self._open = {}
        # (key, window_start) -> [sum, count, dirty]  force-closed but
        # still mergeable; dirty = merged new events after being emitted
        self._closed = {}
        self._buffered = 0  # events currently held in open windows

    # ------------------------------------------------------------------
    # validation
    # ------------------------------------------------------------------

    @staticmethod
    def _validate_event(event):
        if not isinstance(event, dict):
            raise ValueError("event must be a dict, got %r" % (event,))
        key = event.get("key")
        ts = event.get("ts")
        value = event.get("value")
        if not isinstance(key, str) or key == "":
            raise ValueError("event key must be a non-empty string: %r"
                             % (key,))
        if not isinstance(ts, int) or isinstance(ts, bool):
            raise ValueError("event ts must be an int (key=%r): %r"
                             % (key, ts))
        if not isinstance(value, int) or isinstance(value, bool):
            raise ValueError("event value must be an int (key=%r, ts=%d): %r"
                             % (key, ts, value))
        return key, ts, value

    # ------------------------------------------------------------------
    # public API
    # ------------------------------------------------------------------

    def push(self, event):
        """Accept one event; return windows force-emitted because of it."""
        key, ts, value = self._validate_event(event)
        horizon = self._watermark - self._lateness
        if ts < horizon:
            raise ValueError(
                "event too late: key=%r ts=%d is below watermark %d minus "
                "allowed_lateness %d" % (key, ts, self._watermark,
                                         self._lateness))

        emitted = []
        if self._buffered >= self._max_buffered and self._open:
            emitted.append(self._force_close_oldest())

        window_start = ts - ts % self._size
        ident = (key, window_start)
        if ident in self._closed:
            agg = self._closed[ident]
            agg[0] += value
            agg[1] += 1
            agg[2] = True
        else:
            agg = self._open.setdefault(ident, [0, 0])
            agg[0] += value
            agg[1] += 1
            self._buffered += 1
        return self._sort(emitted)

    def advance_watermark(self, ts):
        """Move the watermark forward (monotonic); emit newly closed windows."""
        if not isinstance(ts, int) or isinstance(ts, bool):
            raise ValueError("watermark ts must be an int: %r" % (ts,))
        if ts > self._watermark:
            self._watermark = ts

        emitted = []
        for ident in [k for k in self._open if self._truly_closed(k)]:
            agg = self._open.pop(ident)
            self._buffered -= agg[1]
            emitted.append(self._record(ident, agg))
        for ident in [k for k in self._closed if self._truly_closed(k)]:
            agg = self._closed.pop(ident)
            if agg[2]:  # merged late events after the forced emission
                emitted.append(self._record(ident, agg))
        return self._sort(emitted)

    def flush(self):
        """Close and emit every remaining window; empties the engine."""
        emitted = [self._record(ident, agg)
                   for ident, agg in self._open.items()]
        emitted += [self._record(ident, agg)
                    for ident, agg in self._closed.items()]
        self._open.clear()
        self._closed.clear()
        self._buffered = 0
        return self._sort(emitted)

    def pending(self):
        return {"watermark": self._watermark,
                "open_windows": len(self._open),
                "buffered": self._buffered}

    # ------------------------------------------------------------------
    # internals
    # ------------------------------------------------------------------

    def _truly_closed(self, ident):
        window_end = ident[1] + self._size
        return self._watermark >= window_end + self._lateness

    def _force_close_oldest(self):
        # oldest window fully below the watermark; if none qualifies, fall
        # back to the oldest open window overall (events are never dropped)
        below = [k for k in self._open
                 if k[1] + self._size <= self._watermark]
        ident = min(below) if below else min(self._open)
        agg = self._open.pop(ident)
        self._buffered -= agg[1]
        self._closed[ident] = [agg[0], agg[1], False]
        return self._record(ident, agg)

    def _record(self, ident, agg):
        key, window_start = ident
        return {"key": key,
                "window_start": window_start,
                "window_end": window_start + self._size,
                "sum": agg[0],
                "count": agg[1]}

    @staticmethod
    def _sort(records):
        return sorted(records, key=lambda r: (r["window_start"], r["key"]))
