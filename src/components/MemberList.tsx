import { useState } from 'react';
import type { TeamMember } from '../types';
import MemberCard from './MemberCard';
import MemberModal from './MemberModal';

interface MemberListProps {
  members: TeamMember[];
  onAdd: (data: { name: string; timezone: string }) => void;
  onRemove: (id: string) => void;
  variant?: 'desktop' | 'mobile';
  isMobileOpen?: boolean;
  onMobileClose?: () => void;
}

export default function MemberList({
  members,
  onAdd,
  onRemove,
  variant = 'desktop',
  isMobileOpen = false,
  onMobileClose,
}: MemberListProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const isDesktop = variant === 'desktop';

  const content = (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '20px',
        }}
      >
        <h2
          style={{
            color: '#FFFFFF',
            fontSize: '16px',
            fontWeight: 600,
            margin: 0,
          }}
        >
          团队成员
        </h2>
        <button
          onClick={() => setIsModalOpen(true)}
          style={{
            width: '28px',
            height: '28px',
            borderRadius: '6px',
            backgroundColor: '#6366F1',
            border: 'none',
            color: '#FFFFFF',
            fontSize: '18px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            lineHeight: 1,
            transition: 'background-color 150ms ease',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor =
              '#4F46E5';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor =
              '#6366F1';
          }}
        >
          +
        </button>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '32px',
        }}
      >
        {members.map((member) => (
          <MemberCard key={member.id} member={member} onRemove={onRemove} />
        ))}
        {members.length === 0 && (
          <div
            style={{
              color: '#8B949E',
              fontSize: '13px',
              textAlign: 'center',
              padding: '20px 0',
            }}
          >
            暂无成员，点击 + 添加
          </div>
        )}
      </div>
    </>
  );

  if (isDesktop) {
    return (
      <>
        <aside
          className="desktop-sidebar"
          style={{
            width: '240px',
            backgroundColor: '#1E1E2E',
            borderTopRightRadius: '8px',
            borderBottomRightRadius: '8px',
            padding: '20px 16px',
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0,
            overflowY: 'auto',
          }}
        >
          {content}
        </aside>
        <MemberModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSubmit={onAdd}
        />
      </>
    );
  }

  return (
    <>
      <aside
        className="member-sidebar"
        style={{
          width: '240px',
          backgroundColor: '#1E1E2E',
          borderTopRightRadius: '8px',
          borderBottomRightRadius: '8px',
          padding: '20px 16px',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          overflowY: 'auto',
          transform: isMobileOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 300ms ease',
          position: 'fixed',
          top: '64px',
          left: 0,
          bottom: 0,
          zIndex: 50,
        }}
      >
        {content}
      </aside>

      {isMobileOpen && (
        <div
          onClick={onMobileClose}
          style={{
            position: 'fixed',
            top: '64px',
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.4)',
            zIndex: 40,
          }}
          className="mobile-overlay"
        />
      )}

      <MemberModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={onAdd}
      />
    </>
  );
}
