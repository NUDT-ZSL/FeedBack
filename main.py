"""Command-line entry point for the signal processing kernel.

Reads JSON commands from standard input, one per line, and writes one JSON
result per line to standard output.  Errors are reported as JSON objects
with an ``error`` field (and ``ok: false``); nothing is written to stdout
that is not a JSON line.

Supported commands (each is an object with a ``cmd`` field):

* ``load_signal``   {signal_id, sample_rate, samples|pairs, start_time?}
* ``design_filter`` {filter_id, kind, order, cutoff, window?}
* ``apply``         {signal_id, filter_id, result_id?}
* ``filtfilt``      {signal_id, filter_id, result_id?}
* ``spectrum``      {signal_id, window?, spectrum_id?}
* ``dominant``      {signal_id, top_n, window?}
* ``resample``      {signal_id, up, down, result_id?, record_id?}
* ``align``         {signal_ids, target_rate, align_id?}
* ``interp``        {align_id, signal_id, time}
* ``save``          {path}
* ``load``          {path}
* ``dump``          {}

Run directly:  python main.py   (then type JSON lines, Ctrl-D/Ctrl-Z to end)
"""

from __future__ import annotations

import json
import sys
from typing import Any, Dict

from signal_kernel import (
    Alignment,
    ResampleRecord,
    Signal,
    SignalKernelError,
    Workspace,
    align,
    apply_filter,
    design_filter,
    dominant_frequencies,
    filtfilt,
    resample,
    spectrum,
)


def _reject_constant(token: str) -> None:
    raise SignalKernelError(f"non-finite number {token!r} is not allowed in commands")


def _require(cmd: Dict[str, Any], key: str) -> Any:
    if key not in cmd:
        raise SignalKernelError(f"command {cmd.get('cmd')!r} is missing field {key!r}")
    return cmd[key]


