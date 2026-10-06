package org.textphone.launcher;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;

final class AgendaStore {
    static final class Event { long id, when, task, alarm, google, calendar, revision, created, updated, remindAt; String title, uid = "", taskUid = ""; boolean syncPending; int minutes = 60;
        long end() { return when + minutes * 60000L; }
        Event copy() { Event e = new Event(); e.id=id; e.when=when; e.task=task; e.alarm=alarm; e.google=google; e.calendar=calendar; e.revision=revision; e.title=title; e.syncPending=syncPending; e.minutes=minutes; e.uid=uid;e.taskUid=taskUid;e.created=created;e.updated=updated;e.remindAt=remindAt;return e; }
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
                e.google = o.optLong("google"); e.calendar = o.optLong("calendar"); e.revision = o.optLong("revision"); e.syncPending = o.optBoolean("sync_pending"); e.minutes = o.optInt("minutes", 60);e.uid=o.optString("uid");e.taskUid=o.optString("task_uid");e.created=o.optLong("created");e.updated=o.optLong("updated");e.remindAt=o.optLong("remindAt"); validateMinutes(e.minutes); all.add(e); }
        } catch (Exception e) { throw new IllegalStateException("Agenda data unavailable.", e); } java.util.Collections.sort(all, (a,b) -> Long.compare(a.when, b.when)); return all;
    }
    static synchronized void save(Context c, Event event) { save(c,event,true); }
    static synchronized void saveSynced(Context c, Event event) { save(c,event,false); }
    private static void save(Context c, Event event, boolean local) { if (event.title == null || event.title.trim().isEmpty()) throw new IllegalArgumentException("Enter a title.");
        validateMinutes(event.minutes);
        List<Event> all = list(c); boolean found = false;
        if (event.id == 0) event.id = Math.max(System.currentTimeMillis(), c.getSharedPreferences("pocket_agenda", 0).getLong("last_id", 0) + 1);
        for (int i = 0; i < all.size(); i++) if (all.get(i).id == event.id) { Event old = all.get(i); event.revision = old.revision + 1;
            if (event.google == 0) event.google = old.google; if (event.calendar == 0) event.calendar = old.calendar;
            if(event.uid.isEmpty())event.uid=old.uid;if(event.created==0)event.created=old.created;
            if(local)event.updated=Math.max(System.currentTimeMillis(),old.updated+1);
            all.set(i, event); found = true; break; }
        if (!found) { if (all.size() >= 300) throw new IllegalArgumentException("Agenda full."); event.revision = 1; all.add(event); }
        if(event.uid.isEmpty())event.uid=java.util.UUID.randomUUID().toString();
        if(event.created==0)event.created=System.currentTimeMillis();if(event.updated==0||local&&!found)event.updated=System.currentTimeMillis();
        if(local){ClockStore.Entry reminder=event.alarm==0?null:ClockStore.find(c,event.alarm);event.remindAt=reminder==null?0:reminder.due;}
        write(c, all, event.id);if(local)CloudSync.changed(c);
    }
    private static void write(Context c, List<Event> all, long id) { JSONArray values = new JSONArray(); try { for (Event e : all) values.put(new JSONObject()
            .put("id", e.id).put("when", e.when).put("task", e.task).put("alarm", e.alarm).put("title", e.title)
            .put("google", e.google).put("calendar", e.calendar).put("revision", e.revision).put("sync_pending", e.syncPending).put("minutes", e.minutes)
            .put("uid",e.uid).put("task_uid",e.taskUid).put("created",e.created).put("updated",e.updated).put("remindAt",e.remindAt)); } catch (Exception e) { throw new IllegalStateException(e); }
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
    static synchronized void delete(Context c, long id) {delete(c,id,System.currentTimeMillis(),true);}
    static synchronized void deleteSynced(Context c,long id,long updated){delete(c,id,updated,false);}
    private static void delete(Context c, long id,long updated,boolean local) { List<Event> all = list(c); for (Event e : all) if (e.id == id) {
        if(e.alarm!=0){ AlarmScheduler.cancel(c, e.alarm); ClockStore.deleteSynced(c, e.alarm,updated); }
        String uid=e.uid.isEmpty()?java.util.UUID.randomUUID().toString():e.uid;
        try {android.content.SharedPreferences p=c.getSharedPreferences("pocket_agenda",0);JSONObject deleted=new JSONObject(p.getString("cloud_deleted","{}"));deleted.put(uid,Math.max(updated,e.updated+1));if(!p.edit().putString("cloud_deleted",deleted.toString()).commit())throw new IllegalStateException("Could not save appointment deletion.");}
        catch(org.json.JSONException damaged){throw new IllegalStateException("Agenda deletion data unavailable.",damaged);}
    }
        for (int i = all.size() - 1; i >= 0; i--) if (all.get(i).id == id) all.remove(i); write(c, all, 0);
        if(local)CloudSync.changed(c);
    }
}
