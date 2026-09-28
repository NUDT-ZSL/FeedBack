import { useState } from 'react';
import { PetProvider, usePet } from './modules/pet/PetProvider';
import { SocialProvider } from './modules/social/SocialProvider';
import PetDisplay from './modules/pet/PetDisplay';
import PetActions from './modules/pet/PetActions';
import PetCardList from './modules/social/PetCard';
import { PetType } from './modules/pet/types';

type Page = 'pet' | 'plaza';

function RegistrationScreen() {
  const { registerPet } = usePet();
  const [name, setName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [selectedType, setSelectedType] = useState<PetType>('cat');

  const petTypes: { type: PetType; label: string; emoji: string; desc: string }[] = [
    { type: 'cat', label: '小猫', emoji: '🐱', desc: '活泼可爱的小橘猫' },
    { type: 'dog', label: '小狗', emoji: '🐶', desc: '忠诚温暖的小伙伴' },
    { type: 'dragon', label: '小龙', emoji: '🐉', desc: '神秘酷炫的绿小龙' },
  ];

  const handleSubmit = () => {
    if (!name.trim() || !ownerName.trim()) return;
    registerPet(selectedType, name.trim(), ownerName.trim());
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #FFF8E7 0%, #FFE0B2 50%, #FFCC80 100%)',
        padding: 20,
      }}
    >
      <div
        style={{
          background: '#FFFFFF',
          borderRadius: 20,
          padding: 40,
          maxWidth: 520,
          width: '100%',
          boxShadow: '0 16px 48px rgba(255,140,66,0.15)',
          animation: 'regIn 0.6s ease-out',
        }}
      >
        <h1
          style={{
            fontFamily: "'Press Start 2P', cursive",
            fontSize: 24,
            color: '#FF8C42',
            textAlign: 'center',
            marginBottom: 8,
          }}
        >
          Pet Paradise
        </h1>
        <p
          style={{
            textAlign: 'center',
            color: '#9E9E9E',
            fontFamily: "'Nunito', sans-serif",
            fontWeight: 600,
            marginBottom: 32,
            fontSize: 14,
          }}
        >
          选择你的伙伴，开始养成之旅！
        </p>

        <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
          {petTypes.map(pt => (
            <button
              key={pt.type}
              onClick={() => setSelectedType(pt.type)}
              style={{
                flex: 1,
                border: selectedType === pt.type ? '3px solid #FF8C42' : '3px solid #EFEBE9',
                borderRadius: 16,
                padding: 20,
                background: selectedType === pt.type ? '#FFF3E0' : '#FAFAFA',
                cursor: 'pointer',
                transition: 'all 0.3s ease-out',
                transform: selectedType === pt.type ? 'scale(1.05)' : 'scale(1)',
                boxShadow: selectedType === pt.type ? '0 4px 16px rgba(255,140,66,0.2)' : 'none',
              }}
            >
              <div style={{ fontSize: 40, textAlign: 'center', marginBottom: 8 }}>{pt.emoji}</div>
              <div
                style={{
                  fontFamily: "'Nunito', sans-serif",
                  fontWeight: 800,
                  fontSize: 14,
                  color: '#5D4037',
                  textAlign: 'center',
                  marginBottom: 4,
                }}
              >
                {pt.label}
              </div>
              <div
                style={{
                  fontFamily: "'Nunito', sans-serif",
                  fontSize: 11,
                  color: '#9E9E9E',
                  textAlign: 'center',
                }}
              >
                {pt.desc}
              </div>
            </button>
          ))}
        </div>

        <div style={{ marginBottom: 16 }}>
          <label
            style={{
              display: 'block',
              fontFamily: "'Nunito', sans-serif",
              fontWeight: 700,
              fontSize: 13,
              color: '#795548',
              marginBottom: 6,
            }}
          >
            宠物名字
          </label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="给宠物取个名字吧"
            style={{
              width: '100%',
              padding: '12px 16px',
              border: '2px solid #EFEBE9',
              borderRadius: 12,
              fontSize: 15,
              fontFamily: "'Nunito', sans-serif",
              fontWeight: 600,
              outline: 'none',
              transition: 'border-color 0.3s ease-out',
              boxSizing: 'border-box',
            }}
            onFocus={e => (e.target.style.borderColor = '#FF8C42')}
            onBlur={e => (e.target.style.borderColor = '#EFEBE9')}
          />
        </div>

        <div style={{ marginBottom: 24 }}>
          <label
            style={{
              display: 'block',
              fontFamily: "'Nunito', sans-serif",
              fontWeight: 700,
              fontSize: 13,
              color: '#795548',
              marginBottom: 6,
            }}
          >
            你的昵称
          </label>
          <input
            value={ownerName}
            onChange={e => setOwnerName(e.target.value)}
            placeholder="输入你的昵称"
            style={{
              width: '100%',
              padding: '12px 16px',
              border: '2px solid #EFEBE9',
              borderRadius: 12,
              fontSize: 15,
              fontFamily: "'Nunito', sans-serif",
              fontWeight: 600,
              outline: 'none',
              transition: 'border-color 0.3s ease-out',
              boxSizing: 'border-box',
            }}
            onFocus={e => (e.target.style.borderColor = '#FF8C42')}
            onBlur={e => (e.target.style.borderColor = '#EFEBE9')}
          />
        </div>

        <button
          onClick={handleSubmit}
          disabled={!name.trim() || !ownerName.trim()}
          style={{
            width: '100%',
            padding: 14,
            border: 'none',
            borderRadius: 12,
            background: name.trim() && ownerName.trim()
              ? 'linear-gradient(135deg, #FF8C42, #F4D03F)'
              : '#D7CCC8',
            color: name.trim() && ownerName.trim() ? '#FFF' : '#9E9E9E',
            fontSize: 17,
            fontWeight: 800,
            fontFamily: "'Nunito', sans-serif",
            cursor: name.trim() && ownerName.trim() ? 'pointer' : 'not-allowed',
            transition: 'all 0.3s ease-out',
            boxShadow: name.trim() && ownerName.trim()
              ? '0 4px 16px rgba(255,140,66,0.3)'
              : 'none',
          }}
        >
          🐾 开始领养
        </button>
      </div>
      <style>{`
        @keyframes regIn {
          from { opacity: 0; transform: translateY(30px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}

function PetPage() {
  return (
    <div
      style={{
        display: 'flex',
        gap: 32,
        maxWidth: 960,
        margin: '0 auto',
        padding: '24px 24px 48px',
        alignItems: 'flex-start',
      }}
    >
      <div style={{ flex: '0 0 60%' }}>
        <PetDisplay />
      </div>
      <div style={{ flex: '0 0 calc(40% - 32px)', minWidth: 260 }}>
        <PetActions />
      </div>
    </div>
  );
}

function PlazaPage() {
  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 24px 48px' }}>
      <PetCardList />
    </div>
  );
}

function AppContent() {
  const { state } = usePet();
  const [page, setPage] = useState<Page>('pet');

  if (state.isRegistering) {
    return <RegistrationScreen />;
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#FFF8E7',
      }}
    >
      <nav
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 32px',
          background: '#FFFFFF',
          boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
          position: 'sticky',
          top: 0,
          zIndex: 100,
        }}
      >
        <div
          style={{
            fontFamily: "'Press Start 2P', cursive",
            fontSize: 16,
            color: '#FF8C42',
            letterSpacing: 1,
          }}
        >
          Pet Paradise
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setPage('pet')}
            style={{
              padding: '8px 20px',
              border: 'none',
              borderRadius: 10,
              backgroundColor: page === 'pet' ? '#FF8C42' : 'transparent',
              color: page === 'pet' ? '#FFF' : '#795548',
              fontWeight: 800,
              fontFamily: "'Nunito', sans-serif",
              cursor: 'pointer',
              fontSize: 14,
              transition: 'all 0.3s ease-out',
            }}
          >
            🐾 我的宠物
          </button>
          <button
            onClick={() => setPage('plaza')}
            style={{
              padding: '8px 20px',
              border: 'none',
              borderRadius: 10,
              backgroundColor: page === 'plaza' ? '#FF8C42' : 'transparent',
              color: page === 'plaza' ? '#FFF' : '#795548',
              fontWeight: 800,
              fontFamily: "'Nunito', sans-serif",
              cursor: 'pointer',
              fontSize: 14,
              transition: 'all 0.3s ease-out',
            }}
          >
            🏪 宠物广场
          </button>
        </div>
      </nav>

      {page === 'pet' ? <PetPage /> : <PlazaPage />}

      <style>{`
        @media (max-width: 768px) {
          div[data-layout='pet-row'] {
            flex-direction: column !important;
          }
        }
      `}</style>
    </div>
  );
}

export default function App() {
  return (
    <PetProvider>
      <SocialProvider>
        <AppContent />
      </SocialProvider>
    </PetProvider>
  );
}
