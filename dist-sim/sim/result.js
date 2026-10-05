function emptyPatternCounts() {
    return { fan: 0, spiral: 0, grid: 0 };
}
export function buildResult(config, events, curve, configHash) {
    const waves = new Map();
    const nukes = [];
    const energyLedger = [];
    const totals = {
        score: 0,
        kills: 0,
        escaped: 0,
        nukeCount: 0,
        maxEnergyObserved: 0,
        finalEnergy: 0,
        firesByPattern: emptyPatternCounts()
    };
    const waveSummary = (wave) => {
        let w = waves.get(wave);
        if (!w) {
            w = {
                wave,
                startMs: -1,
                endMs: null,
                spawned: 0,
                killedByPlayer: 0,
                killedByNuke: 0,
                escaped: 0,
                berserkCount: 0,
                scoreGained: 0,
                energyGained: 0,
                firesByPattern: emptyPatternCounts()
            };
            waves.set(wave, w);
        }
        return w;
    };
    for (const e of events) {
        switch (e.type) {
            case 'wave-start':
                waveSummary(e.wave).startMs = e.t;
                break;
            case 'wave-end':
                waveSummary(e.wave).endMs = e.t;
                break;
            case 'enemy-spawn':
                waveSummary(e.wave).spawned++;
                break;
            case 'enemy-berserk':
                waveSummary(e.wave).berserkCount++;
                break;
            case 'enemy-fire':
                waveSummary(e.wave).firesByPattern[e.pattern]++;
                totals.firesByPattern[e.pattern]++;
                break;
            case 'enemy-escape':
                waveSummary(e.wave).escaped++;
                totals.escaped++;
                break;
            case 'enemy-death': {
                const w = waveSummary(e.wave);
                if (e.via === 'player')
                    w.killedByPlayer++;
                else
                    w.killedByNuke++;
                w.scoreGained += e.scoreGained;
                totals.score = e.scoreAfter;
                totals.kills++;
                break;
            }
            case 'energy': {
                energyLedger.push({ t: e.t, delta: e.delta, source: e.source, energyAfter: e.energyAfter });
                if (e.source.type === 'kill') {
                    const id = e.source.enemyId;
                    const wave = Number(id.slice(1, id.indexOf('-')));
                    waveSummary(wave).energyGained += e.delta;
                }
                totals.maxEnergyObserved = Math.max(totals.maxEnergyObserved, e.energyAfter);
                totals.finalEnergy = e.energyAfter;
                break;
            }
            case 'nuke':
                totals.nukeCount++;
                nukes.push({
                    t: e.t,
                    energyBefore: e.energyBefore,
                    clearedEnemyIds: e.clearedEnemyIds,
                    scoreByEnemy: e.scoreByEnemy,
                    scoreGained: e.scoreGained,
                    energyAfter: e.energyAfter,
                    bulletsCleared: e.bulletsCleared
                });
                break;
            default:
                break;
        }
    }
    const durationMs = curve.length > 0 ? curve[curve.length - 1].t : 0;
    const waveList = [...waves.values()].sort((a, b) => a.wave - b.wave);
    return {
        meta: {
            seed: config.seed,
            tickMs: config.tickMs,
            durationMs,
            waves: waveList.length,
            eventCount: events.length,
            configHash
        },
        totals,
        waves: waveList,
        nukes,
        energyLedger,
        energyCurve: curve,
        events
    };
}
