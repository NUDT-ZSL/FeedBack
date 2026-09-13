"""Unit tests for the pure-stdlib signal processing kernel."""

from __future__ import annotations

import cmath
import json
import math
import os
import tempfile
import unittest

import main as cli
from signal_kernel import (
    AlignmentError,
    FilterDesignError,
    PersistenceError,
    ResampleError,
    Signal,
    SignalKernelError,
    SignalValidationError,
    Workspace,
    align,
    apply_filter,
    convolve_full,
    design_filter,
    dominant_frequencies,
    fft,
    filtfilt,
    next_pow2,
    resample,
    spectrum,
)


def sine_signal(
    signal_id: str,
    freq: float,
    sample_rate: float,
    n: int,
    amplitude: float = 1.0,
    phase: float = 0.0,
    start_time: float = 0.0,
) -> Signal:
    samples = [
        amplitude * math.sin(2.0 * math.pi * freq * (start_time + i / sample_rate) + phase)
        for i in range(n)
    ]
    return Signal(signal_id, sample_rate, samples, start_time)


def naive_dft(x):
    n = len(x)
    return [
        sum(x[t] * cmath.exp(-2j * math.pi * k * t / n) for t in range(n))
        for k in range(n)
    ]


# ---------------------------------------------------------------------------
# Signal model
# ---------------------------------------------------------------------------


class TestSignalModel(unittest.TestCase):
    def test_valid_signal(self):
        s = Signal("s1", 100.0, [1.0, 2.0, 3.0], 0.5)
        self.assertEqual(len(s), 3)
        self.assertAlmostEqual(s.end_time, 0.5 + 2 / 100.0)

    def test_empty_id_rejected(self):
        with self.assertRaises(SignalValidationError):
            Signal("", 100.0, [1.0])

    def test_nonpositive_rate_rejected(self):
        for bad in (0.0, -10.0):
            with self.assertRaises(SignalValidationError):
                Signal("s", bad, [1.0])

    def test_empty_samples_rejected(self):
        with self.assertRaises(SignalValidationError):
            Signal("s", 100.0, [])

    def test_nan_and_inf_rejected(self):
        with self.assertRaises(SignalValidationError):
            Signal("s", 100.0, [1.0, float("nan")])
        with self.assertRaises(SignalValidationError):
            Signal("s", 100.0, [float("inf")])
        with self.assertRaises(SignalValidationError):
            Signal("s", 100.0, [-float("inf")])

    def test_from_pairs_valid(self):
        pairs = [(0.25, 1.0), (0.26, 2.0), (0.27, 3.0)]
        s = Signal.from_pairs("p", 100.0, pairs)
        self.assertAlmostEqual(s.start_time, 0.25)
        self.assertEqual(s.samples, [1.0, 2.0, 3.0])

    def test_from_pairs_non_increasing(self):
        pairs = [(0.0, 1.0), (0.01, 2.0), (0.01, 3.0)]
        with self.assertRaises(SignalValidationError) as ctx:
            Signal.from_pairs("p", 100.0, pairs)
        self.assertIn("index 2", str(ctx.exception))

    def test_from_pairs_interval_mismatch_reports_first_deviation(self):
        pairs = [(0.0, 1.0), (0.01, 2.0), (0.025, 3.0), (0.035, 4.0)]
        with self.assertRaises(SignalValidationError) as ctx:
            Signal.from_pairs("p", 100.0, pairs)
        msg = str(ctx.exception)
        self.assertIn("index 2", msg)
        self.assertIn("0.025", msg)


# ---------------------------------------------------------------------------
# Filter design
# ---------------------------------------------------------------------------


