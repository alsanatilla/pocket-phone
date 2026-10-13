package org.textphone.launcher;

import android.content.Context;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/** Portable Movement rules; mirrored by src/shared/movement.js. */
final class MovementData {
    static final String[] SPORTS = {"gym", "run", "ride", "swim", "walk", "other"};
    static LocalDate day(long at) { return Instant.ofEpochMilli(at).atZone(ZoneId.systemDefault()).toLocalDate(); }
    static LocalDate monday(LocalDate date) { return date.minusDays(date.getDayOfWeek().getValue() - 1); }
    static JSONObject copy(JSONObject value) { if (value == null) return null; try { return new JSONObject(value.toString()); } catch (Exception e) { throw new IllegalArgumentException(e); } }
    static boolean validTraining(JSONObject value) {
        if (value == null) return true;
        if (!Arrays.asList(SPORTS).contains(value.optString("sport"))) return false;
        JSONArray names=value.optJSONArray("exercises"); if(names==null || names.length()>30) return false;
        for(int i=0;i<names.length();i++){Object name=names.opt(i);if(!(name instanceof String)||((String)name).trim().isEmpty()||((String)name).length()>60)return false;}
        if(value.has("completedAt")){Object at=value.opt("completedAt"); if(!(at instanceof Number)||((Number)at).doubleValue()!=((Number)at).longValue()||((Number)at).longValue()<0)return false;}
        return true;
    }
    static String sport(CorosData.Activity a) {
        if(a.sport==402 || a.type.toLowerCase(java.util.Locale.ROOT).matches(".*(strength|gym).*"))return "gym";
        String type=a.type.toLowerCase(java.util.Locale.ROOT); return Arrays.asList(SPORTS).contains(type)?type:"other";
    }
    static final class Session {
        String id,name,sport,source; long start; double seconds,km; JSONObject workout; CorosData.Activity coros;
    }
    static List<Session> feed(List<CorosData.Activity> records,List<JSONObject> workouts) {
        List<Session> out=new ArrayList<>(); Map<String,CorosData.Activity> available=new HashMap<>();Set<String> used=new HashSet<>();
        for(CorosData.Activity a:records)available.put(a.id,a);
        List<JSONObject> ordered=new ArrayList<>(workouts);ordered.sort((a,b)->{int time=Long.compare(a.optLong("started"),b.optLong("started"));return time!=0?time:a.optString("id").compareTo(b.optString("id"));});
        for(JSONObject w:ordered){
            if(w.optBoolean("deleted") || w.optLong("ended")==0 || GymStore.setCount(w)==0)continue;
            Session s=new Session();s.id="gym:"+w.optString("id");s.name=w.optString("name","Gym");s.sport="gym";s.start=w.optLong("started");s.seconds=Math.max(0,(w.optLong("ended")-s.start)/1000.0);s.workout=w;
            CorosData.Activity a=available.get(w.optString("coros_id"));if(a!=null&&sport(a).equals("gym")&&!used.contains(a.id)){s.coros=a;used.add(a.id);}
            s.source=s.coros==null?"Gym":"Gym + COROS";out.add(s);
        }
        for(CorosData.Activity a:records)if(!used.contains(a.id)){Session s=new Session();s.id="coros:"+a.id;s.name=a.name;s.sport=sport(a);s.start=a.start;s.seconds=Math.max(0,a.seconds);s.km=a.km;s.source="COROS";s.coros=a;out.add(s);}
        out.sort((a,b)->{int time=Long.compare(b.start,a.start);return time!=0?time:a.id.compareTo(b.id);});return out;
    }
    static JSONObject workout(AgendaStore.Event event,List<JSONObject> workouts){for(JSONObject w:workouts)if(!w.optBoolean("deleted")&&event.uid.equals(w.optString("plan_uid")))return w;return null;}
    static boolean done(AgendaStore.Event e,List<JSONObject> workouts){JSONObject w=workout(e,workouts);return e.training.optLong("completedAt")>0 || w!=null&&w.optLong("ended")>0&&GymStore.setCount(w)>0;}
    static List<AgendaStore.Event> plans(Context c){List<AgendaStore.Event> out=new ArrayList<>();for(AgendaStore.Event e:AgendaStore.list(c))if(e.training!=null&&validTraining(e.training))out.add(e);return out;}
    static List<PlannerStore.Entry> trainingTasks(Context c){
        List<PlannerStore.Entry> out=new ArrayList<>();PlannerStore store=new PlannerStore(c.getSharedPreferences("pocket_planner",0));List<AgendaStore.Event> events=plans(c);
        for(PlannerStore.Entry t:store.entries())if("task".equals(t.kind)&&t.source!=null&&"Pip training".equals(t.source.name)&&t.due.matches("\\d{4}-\\d{2}-\\d{2}")){
            boolean linked=false;String uid=TaskSync.uid(store,t.id);for(AgendaStore.Event e:events)if(uid.equals(e.taskUid))linked=true;if(!linked)out.add(t);
        }
        out.sort((a,b)->a.due.compareTo(b.due));return out;
    }
    static List<CorosData.Activity> choices(JSONObject workout,List<CorosData.Activity> records,List<JSONObject> workouts){
        Set<String> used=new HashSet<>();for(JSONObject w:workouts)if(!w.optBoolean("deleted")&&!w.optString("id").equals(workout.optString("id")))used.add(w.optString("coros_id"));
        List<CorosData.Activity> out=new ArrayList<>();for(CorosData.Activity a:records)if(sport(a).equals("gym")&&!used.contains(a.id)&&day(a.start).equals(day(workout.optLong("started"))))out.add(a);return out;
    }
    private MovementData(){}
}
