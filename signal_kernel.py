"""Pure-standard-library offline signal processing kernel.

Provides, without numpy/scipy:

* :class:`Signal` -- uniformly sampled signal model with validation and a
  :meth:`Signal.from_pairs` constructor that checks the (time, value) grid.
* Window-method FIR filter design (:func:`design_filter`) for lowpass,
  highpass, bandpass and bandstop filters with rectangular/Hamming windows.
* Filtering: :func:`apply_filter` (linear convolution, zero-padded edges,
  same-length output) and :func:`filtfilt` (zero-phase forward/backward).
* Frequency analysis: radix-2 :func:`fft`, :func:`spectrum` (single-sided,
  window-gain normalized, zero-padding to the next power of two is recorded)
  and :func:`dominant_frequencies`.
* Sample-rate conversion: :func:`upsample`, :func:`downsample` and rational
  :func:`resample` with an anti-aliasing filter whose cutoff and group delay
  are reported in the :class:`ResampleResult`.
* Time-axis alignment: :func:`align` resamples several signals to a common
  rate, trims them to the common time range and offers linear interpolation
  via :meth:`Alignment.interp`.
* Persistence: :class:`Workspace` bundles signals, filters, spectra, resample
  records and alignments into one JSON file (:meth:`Workspace.save`) and
  rebuilds it with full consistency validation (:meth:`Workspace.load`).

All frequencies labelled "normalized" are cycles/sample, i.e. 0.5 is the
Nyquist frequency.
"""

from __future__ import annotations

import cmath
import json
import math
from dataclasses import dataclass, field
from fractions import Fraction
from typing import Dict, List, Optional, Sequence, Tuple

__all__ = [
    "SignalKernelError",
    "SignalValidationError",
    "FilterDesignError",
    "ResampleError",
    "AlignmentError",
    "PersistenceError",
    "Signal",
    "FIRFilter",
    "FilterResult",
    "Spectrum",
    "ResampleStage",
    "ResampleResult",
    "Alignment",
    "Workspace",
    "window_coeffs",
    "design_filter",
    "convolve_full",
    "apply_filter",
    "filtfilt",
    "next_pow2",
    "fft",
    "spectrum",
    "dominant_frequencies",
    "upsample",
    "downsample",
    "resample",
    "align",
]


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class SignalKernelError(Exception):
    """Base class for all errors raised by this kernel."""


class SignalValidationError(SignalKernelError, ValueError):
    """A signal definition (id, rate, samples, time grid) is invalid."""


class FilterDesignError(SignalKernelError, ValueError):
    """Filter design parameters (order, cutoff, window, kind) are invalid."""


class ResampleError(SignalKernelError, ValueError):
    """Resampling factors or configuration are invalid."""


class AlignmentError(SignalKernelError, ValueError):
    """Signals cannot be aligned (bad target rate, no time overlap, ...)."""


class PersistenceError(SignalKernelError):
    """A workspace file is unreadable, corrupt or inconsistent."""


# ---------------------------------------------------------------------------
# Signal model
# ---------------------------------------------------------------------------


def _is_finite_number(value: object) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
    )


@dataclass
class Signal:
    """A uniformly sampled real signal.

    Attributes:
        signal_id: Non-empty string, unique within a workspace.
        sample_rate: Positive sampling rate in Hz.
        samples: Sample values, at least one, all finite.
        start_time: Time in seconds of ``samples[0]``.
    """

    signal_id: str
    sample_rate: float
    samples: List[float]
    start_time: float = 0.0

    def __post_init__(self) -> None:
        if not isinstance(self.signal_id, str) or not self.signal_id:
            raise SignalValidationError(
                f"signal_id must be a non-empty string, got {self.signal_id!r}"
            )
        if not _is_finite_number(self.sample_rate) or self.sample_rate <= 0.0:
            raise SignalValidationError(
                f"sample_rate must be a positive finite number, got {self.sample_rate!r}"
            )
        self.sample_rate = float(self.sample_rate)
        if not _is_finite_number(self.start_time):
            raise SignalValidationError(
                f"start_time must be finite, got {self.start_time!r}"
            )
        self.start_time = float(self.start_time)
        if not isinstance(self.samples, (list, tuple)) or len(self.samples) < 1:
            raise SignalValidationError("samples must be a list with at least 1 value")
        coerced: List[float] = []
        for i, value in enumerate(self.samples):
            if not _is_finite_number(value):
                raise SignalValidationError(
                    f"samples[{i}] must be a finite number, got {value!r} "
                    "(NaN and Inf are not supported)"
                )
            coerced.append(float(value))
        self.samples = coerced

    def __len__(self) -> int:
        return len(self.samples)

    @property
    def duration(self) -> float:
        """Time span between the first and last sample, in seconds."""
        return (len(self.samples) - 1) / self.sample_rate

    @property
    def end_time(self) -> float:
        """Time in seconds of the last sample."""
        return self.start_time + self.duration

    def time_at(self, index: int) -> float:
        """Time in seconds of ``samples[index]``."""
        return self.start_time + index / self.sample_rate

    @classmethod
    def from_pairs(
        cls,
        signal_id: str,
        sample_rate: float,
        pairs: Sequence[Sequence[float]],
    ) -> "Signal":
        """Build a signal from ``(time, value)`` pairs.

        Times must be strictly increasing and every interval must match
        ``1 / sample_rate`` (relative tolerance 1e-6).  The first pair's time
        becomes ``start_time``.

        Raises:
            SignalValidationError: describing the first position where the
                time grid is not strictly increasing or deviates from the
                nominal sampling interval.
        """
        if not isinstance(pairs, (list, tuple)) or len(pairs) < 1:
            raise SignalValidationError("pairs must contain at least one (time, value) pair")
        times: List[float] = []
        values: List[float] = []
        for i, pair in enumerate(pairs):
            if not isinstance(pair, (list, tuple)) or len(pair) != 2:
                raise SignalValidationError(
                    f"pairs[{i}] must be a (time, value) pair, got {pair!r}"
                )
            t, v = pair
            if not _is_finite_number(t):
                raise SignalValidationError(f"pairs[{i}] time must be finite, got {t!r}")
            times.append(float(t))
            values.append(v)
        if not _is_finite_number(sample_rate) or sample_rate <= 0.0:
            raise SignalValidationError(
                f"sample_rate must be a positive finite number, got {sample_rate!r}"
            )
        dt = 1.0 / float(sample_rate)
        for i in range(1, len(times)):
            interval = times[i] - times[i - 1]
            if interval <= 0.0:
                raise SignalValidationError(
                    f"times must be strictly increasing; first violation at index {i} "
                    f"(times[{i - 1}]={times[i - 1]}, times[{i}]={times[i]})"
                )
            if not math.isclose(interval, dt, rel_tol=1e-6, abs_tol=1e-12):
                raise SignalValidationError(
                    f"sample interval mismatch: first deviation at index {i}: "
                    f"expected {dt} s (1/{sample_rate}), got {interval} s "
                    f"between times[{i - 1}]={times[i - 1]} and times[{i}]={times[i]}"
                )
        return cls(signal_id, float(sample_rate), values, times[0])


# ---------------------------------------------------------------------------
# FIR filter design (window method)
# ---------------------------------------------------------------------------

_FILTER_KINDS = ("lowpass", "highpass", "bandpass", "bandstop")


