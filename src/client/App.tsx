import React, { useState, useEffect, createContext, useContext, useCallback } from 'react';
import { Routes, Route, NavLink, Navigate, useParams } from 'react-router-dom';
import type { User, Plant } from './types';
import { getUser } from './api';
import { useWebSocket } from './hooks/useWebSocket';

interface AppContextType {
  currentUser: User | null;
  setCurrentUser: (user: User | null) => void;
  plants: Plant[];
  setPlants: (plants: Plant[]) => void;
}

const AppContext = createContext<AppContextType | null>(null);

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within AppProvider');
  }
  return context;
};

const LoginPage: React.FC = () => {
  const { setCurrentUser } = useAppContext();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    try {
      const { login, register } = await import('./api');
      const response = isRegister
        ? await register(username, password)
        : await login(username, password);
      setCurrentUser(response.user);
      localStorage.setItem('token', response.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    }
  };

  return (
    <div className="container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '80vh' }}>
      <div className="card" style={{ width: '100%', maxWidth: '400px' }}>
        <h2 style={{ textAlign: 'center', marginBottom: 'var(--spacing-lg)' }}>
          {isRegister ? '注册账号' : '登录'}
        </h2>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 'var(--spacing-md)' }}>
            <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', color: 'var(--color-text-light)' }}>
              用户名
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={{ width: '100%' }}
              required
            />
          </div>
          <div style={{ marginBottom: 'var(--spacing-md)' }}>
            <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', color: 'var(--color-text-light)' }}>
              密码
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ width: '100%' }}
              required
            />
          </div>
          {error && (
            <div style={{ color: 'var(--color-warning)', marginBottom: 'var(--spacing-md)', fontSize: '0.875rem' }}>
              {error}
            </div>
          )}
          <button type="submit" className="btn btn-primary" style={{ width: '100%', marginBottom: 'var(--spacing-md)' }}>
            {isRegister ? '注册' : '登录'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ width: '100%' }}
            onClick={() => setIsRegister(!isRegister)}
          >
            {isRegister ? '已有账号？去登录' : '没有账号？去注册'}
          </button>
        </form>
      </div>
    </div>
  );
};

