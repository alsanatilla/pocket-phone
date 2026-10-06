package org.textphone.launcher;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.SystemClock;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONException;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;

final class ClockStore {
    static final class Entry {
        long id, due, elapsed, remaining,task,created,updated; String kind, title,uid="",taskUid="",cloudKind=""; boolean enabled, daily; int hour, minute;
        int boot;
    }
    static synchronized SharedPreferences prefs(Context c) {
        if (android.os.Build.VERSION.SDK_INT < 24) return c.getSharedPreferences("pocket_clock", 0);
        Context application = c.getApplicationContext();
        Context device = application.createDeviceProtectedStorageContext();
        SharedPreferences target = device.getSharedPreferences("pocket_clock", 0);
        android.os.UserManager user = c.getSystemService(android.os.UserManager.class);
        if (!target.contains("entries") && user != null && user.isUserUnlocked()
                && application.getSharedPreferences("pocket_clock", 0).contains("entries")) {
            if (!device.moveSharedPreferencesFrom(application, "pocket_clock"))
                throw new IllegalStateException("Clock storage could not be migrated. Try reopening Clock.");
            target = device.getSharedPreferences("pocket_clock", 0);
        }
        return target;
    }
    static int boot(Context c) { return android.os.Build.VERSION.SDK_INT >= 24 ? android.provider.Settings.Global.getInt(c.getContentResolver(), "boot_count", 0) : 0; }
    static synchronized List<Entry> entries(Context c) {
        List<Entry> values = new ArrayList<>(); try { JSONArray all = new JSONArray(prefs(c).getString("entries", "[]"));
            for (int i = 0; i < all.length(); i++) { JSONObject o = all.getJSONObject(i); Entry e = new Entry();
                e.id = o.getLong("id"); e.due = o.getLong("due"); e.kind = o.getString("kind"); e.title = o.getString("title");
                e.enabled = o.getBoolean("enabled"); e.daily = o.optBoolean("daily"); e.hour = o.optInt("hour"); e.minute = o.optInt("minute");
                e.elapsed = o.optLong("elapsed"); e.remaining = o.optLong("remaining"); e.boot = o.optInt("boot");e.task=o.optLong("task");e.uid=o.optString("uid");e.taskUid=o.optString("task_uid");e.cloudKind=o.optString("cloud_kind");e.created=o.optLong("created");e.updated=o.optLong("updated"); values.add(e); }
        } catch (JSONException e) { throw new IllegalStateException("Clock data unavailable.", e); } return values;
    }
    static synchronized void save(Context c, Entry entry) {save(c,entry,true);}
    static synchronized void saveSynced(Context c,Entry entry){save(c,entry,false);}
    private static void save(Context c, Entry entry,boolean local) {
        List<Entry> all = entries(c); if (entry.id == 0) entry.id = Math.max(System.currentTimeMillis(), prefs(c).getLong("last_id", 0) + 1);
        boolean found = false; for (int i = 0; i < all.size(); i++) if (all.get(i).id == entry.id) {Entry old=all.get(i);if(entry.uid.isEmpty())entry.uid=old.uid;if(entry.created==0)entry.created=old.created;if(entry.cloudKind.isEmpty())entry.cloudKind=old.cloudKind;if(entry.taskUid.isEmpty()&&entry.task==old.task)entry.taskUid=old.taskUid;if(local)entry.updated=Math.max(System.currentTimeMillis(),old.updated+1);all.set(i, entry); found = true; break; }
        if (!found) { if (all.size() >= 200) throw new IllegalArgumentException("Remove an old alarm first."); all.add(entry); }
        if(entry.uid.isEmpty())entry.uid=java.util.UUID.randomUUID().toString();if(entry.created==0)entry.created=System.currentTimeMillis();if(entry.updated==0||local&&!found)entry.updated=System.currentTimeMillis();
        write(c, all, entry.id);if(local&&!"reminder".equals(entry.kind))CloudSync.changed(c);
    }
    static synchronized void delete(Context c, long id) {delete(c,id,System.currentTimeMillis(),true);}
    static synchronized void deleteSynced(Context c,long id,long updated){delete(c,id,updated,false);}
    private static void delete(Context c,long id,long updated,boolean local){List<Entry> all=entries(c);for(Entry e:all)if(e.id==id&&!"reminder".equals(e.kind)){
        try{JSONObject deleted=new JSONObject(prefs(c).getString("cloud_deleted","{}"));deleted.put(e.uid.isEmpty()?java.util.UUID.randomUUID().toString():e.uid,Math.max(updated,e.updated+1));if(!prefs(c).edit().putString("cloud_deleted",deleted.toString()).commit())throw new IllegalStateException("Could not save clock deletion.");}
        catch(JSONException damaged){throw new IllegalStateException("Clock deletion data unavailable.",damaged);}
    }for(int i=all.size()-1;i>=0;i--)if(all.get(i).id==id)all.remove(i);write(c,all,0);if(local)CloudSync.changed(c);}
    static Entry find(Context c, long id) { for (Entry e : entries(c)) if (e.id == id) return e; return null; }
    private static void write(Context c, List<Entry> all, long id) { JSONArray array = new JSONArray();
        try { for (Entry e : all) { JSONObject o = new JSONObject(); o.put("id", e.id).put("due", e.due).put("kind", e.kind).put("title", e.title)
                .put("enabled", e.enabled).put("daily", e.daily).put("hour", e.hour).put("minute", e.minute)
                .put("elapsed", e.elapsed).put("remaining", e.remaining).put("boot", e.boot).put("task",e.task)
                .put("uid",e.uid).put("task_uid",e.taskUid).put("cloud_kind",e.cloudKind).put("created",e.created).put("updated",e.updated); array.put(o); }
        } catch (JSONException e) { throw new IllegalStateException(e); }
        if (!prefs(c).edit().putString("entries", array.toString()).putLong("last_id", Math.max(id, prefs(c).getLong("last_id", 0))).commit()) throw new IllegalStateException("Clock could not save.");
    }
    static long nextTime(int hour, int minute, long now) {
        Calendar date = Calendar.getInstance(); date.setTimeInMillis(now); date.set(Calendar.HOUR_OF_DAY, hour); date.set(Calendar.MINUTE, minute); date.set(Calendar.SECOND, 0); date.set(Calendar.MILLISECOND, 0);
        if (date.getTimeInMillis() <= now) date.add(Calendar.DAY_OF_YEAR, 1); return date.getTimeInMillis();
    }
    static long remaining(Context c, Entry e) { if (!e.enabled) return e.remaining;
        if ("timer".equals(e.kind) && e.boot == boot(c) && e.elapsed > 0) return Math.max(0, e.elapsed - SystemClock.elapsedRealtime());
        return Math.max(0, e.due - System.currentTimeMillis()); }
    static long lateness(Context c, Entry e) {
        return "timer".equals(e.kind) && e.boot == boot(c) && e.elapsed > 0
                ? Math.max(0, SystemClock.elapsedRealtime() - e.elapsed) : Math.max(0, System.currentTimeMillis() - e.due);
    }
}
