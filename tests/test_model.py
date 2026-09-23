import pytest

from focuslines.model import (
    FocusError,
    FocusTracker,
    LineStatus,
    StageStatus,
    TrackerState,
)


class FakeClock:
    def __init__(self):
        self.now = 1_000_000.0

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


@pytest.fixture
def clock():
    return FakeClock()


@pytest.fixture
def tracker(clock):
    t = FocusTracker(clock=clock)
    t.add_line("write-report", [("draft", 30), ("review", 20), ("send", 10)])
    t.add_line("fix-bug", [("reproduce", 15), ("patch", 45)])
    return t


# requirement 1: multiple lines, ordered stages, estimates and status
def test_lines_have_ordered_stages_with_estimates(tracker):
    line = tracker.lines["L1"]
    assert [s.name for s in line.stages] == ["draft", "review", "send"]
    assert [s.estimated_seconds for s in line.stages] == [1800, 1200, 600]
    assert all(s.status == StageStatus.PENDING for s in line.stages)
    assert tracker.lines["L2"].status == LineStatus.ACTIVE


# requirement 2: entering a stage starts timing and reports remaining+line
def test_start_focus_shows_remaining_and_line(tracker, clock):
    tracker.start_focus("L1", "S1")
    clock.advance(300)
    focus = tracker.current_focus()
    assert focus["line_name"] == "write-report"
    assert focus["stage_name"] == "draft"
    assert focus["state"] == "focusing"
    assert focus["remaining_seconds"] == pytest.approx(1500)


# requirement 3: interrupt pauses the timer, keeps invested, stores reason
def test_interrupt_pauses_and_keeps_invested(tracker, clock):
    tracker.start_focus("L1", "S1")
    clock.advance(600)
    tracker.interrupt(reason="phone call")
    clock.advance(3600)  # paused: time must not accumulate
    stage = tracker.lines["L1"].stage("S1")
    assert stage.status == StageStatus.PAUSED
    assert tracker.invested_seconds("L1", "S1") == pytest.approx(600)
    assert tracker.remaining_seconds("L1", "S1") == pytest.approx(1200)
    assert stage.interruptions[0].reason == "phone call"
    assert stage.interruptions[0].invested_seconds == pytest.approx(600)


# requirement 4: resume derives remaining from invested, not the estimate
def test_resume_continues_from_invested(tracker, clock):
    tracker.start_focus("L1", "S1")
    clock.advance(600)
    tracker.interrupt(reason="meeting")
    clock.advance(120)
    tracker.resume()
    clock.advance(300)
    assert tracker.invested_seconds("L1", "S1") == pytest.approx(900)
    assert tracker.remaining_seconds("L1", "S1") == pytest.approx(900)


# repeated interruptions must not corrupt the accounting
def test_repeated_interruptions_accumulate_correctly(tracker, clock):
    tracker.start_focus("L1", "S1")
    for _ in range(3):
        clock.advance(200)
        tracker.interrupt(reason="ping")
        clock.advance(50)
        tracker.resume()
    clock.advance(200)
    assert tracker.invested_seconds("L1", "S1") == pytest.approx(800)
    assert tracker.remaining_seconds("L1", "S1") == pytest.approx(1000)
    assert len(tracker.lines["L1"].stage("S1").interruptions) == 3


# requirement 5: switch keeps the old stage unfinished; new one starts fresh
def test_switch_stage_within_line(tracker, clock):
    tracker.start_focus("L1", "S1")
    clock.advance(400)
    tracker.interrupt(reason="urgent ask")
    tracker.switch_stage("L1", "S2")
    old = tracker.lines["L1"].stage("S1")
    new = tracker.lines["L1"].stage("S2")
    assert old.status == StageStatus.PAUSED  # unfinished
    assert old.invested_seconds == pytest.approx(400)
    assert new.status == StageStatus.ACTIVE
    clock.advance(100)
    # new stage counts from its own estimate, untouched by the old stage
    assert tracker.remaining_seconds("L1", "S2") == pytest.approx(1100)
    assert tracker.remaining_seconds("L1", "S1") == pytest.approx(1400)


# switching across lines from interrupted state is also supported
def test_switch_to_other_line(tracker, clock):
    tracker.start_focus("L1", "S1")
    clock.advance(100)
    tracker.interrupt(reason="boss dropped by")
    tracker.switch_stage("L2", "S4")
    assert tracker.lines["L1"].stage("S1").status == StageStatus.PAUSED
    assert tracker.lines["L2"].stage("S4").status == StageStatus.ACTIVE


# returning to a paused stage resumes from its invested time
def test_return_to_paused_stage_later(tracker, clock):
    tracker.start_focus("L1", "S1")
    clock.advance(400)
    tracker.interrupt(reason="x")
    tracker.switch_stage("L1", "S2")
    clock.advance(1200)
    tracker.complete_stage()
    tracker.start_focus("L1", "S1")
    clock.advance(200)
    assert tracker.invested_seconds("L1", "S1") == pytest.approx(600)
    assert tracker.remaining_seconds("L1", "S1") == pytest.approx(1200)


# requirement 6a: finishing every stage completes the line and summarizes
def test_line_completion_and_summary(tracker, clock):
    for sid in ("S1", "S2", "S3"):
        tracker.start_focus("L1", sid)
        clock.advance(60)
        tracker.complete_stage()
    line = tracker.lines["L1"]
    assert line.status == LineStatus.COMPLETED
    summary = tracker.summary("L1")
    assert summary["status"] == "completed"
    assert summary["completed_stages"] == 3
    assert summary["total_invested_seconds"] == pytest.approx(180)
    # user can go back and keep working on other lines
    tracker.start_focus("L2", "S4")
    assert tracker.current_focus()["line_id"] == "L2"


# requirement 6b: abandoning a line summarizes and frees the session
def test_abandon_line_stops_timer_and_summarizes(tracker, clock):
    tracker.start_focus("L1", "S1")
    clock.advance(500)
    tracker.abandon_line("L1")
    line = tracker.lines["L1"]
    assert line.status == LineStatus.ABANDONED
    assert tracker.state == TrackerState.IDLE
    clock.advance(999)
    assert tracker.invested_seconds("L1", "S1") == pytest.approx(500)
    summary = tracker.summary("L1")
    assert summary["status"] == "abandoned"
    assert summary["completed_stages"] == 0
    tracker.start_focus("L2", "S4")  # other lines remain usable


# illegal transitions are rejected instead of corrupting state
def test_illegal_transitions_raise(tracker):
    with pytest.raises(FocusError):
        tracker.interrupt()
    with pytest.raises(FocusError):
        tracker.resume()
    with pytest.raises(FocusError):
        tracker.switch_stage("L1", "S2")
    tracker.start_focus("L1", "S1")
    with pytest.raises(FocusError):
        tracker.start_focus("L1", "S2")  # must interrupt/complete first
    with pytest.raises(FocusError):
        tracker.resume()


# persistence round-trip keeps timing context intact
def test_persistence_round_trip(tracker, clock):
    tracker.start_focus("L1", "S1")
    clock.advance(300)
    tracker.interrupt(reason="lunch")
    restored = FocusTracker.from_dict(tracker.to_dict(), clock=clock)
    assert restored.state == TrackerState.INTERRUPTED
    assert restored.invested_seconds("L1", "S1") == pytest.approx(300)
    restored.resume()
    clock.advance(100)
    assert restored.remaining_seconds("L1", "S1") == pytest.approx(1400)
