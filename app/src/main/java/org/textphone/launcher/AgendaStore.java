package org.textphone.launcher;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;

final class AgendaStore {
    static final class Event { long id, when, task, alarm, google, calendar, revision; String title; boolean syncPending; int minutes = 60;
        long end() { return when + minutes * 60000L; }
        Event copy() { Event e = new Event(); e.id=id; e.when=when; e.task=task; e.alarm=alarm; e.google=google; e.calendar=calendar; e.revision=revision; e.title=title; e.syncPending=syncPending; e.minutes=minutes; return e; }
    }
    static synchronized long reserveId(Context c) {
        android.content.SharedPreferences p = c.getSharedPreferences("pocket_agenda", 0);
        long id = Math.max(System.currentTimeMillis(), p.getLong("last_id", 0) + 1);
        if (!p.edit().putLong("last_id", id).commit()) throw new IllegalStateException("Agenda could not save."); return id;
    }
    static synchronized List<Event> list(Context c) {
        List<Event> all = new ArrayList<>(); try { JSONArray values = new JSONArray(c.getSharedPreferences("pocket_agenda", 0).getString("events", "[]"));
            for (int i = 0; i < values.length(); i++) { JSONObject o = values.getJSONObject(i); Event e = new Event();
                e.id = o.getLong("id"); e.when = o.getLong("when"); e.task = o.optLong("task"); e.alarm = o.optLong("alarm"); e.title = o.getString("title");
                e.google = o.optLong("google"); e.calendar = o.optLong("calendar"); e.revision = o.optLong("revision"); e.syncPending = o.optBoolean("sync_pending"); e.minutes = o.optInt("minutes", 60); validateMinutes(e.minutes); all.add(e); }
        } catch (Exception e) { throw new IllegalStateException("Agenda data unavailable.", e); } java.util.Collections.sort(all, (a,b) -> Long.compare(a.when, b.when)); return all;
    }
    static synchronized void save(Context c, Event event) { if (event.title == null || event.title.trim().isEmpty()) throw new IllegalArgumentException("Enter a title.");
        validateMinutes(event.minutes);
        List<Event> all = list(c); boolean found = false;
        if (event.id == 0) event.id = Math.max(System.currentTimeMillis(), c.getSharedPreferences("pocket_agenda", 0).getLong("last_id", 0) + 1);
        for (int i = 0; i < all.size(); i++) if (all.get(i).id == event.id) { Event old = all.get(i); event.revision = old.revision + 1;
            if (event.google == 0) event.google = old.google; if (event.calendar == 0) event.calendar = old.calendar;
            all.set(i, event); found = true; break; }
        if (!found) { if (all.size() >= 300) throw new IllegalArgumentException("Agenda full."); event.revision = 1; all.add(event); } write(c, all, event.id);
    }
    private static void write(Context c, List<Event> all, long id) { JSONArray values = new JSONArray(); try { for (Event e : all) values.put(new JSONObject()
            .put("id", e.id).put("when", e.when).put("task", e.task).put("alarm", e.alarm).put("title", e.title)
            .put("google", e.google).put("calendar", e.calendar).put("revision", e.revision).put("sync_pending", e.syncPending).put("minutes", e.minutes)); } catch (Exception e) { throw new IllegalStateException(e); }
        android.content.SharedPreferences p = c.getSharedPreferences("pocket_agenda", 0);
        if (!p.edit().putString("events", values.toString()).putLong("last_id", Math.max(id, p.getLong("last_id", 0))).commit()) throw new IllegalStateException("Agenda could not save.");
    }
    static synchronized Event find(Context c, long id) { for (Event e : list(c)) if (e.id == id) return e; return null; }
    static void validateMinutes(int minutes) { if (minutes < 1 || minutes > 1440) throw new IllegalArgumentException("Use 1 to 1440 minutes."); }
    static synchronized void syncResult(Context c, Event snapshot, boolean success) {
        List<Event> all = list(c);
        for (Event e : all) if (e.id == snapshot.id) {
            if (snapshot.google != 0) { e.google = snapshot.google; e.calendar = snapshot.calendar; }
            e.syncPending = !success || e.revision != snapshot.revision; write(c, all, 0); return;
        }
    }
    static synchronized void delete(Context c, long id) { List<Event> all = list(c); for (Event e : all) if (e.id == id && e.alarm != 0) { AlarmScheduler.cancel(c, e.alarm); ClockStore.delete(c, e.alarm); }
        for (int i = all.size() - 1; i >= 0; i--) if (all.get(i).id == id) all.remove(i); write(c, all, 0);
    }
}