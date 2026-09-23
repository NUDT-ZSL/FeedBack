"""Behavior tests for the note-threading app (requirements 3-6)."""
import copy
import json

from threads import ThreadStore, derive_thread


def load_sample():
    with open('sample_notes.json', encoding='utf-8') as f:
        return json.load(f)['notes']


def fresh_store():
    s = ThreadStore()
    s.import_notes(load_sample())
    assert s.verify_consistency() == []
    return s


def test_import_clusters_and_deterministic():
    a, b = fresh_store(), fresh_store()
    pa = sorted(tuple(t['note_ids']) for t in a.threads.values())
    pb = sorted(tuple(t['note_ids']) for t in b.threads.values())
    assert pa == pb, 'clustering must be deterministic'
    assert len(pa) >= 3, 'expected several thematic threads, got %s' % pa
    print('ok import: %d threads -> %s' % (len(pa), pa))


def test_move_only_affects_two_threads():
    s = fresh_store()
    before = copy.deepcopy(s.threads)
    note = sorted(s.notes)[0]
    src = next(t for t, th in s.threads.items() if note in th['note_ids'])
    dst = next(t for t in s.threads if t != src)
    affected = s.move_note(note, dst)
    assert sorted(affected) == sorted([src, dst]) or affected == [dst]
    for tid, th in s.threads.items():
        if tid not in affected:
            assert th == before[tid], 'unaffected thread %s changed' % tid
    # note belongs to exactly one thread, no residual membership
    owners = [t for t, th in s.threads.items() if note in th['note_ids']]
    assert owners == [dst]
    # old links to the note are gone everywhere
    for th in s.threads.values():
        for l in th['links']:
            if l['a'] == note or l['b'] == note:
                assert False, 'stale link to moved note'
    assert s.verify_consistency() == []
    print('ok move: affected=%s' % affected)


def test_incremental_equals_full_recompute():
    s = fresh_store()
    ids = sorted(s.notes)
    tids = sorted(s.threads)
    s.move_note(ids[1], tids[-1])
    s.split_note(ids[3])
    s.merge_threads(*sorted(s.threads)[:2])
    # full recompute of every thread must reproduce current state exactly
    vectors = s._vectors()
    for tid, th in s.threads.items():
        fresh = derive_thread(th['note_ids'], s.notes, vectors)
        for key in ('theme', 'links', 'stats'):
            assert fresh[key] == th[key], 'thread %s field %s differs' % (tid, key)
    assert s.verify_consistency() == []
    print('ok incremental == full recompute')


def test_merge_keeps_notes_and_blocks_duplicates():
    s = fresh_store()
    ta, tb = sorted(s.threads)[:2]
    union = sorted(s.threads[ta]['note_ids'] + s.threads[tb]['note_ids'])
    affected = s.merge_threads(ta, tb)
    assert affected == [min(ta, tb)]
    assert s.threads[affected[0]]['note_ids'] == union
    assert tb not in s.threads
    assert s.verify_consistency() == []
    # corrupt state: same note in two threads -> merge must be blocked
    s2 = fresh_store()
    t1, t2 = sorted(s2.threads)[:2]
    victim = s2.threads[t1]['note_ids'][0]
    s2.threads[t2]['note_ids'].append(victim)
    snapshot = copy.deepcopy(s2.threads)
    try:
        s2.merge_threads(t1, t2)
        assert False, 'duplicate merge should be blocked'
    except ValueError as e:
        assert 'duplicate' in str(e)
    assert s2.threads == snapshot, 'blocked merge must not change state'
    print('ok merge (kept=%s, duplicate blocked)' % affected)


def test_split_and_undo():
    s = fresh_store()
    before = copy.deepcopy(s.to_dict())
    tid = max(s.threads, key=lambda t: len(s.threads[t]['note_ids']))
    note = s.threads[tid]['note_ids'][0]
    affected = s.split_note(note)
    assert len(affected) == 2
    new_tid = next(t for t in affected if t != tid)
    assert s.threads[new_tid]['note_ids'] == [note]
    assert note not in s.threads[tid]['note_ids']
    assert s.verify_consistency() == []
    undone = s.undo()
    assert s.to_dict()['threads'] == before['threads']
    assert s.to_dict()['notes'] == before['notes']
    print('ok split (affected=%s) and undo (restored, touched=%s)' % (affected, undone))


if __name__ == '__main__':
    test_import_clusters_and_deterministic()
    test_move_only_affects_two_threads()
    test_incremental_equals_full_recompute()
    test_merge_keeps_notes_and_blocks_duplicates()
    test_split_and_undo()
    print('ALL TESTS PASSED')