def window_coeffs(name: str, n: int) -> List[float]:
    """Return ``n`` coefficients of the named window ("rectangular"/"hamming").

    Raises:
        FilterDesignError: if the window name is unknown or ``n`` < 1.
    """
    if not isinstance(n, int) or n < 1:
        raise FilterDesignError(f"window length must be a positive integer, got {n!r}")
    if not isinstance(name, str):
        raise FilterDesignError(f"window name must be a string, got {name!r}")
    key = name.strip().lower()
    if key in ("rectangular", "rect", "boxcar"):
        return [1.0] * n
    if key == "hamming":
        if n == 1:
            return [1.0]
        return [0.54 - 0.46 * math.cos(2.0 * math.pi * i / (n - 1)) for i in range(n)]
    raise FilterDesignError(
        f"unknown window {name!r}; supported: 'rectangular', 'hamming'"
    )


def _validate_order(order: object) -> int:
    if isinstance(order, bool) or not isinstance(order, int):
        raise FilterDesignError(f"filter order must be an integer, got {order!r}")
    if order <= 0:
        raise FilterDesignError(f"filter order must be positive, got {order}")
    if order % 2 == 0:
        raise FilterDesignError(f"filter order must be odd, got {order}")
    return order


def _validate_cutoff_value(fc: object, name: str) -> float:
    if not _is_finite_number(fc):
        raise FilterDesignError(f"{name} cutoff must be a finite number, got {fc!r}")
    f = float(fc)
    if not 0.0 < f < 0.5:
        raise FilterDesignError(
            f"{name} cutoff must lie in the open interval (0, 0.5), got {f}"
        )
    return f


def _ideal_lowpass(fc: float, taps: int) -> List[float]:
    """Ideal (unwindowed) lowpass impulse response, cutoff ``fc`` cycles/sample."""
    c = (taps - 1) / 2.0
    h: List[float] = []
    for n in range(taps):
        d = n - c
        if d == 0.0:
            h.append(2.0 * fc)
        else:
            h.append(math.sin(2.0 * math.pi * fc * d) / (math.pi * d))
    return h


def _fractional_delta(taps: int) -> List[float]:
    """Ideal unit impulse centered between the two middle taps.

    For an even number of taps the delay ``(taps-1)/2`` is a half-integer, so
    the "delta" is the band-limited fractional-delay impulse ``sinc(n - c)``;
    this is what makes even-tap highpass/bandstop designs well defined.
    """
    c = (taps - 1) / 2.0
    out: List[float] = []
    for n in range(taps):
        d = n - c
        if d == 0.0:
            out.append(1.0)
        else:
            out.append(math.sin(math.pi * d) / (math.pi * d))
    return out


@dataclass
class FIRFilter:
    """A designed FIR filter.

    Attributes:
        kind: "lowpass" | "highpass" | "bandpass" | "bandstop".
        order: Filter order (positive odd); ``len(coefficients) == order + 1``.
        cutoff: One normalized cutoff (lowpass/highpass) or ``(low, high)``.
        window: Window name used in the design.
        coefficients: Impulse response, symmetric, length ``order + 1``.
    """

    kind: str
    order: int
    cutoff: Tuple[float, ...]
    window: str
    coefficients: List[float]

    @property
    def taps(self) -> int:
        """Number of coefficients (``order + 1``)."""
        return len(self.coefficients)

    @property
    def group_delay(self) -> float:
        """Group delay in samples (``order / 2``)."""
        return (len(self.coefficients) - 1) / 2.0

    def response(self, freq_norm: float) -> float:
        """Magnitude of the frequency response at normalized frequency
        ``freq_norm`` (0..0.5)."""
        return abs(
            sum(
                h * cmath.exp(-2j * math.pi * freq_norm * i)
                for i, h in enumerate(self.coefficients)
            )
        )


def design_filter(
    kind: str,
    order: int,
    cutoff: "float | Sequence[float]",
    window: str = "hamming",
) -> FIRFilter:
    """Design an FIR filter with the window method.

    Args:
        kind: "lowpass", "highpass", "bandpass" or "bandstop".
        order: Positive odd filter order (taps = order + 1).
        cutoff: Normalized cutoff in the open interval (0, 0.5); a single
            number for lowpass/highpass, a ``(low, high)`` pair with
            ``low < high`` for bandpass/bandstop.
        window: "rectangular" or "hamming".

    Returns:
        The designed :class:`FIRFilter`.

    Normalization convention (uniform across all four kinds): **the gain at
    the center of the passband is 1**.  The reference point is

    * lowpass: ``cutoff / 2``
    * highpass: ``(cutoff + 0.5) / 2``
    * bandpass: ``(low + high) / 2``
    * bandstop: both passband centers ``low / 2`` and ``(high + 0.5) / 2``
      are considered; the coefficients are scaled so the mean of the two
      gains is 1, keeping both ends of the passband equally close to 1.

    Note: with an odd order the tap count is even, and any symmetric
    even-tap FIR has a structural zero at f = 0.5, so a bandstop's upper
    passband rolls to 0 exactly at Nyquist; everywhere below that the
    passband stays within a few 1e-3 of 1.

    Raises:
        FilterDesignError: on any invalid parameter.
    """
    if kind not in _FILTER_KINDS:
        raise FilterDesignError(
            f"unknown filter kind {kind!r}; supported: {', '.join(_FILTER_KINDS)}"
        )
    _validate_order(order)
    if kind in ("lowpass", "highpass"):
        if isinstance(cutoff, (list, tuple)):
            raise FilterDesignError(
                f"{kind} takes a single cutoff frequency, got {cutoff!r}"
            )
        cutoffs = (_validate_cutoff_value(cutoff, kind),)
    else:
        if not isinstance(cutoff, (list, tuple)) or len(cutoff) != 2:
            raise FilterDesignError(
                f"{kind} takes a (low, high) cutoff pair, got {cutoff!r}"
            )
        low = _validate_cutoff_value(cutoff[0], f"{kind} lower")
        high = _validate_cutoff_value(cutoff[1], f"{kind} upper")
        if not low < high:
            raise FilterDesignError(
                f"{kind} requires low cutoff < high cutoff, got ({low}, {high})"
            )
        cutoffs = (low, high)

    taps = order + 1
    w = window_coeffs(window, taps)

    lp_low = _ideal_lowpass(cutoffs[0], taps)
    if kind == "lowpass":
        h = lp_low
        ref_freqs = (cutoffs[0] / 2.0,)
    elif kind == "highpass":
        delta = _fractional_delta(taps)
        h = [delta[n] - lp_low[n] for n in range(taps)]
        # Even tap counts force H(0.5) = 0, so normalize mid-passband.
        ref_freqs = ((cutoffs[0] + 0.5) / 2.0,)
    else:
        lp_high = _ideal_lowpass(cutoffs[1], taps)
        band = [lp_high[n] - lp_low[n] for n in range(taps)]
        if kind == "bandpass":
            h = band
            ref_freqs = ((cutoffs[0] + cutoffs[1]) / 2.0,)
        else:  # bandstop: two passbands, normalize on both centers
            delta = _fractional_delta(taps)
            h = [delta[n] - band[n] for n in range(taps)]
            ref_freqs = (cutoffs[0] / 2.0, (cutoffs[1] + 0.5) / 2.0)

    h = [h[n] * w[n] for n in range(taps)]

    # Normalize so the mean gain at the passband-center reference point(s)
    # is exactly 1 (see the convention in the docstring above).
    c = (taps - 1) / 2.0
    gains = [
        sum(h[n] * math.cos(2.0 * math.pi * f0 * (n - c)) for n in range(taps))
        for f0 in ref_freqs
    ]
    gain = sum(gains) / len(gains)
    if abs(gain) > 1e-12:
        h = [v / gain for v in h]

    return FIRFilter(kind=kind, order=order, cutoff=tuple(cutoffs), window=window, coefficients=h)


# ---------------------------------------------------------------------------
# Filtering
# ---------------------------------------------------------------------------


