package org.textphone.launcher;

import android.content.Context;
import android.content.ContentValues;
import android.content.ContentUris;
import android.database.Cursor;
import android.net.Uri;
import android.provider.CalendarContract;
import java.util.ArrayList;
import java.util.List;
import java.util.TimeZone;

/** Uses calendars already synced by Android; no OAuth secrets, network SDK or new account. */
final class CalendarBridge {
    static final class Calendar { long id; String name; }
    static final class Event { long id, begin, end; String title;boolean allDay; }
    static List<Calendar> calendars(Context c) {
        List<Calendar> values = new ArrayList<>(); try (Cursor rows = c.getContentResolver().query(CalendarContract.Calendars.CONTENT_URI,
                new String[]{"_id", "calendar_displayName", "account_name"}, "account_type = ? AND calendar_access_level >= ?",
                new String[]{"com.google", Integer.toString(CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR)}, "calendar_displayName ASC")) {
            if (rows != null) while (rows.moveToNext()) { Calendar item = new Calendar(); item.id = rows.getLong(0); item.name = rows.getString(1) + " · " + rows.getString(2); values.add(item); }
        } return values;
    }
    static long selected(Context c) { return c.getSharedPreferences("pocket_agenda", 0).getLong("google_calendar", 0); }
    static long localAllDay(long utcMillis){java.util.Calendar utc=java.util.Calendar.getInstance(TimeZone.getTimeZone("UTC"));utc.setTimeInMillis(utcMillis);java.util.Calendar local=java.util.Calendar.getInstance();local.clear();local.set(utc.get(java.util.Calendar.YEAR),utc.get(java.util.Calendar.MONTH),utc.get(java.util.Calendar.DAY_OF_MONTH));return local.getTimeInMillis();}
    static synchronized boolean write(Context c, AgendaStore.Event e) {
        if (selected(c) == 0) return true;
        long calendar = e.calendar != 0 ? e.calendar : selected(c); if (calendar == 0) return true;
        try { ContentValues values = new ContentValues(); values.put(CalendarContract.Events.CALENDAR_ID, calendar); values.put(CalendarContract.Events.TITLE, e.title);
            AgendaStore.validateMinutes(e.minutes);
            values.put(CalendarContract.Events.DTSTART, e.when); values.put(CalendarContract.Events.DTEND, e.end());
            values.put(CalendarContract.Events.EVENT_TIMEZONE, TimeZone.getDefault().getID());
            if (e.id != 0) {
                String link = "pocket:appointment/" + e.id;
                values.put(CalendarContract.Events.CUSTOM_APP_PACKAGE, c.getPackageName()); values.put(CalendarContract.Events.CUSTOM_APP_URI, link);
                if (e.google == 0) try (Cursor existing = c.getContentResolver().query(CalendarContract.Events.CONTENT_URI, new String[]{"_id"},
                        "calendar_id = ? AND customAppPackage = ? AND customAppUri = ?", new String[]{Long.toString(calendar), c.getPackageName(), link}, null)) {
                    if (existing == null) return false; if (existing.moveToFirst()) e.google = existing.getLong(0);
                }
            }
            if (e.google == 0) { Uri uri = c.getContentResolver().insert(CalendarContract.Events.CONTENT_URI, values); if (uri == null) return false; e.google = ContentUris.parseId(uri); }
            else if (c.getContentResolver().update(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, e.google), values, null, null) == 0) return false;
            e.calendar = calendar; return true;
        } catch (RuntimeException ex) { return false; }
    }
    static List<Event> upcoming(Context c) {
        return timeline(c,false);
    }
    static List<Event> timeline(Context c,boolean past) {
        long now = System.currentTimeMillis();
        java.util.Calendar midnight=java.util.Calendar.getInstance();midnight.set(java.util.Calendar.HOUR_OF_DAY,0);midnight.set(java.util.Calendar.MINUTE,0);midnight.set(java.util.Calendar.SECOND,0);midnight.set(java.util.Calendar.MILLISECOND,0);
        return range(c,now-(past?90L:1L)*86400000L,past?midnight.getTimeInMillis():now+90L*86400000L,past);
    }
    static List<Event> range(Context c,long from,long to,boolean past){List<Event> values=new ArrayList<>();long calendar=selected(c);if(calendar==0)return values;Uri.Builder range=CalendarContract.Instances.CONTENT_URI.buildUpon();ContentUris.appendId(range,from);ContentUris.appendId(range,to);
        try (Cursor rows = c.getContentResolver().query(range.build(), new String[]{"event_id", "begin", "end", "title","allDay"},
                "calendar_id = ?", new String[]{Long.toString(calendar)}, past?"begin DESC":"begin ASC")) {
            if (rows != null) while (rows.moveToNext() && values.size() < 300) { Event e = new Event(); e.id = rows.getLong(0); e.begin = rows.getLong(1); e.end = rows.getLong(2); e.title = rows.getString(3);int allDay=rows.getColumnIndex("allDay");e.allDay=allDay>=0&&rows.getInt(allDay)!=0; if (e.title == null || e.title.isEmpty()) e.title = "Untitled"; values.add(e); }
        } return values;
    }
    static void delete(Context c, long id) { c.getContentResolver().delete(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, id), null, null); }
}
