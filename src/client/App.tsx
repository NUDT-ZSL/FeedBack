import { useState, useEffect } from 'react';
import EventCreate from './EventCreate';
import EventDetail from './EventDetail';
import Attendance from './Attendance';
import Dashboard from './Dashboard';
import type { Event } from './types';

type Page = 'create' | 'detail' | 'attendance' | 'dashboard';

function App() {
  const [currentPage, setCurrentPage] = useState<Page>('create');
  const [currentEvent, setCurrentEvent] = useState<Event | null>(null);
  const [eventId, setEventId] = useState<string | null>(null);

  useEffect(() => {
    const pathname = window.location.pathname;
    const pathMatch = pathname.match(/\/(attendance|dashboard|event)\/([^/]+)/);
    
    if (pathMatch) {
      const [, pageType, eid] = pathMatch;
      setEventId(eid);
      if (pageType === 'attendance') {
        setCurrentPage('attendance');
      } else if (pageType === 'dashboard') {
        setCurrentPage('dashboard');
      } else if (pageType === 'event') {
        setCurrentPage('detail');
        fetchEvent(eid);
      }
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const eid = params.get('eventId');
    const page = params.get('page');

    if (eid) {
      setEventId(eid);
      if (page === 'attendance') {
        setCurrentPage('attendance');
      } else if (page === 'dashboard') {
        setCurrentPage('dashboard');
      } else {
        setCurrentPage('detail');
        fetchEvent(eid);
      }
    }
  }, []);

  const fetchEvent = async (id: string) => {
    try {
      const response = await fetch(`/api/events/${id}`);
      const event = await response.json();
      setCurrentEvent(event);
    } catch (error) {
      console.error('Failed to fetch event:', error);
    }
  };

  const handleEventCreated = (event: Event) => {
    setCurrentEvent(event);
    setEventId(event.id);
    setCurrentPage('detail');
    window.history.pushState({}, '', `/event/${event.id}`);
  };

  const goToCreate = () => {
    setCurrentPage('create');
    setCurrentEvent(null);
    setEventId(null);
    window.history.pushState({}, '', '/');
  };

  const renderPage = () => {
    switch (currentPage) {
      case 'create':
        return <EventCreate onEventCreated={handleEventCreated} />;
      case 'detail':
        return currentEvent ? (
          <EventDetail event={currentEvent} onBack={goToCreate} />
        ) : null;
      case 'attendance':
        return eventId ? <Attendance eventId={eventId} /> : null;
      case 'dashboard':
        return eventId ? <Dashboard eventId={eventId} /> : null;
      default:
        return <EventCreate onEventCreated={handleEventCreated} />;
    }
  };

  return (
    <div className="app">
      {renderPage()}
    </div>
  );
}

export default App;
