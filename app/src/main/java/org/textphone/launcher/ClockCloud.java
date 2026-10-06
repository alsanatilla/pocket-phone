package org.textphone.launcher;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.SystemClock;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Shared clock configuration with local, boot-safe Android alarm scheduling. */
final class ClockCloud {
    static boolean time(long value){return value>=0&&value<=9_007_199_254_740_991L;}
    private static PlannerStore planner(Context c){return new PlannerStore(c.getSharedPreferences("pocket_planner",0));}
    private static SharedPreferences stopwatch(Context c){return c.getSharedPreferences("pocket_stopwatch",0);}
    static JSONObject merge(Context c,JSONObject remote)throws JSONException{
        synchronized(AgendaStore.class){synchronized(ClockStore.class){synchronized(PlannerStore.WRITE_LOCK){
            JSONArray merged=SyncMerge.byId(local(c),remote==null?null:remote.optJSONArray("entries"),"uid","updated");
            for(int i=0;i<merged.length();i++)validate(merged.getJSONObject(i));
            Map<String,ClockStore.Entry> existing=new HashMap<>();for(ClockStore.Entry e:ClockStore.entries(c))existing.put(e.uid,e);
            JSONObject deleted=new JSONObject(ClockStore.prefs(c).getString("cloud_deleted","{}"));PlannerStore store=planner(c);
            for(int i=0;i<merged.length();i++){
                JSONObject value=merged.getJSONObject(i);String uid=value.getString("uid");long updated=value.getLong("updated");ClockStore.Entry mine=existing.get(uid);
                if(value.optBoolean("deleted")){
                    if("stopwatch".equals(uid)){stopwatch(c).edit().remove("cloud_value").putBoolean("running",false).putLong("total",0).remove("laps").commit();}
                    if(mine!=null){AlarmScheduler.cancel(c,mine.id);stopRinging(c,mine);ClockStore.deleteSynced(c,mine.id,updated);}deleted.put(uid,updated);continue;
                }
                if("stopwatch".equals(value.getString("kind"))){applyStopwatch(c,value);deleted.remove(uid);continue;}
                PlannerStore.Entry task=TaskSync.byUid(store,value.optString("task_uid"));
                if(mine!=null&&mine.updated>=updated){if(task!=null&&mine.task!=task.id){mine.task=task.id;ClockStore.saveSynced(c,mine);}reconcile(c,mine);continue;}
                ClockStore.Entry entry=new ClockStore.Entry();entry.id=mine==null?0:mine.id;entry.uid=uid;entry.cloudKind=value.getString("kind");
                entry.kind="timer".equals(entry.cloudKind)||"focus".equals(entry.cloudKind)?"timer":value.optString("task_uid").isEmpty()?"alarm":"task";
                entry.title=value.getString("title");entry.taskUid=value.optString("task_uid");entry.task=task==null?0:task.id;
                entry.enabled=value.getBoolean("enabled");entry.daily=value.optBoolean("daily");entry.hour=value.optInt("hour");entry.minute=value.optInt("minute");
                entry.due=value.getLong("due");entry.remaining=value.getLong("remaining");entry.created=value.getLong("created");entry.updated=updated;
                if("timer".equals(entry.kind)){entry.elapsed=SystemClock.elapsedRealtime()+Math.max(0,entry.due-System.currentTimeMillis());entry.boot=ClockStore.boot(c);}
                if(task!=null&&task.done){entry.enabled=false;entry.updated=Math.max(System.currentTimeMillis(),updated+1);}
                if(mine!=null){AlarmScheduler.cancel(c,mine.id);if(!entry.enabled)stopRinging(c,mine);}
                ClockStore.saveSynced(c,entry);reconcile(c,entry);deleted.remove(uid);
            }
            if(!ClockStore.prefs(c).edit().putString("cloud_deleted",deleted.toString()).commit())throw new IllegalStateException("Could not save synced clocks.");
            return new JSONObject().put("v",1).put("entries",local(c));
        }}}
    }
    private static JSONArray local(Context c)throws JSONException{
        JSONArray active=new JSONArray();PlannerStore store=planner(c);
        for(ClockStore.Entry entry:ClockStore.entries(c)){
            if("reminder".equals(entry.kind))continue;
            boolean migrated=entry.uid.isEmpty()||entry.created==0||entry.updated==0;
            if(entry.uid.isEmpty())entry.uid=java.util.UUID.randomUUID().toString();
            if(entry.created==0)entry.created=Math.max(1,Math.min(System.currentTimeMillis(),entry.id));if(entry.updated==0)entry.updated=entry.created;
            PlannerStore.Entry task=store.find(entry.task);String taskUid=task!=null&&"task".equals(task.kind)?TaskSync.uid(store,task.id):entry.taskUid;
            if(!taskUid.equals(entry.taskUid)){entry.taskUid=taskUid;migrated=true;}
            if(entry.cloudKind.isEmpty()){entry.cloudKind="timer".equals(entry.kind)?entry.title.startsWith("Focus")?"focus":"timer":"alarm";migrated=true;}
            if("timer".equals(entry.kind)&&entry.enabled&&entry.remaining==0){entry.remaining=Math.max(0,entry.due-entry.created);migrated=true;}
            if(migrated)ClockStore.saveSynced(c,entry);
            active.put(new JSONObject().put("uid",entry.uid).put("kind",entry.cloudKind).put("title",entry.title.substring(0,Math.min(200,entry.title.length()))).put("enabled",entry.enabled).put("daily",entry.daily)
                    .put("hour",entry.hour).put("minute",entry.minute).put("due",entry.due).put("remaining",entry.remaining).put("task_uid",entry.taskUid)
                    .put("created",entry.created).put("updated",entry.updated).put("deleted",false));
        }
        JSONObject watch=stopwatchValue(c);if(watch!=null)active.put(watch);
        JSONArray markers=new JSONArray();JSONObject deleted=new JSONObject(ClockStore.prefs(c).getString("cloud_deleted","{}"));
        for(Iterator<String> keys=deleted.keys();keys.hasNext();){String uid=keys.next();markers.put(new JSONObject().put("uid",uid).put("updated",deleted.getLong(uid)).put("deleted",true));}
        return SyncMerge.byId(active,markers,"uid","updated");
    }
    private static void reconcile(Context c,ClockStore.Entry entry){
        if(!entry.enabled){AlarmScheduler.cancel(c,entry.id);return;}
        if("alarm".equals(entry.kind)&&entry.daily&&entry.due<=System.currentTimeMillis()){
            entry.due=ClockStore.nextTime(entry.hour,entry.minute,System.currentTimeMillis());ClockStore.save(c,entry);
        }
        if(entry.due<=System.currentTimeMillis()||"task".equals(entry.kind)&&entry.task==0){AlarmScheduler.cancel(c,entry.id);return;}
        if(AlarmScheduler.allowed(c))try{AlarmScheduler.arm(c,entry);}catch(RuntimeException failed){ClockStore.prefs(c).edit().putString("last_issue","Clock saved. Review alarm access in Clock.").apply();}
    }
    private static void stopRinging(Context c,ClockStore.Entry entry){
        if(ClockStore.prefs(c).getLong("active_id",0)!=entry.id)return;
        try{c.startService(new android.content.Intent(c,AlarmService.class).setAction("STOP").putExtra("id",entry.id).putExtra("occurrence",ClockStore.prefs(c).getLong("active_occurrence",0)));}
        catch(RuntimeException unavailable){/* The removed record prevents future delivery. */}
    }
    private static JSONObject stopwatchValue(Context c)throws JSONException{
        SharedPreferences p=stopwatch(c);String copy=p.getString("cloud_value",null);if(copy!=null)return new JSONObject(copy);
        if(!p.contains("total")&&!p.contains("laps")&&!p.getBoolean("running",false))return null;
        touchStopwatch(c);copy=p.getString("cloud_value",null);return copy==null?null:new JSONObject(copy);
    }
    static void touchStopwatch(Context c){
        synchronized(ClockStore.class){
            SharedPreferences p=stopwatch(c);long now=System.currentTimeMillis(),updated=now,created=now;
            try{String previous=p.getString("cloud_value",null);if(previous!=null){JSONObject old=new JSONObject(previous);created=old.optLong("created",now);updated=Math.max(now,old.optLong("updated")+1);}
                boolean running=p.getBoolean("running",false)&&p.getInt("boot",-1)==ClockStore.boot(c);
                long start=running?Math.max(0,now-Math.max(0,SystemClock.elapsedRealtime()-p.getLong("start",SystemClock.elapsedRealtime()))):0;
                JSONObject value=new JSONObject().put("uid","stopwatch").put("kind","stopwatch").put("title","Stopwatch").put("enabled",running).put("daily",false)
                        .put("hour",0).put("minute",0).put("due",start).put("remaining",Math.max(0,p.getLong("total",0))).put("laps",p.getString("laps","")).put("task_uid","").put("created",created).put("updated",updated).put("deleted",false);
                if(!p.edit().putString("cloud_value",value.toString()).commit())throw new IllegalStateException("Could not save stopwatch.");
            }catch(JSONException damaged){throw new IllegalStateException("Stopwatch data unavailable.",damaged);}
            CloudSync.changed(c);
        }
    }
    static void restoreStopwatch(Context c){synchronized(ClockStore.class){try{JSONObject value=stopwatchValue(c);if(value!=null)applyStopwatch(c,value);}catch(JSONException damaged){throw new IllegalStateException("Stopwatch data unavailable.",damaged);}}}
    private static void applyStopwatch(Context c,JSONObject value)throws JSONException{
        SharedPreferences p=stopwatch(c);String raw=p.getString("cloud_value",null);JSONObject previous=raw==null?null:new JSONObject(raw);
        if(previous!=null&&previous.optLong("updated")>value.getLong("updated"))return;
        boolean running=value.getBoolean("enabled");long total=value.getLong("remaining")+(running?Math.max(0,System.currentTimeMillis()-value.getLong("due")):0);
        SharedPreferences.Editor edit=p.edit().putString("cloud_value",value.toString()).putBoolean("running",running).putLong("total",total).putLong("start",SystemClock.elapsedRealtime()).putInt("boot",ClockStore.boot(c));
        if(value.has("laps"))edit.putString("laps",value.optString("laps"));else if(previous==null||value.getLong("updated")!=previous.optLong("updated"))edit.remove("laps");
        if(!edit.commit())throw new IllegalStateException("Could not save synced stopwatch.");
    }
    private static void validate(JSONObject value)throws JSONException{
        if(!value.getString("uid").matches("[a-zA-Z0-9_-]{1,100}")||!time(value.getLong("updated")))throw new JSONException("Invalid clock id or time.");if(value.optBoolean("deleted"))return;
        String kind=value.getString("kind"),title=value.getString("title");if(!java.util.Arrays.asList("alarm","timer","focus","stopwatch").contains(kind)||title.trim().isEmpty()||title.length()>200)throw new JSONException("Invalid clock entry.");
        if(!time(value.getLong("created"))||!time(value.getLong("due"))||!time(value.getLong("remaining"))||value.optInt("hour")<0||value.optInt("hour")>23||value.optInt("minute")<0||value.optInt("minute")>59||!value.optString("task_uid").matches("[a-zA-Z0-9_-]{0,100}"))throw new JSONException("Invalid clock configuration.");
        if(value.optString("laps").length()>2400)throw new JSONException("Invalid stopwatch laps.");value.getBoolean("enabled");
    }
    private ClockCloud(){}
}