class TestFilterDesign(unittest.TestCase):
    def test_even_order_rejected(self):
        with self.assertRaises(FilterDesignError):
            design_filter("lowpass", 50, 0.2)

    def test_nonpositive_order_rejected(self):
        for bad in (0, -3):
            with self.assertRaises(FilterDesignError):
                design_filter("lowpass", bad, 0.2)

    def test_cutoff_bounds_rejected(self):
        for bad in (0.0, 0.5, -0.1, 0.6):
            with self.assertRaises(FilterDesignError):
                design_filter("lowpass", 51, bad)

    def test_band_requires_low_less_than_high(self):
        with self.assertRaises(FilterDesignError):
            design_filter("bandpass", 51, (0.3, 0.1))
        with self.assertRaises(FilterDesignError):
            design_filter("bandstop", 51, (0.2, 0.2))

    def test_band_requires_pair(self):
        with self.assertRaises(FilterDesignError):
            design_filter("bandpass", 51, 0.2)

    def test_unknown_kind_and_window_rejected(self):
        with self.assertRaises(FilterDesignError):
            design_filter("notafilter", 51, 0.2)
        with self.assertRaises(FilterDesignError):
            design_filter("lowpass", 51, 0.2, window="blackman")

    def test_tap_count_and_symmetry(self):
        f = design_filter("lowpass", 51, 0.2)
        self.assertEqual(f.taps, 52)
        for a, b in zip(f.coefficients, reversed(f.coefficients)):
            self.assertAlmostEqual(a, b, places=12)

    def test_lowpass_response(self):
        f = design_filter("lowpass", 101, 0.2, "hamming")
        self.assertAlmostEqual(f.response(0.05), 1.0, delta=0.02)
        self.assertLess(f.response(0.35), 0.01)

    def test_highpass_response(self):
        f = design_filter("highpass", 101, 0.2, "hamming")
        self.assertAlmostEqual(f.response(0.4), 1.0, delta=0.02)
        self.assertLess(f.response(0.05), 0.01)

    def test_bandpass_response(self):
        f = design_filter("bandpass", 101, (0.1, 0.2), "hamming")
        self.assertAlmostEqual(f.response(0.15), 1.0, delta=0.02)
        self.assertLess(f.response(0.4), 0.01)
        self.assertLess(f.response(0.02), 0.01)

    def test_bandstop_response(self):
        f = design_filter("bandstop", 101, (0.1, 0.2), "hamming")
        self.assertLess(f.response(0.15), 0.01)
        self.assertAlmostEqual(f.response(0.35), 1.0, delta=0.02)
        self.assertAlmostEqual(f.response(0.0), 1.0, delta=0.02)

    def test_rectangular_window_supported(self):
        f = design_filter("lowpass", 51, 0.2, "rectangular")
        self.assertEqual(f.taps, 52)
        self.assertAlmostEqual(f.response(0.05), 1.0, delta=0.1)

    def test_passband_center_gain_is_unity_all_kinds(self):
        # Unified convention: gain is 1 at the passband center, for every
        # kind and across cutoff choices.
        cases = [
            ("lowpass", 0.2, [0.05, 0.1, 0.15]),
            ("lowpass", 0.35, [0.1, 0.2, 0.3]),
            ("highpass", 0.2, [0.3, 0.4, 0.45]),
            ("highpass", 0.1, [0.2, 0.3, 0.45]),
            ("bandpass", (0.1, 0.2), [0.12, 0.15, 0.18]),
            ("bandpass", (0.15, 0.35), [0.2, 0.25, 0.3]),
            # Bandstop has two passbands; both ends are checked separately.
            ("bandstop", (0.1, 0.2), [0.0, 0.05, 0.3, 0.4]),
            ("bandstop", (0.2, 0.3), [0.0, 0.1, 0.4, 0.45]),
        ]
        for kind, cutoff, passband_points in cases:
            f = design_filter(kind, 101, cutoff, "hamming")
            for p in passband_points:
                self.assertAlmostEqual(
                    f.response(p), 1.0, delta=0.02,
                    msg=f"{kind} cutoff={cutoff} at f={p}",
                )

    def test_stopband_near_zero_all_kinds(self):
        cases = [
            ("lowpass", 0.2, [0.3, 0.4]),
            ("highpass", 0.2, [0.05, 0.1]),
            ("bandpass", (0.1, 0.2), [0.02, 0.4]),
            ("bandstop", (0.1, 0.2), [0.14, 0.15, 0.16]),
        ]
        for kind, cutoff, stopband_points in cases:
            f = design_filter(kind, 101, cutoff, "hamming")
            for p in stopband_points:
                self.assertLess(
                    f.response(p), 0.01, msg=f"{kind} cutoff={cutoff} at f={p}"
                )

    def test_even_taps_structural_zero_at_nyquist(self):
        # Documented behavior: odd order -> even tap count -> H(0.5) == 0.
        for kind, cutoff in (("highpass", 0.2), ("bandstop", (0.1, 0.2))):
            f = design_filter(kind, 101, cutoff, "hamming")
            self.assertLess(f.response(0.5), 1e-10, msg=kind)


# ---------------------------------------------------------------------------
# Filtering
# ---------------------------------------------------------------------------


