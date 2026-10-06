package org.textphone.launcher;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Portable appointments; task ids and Android alarm handles are resolved on this phone. */
final class AgendaCloud {
    private static SharedPreferences prefs(Context c){return c.getSharedPreferences("pocket_agenda",0);}
    private static PlannerStore planner(Context c){return new PlannerStore(c.getSharedPreferences("pocket_planner",0));}
    static JSONObject merge(Context c,JSONObject remote)throws JSONException{
        synchronized(AgendaStore.class){synchronized(ClockStore.class){synchronized(PlannerStore.WRITE_LOCK){
            JSONArray merged=SyncMerge.byId(local(c),remote==null?null:remote.optJSONArray("events"),"uid","updated");
            for(int i=0;i<merged.length();i++)validate(merged.getJSONObject(i));
            Map<String,AgendaStore.Event> existing=new HashMap<>();for(AgendaStore.Event e:AgendaStore.list(c))existing.put(e.uid,e);
            JSONObject deleted=new JSONObject(prefs(c).getString("cloud_deleted","{}"));PlannerStore store=planner(c);
            for(int i=0;i<merged.length();i++){
                JSONObject value=merged.getJSONObject(i);String uid=value.getString("uid");long updated=value.getLong("updated");AgendaStore.Event mine=existing.get(uid);
                if(value.optBoolean("deleted")){
                    if(mine!=null)AgendaStore.deleteSynced(c,mine.id,updated);deleted.put(uid,updated);continue;
                }
                PlannerStore.Entry task=TaskSync.byUid(store,value.optString("task_uid"));
                if(mine!=null&&mine.updated>=updated){
                    if(task!=null&&mine.task!=task.id){mine.task=task.id;AgendaStore.saveSynced(c,mine);}
                    reconcile(c,mine,task);continue;
                }
                AgendaStore.Event event=new AgendaStore.Event();event.id=mine==null?0:mine.id;event.alarm=mine==null?0:mine.alarm;
                event.uid=uid;event.title=value.getString("title");event.when=value.getLong("when");event.minutes=value.getInt("minutes");
                event.taskUid=value.optString("task_uid");event.task=task==null?0:task.id;event.remindAt=value.optLong("remindAt");
                event.created=value.getLong("created");event.updated=updated;
                reconcile(c,event,task);AgendaStore.saveSynced(c,event);deleted.remove(uid);
            }
            if(!prefs(c).edit().putString("cloud_deleted",deleted.toString()).commit())throw new IllegalStateException("Could not save synced appointments.");
            return new JSONObject().put("v",1).put("events",local(c));
        }}}
    }
    private static JSONArray local(Context c)throws JSONException{
        JSONArray active=new JSONArray();PlannerStore store=planner(c);
        for(AgendaStore.Event event:AgendaStore.list(c)){
            boolean migrated=event.uid.isEmpty()||event.created==0||event.updated==0;
            if(event.uid.isEmpty())event.uid=java.util.UUID.randomUUID().toString();
            if(event.created==0)event.created=Math.max(1,Math.min(System.currentTimeMillis(),event.id));if(event.updated==0)event.updated=event.created;
            PlannerStore.Entry task=store.find(event.task);String taskUid=task!=null&&"task".equals(task.kind)?TaskSync.uid(store,task.id):event.taskUid;
            if(!taskUid.equals(event.taskUid)){event.taskUid=taskUid;migrated=true;}
            if(migrated){ClockStore.Entry alarm=event.alarm==0?null:ClockStore.find(c,event.alarm);if(alarm!=null)event.remindAt=alarm.due;AgendaStore.saveSynced(c,event);}
            active.put(new JSONObject().put("uid",event.uid).put("title",event.title).put("when",event.when).put("minutes",event.minutes)
                    .put("task_uid",event.taskUid).put("remindAt",event.remindAt).put("created",event.created).put("updated",event.updated).put("deleted",false));
        }
        JSONArray markers=new JSONArray();JSONObject deleted=new JSONObject(prefs(c).getString("cloud_deleted","{}"));
        for(Iterator<String> keys=deleted.keys();keys.hasNext();){String uid=keys.next();markers.put(new JSONObject().put("uid",uid).put("updated",deleted.getLong(uid)).put("deleted",true));}
        return SyncMerge.byId(active,markers,"uid","updated");
    }
    private static void reconcile(Context c,AgendaStore.Event event,PlannerStore.Entry task){
        ClockStore.Entry previous=event.alarm==0?null:ClockStore.find(c,event.alarm);
        boolean enabled=event.remindAt>System.currentTimeMillis()&&(task==null||!task.done);
        if(!enabled){if(previous!=null){AlarmScheduler.cancel(c,previous.id);ClockStore.deleteSynced(c,previous.id,event.updated);event.alarm=0;AgendaStore.saveSynced(c,event);}return;}
        ClockStore.Entry alarm=new ClockStore.Entry();alarm.id=previous==null?0:previous.id;alarm.kind="reminder";alarm.title=event.title;
        alarm.due=event.remindAt;alarm.enabled=true;alarm.task=event.task;alarm.created=event.created;alarm.updated=event.updated;
        if(previous!=null){alarm.uid=previous.uid;if(previous.due!=alarm.due)AlarmScheduler.cancel(c,previous.id);}
        ClockStore.saveSynced(c,alarm);boolean changed=event.alarm!=alarm.id;event.alarm=alarm.id;
        if(changed&&event.id!=0)AgendaStore.saveSynced(c,event);
        if(AlarmScheduler.allowed(c))try{AlarmScheduler.arm(c,alarm);}catch(RuntimeException failed){ClockStore.prefs(c).edit().putString("last_issue","Appointment saved. Review alarm access in Clock.").apply();}
    }
    private static void validate(JSONObject value)throws JSONException{
        String uid=value.getString("uid");if(!uid.matches("[a-zA-Z0-9_-]{1,100}")||!ClockCloud.time(value.getLong("updated")))throw new JSONException("Invalid appointment id or time.");
        if(value.optBoolean("deleted"))return;
        String title=value.getString("title");if(title.trim().isEmpty()||title.length()>500||!ClockCloud.time(value.getLong("when"))||!ClockCloud.time(value.getLong("created"))||!ClockCloud.time(value.optLong("remindAt")))throw new JSONException("Invalid appointment.");
        if(value.getInt("minutes")<1||value.getInt("minutes")>1440||!value.optString("task_uid").matches("[a-zA-Z0-9_-]{0,100}"))throw new JSONException("Invalid appointment duration or task.");
    }
    private AgendaCloud(){}
}
