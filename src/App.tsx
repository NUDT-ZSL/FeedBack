import React, { useState, useEffect, useCallback } from 'react';
import CharacterConfig from './components/CharacterConfig';
import BattleLog from './components/BattleLog';
import StatsPanel from './components/StatsPanel';
import { CharacterConfig as CharacterConfigType, BattleResult, SavedConfig, BattleLogEntry } from './types';
import { PRESET_SKILLS } from './data/skills';

const App: React.FC = () => {
  const [player1, setPlayer1] = useState<CharacterConfigType>({
    id: 'p1',
    name: '角色A',
    hp: 200,
    maxHp: 200,
    attack: 25,
    defense: 15,
    speed: 15,
    skills: [PRESET_SKILLS[0], PRESET_SKILLS[2]],
  });

  const [player2, setPlayer2] = useState<CharacterConfigType>({
    id: 'p2',
    name: '角色B',
    hp: 220,
    maxHp: 220,
    attack: 22,
    defense: 18,
    speed: 13,
    skills: [PRESET_SKILLS[1], PRESET_SKILLS[3]],
  });

  const [battleResult, setBattleResult] = useState<BattleResult | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [displayedLogs, setDisplayedLogs] = useState<BattleLogEntry[]>([]);
  const [savedConfigs, setSavedConfigs] = useState<SavedConfig[]>([]);
  const [saveName, setSaveName] = useState('');
  const [particles, setParticles] = useState<Array<{ id: number; x: number; y: number; color: string; size: number }>>([]);

  useEffect(() => {
    loadConfigs();
  }, []);

  const loadConfigs = async () => {
    try {
      const res = await fetch('/api/configs');
      const data = await res.json();
      setSavedConfigs(data);
    } catch (error) {
      console.error('Failed to load configs:', error);
    }
  };

  const startSimulation = async () => {
    if (isSimulating) return;

    setIsSimulating(true);
    setDisplayedLogs([]);
    setBattleResult(null);

    try {
      const response = await fetch('/api/battle/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player1, player2 }),
      });

      const result: BattleResult = await response.json();
      setBattleResult(result);

      let index = 0;
      const logSpeed = Math.ceil(result.logs.length / 60);
      const interval = setInterval(() => {
        if (index >= result.logs.length) {
          clearInterval(interval);
          setIsSimulating(false);
          return;
        }

        const nextIndex = Math.min(index + logSpeed, result.logs.length);
        setDisplayedLogs(result.logs.slice(0, nextIndex));

        const currentLog = result.logs[index];
        if (currentLog && currentLog.skillColor) {
          spawnParticles(currentLog.skillColor);
        }

        index = nextIndex;
      }, 16);
    } catch (error) {
      console.error('Battle simulation failed:', error);
      setIsSimulating(false);
    }
  };

  const spawnParticles = (color: string) => {
    const newParticles = Array.from({ length: 8 }, (_, i) => ({
      id: Date.now() + i,
      x: 40 + Math.random() * 20,
      y: 30 + Math.random() * 40,
      color,
      size: 4 + Math.random() * 4,
    }));

    setParticles((prev) => [...prev, ...newParticles]);

    setTimeout(() => {
      setParticles((prev) => prev.filter((p) => !newParticles.find((np) => np.id === p.id)));
    }, 300);
  };

  const saveConfig = async () => {
    if (!saveName.trim() || savedConfigs.length >= 10) return;

    try {
      const response = await fetch('/api/configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: saveName.trim(),
          player1,
          player2,
          status: 'pending' as const,
        }),
      });

      if (response.ok) {
        setSaveName('');
        loadConfigs();
      }
    } catch (error) {
      console.error('Failed to save config:', error);
    }
  };

  const loadConfig = (config: SavedConfig) => {
    setPlayer1(config.player1);
    setPlayer2(config.player2);
    setBattleResult(null);
    setDisplayedLogs([]);
  };

  const deleteConfig = async (id: string) => {
    try {
      const response = await fetch(`/api/configs/${id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        loadConfigs();
      }
    } catch (error) {
      console.error('Failed to delete config:', error);
    }
  };

  const player1HpPercent = battleResult
    ? (displayedLogs.length > 0
        ? displayedLogs.filter((l) => l.target === player1.name).reduce((hp, log) => {
            if (log.action === 'heal') return hp;
            return Math.max(0, hp - log.value);
          }, player1.hp)
        : player1.hp) / player1.hp * 100
    : 100;

  const player2HpPercent = battleResult
    ? (displayedLogs.length > 0
        ? displayedLogs.filter((l) => l.target === player2.name).reduce((hp, log) => {
            if (log.action === 'heal') return hp;
            return Math.max(0, hp - log.value);
          }, player2.hp)
        : player2.hp) / player2.hp * 100
    : 100;

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>SKILL FORGE</h1>
        <p>角色技能数值平衡模拟沙箱</p>
      </header>

      <div className="main-layout">
        <CharacterConfig
          character={player1}
          onChange={setPlayer1}
          label="角色 1"
          side="left"
        />

        <div className="battle-arena">
          <div className="panel">
            <h2>战斗场景</h2>
            <div className="battle-visual">
              <div className="battle-character">
                <div className={`character-avatar ${isSimulating ? 'attacking' : ''}`}>
                  ⚔️
                </div>
                <div className="hp-bar">
                  <div
                    className="hp-bar-fill"
                    style={{ width: `${Math.max(0, player1HpPercent)}%` }}
                  />
                </div>
                <span className="hp-text">
                  {Math.max(0, Math.round(player1.hp * (player1HpPercent / 100)))} / {player1.hp}
                </span>
                <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)' }}>
                  {player1.name}
                </span>
              </div>

              {particles.map((p) => (
                <div
                  key={p.id}
                  className="particle"
                  style={{
                    left: `${p.x}%`,
                    top: `${p.y}%`,
                    width: `${p.size}px`,
                    height: `${p.size}px`,
                    backgroundColor: p.color,
                    boxShadow: `0 0 ${p.size}px ${p.color}`,
                  }}
                />
              ))}

              <div className="battle-character">
                <div className={`character-avatar ${isSimulating ? '' : ''}`}>
                  🛡️
                </div>
                <div className="hp-bar">
                  <div
                    className="hp-bar-fill"
                    style={{ width: `${Math.max(0, player2HpPercent)}%` }}
                  />
                </div>
                <span className="hp-text">
                  {Math.max(0, Math.round(player2.hp * (player2HpPercent / 100)))} / {player2.hp}
                </span>
                <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)' }}>
                  {player2.name}
                </span>
              </div>
            </div>

            <button
              className="start-button"
              onClick={startSimulation}
              disabled={isSimulating}
            >
              {isSimulating ? '战斗进行中...' : '⚡ 开始模拟战斗'}
            </button>
          </div>

          <BattleLog
            logs={displayedLogs}
            autoScroll={autoScroll}
            onToggleAutoScroll={() => setAutoScroll(!autoScroll)}
          />

          <div className="save-section">
            <input
              type="text"
              className="save-input"
              placeholder="输入配置名称保存..."
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              maxLength={20}
            />
            <button
              className="save-btn"
              onClick={saveConfig}
              disabled={!saveName.trim() || savedConfigs.length >= 10}
            >
              保存配置
            </button>
          </div>
        </div>

        <div>
          {battleResult && !isSimulating ? (
            <StatsPanel
              player1Name={player1.name}
              player2Name={player2.name}
              stats={battleResult.stats}
              winner={battleResult.winner}
            />
          ) : (
            <div className="panel">
              <h2>战斗统计</h2>
              <div
                style={{
                  textAlign: 'center',
                  padding: '60px 20px',
                  color: 'rgba(255,255,255,0.5)',
                }}
              >
                {isSimulating ? '战斗进行中...' : '完成战斗后查看统计数据'}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="history-section">
        <div className="panel">
          <h2>历史配置（{savedConfigs.length}/10）</h2>
          {savedConfigs.length === 0 ? (
            <div style={{ color: 'rgba(255,255,255,0.5)', textAlign: 'center', padding: '20px' }}>
              暂无保存的配置
            </div>
          ) : (
            <div className="history-cards">
              {savedConfigs.map((config) => (
                <div
                  key={config.id}
                  className={`history-card ${config.status}`}
                  onClick={() => loadConfig(config)}
                >
                  <h4>{config.name}</h4>
                  <div className="card-info">
                    <div>
                      {config.player1.name} vs {config.player2.name}
                    </div>
                    <div style={{ marginTop: '4px' }}>
                      {config.status === 'verified' ? '✅ 已验证' : '⏳ 待测试'}
                    </div>
                  </div>
                  <div className="card-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="card-btn load"
                      onClick={() => loadConfig(config)}
                    >
                      载入
                    </button>
                    <button
                      className="card-btn delete"
                      onClick={() => deleteConfig(config.id)}
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;
