import React, { useState, useEffect, useCallback } from 'react';
import EventManager from './components/EventManager';
import RegistrationModule from './components/RegistrationModule';
import CheckInDashboard from './components/CheckInDashboard';
import { theme } from './styles/theme';
import {
  BookstoreEvent,
  Registration,
  CheckInRecord,
  getEvents,
  getRegistrations,
  getCheckInRecords,
  addEvent,
  updateEvent,
  deleteEvent as deleteEventData,
  addRegistration,
  toggleCheckIn,
} from './data/mockData';

type ViewType = 'list' | 'detail' | 'checkin' | 'report';

const App: React.FC = () => {
  const [events, setEvents] = useState<BookstoreEvent[]>([]);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [checkInRecords, setCheckInRecords] = useState<CheckInRecord[]>([]);
  const [currentView, setCurrentView] = useState<ViewType>('list');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [opacity, setOpacity] = useState(1);

  useEffect(() => {
    setEvents(getEvents());
    setRegistrations(getRegistrations());
    setCheckInRecords(getCheckInRecords());
  }, []);

  const navigateTo = useCallback((view: ViewType, eventId?: string) => {
    setOpacity(0);
    setTimeout(() => {
      setCurrentView(view);
      if (eventId !== undefined) setSelectedEventId(eventId);
      setOpacity(1);
    }, 300);
  }, []);

  const handleCreateEvent = useCallback((data: Omit<BookstoreEvent, 'id'>): BookstoreEvent => {
    const newEvent = addEvent(data);
    setEvents(getEvents());
    setRegistrations(getRegistrations());
    setCheckInRecords(getCheckInRecords());
    return newEvent;
  }, []);

  const handleEditEvent = useCallback((id: string, data: Partial<BookstoreEvent>) => {
    updateEvent(id, data);
    setEvents(getEvents());
  }, []);

  const handleDeleteEvent = useCallback((id: string) => {
    deleteEventData(id);
    setEvents(getEvents());
    setRegistrations(getRegistrations());
    setCheckInRecords(getCheckInRecords());
  }, []);

  const handleRegister = useCallback((eventId: string, data: { name: string; phone: string; email: string }): boolean => {
    const event = events.find(e => e.id === eventId);
    if (!event) return false;
    const regCount = registrations.filter(r => r.eventId === eventId).length;
    if (regCount >= event.maxParticipants) return false;
    addRegistration({ eventId, ...data, registeredAt: new Date().toISOString() });
    setRegistrations(getRegistrations());
    setCheckInRecords(getCheckInRecords());
    return true;
  }, [events, registrations]);

  const handleCheckIn = useCallback((registrationId: string, eventId: string) => {
    toggleCheckIn(registrationId, eventId);
    setCheckInRecords(getCheckInRecords());
  }, []);

  const selectedEvent = events.find(e => e.id === selectedEventId) || null;
  const eventRegistrations = selectedEventId
    ? registrations.filter(r => r.eventId === selectedEventId)
    : [];
  const eventCheckIns = selectedEventId
    ? checkInRecords.filter(r => r.eventId === selectedEventId)
    : [];
  const eventRegCount = eventRegistrations.length;

  return (
    <div style={{
      minHeight: '100vh',
      background: theme.colors.background,
      opacity,
      transition: 'opacity 0.3s ease-out',
    }}>
      {currentView === 'list' && (
        <EventManager
          events={events}
          registrations={registrations}
          onCreateEvent={handleCreateEvent}
          onEditEvent={handleEditEvent}
          onDeleteEvent={handleDeleteEvent}
          onSelectEvent={(id) => navigateTo('detail', id)}
          onCheckInMode={(id) => navigateTo('checkin', id)}
          onViewReport={(id) => navigateTo('report', id)}
        />
      )}

      {currentView === 'detail' && selectedEvent && (
        <RegistrationModule
          event={selectedEvent}
          registrations={eventRegistrations}
          registrationCount={eventRegCount}
          onRegister={(data) => handleRegister(selectedEvent.id, data)}
          onBack={() => navigateTo('list')}
          onViewReport={() => navigateTo('report', selectedEvent.id)}
          onCheckInMode={() => navigateTo('checkin', selectedEvent.id)}
        />
      )}

      {currentView === 'checkin' && selectedEvent && (
        <CheckInDashboard
          event={selectedEvent}
          registrations={eventRegistrations}
          checkInRecords={eventCheckIns}
          onCheckIn={(regId) => handleCheckIn(regId, selectedEvent.id)}
          onBack={() => navigateTo('detail', selectedEvent.id)}
          initialMode="checkin"
        />
      )}

      {currentView === 'report' && selectedEvent && (
        <CheckInDashboard
          event={selectedEvent}
          registrations={eventRegistrations}
          checkInRecords={eventCheckIns}
          onCheckIn={(regId) => handleCheckIn(regId, selectedEvent.id)}
          onBack={() => navigateTo('detail', selectedEvent.id)}
          initialMode="report"
        />
      )}
    </div>
  );
};

export default App;
