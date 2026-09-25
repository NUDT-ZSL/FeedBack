export interface Event {
  id: string;
  name: string;
  dateTime: string;
  location: string;
  maxCapacity: number;
  description: string;
  createdAt: string;
}

export interface Registration {
  id: string;
  eventId: string;
  name: string;
  email: string;
  checkedIn: boolean;
  checkedInAt?: string;
  createdAt: string;
}

export interface EventWithStats extends Event {
  registeredCount: number;
  isFull: boolean;
}

export interface CreateEventRequest {
  name: string;
  dateTime: string;
  location: string;
  maxCapacity: number;
  description: string;
}

export interface RegisterRequest {
  eventId: string;
  name: string;
  email: string;
}

export interface RegisterResponse {
  registration: Registration;
  qrCodeDataUrl: string;
}

export interface VerifyRequest {
  registrationId: string;
  eventId: string;
}

export interface VerifyResponse {
  success: boolean;
  registration?: Registration;
  message: string;
}
