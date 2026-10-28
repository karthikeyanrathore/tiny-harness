import datetime
import os.path
import sys

from google.auth.exceptions import RefreshError
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

# If modifying these scopes, delete the file token.json.
SCOPES = ['https://www.googleapis.com/auth/calendar']

SETUP_HINT = "Run /install-gcal in tiny-harness (or: tiny-harness calendar-setup)"

def login():
    """Signs in through the browser once and saves token.json; needs credentials.json from Google Cloud Console."""
    if not os.path.exists('credentials.json'):
        print(f"No credentials.json in {os.getcwd()}. {SETUP_HINT}", file=sys.stderr)
        sys.exit(1)
    flow = InstalledAppFlow.from_client_secrets_file('credentials.json', SCOPES)
    creds = flow.run_local_server(port=0)
    with open('token.json', 'w') as token:
        token.write(creds.to_json())
    os.chmod('token.json', 0o600)
    print("Signed in to Google Calendar.")

def get_calendar_service():
    """Uses the saved sign-in, refreshing it if needed. Never opens a browser: the harness would hang waiting."""
    creds = None
    if os.path.exists('token.json'):
        creds = Credentials.from_authorized_user_file('token.json', SCOPES)
    if creds and not creds.valid and creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
        except RefreshError:
            creds = None
        else:
            with open('token.json', 'w') as token:
                token.write(creds.to_json())
    if not creds or not creds.valid:
        print(f"Not signed in to Google Calendar, or the sign-in expired. {SETUP_HINT}", file=sys.stderr)
        sys.exit(1)
    return build('calendar', 'v3', credentials=creds)

def add_event(summary, start_time, end_time, description=None, location=None):
    """
    Adds an event to the primary Google Calendar.
    start_time and end_time are RFC 3339 with an offset, e.g. '2026-05-19T14:00:00+02:00'
    """
    try:
        service = get_calendar_service()

        event = {
            'summary': summary,
            'location': location,
            'description': description,
            'start': {'dateTime': start_time},
            'end': {'dateTime': end_time},
        }

        event = service.events().insert(calendarId='primary', body=event).execute()
        print(f"Event created: id={event['id']} {event.get('htmlLink')}")
        return event

    except HttpError as error:
        print(f"An error occurred: {error}", file=sys.stderr)
        sys.exit(1)

def list_events(time_min, time_max, query=None):
    """Prints the events between time_min and time_max, one per line with its id."""
    try:
        service = get_calendar_service()
        result = service.events().list(
            calendarId='primary', timeMin=time_min, timeMax=time_max, q=query,
            singleEvents=True, orderBy='startTime').execute()
        events = result.get('items', [])
        if not events:
            print("No events found.")
        for event in events:
            start = event['start'].get('dateTime', event['start'].get('date'))
            end = event['end'].get('dateTime', event['end'].get('date'))
            print(f"id={event['id']} {start} - {end} {event.get('summary', '(no title)')}")
    except HttpError as error:
        print(f"An error occurred: {error}", file=sys.stderr)
        sys.exit(1)

def get_event(event_id):
    """Prints one event's title and times, so the user can see what an id stands for before deleting it."""
    try:
        service = get_calendar_service()
        event = service.events().get(calendarId='primary', eventId=event_id).execute()
        start = event['start'].get('dateTime', event['start'].get('date'))
        end = event['end'].get('dateTime', event['end'].get('date'))
        print(f"{event.get('summary', '(no title)')} ({start} - {end})")
    except HttpError as error:
        print(f"An error occurred: {error}", file=sys.stderr)
        sys.exit(1)

def delete_event(event_id):
    """Deletes one event from the primary Google Calendar."""
    try:
        service = get_calendar_service()
        service.events().delete(calendarId='primary', eventId=event_id).execute()
        print(f"Event deleted: id={event_id}")
    except HttpError as error:
        print(f"An error occurred: {error}", file=sys.stderr)
        sys.exit(1)

USAGE = """Usage:
  gcal_tool.py login
  gcal_tool.py add 'Event Name' START END ['Description']
  gcal_tool.py list TIME_MIN TIME_MAX ['search text']
  gcal_tool.py get EVENT_ID
  gcal_tool.py delete EVENT_ID
Times are RFC 3339 with an offset, e.g. 2026-05-19T14:00:00+02:00"""

if __name__ == '__main__':
    command, args = (sys.argv[1], sys.argv[2:]) if len(sys.argv) > 1 else ('', [])
    if command == 'login' and not args:
        login()
    elif command == 'add' and len(args) >= 3:
        add_event(args[0], args[1], args[2], args[3] if len(args) > 3 and args[3] else None)
    elif command == 'list' and len(args) >= 2:
        list_events(args[0], args[1], args[2] if len(args) > 2 and args[2] else None)
    elif command == 'get' and len(args) == 1:
        get_event(args[0])
    elif command == 'delete' and len(args) == 1:
        delete_event(args[0])
    else:
        print(USAGE, file=sys.stderr)
        sys.exit(1)