def handle(ws: Workspace, cmd: Dict[str, Any]) -> Dict[str, Any]:
    """Execute one command against ``ws`` and return the JSON-able result."""
    if not isinstance(cmd, dict):
        raise SignalKernelError("each command line must be a JSON object")
    op = cmd.get("cmd")
    if not isinstance(op, str):
        raise SignalKernelError("command object must have a string 'cmd' field")

    if op == "load_signal":
        signal_id = _require(cmd, "signal_id")
        sample_rate = _require(cmd, "sample_rate")
        if "pairs" in cmd:
            signal = Signal.from_pairs(signal_id, sample_rate, cmd["pairs"])
        else:
            signal = Signal(
                signal_id,
                sample_rate,
                _require(cmd, "samples"),
                cmd.get("start_time", 0.0),
            )
        ws.add_signal(signal)
        return {
            "ok": True,
            "signal_id": signal.signal_id,
            "sample_rate": signal.sample_rate,
            "length": len(signal),
            "start_time": signal.start_time,
            "end_time": signal.end_time,
        }

    if op == "design_filter":
        filter_id = _require(cmd, "filter_id")
        filt = design_filter(
            _require(cmd, "kind"),
            _require(cmd, "order"),
            _require(cmd, "cutoff"),
            cmd.get("window", "hamming"),
        )
        ws.filters[filter_id] = filt
        return {
            "ok": True,
            "filter_id": filter_id,
            "kind": filt.kind,
            "order": filt.order,
            "taps": filt.taps,
            "group_delay_samples": filt.group_delay,
        }

    if op in ("apply", "filtfilt"):
        signal = ws.get_signal(_require(cmd, "signal_id"))
        filt = ws.get_filter(_require(cmd, "filter_id"))
        result_id = cmd.get("result_id") or f"{signal.signal_id}_{op}"
        fn = apply_filter if op == "apply" else filtfilt
        result = fn(signal, filt, new_id=result_id)
        ws.add_signal(result.filtered)
        ws.filter_results[result_id] = result
        out: Dict[str, Any] = {
            "ok": True,
            "result_id": result_id,
            "length": len(result.filtered),
            "zero_phase": result.zero_phase,
        }
        if op == "filtfilt":
            out["effective_order"] = 2 * filt.order
            out["note"] = (
                "zero-phase: forward+backward pass, effective order doubles "
                "and the magnitude response is squared"
            )
        return out

    if op == "spectrum":
        signal = ws.get_signal(_require(cmd, "signal_id"))
        spectrum_id = cmd.get("spectrum_id") or f"{signal.signal_id}_spectrum"
        sp = spectrum(signal, cmd.get("window"))
        ws.spectra[spectrum_id] = sp
        return {
            "ok": True,
            "spectrum_id": spectrum_id,
            "signal_id": signal.signal_id,
            "n_fft": sp.n_fft,
            "zero_padded": sp.zero_padded,
            "frequency_resolution": sp.frequency_resolution,
            "bins": len(sp.frequencies),
        }

    if op == "dominant":
        signal = ws.get_signal(_require(cmd, "signal_id"))
        peaks = dominant_frequencies(
            signal, _require(cmd, "top_n"), cmd.get("window")
        )
        return {
            "ok": True,
            "signal_id": signal.signal_id,
            "frequencies": [
                {"frequency": f, "magnitude": m} for f, m in peaks
            ],
        }

    if op == "resample":
        signal = ws.get_signal(_require(cmd, "signal_id"))
        result_id = cmd.get("result_id") or f"{signal.signal_id}_rs"
        record_id = cmd.get("record_id") or f"{result_id}_cfg"
        result = resample(
            signal, _require(cmd, "up"), _require(cmd, "down"), new_id=result_id
        )
        ws.add_signal(result.signal)
        ws.resamples[record_id] = ResampleRecord(
            record_id=record_id,
            source_id=signal.signal_id,
            result_id=result_id,
            up=result.up,
            down=result.down,
            cutoff_normalized=result.cutoff_normalized,
            cutoff_hz=result.cutoff_hz,
            group_delay_samples=result.group_delay_samples,
            group_delay_seconds=result.group_delay_seconds,
            filter_taps=result.filter_taps,
        )
        return {
            "ok": True,
            "result_id": result_id,
            "record_id": record_id,
            "sample_rate": result.signal.sample_rate,
            "length": len(result.signal),
            "cutoff_normalized": result.cutoff_normalized,
            "cutoff_hz": result.cutoff_hz,
            "group_delay_samples": result.group_delay_samples,
            "group_delay_seconds": result.group_delay_seconds,
        }

    if op == "align":
        signal_ids = _require(cmd, "signal_ids")
        if not isinstance(signal_ids, list) or not signal_ids:
            raise SignalKernelError("align requires a non-empty 'signal_ids' list")
        signals = [ws.get_signal(sid) for sid in signal_ids]
        align_id = cmd.get("align_id") or "alignment"
        alignment: Alignment = align(signals, _require(cmd, "target_rate"))
        ws.alignments[align_id] = alignment
        return {
            "ok": True,
            "align_id": align_id,
            "target_rate": alignment.target_rate,
            "start": alignment.start,
            "end": alignment.end,
            "signals": alignment.signal_ids(),
        }

    if op == "interp":
        align_id = _require(cmd, "align_id")
        try:
            alignment = ws.alignments[align_id]
        except KeyError:
            raise SignalKernelError(f"unknown align_id {align_id!r}") from None
        value, reason = alignment.interp(
            _require(cmd, "signal_id"), _require(cmd, "time")
        )
        out = {"ok": True, "value": value}
        if reason is not None:
            out["reason"] = reason
        return out

    if op == "save":
        path = _require(cmd, "path")
        ws.save(path)
        return {"ok": True, "path": path}

    if op == "load":
        path = _require(cmd, "path")
        ws.replace_with(Workspace.load(path))
        return {
            "ok": True,
            "path": path,
            "signals": len(ws.signals),
            "filters": len(ws.filters),
            "spectra": len(ws.spectra),
            "resamples": len(ws.resamples),
            "alignments": len(ws.alignments),
        }

    if op == "dump":
        out = {"ok": True}
        out.update(ws.dump())
        return out

    raise SignalKernelError(f"unknown command {op!r}")


def main() -> None:
    """Read JSON command lines from stdin, answer each with one JSON line."""
    ws = Workspace()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            cmd = json.loads(line, parse_constant=_reject_constant)
            response = handle(ws, cmd)
        except Exception as exc:  # every failure becomes one JSON error line
            response = {
                "ok": False,
                "error": str(exc),
                "error_type": type(exc).__name__,
            }
        sys.stdout.write(json.dumps(response, allow_nan=False) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