def convolve_full(x: Sequence[float], h: Sequence[float]) -> List[float]:
    """Full linear convolution of ``x`` and ``h`` (length ``len(x)+len(h)-1``)."""
    if len(x) == 0 or len(h) == 0:
        raise SignalKernelError("convolution requires two non-empty sequences")
    out = [0.0] * (len(x) + len(h) - 1)
    for i, xv in enumerate(x):
        if xv == 0.0:
            continue
        for j, hv in enumerate(h):
            out[i + j] += xv * hv
    return out


@dataclass
class FilterResult:
    """Result of filtering a signal; keeps both versions for per-sample queries.

    Attributes:
        original: The input signal.
        filtered: The filtered signal (same length and time axis as input).
        filter: The FIR filter that was applied.
        zero_phase: True when produced by :func:`filtfilt`.
    """

    original: Signal
    filtered: Signal
    filter: FIRFilter
    zero_phase: bool

    def sample(self, index: int) -> Tuple[float, float]:
        """Return ``(original, filtered)`` values at ``index``."""
        n = len(self.original.samples)
        if not 0 <= index < n:
            raise IndexError(f"sample index {index} out of range [0, {n})")
        return self.original.samples[index], self.filtered.samples[index]


def apply_filter(
    signal: Signal, filt: FIRFilter, new_id: Optional[str] = None
) -> FilterResult:
    """Filter ``signal`` with linear convolution.

    Edges are zero-padded and the output has the same length as the input
    (the full convolution is windowed around the filter's group delay of
    ``order/2`` samples; for odd orders this leaves a residual half-sample
    delay, which is inherent to an even number of taps).
    """
    full = convolve_full(signal.samples, filt.coefficients)
    start = (len(filt.coefficients) - 1) // 2
    out = full[start : start + len(signal.samples)]
    filtered = Signal(
        new_id or f"{signal.signal_id}_filtered",
        signal.sample_rate,
        out,
        signal.start_time,
    )
    return FilterResult(original=signal, filtered=filtered, filter=filt, zero_phase=False)


def filtfilt(
    signal: Signal, filt: FIRFilter, new_id: Optional[str] = None
) -> FilterResult:
    """Zero-phase filtering: apply the filter forward and backward.

    The signal is filtered, time-reversed, filtered again and re-reversed,
    so the phase shifts cancel.  Consequences compared to a single pass:

    * the **effective order doubles** (``2 * order``, i.e. the cascade has
      ``2 * order + 1`` equivalent taps);
    * the magnitude response is **squared**: passband deviation doubles,
      stopband attenuation doubles in dB, and the cutoff point moves from
      -3 dB to -6 dB;
    * the result has **zero phase distortion** (no group delay).
    """
    forward = convolve_full(signal.samples, filt.coefficients)
    start = (len(filt.coefficients) - 1) // 2
    forward = forward[start : start + len(signal.samples)]
    backward = convolve_full(forward[::-1], filt.coefficients)
    backward = backward[start : start + len(signal.samples)]
    out = backward[::-1]
    filtered = Signal(
        new_id or f"{signal.signal_id}_filtfilt",
        signal.sample_rate,
        out,
        signal.start_time,
    )
    return FilterResult(original=signal, filtered=filtered, filter=filt, zero_phase=True)


# ---------------------------------------------------------------------------
# FFT and spectrum
# ---------------------------------------------------------------------------


def next_pow2(n: int) -> int:
    """Smallest power of two >= ``n`` (``n`` must be >= 1)."""
    if n < 1:
        raise SignalKernelError(f"next_pow2 requires n >= 1, got {n}")
    p = 1
    while p < n:
        p <<= 1
    return p


def fft(x: Sequence[complex]) -> List[complex]:
    """Iterative radix-2 Cooley-Tukey FFT.

    The input length must be a power of two; use :func:`next_pow2` to pad
    otherwise.  Returns the DFT ``X[k] = sum_n x[n] * exp(-2j*pi*k*n/N)``.
    """
    n = len(x)
    if n == 0:
        raise SignalKernelError("fft requires a non-empty input")
    if n & (n - 1):
        raise SignalKernelError(f"fft length must be a power of two, got {n}")
    a = [complex(v) for v in x]
    # Bit-reversal permutation.
    j = 0
    for i in range(1, n):
        bit = n >> 1
        while j & bit:
            j ^= bit
            bit >>= 1
        j |= bit
        if i < j:
            a[i], a[j] = a[j], a[i]
    size = 2
    while size <= n:
        half = size // 2
        w_step = cmath.exp(-2j * math.pi / size)
        for base in range(0, n, size):
            w = 1.0 + 0.0j
            for k in range(base, base + half):
                u = a[k]
                v = a[k + half] * w
                a[k] = u + v
                a[k + half] = u - v
                w *= w_step
        size <<= 1
    return a


@dataclass
class Spectrum:
    """Single-sided amplitude/phase spectrum of a signal.

    Attributes:
        signal_id: Id of the analysed signal.
        sample_rate: Sampling rate in Hz.
        window: Window applied before the FFT ("rectangular" if none).
        n_fft: FFT length after zero-padding to a power of two.
        zero_padded: Number of zero samples appended to reach ``n_fft``.
        frequencies: Frequency axis in Hz, length ``n_fft // 2 + 1``.
        magnitudes: Amplitude spectrum, normalized by the window's coherent
            gain (sum of window coefficients) and doubled for non-DC/Nyquist
            bins, so a pure tone of amplitude A reads ~A.
        phases: Phase spectrum in radians.
    """

    signal_id: str
    sample_rate: float
    window: str
    n_fft: int
    zero_padded: int
    frequencies: List[float]
    magnitudes: List[float]
    phases: List[float]

    @property
    def frequency_resolution(self) -> float:
        """Bin spacing in Hz."""
        return self.sample_rate / self.n_fft

    def top(self, n: int) -> List[Tuple[float, float]]:
        """The ``n`` largest ``(frequency, magnitude)`` bins.

        Sorted by magnitude descending, ties broken by frequency ascending.
        """
        pairs = list(zip(self.frequencies, self.magnitudes))
        pairs.sort(key=lambda p: (-p[1], p[0]))
        return pairs[:n]


def spectrum(signal: Signal, window: Optional[str] = None) -> Spectrum:
    """Compute the single-sided spectrum of ``signal``.

    The samples are multiplied by the named window (rectangular when
    ``window`` is None), zero-padded to the next power of two, and
    transformed with the radix-2 FFT.  Magnitudes are normalized by the
    window's coherent gain so a pure tone's peak reads its amplitude.
    """
    name = "rectangular" if window is None else window
    n = len(signal.samples)
    w = window_coeffs(name, n)
    scale = sum(w)
    if scale == 0.0:
        raise SignalKernelError(f"window {name!r} has zero coherent gain")
    n_fft = next_pow2(n)
    padded = n_fft - n
    xw = [signal.samples[i] * w[i] for i in range(n)] + [0.0] * padded
    x = fft(xw)
    half = n_fft // 2
    freqs = [k * signal.sample_rate / n_fft for k in range(half + 1)]
    mags: List[float] = []
    phases: List[float] = []
    for k in range(half + 1):
        mag = abs(x[k]) / scale
        if 0 < k < half:  # single-sided: fold negative-frequency energy in
            mag *= 2.0
        mags.append(mag)
        phases.append(math.atan2(x[k].imag, x[k].real))
    return Spectrum(
        signal_id=signal.signal_id,
        sample_rate=signal.sample_rate,
        window=name,
        n_fft=n_fft,
        zero_padded=padded,
        frequencies=freqs,
        magnitudes=mags,
        phases=phases,
    )


def dominant_frequencies(
    signal: Signal, top_n: int, window: Optional[str] = None
) -> List[Tuple[float, float]]:
    """Return the ``top_n`` ``(frequency, magnitude)`` peaks of the signal.

    Sorted by magnitude descending, ties broken by frequency ascending.
    """
    if isinstance(top_n, bool) or not isinstance(top_n, int) or top_n < 1:
        raise SignalKernelError(f"top_n must be a positive integer, got {top_n!r}")
    return spectrum(signal, window).top(top_n)