class TestFiltering(unittest.TestCase):
    def test_convolve_full_small(self):
        self.assertEqual(convolve_full([1.0, 2.0], [1.0, 1.0, 1.0]), [1.0, 3.0, 3.0, 2.0])

    def test_apply_preserves_length_and_time_axis(self):
        s = sine_signal("s", 5.0, 100.0, 64, start_time=1.0)
        f = design_filter("lowpass", 51, 0.2)
        r = apply_filter(s, f)
        self.assertEqual(len(r.filtered), len(s))
        self.assertAlmostEqual(r.filtered.start_time, s.start_time)
        self.assertAlmostEqual(r.filtered.sample_rate, s.sample_rate)

    def test_zero_padded_edges(self):
        # Constant signal: interior stays ~1 (passband-center normalization
        # leaves DC within passband ripple), edges droop due to zero padding.
        s = Signal("c", 100.0, [1.0] * 40)
        f = design_filter("lowpass", 21, 0.2)
        r = apply_filter(s, f)
        self.assertAlmostEqual(r.filtered.samples[20], 1.0, delta=0.01)
        self.assertLess(r.filtered.samples[0], 0.9)
        # Explicit zero-padding check: out[0] equals the partial tap sum.
        start = (f.taps - 1) // 2
        self.assertAlmostEqual(
            r.filtered.samples[0], sum(f.coefficients[: start + 1]), places=12
        )

    def test_impulse_response_at_boundary(self):
        s = Signal("i", 100.0, [1.0] + [0.0] * 19)
        f = design_filter("lowpass", 11, 0.2)
        r = apply_filter(s, f)
        start = (f.taps - 1) // 2
        for i in range(f.taps - start):
            self.assertAlmostEqual(r.filtered.samples[i], f.coefficients[start + i], places=12)

    def test_sample_query_returns_original_and_filtered(self):
        s = sine_signal("s", 5.0, 100.0, 32)
        f = design_filter("lowpass", 21, 0.2)
        r = apply_filter(s, f)
        orig, proc = r.sample(7)
        self.assertEqual(orig, s.samples[7])
        self.assertEqual(proc, r.filtered.samples[7])
        with self.assertRaises(IndexError):
            r.sample(32)

    def test_lowpass_removes_high_frequency(self):
        sr, n = 200.0, 400
        samples = [
            math.sin(2 * math.pi * 10 * i / sr) + math.sin(2 * math.pi * 80 * i / sr)
            for i in range(n)
        ]
        s = Signal("mix", sr, samples)
        f = design_filter("lowpass", 101, 0.2)  # 0.2 * 200 = 40 Hz cutoff
        r = apply_filter(s, f)
        sp = spectrum(r.filtered)
        k10 = min(range(len(sp.frequencies)), key=lambda k: abs(sp.frequencies[k] - 10.0))
        k80 = min(range(len(sp.frequencies)), key=lambda k: abs(sp.frequencies[k] - 80.0))
        # Zero-padded edges cost some energy; the passband tone still dominates.
        self.assertGreater(sp.magnitudes[k10], 0.8)
        self.assertLess(sp.magnitudes[k80], 0.01)

    def test_filtfilt_zero_phase(self):
        sr, n = 200.0, 400
        s = sine_signal("s", 10.0, sr, n)
        f = design_filter("lowpass", 51, 0.2)
        r = filtfilt(s, f)
        # Interior of a zero-phase filtered sine stays in phase with the input.
        for i in range(100, 300, 25):
            self.assertAlmostEqual(
                r.filtered.samples[i], s.samples[i], delta=0.05, msg=f"index {i}"
            )
        self.assertTrue(r.zero_phase)

    def test_filtfilt_stronger_stopband_than_single_pass(self):
        sr, n = 200.0, 400
        s = sine_signal("s", 80.0, sr, n)
        f = design_filter("lowpass", 51, 0.2)
        once = apply_filter(s, f).filtered.samples[100:300]
        twice = filtfilt(s, f).filtered.samples[100:300]
        rms_once = math.sqrt(sum(v * v for v in once) / len(once))
        rms_twice = math.sqrt(sum(v * v for v in twice) / len(twice))
        self.assertLess(rms_twice, rms_once)


# ---------------------------------------------------------------------------
# FFT and spectrum
# ---------------------------------------------------------------------------


class TestFFT(unittest.TestCase):
    def test_fft_matches_naive_dft(self):
        x = [0.3, -1.2, 2.5, 0.7, -0.4, 1.1, 0.9, -2.2]
        got = fft(x)
        want = naive_dft(x)
        for a, b in zip(got, want):
            self.assertAlmostEqual(a.real, b.real, places=9)
            self.assertAlmostEqual(a.imag, b.imag, places=9)

    def test_fft_rejects_non_power_of_two(self):
        with self.assertRaises(SignalKernelError):
            fft([1.0, 2.0, 3.0])

    def test_next_pow2(self):
        self.assertEqual(next_pow2(1), 1)
        self.assertEqual(next_pow2(8), 8)
        self.assertEqual(next_pow2(100), 128)

    def test_spectrum_zero_padding_recorded(self):
        s = sine_signal("s", 8.0, 128.0, 100)
        sp = spectrum(s)
        self.assertEqual(sp.n_fft, 128)
        self.assertEqual(sp.zero_padded, 28)
        self.assertEqual(len(sp.frequencies), 65)

    def test_spectrum_peak_frequency_and_amplitude(self):
        s = sine_signal("s", 8.0, 128.0, 128, amplitude=2.0)
        sp = spectrum(s)
        k = sp.magnitudes.index(max(sp.magnitudes))
        self.assertAlmostEqual(sp.frequencies[k], 8.0, places=9)
        self.assertAlmostEqual(sp.magnitudes[k], 2.0, delta=1e-9)

    def test_spectrum_window_normalized(self):
        s = sine_signal("s", 8.0, 128.0, 128, amplitude=1.5)
        sp = spectrum(s, window="hamming")
        k = sp.magnitudes.index(max(sp.magnitudes))
        self.assertAlmostEqual(sp.frequencies[k], 8.0, places=9)
        self.assertAlmostEqual(sp.magnitudes[k], 1.5, delta=0.05)

    def test_phase_of_known_sine(self):
        # cosine => phase 0 at its bin
        sr, n, f = 128.0, 128, 8.0
        s = Signal(
            "c", sr, [math.cos(2 * math.pi * f * i / sr) for i in range(n)]
        )
        sp = spectrum(s)
        k = sp.frequencies.index(8.0)
        self.assertAlmostEqual(sp.phases[k], 0.0, delta=1e-6)

    def test_dominant_frequencies_order_and_ties(self):
        sr, n = 128.0, 256
        samples = [
            1.5 * math.sin(2 * math.pi * 20 * i / sr) + 0.5 * math.sin(2 * math.pi * 8 * i / sr)
            for i in range(n)
        ]
        s = Signal("mix", sr, samples)
        top = dominant_frequencies(s, 2)
        self.assertAlmostEqual(top[0][0], 20.0, places=9)
        self.assertAlmostEqual(top[1][0], 8.0, places=9)
        # Equal amplitudes -> lower frequency first.
        samples = [
            math.sin(2 * math.pi * 20 * i / sr) + math.sin(2 * math.pi * 8 * i / sr)
            for i in range(n)
        ]
        top = dominant_frequencies(Signal("tie", sr, samples), 2)
        self.assertEqual([p[0] for p in top], [8.0, 20.0])

    def test_single_sample_signal(self):
        s = Signal("one", 100.0, [3.0])
        sp = spectrum(s)
        self.assertEqual(sp.n_fft, 1)
        self.assertEqual(sp.frequencies, [0.0])
        self.assertEqual(sp.magnitudes, [3.0])
        top = dominant_frequencies(s, 1)
        self.assertEqual(top, [(0.0, 3.0)])

    def test_constant_signal_dominant_dc(self):
        s = Signal("dc", 100.0, [2.0] * 64)
        top = dominant_frequencies(s, 1)
        self.assertEqual(top[0][0], 0.0)
        self.assertAlmostEqual(top[0][1], 2.0, places=9)


