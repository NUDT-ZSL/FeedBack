import { useEffect, useState } from 'react';
import Header from './components/Header';
import MemberList from './components/MemberList';
import TimeLine from './components/TimeLine';
import { useScheduleStore, initializeStore } from './store/useScheduleStore';

export default function App() {
  const {
    members,
    events,
    currentTimezone,
    zoomLevel,
    addMember,
    removeMember,
    addEvent,
    removeEvent,
    updateEventTime,
    setTimezone,
    setZoom,
  } = useScheduleStore();

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    initializeStore().then(() => setIsInitialized(true));
  }, []);

  if (!isInitialized) {
    return (
      <div
        style={{
          width: '100vw',
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0D1117',
        }}
      >
        <div
          style={{
            color: '#8B949E',
            fontSize: '16px',
          }}
        >
          加载中...
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        backgroundColor: '#0D1117',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      }}
    >
      <Header
        currentTimezone={currentTimezone}
        onTimezoneChange={setTimezone}
        onAddEvent={addEvent}
        members={members}
        onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
      />
      <div
        style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}
      >
        <MemberList
          variant="desktop"
          members={members}
          onAdd={addMember}
          onRemove={removeMember}
        />
        <MemberList
          variant="mobile"
          members={members}
          onAdd={addMember}
          onRemove={removeMember}
          isMobileOpen={isSidebarOpen}
          onMobileClose={() => setIsSidebarOpen(false)}
        />
        <TimeLine
          members={members}
          events={events}
          baseTimezone={currentTimezone}
          zoom={zoomLevel}
          onZoomChange={setZoom}
          onUpdateEventTime={updateEventTime}
          onRemoveEvent={removeEvent}
        />
      </div>
    </div>
  );
}