# ---------------------------------------------------------------------------
# Sample-rate conversion
# ---------------------------------------------------------------------------


def _validate_factor(value: object, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ResampleError(f"{name} must be a positive integer, got {value!r}")
    return value


def _design_lowpass_taps(fc: float, taps: int, window: str = "hamming") -> List[float]:
    """Window-method lowpass with an arbitrary (odd) tap count, DC gain 1."""
    h = _ideal_lowpass(fc, taps)
    w = window_coeffs(window, taps)
    h = [a * b for a, b in zip(h, w)]
    gain = sum(h)
    if abs(gain) > 1e-12:
        h = [v / gain for v in h]
    return h


@dataclass
class ResampleStage:
    """One stage of a rational resampling chain.

    Attributes:
        kind: "interpolation" (zero-stuffing + lowpass) or "decimation"
            (anti-aliasing lowpass before decimation).
        factor: The stage's up/down factor.
        taps: Actual tap count of the stage's filter.
        cutoff_normalized: Filter cutoff as a fraction of the intermediate
            (upsampled) rate.
        cutoff_hz: Same cutoff in Hz of the intermediate rate.
        group_delay_samples: The stage filter's group delay, in
            intermediate-rate samples (``(taps - 1) / 2``).
    """

    kind: str
    factor: int
    taps: int
    cutoff_normalized: float
    cutoff_hz: float
    group_delay_samples: float

    def to_dict(self) -> dict:
        return {
            "kind": self.kind,
            "factor": self.factor,
            "taps": self.taps,
            "cutoff_normalized": self.cutoff_normalized,
            "cutoff_hz": self.cutoff_hz,
            "group_delay_samples": self.group_delay_samples,
        }

    @staticmethod
    def from_dict(data: object, where: str) -> "ResampleStage":
        if not isinstance(data, dict):
            raise PersistenceError(
                f"{where}: expected an object, got {type(data).__name__}"
            )
        required = (
            "kind",
            "factor",
            "taps",
            "cutoff_normalized",
            "cutoff_hz",
            "group_delay_samples",
        )
        missing = [k for k in required if k not in data]
        if missing:
            raise PersistenceError(f"{where}: missing field(s) {', '.join(missing)}")
        return ResampleStage(
            kind=str(data["kind"]),
            factor=int(data["factor"]),
            taps=int(data["taps"]),
            cutoff_normalized=float(data["cutoff_normalized"]),
            cutoff_hz=float(data["cutoff_hz"]),
            group_delay_samples=float(data["group_delay_samples"]),
        )


@dataclass
class ResampleResult:
    """Outcome of a resampling operation.

    Two different delay quantities are reported, and they must not be
    confused:

    * ``filter_group_delay_*`` — the delay the anti-aliasing filter chain
      itself introduces, accumulated from the actual tap counts of every
      stage (``sum((taps-1)/2)`` in intermediate-rate samples, divided by
      ``down`` for output samples).  Informational: it describes the
      filters, not the output time axis.
    * ``time_offset_*`` — the net shift of the output time axis relative to
      the input time axis.  This implementation compensates the filter
      delay exactly when slicing the decimated output, so the offset is
      0.0 and output sample ``k`` sits at
      ``signal.start_time + k / new_rate``.  Use *this* value (not the
      filter group delay) to align the resampled signal on a time axis.

    Attributes:
        signal: The resampled signal (rate ``old_rate * up / down``).
        up: Upsampling factor.
        down: Downsampling factor.
        cutoff_normalized: Effective anti-aliasing cutoff (the minimum of
            the stage cutoffs) as a fraction of the intermediate rate;
            None for a 1:1 copy.
        cutoff_hz: Same cutoff in Hz of the intermediate rate.
        stages: Per-stage filter details; delays accumulate over these.
        filter_group_delay_samples: Total filter chain delay in output
            samples.
        filter_group_delay_seconds: Total filter chain delay in seconds.
        time_offset_samples: Net output time-axis shift in output samples
            (0.0 — the filter delay is compensated).
        time_offset_seconds: Net output time-axis shift in seconds (0.0).
        aliasing_detected: True when the input carried significant energy
            (more than ``alias_threshold`` of the total) above the output
            Nyquist frequency.  That content is *removed* by the
            anti-aliasing filter; without filtering it would fold into
            ``[0, new_nyquist]``.
        aliased_band: ``(new_nyquist, old_nyquist)`` — the input band that
            was removed — when detected, else None.
        aliased_energy_ratio: Fraction of input spectral energy above the
            output Nyquist frequency (0 when not downsampling).
    """

    signal: Signal
    up: int
    down: int
    cutoff_normalized: Optional[float]
    cutoff_hz: Optional[float]
    stages: List[ResampleStage]
    filter_group_delay_samples: float
    filter_group_delay_seconds: float
    time_offset_samples: float
    time_offset_seconds: float
    aliasing_detected: bool
    aliased_band: Optional[Tuple[float, float]]
    aliased_energy_ratio: float

    @property
    def group_delay_samples(self) -> float:
        """Backward-compatible alias for ``filter_group_delay_samples``."""
        return self.filter_group_delay_samples

    @property
    def group_delay_seconds(self) -> float:
        """Backward-compatible alias for ``filter_group_delay_seconds``."""
        return self.filter_group_delay_seconds

    @property
    def filter_taps(self) -> int:
        """Total tap count across all stages."""
        return sum(s.taps for s in self.stages)


def _odd_taps(taps: int) -> int:
    """Coerce to a positive odd tap count (odd taps -> integer group delay)."""
    if isinstance(taps, bool) or not isinstance(taps, int) or taps < 1:
        raise ResampleError(f"taps must be a positive integer, got {taps!r}")
    return taps if taps % 2 == 1 else taps + 1


def resample(
    signal: Signal,
    up: int,
    down: int,
    new_id: Optional[str] = None,
    taps: Optional[int] = None,
    alias_threshold: float = 0.01,
) -> ResampleResult:
    """Resample ``signal`` by the rational factor ``up / down``.

    ``up`` and ``down`` must be positive coprime integers.  The chain runs
    as explicit stages at the intermediate rate ``sample_rate * up``:

    1. interpolation (only when ``up > 1``): zero-stuffing plus a lowpass
       at ``0.5 / up`` with gain ``up``;
    2. decimation (only when ``down > 1``): an anti-aliasing lowpass at
       ``0.5 / down``, then taking every ``down``-th sample.

    The output rate is ``signal.sample_rate * up / down``.  The stages'
    combined group delay is compensated exactly when slicing the output,
    so the output time axis stays aligned with the input (see
    :class:`ResampleResult` for the reported delay and offset values).

    When the output Nyquist frequency is below the input's, spectral
    energy above it is removed by the anti-aliasing filter; if that
    removed energy exceeds ``alias_threshold`` of the total, the result
    carries ``aliasing_detected=True`` and the removed band.

    Raises:
        ResampleError: non-positive or non-coprime factors, bad taps.
    """
    _validate_factor(up, "up")
    _validate_factor(down, "down")
    common = math.gcd(up, down)
    if common != 1:
        raise ResampleError(
            f"up and down must be coprime, got up={up}, down={down} (gcd={common})"
        )
    if not _is_finite_number(alias_threshold) or not 0.0 <= alias_threshold <= 1.0:
        raise ResampleError(
            f"alias_threshold must lie in [0, 1], got {alias_threshold!r}"
        )
    if up == 1 and down == 1:
        copied = Signal(
            new_id or f"{signal.signal_id}_rs",
            signal.sample_rate,
            list(signal.samples),
            signal.start_time,
        )
        return ResampleResult(
            signal=copied,
            up=1,
            down=1,
            cutoff_normalized=None,
            cutoff_hz=None,
            stages=[],
            filter_group_delay_samples=0.0,
            filter_group_delay_seconds=0.0,
            time_offset_samples=0.0,
            time_offset_seconds=0.0,
            aliasing_detected=False,
            aliased_band=None,
            aliased_energy_ratio=0.0,
        )

    intermediate_rate = signal.sample_rate * up
    n = len(signal.samples)
    stages: List[ResampleStage] = []
    total_delay = 0  # in intermediate-rate samples

    # Stage 1: zero-stuffing + interpolation lowpass.
    if up > 1:
        x_up = [0.0] * ((n - 1) * up + 1)
        x_up[::up] = signal.samples
        cutoff_a = 0.5 / up
        taps_a = _odd_taps(taps if taps is not None else 16 * up + 1)
        h = [up * v for v in _design_lowpass_taps(cutoff_a, taps_a)]
        y = convolve_full(x_up, h)
        delay_a = (taps_a - 1) // 2
        total_delay += delay_a
        stages.append(
            ResampleStage(
                "interpolation", up, taps_a, cutoff_a,
                cutoff_a * intermediate_rate, float(delay_a),
            )
        )
    else:
        y = list(signal.samples)

    # Stage 2: anti-aliasing lowpass before decimation.
    if down > 1:
        cutoff_b = 0.5 / down
        taps_b = _odd_taps(taps if taps is not None else 16 * down + 1)
        y = convolve_full(y, _design_lowpass_taps(cutoff_b, taps_b))
        delay_b = (taps_b - 1) // 2
        total_delay += delay_b
        stages.append(
            ResampleStage(
                "decimation", down, taps_b, cutoff_b,
                cutoff_b * intermediate_rate, float(delay_b),
            )
        )

    # Decimate, compensating the accumulated filter delay exactly: output
    # sample k is intermediate sample k*down + total_delay, whose
    # delay-corrected time is k*down/intermediate_rate = k/new_rate.
    count = ((n - 1) * up) // down + 1
    out = [y[k * down + total_delay] for k in range(count)]

    new_rate = signal.sample_rate * up / down
    result = Signal(
        new_id or f"{signal.signal_id}_rs", new_rate, out, signal.start_time
    )
    effective_cutoff = min(s.cutoff_normalized for s in stages)

    # Aliasing detection: measure input energy above the output Nyquist.
    aliasing_detected = False
    aliased_band: Optional[Tuple[float, float]] = None
    energy_ratio = 0.0
    new_nyquist = new_rate / 2.0
    old_nyquist = signal.sample_rate / 2.0
    if new_nyquist < old_nyquist:
        sp = spectrum(signal)
        total_energy = sum(m * m for m in sp.magnitudes)
        above_energy = sum(
            m * m for f, m in zip(sp.frequencies, sp.magnitudes) if f > new_nyquist
        )
        energy_ratio = above_energy / total_energy if total_energy > 0.0 else 0.0
        if energy_ratio > alias_threshold:
            aliasing_detected = True
            aliased_band = (new_nyquist, old_nyquist)

    return ResampleResult(
        signal=result,
        up=up,
        down=down,
        cutoff_normalized=effective_cutoff,
        cutoff_hz=effective_cutoff * intermediate_rate,
        stages=stages,
        filter_group_delay_samples=total_delay / down,
        filter_group_delay_seconds=total_delay / intermediate_rate,
        time_offset_samples=0.0,
        time_offset_seconds=0.0,
        aliasing_detected=aliasing_detected,
        aliased_band=aliased_band,
        aliased_energy_ratio=energy_ratio,
    )


def upsample(
    signal: Signal, factor: int, new_id: Optional[str] = None
) -> ResampleResult:
    """Upsample by an integer ``factor``: zero-stuffing plus lowpass at
    ``0.5 / factor`` of the new rate."""
    _validate_factor(factor, "factor")
    return resample(signal, factor, 1, new_id=new_id)


def downsample(
    signal: Signal, factor: int, new_id: Optional[str] = None
) -> ResampleResult:
    """Downsample by an integer ``factor``: lowpass anti-aliasing at
    ``0.5 / factor`` of the old rate, then decimation."""
    _validate_factor(factor, "factor")
    return resample(signal, 1, factor, new_id=new_id)


# ---------------------------------------------------------------------------
# Time-axis alignment
# ---------------------------------------------------------------------------


@dataclass
class Alignment:
    """Several signals resampled to a common rate and trimmed to the common
    time range.

    Attributes:
        signals: The aligned signals (all at ``target_rate``).
        target_rate: Common sampling rate in Hz.
        start: Start of the common time range (seconds).
        end: End of the common time range (seconds).
        aliasing: Per-signal dict ``{signal_id: {"detected": bool,
            "aliased_band": [low, high] | None, "energy_ratio": float,
            "note": str | None}}`` reporting whether resampling to
            ``target_rate`` had to remove energy above the new Nyquist
            frequency (that content is attenuated by the anti-aliasing
            filter; unfiltered it would fold into ``[0, target_rate/2]``).
    """

    signals: List[Signal]
    target_rate: float
    start: float
    end: float
    aliasing: Dict[str, dict] = field(default_factory=dict)

    def signal_ids(self) -> List[str]:
        """Ids of the aligned signals, in order."""
        return [s.signal_id for s in self.signals]

    def get(self, signal_id: str) -> Signal:
        """Return the aligned signal with ``signal_id``."""
        for s in self.signals:
            if s.signal_id == signal_id:
                return s
        raise AlignmentError(
            f"no signal {signal_id!r} in this alignment; have {self.signal_ids()}"
        )

    def interp(self, signal_id: str, t: float) -> Tuple[Optional[float], Optional[str]]:
        """Linearly interpolate ``signal_id`` at time ``t`` (seconds).

        Returns ``(value, None)`` on success, or ``(None, reason)`` when
        ``t`` lies outside the aligned signal's time range.
        """
        sig = self.get(signal_id)
        if not _is_finite_number(t):
            return None, f"time must be finite, got {t!r}"
        a, b = sig.start_time, sig.end_time
        tol = 1e-9 * max(1.0, abs(a), abs(b))
        if t < a - tol:
            return None, (
                f"time {t} is before the aligned range of {signal_id!r} "
                f"[{a}, {b}]"
            )
        if t > b + tol:
            return None, (
                f"time {t} is after the aligned range of {signal_id!r} "
                f"[{a}, {b}]"
            )
        pos = (t - a) * sig.sample_rate
        i = int(math.floor(pos))
        if i >= len(sig.samples) - 1:
            return sig.samples[-1], None
        frac = pos - i
        return sig.samples[i] * (1.0 - frac) + sig.samples[i + 1] * frac, None


def align(
    signals: Sequence[Signal],
    target_rate: float,
    max_ratio: int = 1000,
    alias_threshold: float = 0.01,
) -> Alignment:
    """Resample ``signals`` to ``target_rate`` and align them on a common
    time axis.

    Each signal is rationally resampled (its own ``start_time`` is kept),
    then all are trimmed to the overlapping time range.  Content above the
    target Nyquist frequency is removed by the resampling anti-aliasing
    filter; when a signal loses more than ``alias_threshold`` of its
    spectral energy that way, the returned ``Alignment.aliasing`` marks it
    with ``detected=True`` and names the removed band (which would
    otherwise fold into ``[0, target_rate / 2]``).

    Raises:
        AlignmentError: empty input, duplicate ids, invalid target rate, an
            extreme resampling ratio, or no common time overlap.
    """
    signals = list(signals)
    if not signals:
        raise AlignmentError("align requires at least one signal")
    ids = [s.signal_id for s in signals]
    if len(set(ids)) != len(ids):
        raise AlignmentError(f"duplicate signal ids in align: {ids}")
    if not _is_finite_number(target_rate) or target_rate <= 0.0:
        raise AlignmentError(
            f"target_rate must be a positive finite number, got {target_rate!r}"
        )
    target = Fraction(target_rate).limit_denominator(10**6)

    resampled: List[Signal] = []
    aliasing: Dict[str, dict] = {}
    for s in signals:
        ratio = target / Fraction(s.sample_rate).limit_denominator(10**6)
        up, down = ratio.numerator, ratio.denominator
        if max(up, down) > max_ratio:
            raise AlignmentError(
                f"resampling ratio {up}/{down} for signal {s.signal_id!r} is too "
                f"extreme (limit {max_ratio})"
            )
        r = resample(s, up, down, new_id=s.signal_id, alias_threshold=alias_threshold)
        resampled.append(r.signal)
        new_nyquist = r.signal.sample_rate / 2.0
        aliasing[s.signal_id] = {
            "detected": r.aliasing_detected,
            "aliased_band": list(r.aliased_band) if r.aliased_band else None,
            "energy_ratio": r.aliased_energy_ratio,
            "note": (
                f"input energy above the new Nyquist frequency {new_nyquist} Hz "
                f"was removed by the anti-aliasing filter; unfiltered it would "
                f"fold into [0, {new_nyquist}] Hz"
                if r.aliasing_detected
                else None
            ),
        }

    t0 = max(s.start_time for s in resampled)
    t1 = min(s.end_time for s in resampled)
    tol = 1e-9 * max(1.0, abs(t0), abs(t1))
    if t0 > t1 + tol:
        raise AlignmentError(
            f"signals have no common time range: latest start is {t0} s but "
            f"earliest end is {t1} s"
        )

    trimmed: List[Signal] = []
    for s in resampled:
        rate = s.sample_rate
        k0 = max(0, math.ceil((t0 - s.start_time) * rate - 1e-9))
        k1 = min(len(s.samples) - 1, math.floor((t1 - s.start_time) * rate + 1e-9))
        if k1 < k0:
            raise AlignmentError(
                f"signal {s.signal_id!r} has no samples inside the common range "
                f"[{t0}, {t1}]"
            )
        trimmed.append(
            Signal(s.signal_id, rate, s.samples[k0 : k1 + 1], s.start_time + k0 / rate)
        )

    start = max(s.start_time for s in trimmed)
    end = min(s.end_time for s in trimmed)
    return Alignment(
        signals=trimmed,
        target_rate=float(target_rate),
        start=start,
        end=end,
        aliasing=aliasing,
    )


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------

WORKSPACE_FORMAT = "signal-kernel-workspace"
WORKSPACE_VERSION = 1


def _reject_json_constant(token: str) -> None:
    raise PersistenceError(f"non-finite number {token!r} is not allowed")


def _signal_to_dict(s: Signal) -> dict:
    return {
        "signal_id": s.signal_id,
        "sample_rate": s.sample_rate,
        "samples": list(s.samples),
        "start_time": s.start_time,
    }


def _signal_from_dict(data: object, where: str) -> Signal:
    if not isinstance(data, dict):
        raise PersistenceError(f"{where}: expected an object, got {type(data).__name__}")
    missing = [k for k in ("signal_id", "sample_rate", "samples") if k not in data]
    if missing:
        raise PersistenceError(f"{where}: missing field(s) {', '.join(missing)}")
    try:
        return Signal(
            data["signal_id"],
            data["sample_rate"],
            data["samples"],
            data.get("start_time", 0.0),
        )
    except SignalValidationError as exc:
        raise PersistenceError(f"{where}: {exc}") from exc


def _filter_to_dict(filter_id: str, f: FIRFilter) -> dict:
    return {
        "filter_id": filter_id,
        "kind": f.kind,
        "order": f.order,
        "cutoff": list(f.cutoff),
        "window": f.window,
        "coefficients": list(f.coefficients),
    }


def _filter_from_dict(data: object, where: str) -> Tuple[str, FIRFilter]:
    if not isinstance(data, dict):
        raise PersistenceError(f"{where}: expected an object, got {type(data).__name__}")
    missing = [
        k
        for k in ("filter_id", "kind", "order", "cutoff", "window", "coefficients")
        if k not in data
    ]
    if missing:
        raise PersistenceError(f"{where}: missing field(s) {', '.join(missing)}")
    filter_id = data["filter_id"]
    if not isinstance(filter_id, str) or not filter_id:
        raise PersistenceError(f"{where}: filter_id must be a non-empty string")
    cutoff = data["cutoff"]
    if (
        data["kind"] in ("lowpass", "highpass")
        and isinstance(cutoff, list)
        and len(cutoff) == 1
    ):
        cutoff = cutoff[0]  # single cutoffs are stored as one-element lists
    try:
        redesigned = design_filter(data["kind"], data["order"], cutoff, data["window"])
    except FilterDesignError as exc:
        raise PersistenceError(f"{where}: invalid filter parameters: {exc}") from exc
    coeffs = data["coefficients"]
    if (
        not isinstance(coeffs, list)
        or len(coeffs) != redesigned.taps
        or not all(_is_finite_number(c) for c in coeffs)
    ):
        raise PersistenceError(
            f"{where}: coefficients must be {redesigned.taps} finite numbers"
        )
    for i, (stored, expected) in enumerate(zip(coeffs, redesigned.coefficients)):
        if not math.isclose(stored, expected, rel_tol=1e-9, abs_tol=1e-12):
            raise PersistenceError(
                f"{where}: coefficients[{i}]={stored} is inconsistent with the "
                f"stored design parameters (expected {expected})"
            )
    return filter_id, redesigned


def _spectrum_to_dict(spectrum_id: str, sp: Spectrum) -> dict:
    return {
        "spectrum_id": spectrum_id,
        "signal_id": sp.signal_id,
        "sample_rate": sp.sample_rate,
        "window": sp.window,
        "n_fft": sp.n_fft,
        "zero_padded": sp.zero_padded,
        "frequencies": list(sp.frequencies),
        "magnitudes": list(sp.magnitudes),
        "phases": list(sp.phases),
    }


def _spectrum_from_dict(data: object, where: str) -> Tuple[str, Spectrum]:
    if not isinstance(data, dict):
        raise PersistenceError(f"{where}: expected an object, got {type(data).__name__}")
    required = (
        "spectrum_id",
        "signal_id",
        "sample_rate",
        "window",
        "n_fft",
        "zero_padded",
        "frequencies",
        "magnitudes",
        "phases",
    )
    missing = [k for k in required if k not in data]
    if missing:
        raise PersistenceError(f"{where}: missing field(s) {', '.join(missing)}")
    spectrum_id = data["spectrum_id"]
    if not isinstance(spectrum_id, str) or not spectrum_id:
        raise PersistenceError(f"{where}: spectrum_id must be a non-empty string")
    n_fft = data["n_fft"]
    if not isinstance(n_fft, int) or n_fft < 1 or (n_fft & (n_fft - 1)):
        raise PersistenceError(f"{where}: n_fft must be a power of two, got {n_fft!r}")
    zero_padded = data["zero_padded"]
    if not isinstance(zero_padded, int) or zero_padded < 0 or zero_padded >= n_fft:
        raise PersistenceError(
            f"{where}: zero_padded must be in [0, n_fft), got {zero_padded!r}"
        )
    if not _is_finite_number(data["sample_rate"]) or data["sample_rate"] <= 0:
        raise PersistenceError(
            f"{where}: sample_rate must be positive, got {data['sample_rate']!r}"
        )
    freqs, mags, phases = data["frequencies"], data["magnitudes"], data["phases"]
    expected_len = n_fft // 2 + 1
    for name, arr in (("frequencies", freqs), ("magnitudes", mags), ("phases", phases)):
        if not isinstance(arr, list) or len(arr) != expected_len:
            raise PersistenceError(
                f"{where}: {name} must have {expected_len} entries (n_fft//2+1)"
            )
        if not all(_is_finite_number(v) for v in arr):
            raise PersistenceError(f"{where}: {name} contains non-finite values")
    return spectrum_id, Spectrum(
        signal_id=str(data["signal_id"]),
        sample_rate=float(data["sample_rate"]),
        window=str(data["window"]),
        n_fft=n_fft,
        zero_padded=zero_padded,
        frequencies=[float(v) for v in freqs],
        magnitudes=[float(v) for v in mags],
        phases=[float(v) for v in phases],
    )


@dataclass
class ResampleRecord:
    """Persisted configuration and outcome metadata of a resample call.

    The delay fields keep the same distinction as :class:`ResampleResult`:
    ``group_delay_*`` is what the filter chain introduces, while
    ``time_offset_*`` is the net output time-axis shift (0.0 here, since
    the delay is compensated) that callers use for alignment.
    """

    record_id: str
    source_id: str
    result_id: str
    up: int
    down: int
    cutoff_normalized: Optional[float]
    cutoff_hz: Optional[float]
    group_delay_samples: float
    group_delay_seconds: float
    filter_taps: int
    stages: List[ResampleStage] = field(default_factory=list)
    time_offset_samples: float = 0.0
    time_offset_seconds: float = 0.0
    aliasing_detected: bool = False
    aliased_band: Optional[Tuple[float, float]] = None
    aliased_energy_ratio: float = 0.0

    def to_dict(self) -> dict:
        return {
            "record_id": self.record_id,
            "source_id": self.source_id,
            "result_id": self.result_id,
            "up": self.up,
            "down": self.down,
            "cutoff_normalized": self.cutoff_normalized,
            "cutoff_hz": self.cutoff_hz,
            "group_delay_samples": self.group_delay_samples,
            "group_delay_seconds": self.group_delay_seconds,
            "filter_taps": self.filter_taps,
            "stages": [s.to_dict() for s in self.stages],
            "time_offset_samples": self.time_offset_samples,
            "time_offset_seconds": self.time_offset_seconds,
            "aliasing_detected": self.aliasing_detected,
            "aliased_band": list(self.aliased_band) if self.aliased_band else None,
            "aliased_energy_ratio": self.aliased_energy_ratio,
        }

    @staticmethod
    def from_dict(data: object, where: str) -> "ResampleRecord":
        if not isinstance(data, dict):
            raise PersistenceError(
                f"{where}: expected an object, got {type(data).__name__}"
            )
        required = (
            "record_id",
            "source_id",
            "result_id",
            "up",
            "down",
            "cutoff_normalized",
            "cutoff_hz",
            "group_delay_samples",
            "group_delay_seconds",
            "filter_taps",
        )
        missing = [k for k in required if k not in data]
        if missing:
            raise PersistenceError(f"{where}: missing field(s) {', '.join(missing)}")
        try:
            up = _validate_factor(data["up"], "up")
            down = _validate_factor(data["down"], "down")
        except ResampleError as exc:
            raise PersistenceError(f"{where}: {exc}") from exc
        common = math.gcd(up, down)
        if common != 1:
            raise PersistenceError(
                f"{where}: up and down must be coprime, got up={up}, down={down}"
            )
        cutoff_norm = data["cutoff_normalized"]
        if cutoff_norm is not None:
            if not _is_finite_number(cutoff_norm) or not 0.0 < cutoff_norm < 0.5:
                raise PersistenceError(
                    f"{where}: cutoff_normalized must be in (0, 0.5) or null, "
                    f"got {cutoff_norm!r}"
                )
        # Newer fields are optional so older workspace files still load.
        stages = [
            ResampleStage.from_dict(item, f"{where}.stages[{i}]")
            for i, item in enumerate(data.get("stages", []))
        ]
        aliased_band = data.get("aliased_band")
        if aliased_band is not None:
            if (
                not isinstance(aliased_band, list)
                or len(aliased_band) != 2
                or not all(_is_finite_number(v) for v in aliased_band)
            ):
                raise PersistenceError(
                    f"{where}: aliased_band must be null or a [low, high] pair"
                )
            aliased_band = (float(aliased_band[0]), float(aliased_band[1]))
        return ResampleRecord(
            record_id=str(data["record_id"]),
            source_id=str(data["source_id"]),
            result_id=str(data["result_id"]),
            up=up,
            down=down,
            cutoff_normalized=cutoff_norm,
            cutoff_hz=data["cutoff_hz"],
            group_delay_samples=float(data["group_delay_samples"]),
            group_delay_seconds=float(data["group_delay_seconds"]),
            filter_taps=int(data["filter_taps"]),
            stages=stages,
            time_offset_samples=float(data.get("time_offset_samples", 0.0)),
            time_offset_seconds=float(data.get("time_offset_seconds", 0.0)),
            aliasing_detected=bool(data.get("aliasing_detected", False)),
            aliased_band=aliased_band,
            aliased_energy_ratio=float(data.get("aliased_energy_ratio", 0.0)),
        )


def _alignment_to_dict(align_id: str, al: Alignment) -> dict:
    return {
        "align_id": align_id,
        "target_rate": al.target_rate,
        "start": al.start,
        "end": al.end,
        "signals": [_signal_to_dict(s) for s in al.signals],
        "aliasing": al.aliasing,
    }


def _alignment_from_dict(data: object, where: str) -> Tuple[str, Alignment]:
    if not isinstance(data, dict):
        raise PersistenceError(f"{where}: expected an object, got {type(data).__name__}")
    missing = [
        k for k in ("align_id", "target_rate", "start", "end", "signals") if k not in data
    ]
    if missing:
        raise PersistenceError(f"{where}: missing field(s) {', '.join(missing)}")
    align_id = data["align_id"]
    if not isinstance(align_id, str) or not align_id:
        raise PersistenceError(f"{where}: align_id must be a non-empty string")
    if not _is_finite_number(data["target_rate"]) or data["target_rate"] <= 0:
        raise PersistenceError(
            f"{where}: target_rate must be positive, got {data['target_rate']!r}"
        )
    if not (_is_finite_number(data["start"]) and _is_finite_number(data["end"])):
        raise PersistenceError(f"{where}: start/end must be finite")
    if data["start"] > data["end"] + 1e-9:
        raise PersistenceError(
            f"{where}: start ({data['start']}) is after end ({data['end']})"
        )
    if not isinstance(data["signals"], list) or not data["signals"]:
        raise PersistenceError(f"{where}: signals must be a non-empty list")
    sigs = [
        _signal_from_dict(item, f"{where}.signals[{i}]")
        for i, item in enumerate(data["signals"])
    ]
    ids = [s.signal_id for s in sigs]
    if len(set(ids)) != len(ids):
        raise PersistenceError(f"{where}: duplicate signal ids {ids}")
    aliasing_raw = data.get("aliasing", {})
    if not isinstance(aliasing_raw, dict):
        raise PersistenceError(f"{where}: aliasing must be an object")
    aliasing: Dict[str, dict] = {}
    for sid, entry in aliasing_raw.items():
        if not isinstance(entry, dict) or "detected" not in entry:
            raise PersistenceError(
                f"{where}.aliasing[{sid!r}]: expected an object with a 'detected' field"
            )
        aliasing[str(sid)] = {
            "detected": bool(entry["detected"]),
            "aliased_band": entry.get("aliased_band"),
            "energy_ratio": float(entry.get("energy_ratio", 0.0)),
            "note": entry.get("note"),
        }
    return align_id, Alignment(
        signals=sigs,
        target_rate=float(data["target_rate"]),
        start=float(data["start"]),
        end=float(data["end"]),
        aliasing=aliasing,
    )


class Workspace:
    """A named collection of signals, filters, spectra, resample records and
    alignments, with JSON persistence."""

    def __init__(self) -> None:
        self.signals: Dict[str, Signal] = {}
        self.filters: Dict[str, FIRFilter] = {}
        self.spectra: Dict[str, Spectrum] = {}
        self.resamples: Dict[str, ResampleRecord] = {}
        self.alignments: Dict[str, Alignment] = {}
        self.filter_results: Dict[str, FilterResult] = {}

    # -- mutation helpers ---------------------------------------------------

    def add_signal(self, signal: Signal) -> Signal:
        """Register ``signal``; its id must not already be in use."""
        if signal.signal_id in self.signals:
            raise SignalKernelError(
                f"signal_id {signal.signal_id!r} already exists in this workspace"
            )
        self.signals[signal.signal_id] = signal
        return signal

    def get_signal(self, signal_id: str) -> Signal:
        """Return the signal registered under ``signal_id``."""
        try:
            return self.signals[signal_id]
        except KeyError:
            raise SignalKernelError(f"unknown signal_id {signal_id!r}") from None

    def get_filter(self, filter_id: str) -> FIRFilter:
        """Return the filter registered under ``filter_id``."""
        try:
            return self.filters[filter_id]
        except KeyError:
            raise SignalKernelError(f"unknown filter_id {filter_id!r}") from None

    # -- persistence --------------------------------------------------------

    def to_dict(self) -> dict:
        """Serialize the whole workspace to a JSON-compatible dict."""
        return {
            "format": WORKSPACE_FORMAT,
            "version": WORKSPACE_VERSION,
            "signals": [_signal_to_dict(s) for s in self.signals.values()],
            "filters": [
                _filter_to_dict(fid, f) for fid, f in self.filters.items()
            ],
            "spectra": [
                _spectrum_to_dict(sid, sp) for sid, sp in self.spectra.items()
            ],
            "resamples": [r.to_dict() for r in self.resamples.values()],
            "alignments": [
                _alignment_to_dict(aid, al) for aid, al in self.alignments.items()
            ],
        }

    def save(self, path: str) -> None:
        """Write the workspace to ``path`` as one JSON file."""
        try:
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(self.to_dict(), fh, allow_nan=False)
        except (OSError, ValueError) as exc:
            raise PersistenceError(f"failed to save workspace to {path!r}: {exc}") from exc

    @classmethod
    def load(cls, path: str) -> "Workspace":
        """Rebuild a workspace from ``path``, validating consistency.

        Every section is checked: signal ids must be unique, sample rates
        positive, samples finite, filter orders positive odd (and stored
        coefficients must match the stored design parameters), resample
        up/down coprime, spectrum arrays consistent with ``n_fft``, and
        alignment time ranges sane.  Any violation raises
        :class:`PersistenceError` with a message locating the problem.
        """
        try:
            with open(path, "r", encoding="utf-8") as fh:
                text = fh.read()
        except OSError as exc:
            raise PersistenceError(f"cannot read {path!r}: {exc}") from exc
        try:
            data = json.loads(text, parse_constant=_reject_json_constant)
        except PersistenceError:
            raise
        except json.JSONDecodeError as exc:
            raise PersistenceError(
                f"{path!r}: invalid JSON at line {exc.lineno} column {exc.colno}: "
                f"{exc.msg}"
            ) from exc
        if not isinstance(data, dict):
            raise PersistenceError(f"{path!r}: top level must be a JSON object")
        if data.get("format") != WORKSPACE_FORMAT:
            raise PersistenceError(
                f"{path!r}: not a {WORKSPACE_FORMAT} file "
                f"(format={data.get('format')!r})"
            )
        if data.get("version") != WORKSPACE_VERSION:
            raise PersistenceError(
                f"{path!r}: unsupported version {data.get('version')!r}, "
                f"expected {WORKSPACE_VERSION}"
            )
        sections = ("signals", "filters", "spectra", "resamples", "alignments")
        for section in sections:
            if section not in data:
                raise PersistenceError(
                    f"{path!r}: missing required section {section!r}"
                )
            if not isinstance(data[section], list):
                raise PersistenceError(f"{path!r}: section {section!r} must be a list")

        ws = cls()
        for i, item in enumerate(data["signals"]):
            sig = _signal_from_dict(item, f"signals[{i}]")
            if sig.signal_id in ws.signals:
                raise PersistenceError(
                    f"signals[{i}]: duplicate signal_id {sig.signal_id!r}"
                )
            ws.signals[sig.signal_id] = sig
        for i, item in enumerate(data["filters"]):
            filter_id, filt = _filter_from_dict(item, f"filters[{i}]")
            if filter_id in ws.filters:
                raise PersistenceError(
                    f"filters[{i}]: duplicate filter_id {filter_id!r}"
                )
            ws.filters[filter_id] = filt
        for i, item in enumerate(data["spectra"]):
            spectrum_id, sp = _spectrum_from_dict(item, f"spectra[{i}]")
            if spectrum_id in ws.spectra:
                raise PersistenceError(
                    f"spectra[{i}]: duplicate spectrum_id {spectrum_id!r}"
                )
            ws.spectra[spectrum_id] = sp
        for i, item in enumerate(data["resamples"]):
            record = ResampleRecord.from_dict(item, f"resamples[{i}]")
            if record.record_id in ws.resamples:
                raise PersistenceError(
                    f"resamples[{i}]: duplicate record_id {record.record_id!r}"
                )
            for ref, role in ((record.source_id, "source_id"), (record.result_id, "result_id")):
                if ref not in ws.signals:
                    raise PersistenceError(
                        f"resamples[{i}]: {role} {ref!r} has no matching signal"
                    )
            ws.resamples[record.record_id] = record
        for i, item in enumerate(data["alignments"]):
            align_id, al = _alignment_from_dict(item, f"alignments[{i}]")
            if align_id in ws.alignments:
                raise PersistenceError(
                    f"alignments[{i}]: duplicate align_id {align_id!r}"
                )
            ws.alignments[align_id] = al
        return ws

    def replace_with(self, other: "Workspace") -> None:
        """Replace this workspace's contents with ``other``'s (used by load)."""
        self.signals = other.signals
        self.filters = other.filters
        self.spectra = other.spectra
        self.resamples = other.resamples
        self.alignments = other.alignments
        self.filter_results = other.filter_results

    def dump(self) -> dict:
        """A compact summary of everything stored in the workspace."""
        return {
            "signals": {
                sid: {
                    "sample_rate": s.sample_rate,
                    "length": len(s.samples),
                    "start_time": s.start_time,
                    "end_time": s.end_time,
                }
                for sid, s in self.signals.items()
            },
            "filters": {
                fid: {
                    "kind": f.kind,
                    "order": f.order,
                    "cutoff": list(f.cutoff),
                    "window": f.window,
                    "taps": f.taps,
                }
                for fid, f in self.filters.items()
            },
            "spectra": {
                sid: {
                    "signal_id": sp.signal_id,
                    "n_fft": sp.n_fft,
                    "zero_padded": sp.zero_padded,
                    "window": sp.window,
                }
                for sid, sp in self.spectra.items()
            },
            "resamples": {rid: r.to_dict() for rid, r in self.resamples.items()},
            "alignments": {
                aid: {
                    "target_rate": al.target_rate,
                    "start": al.start,
                    "end": al.end,
                    "signals": al.signal_ids(),
                    "aliasing": al.aliasing,
                }
                for aid, al in self.alignments.items()
            },
        }