# ---------------------------------------------------------------------------
# Resampling
# ---------------------------------------------------------------------------


class TestResample(unittest.TestCase):
    def test_factor_validation(self):
        s = Signal("s", 100.0, [1.0, 2.0, 3.0])
        for up, down in ((0, 1), (1, 0), (-2, 1), (2, 4), (3, 3)):
            with self.assertRaises(ResampleError, msg=f"up={up} down={down}"):
                resample(s, up, down)

    def test_output_rate_and_length(self):
        s = sine_signal("s", 5.0, 100.0, 200)
        r = resample(s, 3, 2)
        self.assertAlmostEqual(r.signal.sample_rate, 150.0)
        self.assertEqual(len(r.signal), (199 * 3) // 2 + 1)
        self.assertAlmostEqual(r.signal.start_time, 0.0)

    def test_main_frequency_preserved(self):
        sr = 100.0
        s = sine_signal("s", 8.0, sr, 256)
        for up, down in ((1, 2), (2, 1), (3, 2), (2, 3)):
            r = resample(s, up, down)
            top = dominant_frequencies(r.signal, 1)
            self.assertAlmostEqual(top[0][0], 8.0, delta=1.0, msg=f"up={up} down={down}")

    def test_antialiasing_on_downsample(self):
        sr, n = 200.0, 400
        samples = [
            math.sin(2 * math.pi * 10 * i / sr) + math.sin(2 * math.pi * 80 * i / sr)
            for i in range(n)
        ]
        s = Signal("mix", sr, samples)
        r = resample(s, 1, 2)  # new Nyquist = 50 Hz; 80 Hz must be removed
        sp = spectrum(r.signal)
        k10 = min(range(len(sp.frequencies)), key=lambda k: abs(sp.frequencies[k] - 10.0))
        k20 = min(range(len(sp.frequencies)), key=lambda k: abs(sp.frequencies[k] - 20.0))
        self.assertGreater(sp.magnitudes[k10], 0.8)  # edge transients cost some energy
        self.assertLess(sp.magnitudes[k20], 0.02)  # 80 Hz would alias to 20 Hz

    def test_cutoff_and_group_delay_reported(self):
        s = sine_signal("s", 5.0, 100.0, 64)
        r = resample(s, 1, 4)
        self.assertAlmostEqual(r.cutoff_normalized, 0.5 / 4)
        self.assertAlmostEqual(r.cutoff_hz, 0.125 * 100.0)
        self.assertEqual(len(r.stages), 1)
        self.assertEqual(r.stages[0].kind, "decimation")
        self.assertEqual(r.stages[0].taps % 2, 1)
        expected_delay = (r.stages[0].taps - 1) / 2
        self.assertAlmostEqual(r.filter_group_delay_seconds, expected_delay / 100.0)
        self.assertAlmostEqual(r.filter_group_delay_samples, expected_delay / 4)
        # Backward-compatible aliases still work.
        self.assertEqual(r.group_delay_seconds, r.filter_group_delay_seconds)
        self.assertEqual(r.group_delay_samples, r.filter_group_delay_samples)
        self.assertEqual(r.filter_taps, r.stages[0].taps)
        # The filter delay is compensated, so the net time-axis shift is 0.
        self.assertEqual(r.time_offset_samples, 0.0)
        self.assertEqual(r.time_offset_seconds, 0.0)

    def test_group_delay_report_matches_impulse_peak(self):
        sr, n, i0 = 100.0, 64, 6
        samples = [0.0] * n
        samples[i0] = 1.0
        s = Signal("imp", sr, samples)
        for up, down in ((1, 2), (2, 1), (2, 3), (3, 2)):
            r = resample(s, up, down)
            # The reported filter delay accumulates the actual stage taps.
            delay_intermediate = sum((st.taps - 1) / 2 for st in r.stages)
            self.assertAlmostEqual(
                r.filter_group_delay_seconds,
                delay_intermediate / (sr * up),
                msg=f"up={up} down={down}",
            )
            self.assertAlmostEqual(
                r.filter_group_delay_samples,
                delay_intermediate / down,
                msg=f"up={up} down={down}",
            )
            # Net time-axis offset is zero: the impulse peak lands exactly on
            # the output grid point matching the input impulse time.
            self.assertEqual(r.time_offset_seconds, 0.0)
            self.assertEqual(r.time_offset_samples, 0.0)
            self.assertEqual((i0 * up) % down, 0)  # test premise: on-grid peak
            peak = max(range(len(r.signal)), key=lambda k: r.signal.samples[k])
            self.assertEqual(peak, (i0 * up) // down, msg=f"up={up} down={down}")
            self.assertAlmostEqual(
                r.signal.start_time + peak / r.signal.sample_rate,
                s.start_time + i0 / sr,
                msg=f"up={up} down={down}",
            )

    def test_aliasing_detected_when_content_above_new_nyquist(self):
        s = sine_signal("hf", 40.0, 200.0, 400)  # 40 Hz content
        r = resample(s, 1, 4)  # new rate 50 Hz, new Nyquist 25 Hz < 40 Hz
        self.assertTrue(r.aliasing_detected)
        self.assertEqual(r.aliased_band, (25.0, 100.0))
        self.assertGreater(r.aliased_energy_ratio, 0.9)

    def test_no_aliasing_flag_when_content_fits(self):
        s = sine_signal("lf", 10.0, 200.0, 400)
        r = resample(s, 1, 2)  # new Nyquist 50 Hz > 10 Hz
        self.assertFalse(r.aliasing_detected)
        self.assertIsNone(r.aliased_band)
        self.assertLess(r.aliased_energy_ratio, 0.01)

    def test_aliasing_threshold_validation(self):
        s = Signal("s", 100.0, [1.0, 2.0, 3.0])
        with self.assertRaises(ResampleError):
            resample(s, 1, 2, alias_threshold=1.5)

    def test_identity_resample(self):
        s = Signal("s", 100.0, [1.0, 2.0, 3.0])
        r = resample(s, 1, 1)
        self.assertEqual(r.signal.samples, s.samples)
        self.assertIsNone(r.cutoff_normalized)

    def test_upsample_interpolates(self):
        sr = 50.0
        s = sine_signal("s", 5.0, sr, 100)
        r = resample(s, 2, 1)
        self.assertAlmostEqual(r.signal.sample_rate, 100.0)
        # Interior samples of the upsampled sine match the analytic curve.
        for i in range(40, 160, 10):
            t = i / r.signal.sample_rate
            self.assertAlmostEqual(
                r.signal.samples[i], math.sin(2 * math.pi * 5 * t), delta=0.02
            )


# ---------------------------------------------------------------------------
# Alignment
# ---------------------------------------------------------------------------


class TestAlign(unittest.TestCase):
    def _two_sines(self):
        s1 = sine_signal("a", 5.0, 100.0, 200, start_time=0.0)
        s2 = sine_signal("b", 5.0, 160.0, 160, amplitude=0.5, start_time=0.5)
        return s1, s2

    def test_common_range(self):
        s1, s2 = self._two_sines()
        al = align([s1, s2], 120.0)
        self.assertAlmostEqual(al.start, 0.5, places=9)
        # Common end snaps to the target-rate grid at or before s2's end.
        self.assertLessEqual(al.end, s2.end_time + 1e-9)
        self.assertGreater(al.end, s2.end_time - 2 / 120.0)
        for s in al.signals:
            self.assertAlmostEqual(s.sample_rate, 120.0)
            self.assertGreaterEqual(s.start_time, al.start - 1e-9)
            self.assertLessEqual(s.end_time, al.end + 1e-9)

    def test_interp_matches_analytic(self):
        s1, s2 = self._two_sines()
        al = align([s1, s2], 120.0)
        for t in (0.6, 0.83, 1.1, 1.4):
            value, reason = al.interp("a", t)
            self.assertIsNone(reason)
            self.assertAlmostEqual(value, math.sin(2 * math.pi * 5 * t), delta=0.02)
            value, reason = al.interp("b", t)
            self.assertIsNone(reason)
            self.assertAlmostEqual(value, 0.5 * math.sin(2 * math.pi * 5 * t), delta=0.02)

    def test_interp_out_of_range_returns_none_with_reason(self):
        s1, s2 = self._two_sines()
        al = align([s1, s2], 120.0)
        value, reason = al.interp("a", 99.0)
        self.assertIsNone(value)
        self.assertIn("after", reason)
        value, reason = al.interp("a", -5.0)
        self.assertIsNone(value)
        self.assertIn("before", reason)

    def test_no_overlap_raises(self):
        s1 = sine_signal("a", 5.0, 100.0, 100, start_time=0.0)   # [0, 0.99]
        s2 = sine_signal("b", 5.0, 100.0, 100, start_time=5.0)   # [5, 5.99]
        with self.assertRaises(AlignmentError) as ctx:
            align([s1, s2], 100.0)
        self.assertIn("no common time range", str(ctx.exception))

    def test_empty_and_duplicate_inputs(self):
        with self.assertRaises(AlignmentError):
            align([], 100.0)
        s = sine_signal("a", 5.0, 100.0, 10)
        with self.assertRaises(AlignmentError):
            align([s, s], 100.0)

    def test_invalid_target_rate(self):
        s = sine_signal("a", 5.0, 100.0, 10)
        for bad in (0.0, -50.0):
            with self.assertRaises(AlignmentError):
                align([s], bad)

    def test_target_rate_below_signal_content_is_antialiased(self):
        # 40 Hz content, target rate 50 Hz (Nyquist 25 Hz): must not alias,
        # and the loss must be flagged in the alignment's aliasing report.
        s = sine_signal("a", 40.0, 200.0, 400)
        al = align([s], 50.0)
        sp = spectrum(al.get("a"))
        self.assertLess(max(sp.magnitudes), 0.05)
        info = al.aliasing["a"]
        self.assertTrue(info["detected"])
        self.assertEqual(info["aliased_band"], [25.0, 100.0])
        self.assertGreater(info["energy_ratio"], 0.9)
        self.assertIn("fold into [0, 25.0]", info["note"])

    def test_align_marks_no_aliasing_when_content_fits(self):
        s = sine_signal("a", 5.0, 100.0, 200)
        al = align([s], 80.0)
        self.assertFalse(al.aliasing["a"]["detected"])
        self.assertIsNone(al.aliasing["a"]["aliased_band"])
        self.assertIsNone(al.aliasing["a"]["note"])


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------


class TestPersistence(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "ws.json")

    def tearDown(self):
        self.tmp.cleanup()

    def _build_workspace(self) -> Workspace:
        ws = Workspace()
        s = sine_signal("s1", 8.0, 128.0, 128)
        ws.add_signal(s)
        ws.filters["lp"] = design_filter("lowpass", 51, 0.2)
        filtered = apply_filter(s, ws.filters["lp"], new_id="s1_lp")
        ws.add_signal(filtered.filtered)
        ws.spectra["sp1"] = spectrum(s)
        r = resample(s, 3, 2, new_id="s1_rs")
        ws.add_signal(r.signal)
        from signal_kernel import ResampleRecord

        ws.resamples["r1"] = ResampleRecord(
            "r1", "s1", "s1_rs", 3, 2,
            r.cutoff_normalized, r.cutoff_hz,
            r.filter_group_delay_samples, r.filter_group_delay_seconds,
            r.filter_taps,
            stages=r.stages,
            time_offset_samples=r.time_offset_samples,
            time_offset_seconds=r.time_offset_seconds,
            aliasing_detected=r.aliasing_detected,
            aliased_band=r.aliased_band,
            aliased_energy_ratio=r.aliased_energy_ratio,
        )
        s2 = sine_signal("s2", 8.0, 100.0, 150, start_time=0.1)
        ws.add_signal(s2)
        ws.alignments["al1"] = align([s, s2], 120.0)
        return ws

    def test_roundtrip(self):
        ws = self._build_workspace()
        ws.save(self.path)
        loaded = Workspace.load(self.path)
        self.assertEqual(set(loaded.signals), set(ws.signals))
        self.assertEqual(loaded.signals["s1"].samples, ws.signals["s1"].samples)
        self.assertEqual(
            loaded.filters["lp"].coefficients, ws.filters["lp"].coefficients
        )
        # Spectrum survives the roundtrip exactly.
        self.assertEqual(loaded.spectra["sp1"].frequencies, ws.spectra["sp1"].frequencies)
        self.assertEqual(loaded.spectra["sp1"].magnitudes, ws.spectra["sp1"].magnitudes)
        self.assertEqual(loaded.spectra["sp1"].phases, ws.spectra["sp1"].phases)
        self.assertEqual(loaded.resamples["r1"].up, 3)
        self.assertEqual(loaded.resamples["r1"].down, 2)
        self.assertEqual(len(loaded.resamples["r1"].stages), 2)
        self.assertEqual(loaded.resamples["r1"].stages[0].kind, "interpolation")
        self.assertEqual(loaded.resamples["r1"].stages[1].kind, "decimation")
        self.assertEqual(loaded.resamples["r1"].time_offset_seconds, 0.0)
        self.assertFalse(loaded.resamples["r1"].aliasing_detected)
        self.assertAlmostEqual(loaded.alignments["al1"].start, ws.alignments["al1"].start)
        self.assertEqual(
            set(loaded.alignments["al1"].aliasing), set(ws.alignments["al1"].aliasing)
        )
        value, reason = loaded.alignments["al1"].interp("s1", 0.5)
        self.assertIsNone(reason)
        self.assertIsNotNone(value)

    def test_load_missing_file(self):
        with self.assertRaises(PersistenceError):
            Workspace.load(os.path.join(self.tmp.name, "nope.json"))

    def test_load_garbage_json(self):
        with open(self.path, "w", encoding="utf-8") as fh:
            fh.write("{not valid json")
        with self.assertRaises(PersistenceError) as ctx:
            Workspace.load(self.path)
        self.assertIn("invalid JSON", str(ctx.exception))

    def test_load_wrong_format(self):
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump({"format": "something-else"}, fh)
        with self.assertRaises(PersistenceError) as ctx:
            Workspace.load(self.path)
        self.assertIn("not a signal-kernel-workspace", str(ctx.exception))

    def _write(self, data):
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump(data, fh)

    def _minimal(self):
        return {
            "format": "signal-kernel-workspace",
            "version": 1,
            "signals": [],
            "filters": [],
            "spectra": [],
            "resamples": [],
            "alignments": [],
        }

    def test_missing_section_reported(self):
        data = self._minimal()
        del data["filters"]
        self._write(data)
        with self.assertRaises(PersistenceError) as ctx:
            Workspace.load(self.path)
        self.assertIn("filters", str(ctx.exception))

    def test_duplicate_signal_id_rejected(self):
        data = self._minimal()
        sig = {"signal_id": "s", "sample_rate": 100.0, "samples": [1.0], "start_time": 0.0}
        data["signals"] = [sig, dict(sig)]
        self._write(data)
        with self.assertRaises(PersistenceError) as ctx:
            Workspace.load(self.path)
        self.assertIn("duplicate signal_id", str(ctx.exception))

    def test_bad_sample_rate_rejected(self):
        data = self._minimal()
        data["signals"] = [
            {"signal_id": "s", "sample_rate": -5.0, "samples": [1.0], "start_time": 0.0}
        ]
        self._write(data)
        with self.assertRaises(PersistenceError) as ctx:
            Workspace.load(self.path)
        self.assertIn("sample_rate", str(ctx.exception))

    def test_even_filter_order_rejected(self):
        data = self._minimal()
        data["filters"] = [
            {
                "filter_id": "f",
                "kind": "lowpass",
                "order": 50,
                "cutoff": [0.2],
                "window": "hamming",
                "coefficients": [0.0] * 51,
            }
        ]
        self._write(data)
        with self.assertRaises(PersistenceError) as ctx:
            Workspace.load(self.path)
        self.assertIn("odd", str(ctx.exception))

    def test_tampered_coefficients_rejected(self):
        ws = Workspace()
        ws.filters["f"] = design_filter("lowpass", 51, 0.2)
        ws.save(self.path)
        with open(self.path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        data["filters"][0]["coefficients"][3] += 1.0
        self._write(data)
        with self.assertRaises(PersistenceError) as ctx:
            Workspace.load(self.path)
        self.assertIn("inconsistent", str(ctx.exception))

    def test_non_coprime_resample_rejected(self):
        data = self._minimal()
        data["signals"] = [
            {"signal_id": "a", "sample_rate": 100.0, "samples": [1.0], "start_time": 0.0},
            {"signal_id": "b", "sample_rate": 50.0, "samples": [1.0], "start_time": 0.0},
        ]
        data["resamples"] = [
            {
                "record_id": "r",
                "source_id": "a",
                "result_id": "b",
                "up": 2,
                "down": 4,
                "cutoff_normalized": 0.125,
                "cutoff_hz": 25.0,
                "group_delay_samples": 4.0,
                "group_delay_seconds": 0.08,
                "filter_taps": 65,
            }
        ]
        self._write(data)
        with self.assertRaises(PersistenceError) as ctx:
            Workspace.load(self.path)
        self.assertIn("coprime", str(ctx.exception))

    def test_old_format_resample_record_loads_with_defaults(self):
        # Records written before stages/aliasing existed must still load.
        data = self._minimal()
        data["signals"] = [
            {"signal_id": "a", "sample_rate": 100.0, "samples": [1.0], "start_time": 0.0},
            {"signal_id": "b", "sample_rate": 50.0, "samples": [1.0], "start_time": 0.0},
        ]
        data["resamples"] = [
            {
                "record_id": "r",
                "source_id": "a",
                "result_id": "b",
                "up": 1,
                "down": 2,
                "cutoff_normalized": 0.25,
                "cutoff_hz": 25.0,
                "group_delay_samples": 16.0,
                "group_delay_seconds": 0.16,
                "filter_taps": 33,
            }
        ]
        self._write(data)
        ws = Workspace.load(self.path)
        rec = ws.resamples["r"]
        self.assertEqual(rec.stages, [])
        self.assertEqual(rec.time_offset_seconds, 0.0)
        self.assertFalse(rec.aliasing_detected)
        self.assertIsNone(rec.aliased_band)

    def test_nan_token_rejected(self):
        with open(self.path, "w", encoding="utf-8") as fh:
            fh.write(
                '{"format": "signal-kernel-workspace", "version": 1, '
                '"signals": [{"signal_id": "s", "sample_rate": 100, '
                '"samples": [NaN], "start_time": 0}], "filters": [], '
                '"spectra": [], "resamples": [], "alignments": []}'
            )
        with self.assertRaises(PersistenceError) as ctx:
            Workspace.load(self.path)
        self.assertIn("non-finite", str(ctx.exception))


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


class TestCLI(unittest.TestCase):
    def setUp(self):
        self.ws = Workspace()

    def test_happy_path(self):
        r = cli.handle(self.ws, {
            "cmd": "load_signal", "signal_id": "s", "sample_rate": 128.0,
            "samples": [math.sin(2 * math.pi * 8 * i / 128) for i in range(128)],
        })
        self.assertTrue(r["ok"])
        r = cli.handle(self.ws, {
            "cmd": "design_filter", "filter_id": "lp", "kind": "lowpass",
            "order": 51, "cutoff": 0.2,
        })
        self.assertTrue(r["ok"])
        self.assertEqual(r["taps"], 52)
        r = cli.handle(self.ws, {"cmd": "apply", "signal_id": "s", "filter_id": "lp"})
        self.assertTrue(r["ok"])
        r = cli.handle(self.ws, {"cmd": "filtfilt", "signal_id": "s", "filter_id": "lp"})
        self.assertTrue(r["ok"])
        self.assertEqual(r["effective_order"], 102)
        r = cli.handle(self.ws, {"cmd": "spectrum", "signal_id": "s"})
        self.assertTrue(r["ok"])
        self.assertEqual(r["n_fft"], 128)
        r = cli.handle(self.ws, {"cmd": "dominant", "signal_id": "s", "top_n": 1})
        self.assertAlmostEqual(r["frequencies"][0]["frequency"], 8.0)
        r = cli.handle(self.ws, {"cmd": "resample", "signal_id": "s", "up": 1, "down": 2})
        self.assertTrue(r["ok"])
        self.assertAlmostEqual(r["sample_rate"], 64.0)
        r = cli.handle(self.ws, {"cmd": "dump"})
        self.assertTrue(r["ok"])
        self.assertIn("s", r["signals"])

    def test_align_and_interp_via_cli(self):
        for sid, rate, start in (("a", 100.0, 0.0), ("b", 160.0, 0.5)):
            n = 200
            cli.handle(self.ws, {
                "cmd": "load_signal", "signal_id": sid, "sample_rate": rate,
                "start_time": start,
                "samples": [math.sin(2 * math.pi * 5 * (start + i / rate)) for i in range(n)],
            })
        r = cli.handle(self.ws, {
            "cmd": "align", "signal_ids": ["a", "b"], "target_rate": 120.0,
            "align_id": "al",
        })
        self.assertTrue(r["ok"])
        r = cli.handle(self.ws, {"cmd": "interp", "align_id": "al", "signal_id": "a", "time": 0.8})
        self.assertTrue(r["ok"])
        self.assertAlmostEqual(r["value"], math.sin(2 * math.pi * 5 * 0.8), delta=0.02)
        r = cli.handle(self.ws, {"cmd": "interp", "align_id": "al", "signal_id": "a", "time": 50.0})
        self.assertTrue(r["ok"])
        self.assertIsNone(r["value"])
        self.assertIn("reason", r)

    def test_save_and_load_via_cli(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "ws.json")
            cli.handle(self.ws, {
                "cmd": "load_signal", "signal_id": "s", "sample_rate": 64.0,
                "samples": [1.0, 2.0, 3.0],
            })
            r = cli.handle(self.ws, {"cmd": "save", "path": path})
            self.assertTrue(r["ok"])
            fresh = Workspace()
            r = cli.handle(fresh, {"cmd": "load", "path": path})
            self.assertTrue(r["ok"])
            self.assertEqual(r["signals"], 1)
            self.assertEqual(fresh.signals["s"].samples, [1.0, 2.0, 3.0])

    def test_from_pairs_via_cli(self):
        err = self._error_of({
            "cmd": "load_signal", "signal_id": "p", "sample_rate": 100.0,
            "pairs": [[0.0, 1.0], [0.01, 2.0], [0.03, 3.0]],
        })
        self.assertIn("index 2", err)

    def _error_of(self, cmd):
        try:
            cli.handle(self.ws, cmd)
        except Exception as exc:
            return str(exc)
        self.fail(f"expected an error for {cmd}")

    def test_errors_are_clear(self):
        self.assertIn("odd", self._error_of({
            "cmd": "design_filter", "filter_id": "f", "kind": "lowpass",
            "order": 50, "cutoff": 0.2,
        }))
        self.assertIn("(0, 0.5)", self._error_of({
            "cmd": "design_filter", "filter_id": "f", "kind": "lowpass",
            "order": 51, "cutoff": 0.5,
        }))
        cli.handle(self.ws, {
            "cmd": "load_signal", "signal_id": "x", "sample_rate": 100.0,
            "samples": [1.0, 2.0, 3.0],
        })
        self.assertIn("coprime", self._error_of({
            "cmd": "resample", "signal_id": "x", "up": 2, "down": 4,
        }))
        self.assertIn("unknown command", self._error_of({"cmd": "explode"}))
        self.assertIn("unknown signal_id", self._error_of({
            "cmd": "spectrum", "signal_id": "ghost",
        }))


if __name__ == "__main__":
    unittest.main()
