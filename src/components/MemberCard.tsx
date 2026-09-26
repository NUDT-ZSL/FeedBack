import type { TeamMember } from '../types';
import { TIMEZONE_OPTIONS } from '../utils/timezone';

interface MemberCardProps {
  member: TeamMember;
  onRemove: (id: string) => void;
}

export default function MemberCard({ member, onRemove }: MemberCardProps) {
  const initial = member.name.charAt(0).toUpperCase();
  const timezoneLabel =
    TIMEZONE_OPTIONS.find((tz) => tz.value === member.timezone)?.label ||
    member.timezone;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '12px',
        borderRadius: '8px',
        backgroundColor: 'rgba(255,255,255,0.05)',
        position: 'relative',
        transition: 'background-color 150ms ease',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.backgroundColor =
          'rgba(255,255,255,0.1)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.backgroundColor =
          'rgba(255,255,255,0.05)';
      }}
    >
      <div
        style={{
          width: '32px',
          height: '32px',
          borderRadius: '50%',
          backgroundColor: member.avatarColor,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#FFFFFF',
          fontWeight: 600,
          fontSize: '14px',
          flexShrink: 0,
        }}
      >
        {initial}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            color: '#FFFFFF',
            fontSize: '14px',
            fontWeight: 500,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {member.name}
        </div>
        <div
          style={{
            color: '#8B949E',
            fontSize: '12px',
            marginTop: '2px',
          }}
        >
          {timezoneLabel}
        </div>
      </div>
      <button
        onClick={() => onRemove(member.id)}
        style={{
          background: 'none',
          border: 'none',
          color: '#8B949E',
          cursor: 'pointer',
          fontSize: '16px',
          padding: '4px',
          lineHeight: 1,
          opacity: 0,
          transition: 'opacity 150ms ease, color 150ms ease',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.opacity = '1';
          (e.currentTarget as HTMLButtonElement).style.color = '#FF5555';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.opacity = '0';
          (e.currentTarget as HTMLButtonElement).style.color = '#8B949E';
        }}
        className="member-delete-btn"
      >
        ×
      </button>
    </div>
  );
}
