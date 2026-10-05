package org.textphone.launcher;

import android.content.Context;
import org.json.JSONObject;

/** One recoverable edit, separate from the saved appointment and its alarm. */
final class AgendaDraft {
    static final class Value { final AgendaStore.Event event;final boolean remind;Value(AgendaStore.Event event,boolean remind){this.event=event;this.remind=remind;} }
    static void save(Context c,AgendaStore.Event event,boolean remind) {
        try {JSONObject value=new JSONObject().put("id",event.id).put("when",event.when).put("task",event.task).put("alarm",event.alarm)
                .put("google",event.google).put("calendar",event.calendar).put("revision",event.revision).put("title",event.title).put("remind",remind).put("minutes",event.minutes);
            c.getSharedPreferences("pocket_agenda",0).edit().putString("appointment_draft",value.toString()).apply();
        }catch(org.json.JSONException error){throw new IllegalStateException("Could not keep the appointment draft.",error);}
    }
    static Value read(Context c) {
        String raw=c.getSharedPreferences("pocket_agenda",0).getString("appointment_draft",null);if(raw==null)return null;
        try {JSONObject v=new JSONObject(raw);AgendaStore.Event e=new AgendaStore.Event();e.id=v.getLong("id");e.when=v.getLong("when");e.title=v.getString("title");
            e.task=v.optLong("task");e.alarm=v.optLong("alarm");e.google=v.optLong("google");e.calendar=v.optLong("calendar");e.revision=v.optLong("revision");
            e.minutes=v.optInt("minutes",60);if(e.minutes<1||e.minutes>1440||e.title.length()>500)return null;return new Value(e,v.optBoolean("remind"));
        }catch(org.json.JSONException error){return null;}
    }
    static void clear(Context c,long id){Value v=read(c);if(v!=null&&v.event.id==id)c.getSharedPreferences("pocket_agenda",0).edit().remove("appointment_draft").apply();}
    private AgendaDraft(){}
}