const GardenPage: React.FC = () => {
  const { currentUser, plants, setPlants } = useAppContext();
  const [plantName, setPlantName] = useState('');
  const [plantSpecies, setPlantSpecies] = useState<'cactus' | 'sunflower' | 'succulent'>('sunflower');
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    if (currentUser) {
      const fetchPlants = async () => {
        const { getPlants } = await import('./api');
        const userPlants = await getPlants(currentUser.id);
        setPlants(userPlants);
      };
      fetchPlants();
    }
  }, [currentUser, setPlants]);

  const handleCreatePlant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !plantName.trim()) return;

    try {
      setIsCreating(true);
      const { createPlant } = await import('./api');
      const newPlant = await createPlant(currentUser.id, plantSpecies, plantName.trim());
      setPlants([newPlant, ...plants]);
      setPlantName('');
    } catch (err) {
      console.error('创建植物失败:', err);
    } finally {
      setIsCreating(false);
    }
  };

  const handleAction = async (plantId: string, action: 'water' | 'fertilize' | 'light') => {
    if (!currentUser) return;

    try {
      const { waterPlant, fertilizePlant, adjustLight } = await import('./api');
      let result;

      if (action === 'water') {
        result = await waterPlant(plantId, currentUser.id);
      } else if (action === 'fertilize') {
        result = await fertilizePlant(plantId, currentUser.id);
      } else {
        result = await adjustLight(plantId, currentUser.id);
      }

      if (result.success) {
        setPlants(plants.map(p => p.id === plantId ? result.updatedPlant : p));
      }
    } catch (err) {
      console.error('操作失败:', err);
    }
  };

  if (!currentUser) {
    return <Navigate to="/login" />;
  }

  const isPlantUnhealthy = (plant: Plant) => {
    return plant.health.water < 30 || plant.health.light < 30 || plant.health.nutrition < 30;
  };

  return (
    <div className="container">
      <h2>我的花园</h2>

      <div className="card" style={{ marginBottom: 'var(--spacing-lg)' }}>
        <h3>种植新植物</h3>
        <form onSubmit={handleCreatePlant} style={{ display: 'flex', gap: 'var(--spacing-sm)', flexWrap: 'wrap' }}>
          <input
            type="text"
            value={plantName}
            onChange={(e) => setPlantName(e.target.value)}
            placeholder="给植物起个名字"
            style={{ flex: 1, minWidth: '150px' }}
            required
          />
          <select
            value={plantSpecies}
            onChange={(e) => setPlantSpecies(e.target.value as 'cactus' | 'sunflower' | 'succulent')}
            style={{ minWidth: '120px' }}
          >
            <option value="sunflower">🌻 向日葵</option>
            <option value="cactus">🌵 仙人掌</option>
            <option value="succulent">🌿 多肉</option>
          </select>
          <button type="submit" className="btn btn-primary" disabled={isCreating}>
            {isCreating ? '种植中...' : '种植'}
          </button>
        </form>
      </div>

      {plants.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--spacing-xl)' }}>
          <p style={{ color: 'var(--color-text-light)' }}>还没有植物，快去种一棵吧！</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 'var(--spacing-md)' }}>
          {plants.map((plant) => (
            <div
              key={plant.id}
              className={`card ${isPlantUnhealthy(plant) ? 'plant-card-warning' : ''}`}
            >
              <div style={{ textAlign: 'center', marginBottom: 'var(--spacing-md)' }}>
                <div style={{
                  width: '120px',
                  height: '120px',
                  margin: '0 auto',
                  backgroundColor: 'var(--color-cream)',
                  borderRadius: 'var(--radius-lg)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '3rem',
                }}>
                  {plant.species === 'sunflower' ? '🌻' : plant.species === 'cactus' ? '🌵' : '🌿'}
                </div>
                <h3 style={{ marginTop: 'var(--spacing-sm)', marginBottom: 'var(--spacing-xs)' }}>
                  {plant.name}
                </h3>
                <p style={{ color: 'var(--color-text-light)', fontSize: '0.875rem', marginBottom: 'var(--spacing-sm)' }}>
                  {plant.stage === 'seed' ? '种子' : plant.stage === 'sprout' ? '幼苗' : plant.stage === 'adult' ? '成株' : '开花'}
                  {' · '}
                  成长进度: {Math.floor(plant.progress)}%
                </p>
              </div>

              <div style={{ marginBottom: 'var(--spacing-sm)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', marginBottom: '2px' }}>
                  <span>💧 水分</span>
                  <span style={{ color: plant.health.water < 30 ? 'var(--color-warning)' : 'inherit' }}>
                    {Math.floor(plant.health.water)}%
                  </span>
                </div>
                <div className="progress-bar">
                  <div
                    className={`progress-bar-fill ${plant.health.water < 30 ? 'warning' : plant.health.water > 70 ? 'success' : ''}`}
                    style={{ width: `${plant.health.water}%` }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: 'var(--spacing-sm)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', marginBottom: '2px' }}>
                  <span>☀️ 光照</span>
                  <span style={{ color: plant.health.light < 30 ? 'var(--color-warning)' : 'inherit' }}>
                    {Math.floor(plant.health.light)}%
                  </span>
                </div>
                <div className="progress-bar">
                  <div
                    className={`progress-bar-fill ${plant.health.light < 30 ? 'warning' : plant.health.light > 70 ? 'success' : ''}`}
                    style={{ width: `${plant.health.light}%` }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: 'var(--spacing-md)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', marginBottom: '2px' }}>
                  <span>🌱 营养</span>
                  <span style={{ color: plant.health.nutrition < 30 ? 'var(--color-warning)' : 'inherit' }}>
                    {Math.floor(plant.health.nutrition)}%
                  </span>
                </div>
                <div className="progress-bar">
                  <div
                    className={`progress-bar-fill ${plant.health.nutrition < 30 ? 'warning' : plant.health.nutrition > 70 ? 'success' : ''}`}
                    style={{ width: `${plant.health.nutrition}%` }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 'var(--spacing-xs)' }}>
                <button
                  className="btn btn-secondary"
                  style={{ flex: 1, fontSize: '0.875rem' }}
                  onClick={() => handleAction(plant.id, 'water')}
                >
                  💧 浇水
                </button>
                <button
                  className="btn btn-secondary"
                  style={{ flex: 1, fontSize: '0.875rem' }}
                  onClick={() => handleAction(plant.id, 'fertilize')}
                >
                  🌱 施肥
                </button>
                <button
                  className="btn btn-secondary"
                  style={{ flex: 1, fontSize: '0.875rem' }}
                  onClick={() => handleAction(plant.id, 'light')}
                >
                  ☀️ 光照
                </button>
              </div>

              {plant.lastHelpers.length > 0 && (
                <div style={{ marginTop: 'var(--spacing-md)', paddingTop: 'var(--spacing-sm)', borderTop: '1px solid var(--color-border)' }}>
                  <p style={{ fontSize: '0.75rem', color: 'var(--color-text-light)', marginBottom: 'var(--spacing-xs)' }}>
                    最近来帮忙的好友:
                  </p>
                  <div style={{ display: 'flex', gap: 'var(--spacing-xs)' }}>
                    {plant.lastHelpers.slice(0, 5).map((helper, index) => (
                      <div
                        key={index}
                        title={helper.username}
                        style={{
                          width: '24px',
                          height: '24px',
                          borderRadius: '50%',
                          backgroundColor: 'var(--color-primary-light)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '0.75rem',
                          color: 'white',
                        }}
                      >
                        {helper.username.charAt(0)}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const FriendGardenPage: React.FC = () => {
  const { currentUser } = useAppContext();
  const [friends, setFriends] = useState<User[]>([]);
  const [selectedFriend, setSelectedFriend] = useState<User | null>(null);
  const [friendPlants, setFriendPlants] = useState<Plant[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<User[]>([]);

  useEffect(() => {
    if (currentUser) {
      const fetchFriends = async () => {
        const { getFriends } = await import('./api');
        const userFriends = await getFriends(currentUser.id);
        setFriends(userFriends);
      };
      fetchFriends();
    }
  }, [currentUser]);

  useEffect(() => {
    if (selectedFriend) {
      const fetchFriendPlants = async () => {
        const { getPlants } = await import('./api');
        const plants = await getPlants(selectedFriend.id);
        setFriendPlants(plants);
      };
      fetchFriendPlants();
    }
  }, [selectedFriend]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    try {
      const { searchUsers } = await import('./api');
      const results = await searchUsers(searchQuery.trim());
      setSearchResults(results.filter(u => u.id !== currentUser?.id));
    } catch (err) {
      console.error('搜索失败:', err);
    }
  };

  const handleAddFriend = async (friendId: string) => {
    if (!currentUser) return;

    try {
      const { addFriend } = await import('./api');
      await addFriend(currentUser.id, friendId);

      const { getFriends } = await import('./api');
      const userFriends = await getFriends(currentUser.id);
      setFriends(userFriends);
      setSearchResults(searchResults.filter(u => u.id !== friendId));
    } catch (err) {
      console.error('添加好友失败:', err);
    }
  };

  const handleWaterFriendPlant = async (plantId: string) => {
    if (!currentUser) return;

    try {
      const { waterPlant } = await import('./api');
      const result = await waterPlant(plantId, currentUser.id);
      if (result.success) {
        setFriendPlants(friendPlants.map(p => p.id === plantId ? result.updatedPlant : p));
      }
    } catch (err) {
      console.error('浇水失败:', err);
    }
  };

  const handleFertilizeFriendPlant = async (plantId: string) => {
    if (!currentUser) return;

    try {
      const { fertilizePlant } = await import('./api');
      const result = await fertilizePlant(plantId, currentUser.id);
      if (result.success) {
        setFriendPlants(friendPlants.map(p => p.id === plantId ? result.updatedPlant : p));
      }
    } catch (err) {
      console.error('施肥失败:', err);
    }
  };

  if (!currentUser) {
    return <Navigate to="/login" />;
  }

  return (
    <div className="container">
      <h2>好友花园</h2>

      <div className="card" style={{ marginBottom: 'var(--spacing-lg)' }}>
        <h3>搜索好友</h3>
        <div style={{ display: 'flex', gap: 'var(--spacing-sm)', marginBottom: 'var(--spacing-md)' }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="输入用户名搜索"
            style={{ flex: 1 }}
            onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
          />
          <button className="btn btn-primary" onClick={handleSearch}>
            搜索
          </button>
        </div>

        {searchResults.length > 0 && (
          <div style={{ marginBottom: 'var(--spacing-md)' }}>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-text-light)', marginBottom: 'var(--spacing-sm)' }}>
              搜索结果:
            </p>
            {searchResults.map((user) => {
              const isAlreadyFriend = friends.some(f => f.id === user.id);
              return (
                <div
                  key={user.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: 'var(--spacing-sm)',
                    backgroundColor: 'var(--color-cream-light)',
                    borderRadius: 'var(--radius-sm)',
                    marginBottom: 'var(--spacing-xs)',
                  }}
                >
                  <span>{user.username}</span>
                  {isAlreadyFriend ? (
                    <span style={{ color: 'var(--color-success)', fontSize: '0.875rem' }}>
                      ✓ 已是好友
                    </span>
                  ) : (
                    <button
                      className="btn btn-primary"
                      style={{ padding: '4px 12px', fontSize: '0.875rem' }}
                      onClick={() => handleAddFriend(user.id)}
                    >
                      添加好友
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '250px 1fr', gap: 'var(--spacing-lg)' }}>
        <div>
          <h3>我的好友</h3>
          {friends.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 'var(--spacing-lg)' }}>
              <p style={{ color: 'var(--color-text-light)', fontSize: '0.875rem' }}>
                还没有好友，快去搜索添加吧！
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-xs)' }}>
              {friends.map((friend) => (
                <button
                  key={friend.id}
                  className={`card ${selectedFriend?.id === friend.id ? 'bounce-feedback' : ''}`}
                  style={{
                    textAlign: 'left',
                    padding: 'var(--spacing-sm)',
                    border: selectedFriend?.id === friend.id ? '2px solid var(--color-primary)' : 'none',
                  }}
                  onClick={() => setSelectedFriend(friend)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
                    <div style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      backgroundColor: 'var(--color-primary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'white',
                      fontWeight: 'bold',
                    }}>
                      {friend.username.charAt(0)}
                    </div>
                    <span>{friend.username}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          {selectedFriend ? (
            <>
              <h3>{selectedFriend.username} 的花园</h3>
              {friendPlants.length === 0 ? (
                <div className="card" style={{ textAlign: 'center', padding: 'var(--spacing-xl)' }}>
                  <p style={{ color: 'var(--color-text-light)' }}>TA 还没有种植植物</p>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 'var(--spacing-md)' }}>
                  {friendPlants.map((plant) => (
                    <div key={plant.id} className="card">
                      <div style={{ textAlign: 'center', marginBottom: 'var(--spacing-md)' }}>
                        <div style={{
                          width: '100px',
                          height: '100px',
                          margin: '0 auto',
                          backgroundColor: 'var(--color-cream)',
                          borderRadius: 'var(--radius-lg)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '2.5rem',
                        }}>
                          {plant.species === 'sunflower' ? '🌻' : plant.species === 'cactus' ? '🌵' : '🌿'}
                        </div>
                        <h4 style={{ marginTop: 'var(--spacing-sm)', marginBottom: 'var(--spacing-xs)' }}>
                          {plant.name}
                        </h4>
                        <p style={{ color: 'var(--color-text-light)', fontSize: '0.75rem' }}>
                          {plant.stage === 'seed' ? '种子' : plant.stage === 'sprout' ? '幼苗' : plant.stage === 'adult' ? '成株' : '开花'}
                        </p>
                      </div>

                      <div style={{ marginBottom: 'var(--spacing-xs)', fontSize: '0.75rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>💧 水分: {Math.floor(plant.health.water)}%</span>
                        </div>
                        <div className="progress-bar" style={{ height: '4px', marginTop: '2px' }}>
                          <div
                            className={`progress-bar-fill ${plant.health.water < 30 ? 'warning' : ''}`}
                            style={{ width: `${plant.health.water}%` }}
                          />
                        </div>
                      </div>

                      <div style={{ marginBottom: 'var(--spacing-xs)', fontSize: '0.75rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>☀️ 光照: {Math.floor(plant.health.light)}%</span>
                        </div>
                        <div className="progress-bar" style={{ height: '4px', marginTop: '2px' }}>
                          <div
                            className={`progress-bar-fill ${plant.health.light < 30 ? 'warning' : ''}`}
                            style={{ width: `${plant.health.light}%` }}
                          />
                        </div>
                      </div>

                      <div style={{ marginBottom: 'var(--spacing-md)', fontSize: '0.75rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>🌱 营养: {Math.floor(plant.health.nutrition)}%</span>
                        </div>
                        <div className="progress-bar" style={{ height: '4px', marginTop: '2px' }}>
                          <div
                            className={`progress-bar-fill ${plant.health.nutrition < 30 ? 'warning' : ''}`}
                            style={{ width: `${plant.health.nutrition}%` }}
                          />
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 'var(--spacing-xs)' }}>
                        <button
                          className="btn btn-secondary"
                          style={{ flex: 1, fontSize: '0.75rem', padding: '6px' }}
                          onClick={() => handleWaterFriendPlant(plant.id)}
                        >
                          💧 浇水
                        </button>
                        <button
                          className="btn btn-secondary"
                          style={{ flex: 1, fontSize: '0.75rem', padding: '6px' }}
                          onClick={() => handleFertilizeFriendPlant(plant.id)}
                        >
                          🌱 施肥
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="card" style={{ textAlign: 'center', padding: 'var(--spacing-xl)' }}>
              <p style={{ color: 'var(--color-text-light)' }}>选择一个好友查看 TA 的花园</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const LeaderboardPage: React.FC = () => {
  const { currentUser } = useAppContext();
  const [leaderboard, setLeaderboard] = useState<Array<{
    userId: string;
    username: string;
    avatar: string;
    totalScore: number;
    recentPlants: Plant[];
  }>>([]);

  useEffect(() => {
    const fetchLeaderboard = async () => {
      const { getLeaderboard } = await import('./api');
      const data = await getLeaderboard();
      setLeaderboard(data);
    };
    fetchLeaderboard();
  }, []);

  if (!currentUser) {
    return <Navigate to="/login" />;
  }

  const getRankEmoji = (rank: number) => {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return `${rank}`;
  };

  return (
    <div className="container">
      <h2>排行榜</h2>

      <div className="card" style={{ marginBottom: 'var(--spacing-lg)' }}>
        <p style={{ color: 'var(--color-text-light)', marginBottom: 0 }}>
          排行榜根据植物成长进度、阶段、好友帮助数和种植时长综合计算得分
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-sm)' }}>
        {leaderboard.map((entry, index) => (
          <div
            key={entry.userId}
            className={`card ${entry.userId === currentUser.id ? 'bounce-feedback' : ''}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--spacing-md)',
              border: entry.userId === currentUser.id ? '2px solid var(--color-primary)' : 'none',
            }}
          >
            <div style={{
              width: '48px',
              height: '48px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: index < 3 ? '1.5rem' : '1.25rem',
              fontWeight: 'bold',
              color: index < 3 ? 'inherit' : 'var(--color-text-light)',
            }}>
              {getRankEmoji(index + 1)}
            </div>

            <div style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              backgroundColor: 'var(--color-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontSize: '1.25rem',
              fontWeight: 'bold',
              flexShrink: 0,
            }}>
              {entry.username.charAt(0)}
            </div>

            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
                <h4 style={{ marginBottom: 0 }}>{entry.username}</h4>
                {entry.userId === currentUser.id && (
                  <span style={{
                    fontSize: '0.75rem',
                    padding: '2px 8px',
                    backgroundColor: 'var(--color-primary)',
                    color: 'white',
                    borderRadius: 'var(--radius-full)',
                  }}>
                    我
                  </span>
                )}
              </div>
              {entry.recentPlants.length > 0 && (
                <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                  {entry.recentPlants.slice(0, 3).map((plant, i) => (
                    <span key={i} title={plant.name} style={{ fontSize: '1rem' }}>
                      {plant.species === 'sunflower' ? '🌻' : plant.species === 'cactus' ? '🌵' : '🌿'}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div style={{ textAlign: 'right' }}>
              <div style={{
                fontSize: '1.5rem',
                fontWeight: 'bold',
                color: 'var(--color-primary-dark)',
              }}>
                {entry.totalScore}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-light)' }}>
                总积分
              </div>
            </div>
          </div>
        ))}
      </div>

      {leaderboard.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--spacing-xl)' }}>
          <p style={{ color: 'var(--color-text-light)' }}>暂无排行数据</p>
        </div>
      )}
    </div>
  );
};

const Navigation: React.FC = () => {
  const { currentUser, setCurrentUser } = useAppContext();

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem('token');
  };

  if (!currentUser) return null;

  return (
    <nav className="navbar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-lg)' }}>
        <span style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>🌱 植物养成</span>
        <NavLink to="/garden" className={({ isActive }) => isActive ? 'active' : ''}>
          我的花园
        </NavLink>
        <NavLink to="/friends" className={({ isActive }) => isActive ? 'active' : ''}>
          好友花园
        </NavLink>
        <NavLink to="/leaderboard" className={({ isActive }) => isActive ? 'active' : ''}>
          排行榜
        </NavLink>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)' }}>
        <span style={{ fontSize: '0.875rem' }}>欢迎, {currentUser.username}</span>
        <button
          className="btn btn-secondary"
          style={{ fontSize: '0.875rem', padding: '4px 12px' }}
          onClick={handleLogout}
        >
          退出登录
        </button>
      </div>
    </nav>
  );
};

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [plants, setPlants] = useState<Plant[]>([]);

  const { send, subscribe } = useWebSocket('ws://localhost:3001');

  useEffect(() => {
    const token = localStorage.getItem('token');
    const savedUserId = localStorage.getItem('userId');

    if (token && savedUserId) {
      const autoLogin = async () => {
        try {
          const user = await getUser(savedUserId);
          setCurrentUser(user);
        } catch {
          localStorage.removeItem('token');
          localStorage.removeItem('userId');
        }
      };
      autoLogin();
    }
  }, []);

  useEffect(() => {
    if (currentUser) {
      localStorage.setItem('userId', currentUser.id);

      send({
        type: 'subscribe',
        userId: currentUser.id,
      });

      const unsubscribe = subscribe((message) => {
        console.log('WebSocket message:', message);
      });

      return () => {
        unsubscribe();
        send({
          type: 'unsubscribe',
          userId: currentUser.id,
        });
      };
    }
  }, [currentUser, send, subscribe]);

  const contextValue = {
    currentUser,
    setCurrentUser,
    plants,
    setPlants,
  };

  return (
    <AppContext.Provider value={contextValue}>
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        <Navigation />
        <main style={{ flex: 1 }}>
          <Routes>
            <Route path="/" element={<Navigate to={currentUser ? '/garden' : '/login'} />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/garden" element={<GardenPage />} />
            <Route path="/friends" element={<FriendGardenPage />} />
            <Route path="/leaderboard" element={<LeaderboardPage />} />
            <Route path="*" element={<Navigate to={currentUser ? '/garden' : '/login'} />} />
          </Routes>
        </main>
      </div>
    </AppContext.Provider>
  );
};

export default App;
