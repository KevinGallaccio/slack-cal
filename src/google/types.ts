export interface CalendarEvent {
  id: string;
  status: 'confirmed' | 'tentative' | 'cancelled';
  summary?: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: { email: string; displayName?: string; responseStatus?: string }[];
  updated: string;
  recurringEventId?: string;
}

export interface WatchResponse {
  kind: 'api#channel';
  id: string;
  resourceId: string;
  resourceUri: string;
  token?: string;
  expiration: string;
}

export interface EventsListResponse {
  items?: CalendarEvent[];
  nextSyncToken?: string;
  nextPageToken?: string;
}
