package org.textphone.launcher;

import android.content.Context;
import android.content.Intent;

/** Stable task-to-alarm links. Appointments stay intact when their linked task is completed. */
final class TaskReminders {
    private static PlannerStore planner(Context c){return new PlannerStore(c.getSharedPreferences("pocket_planner",0));}
    static ClockStore.Entry find(Context c,long task){for(ClockStore.Entry e:ClockStore.entries(c))if(e.task==task&&"task".equals(e.kind))return e;return null;}
    static void set(Context c,long task,long when){synchronized(ClockStore.class){PlannerStore.Entry entry=planner(c).find(task);if(entry==null||entry.done)throw new IllegalStateException("This task is completed or removed.");
        if(when<=System.currentTimeMillis())throw new IllegalArgumentException("Choose a future reminder time.");ClockStore.Entry old=find(c,task),alarm=new ClockStore.Entry();alarm.id=old==null?0:old.id;alarm.kind="task";alarm.task=task;alarm.title=entry.text;alarm.due=when;alarm.enabled=true;AlarmScheduler.saveAndArm(c,alarm);}}
    static void cancel(Context c,long task){synchronized(AgendaStore.class){synchronized(ClockStore.class){
        for(ClockStore.Entry e:ClockStore.entries(c))if(e.task==task)cancelAlarm(c,e);
        for(AgendaStore.Event e:AgendaStore.list(c))if(e.task==task&&e.alarm!=0){ClockStore.Entry alarm=ClockStore.find(c,e.alarm);if(alarm!=null)cancelAlarm(c,alarm);else AlarmScheduler.cancel(c,e.alarm);e.alarm=0;AgendaStore.save(c,e);}
    }}}
    private static void cancelAlarm(Context c,ClockStore.Entry e){e.enabled=false;ClockStore.save(c,e);AlarmScheduler.cancel(c,e.id);
        if(ClockStore.prefs(c).getLong("active_id",0)==e.id){try{c.startService(new Intent(c,AlarmService.class).setAction("STOP").putExtra("id",e.id).putExtra("occurrence",ClockStore.prefs(c).getLong("active_occurrence",0)));}catch(RuntimeException ignored){/* The disabled/deleted record still prevents future delivery. */}}
        ClockStore.delete(c,e.id);}
    static void toggle(Context c,long task){synchronized(AgendaStore.class){synchronized(ClockStore.class){PlannerStore store=planner(c);PlannerStore.Entry e=store.find(task);if(e==null)throw new IllegalStateException("This task was removed.");if(!e.done)cancel(c,task);store.toggle(task);if(!e.done)ReceiptTape.log(c,ReceiptTape.DONE,e.text);}}}
    static void delete(Context c,long id){synchronized(AgendaStore.class){synchronized(ClockStore.class){PlannerStore store=planner(c);PlannerStore.Entry e=store.find(id);if(e!=null&&e.kind.equals("task"))cancel(c,id);store.delete(id);}}}
    static void rename(Context c,long id,String title){synchronized(ClockStore.class){ClockStore.Entry alarm=find(c,id);if(alarm!=null){alarm.title=title;ClockStore.save(c,alarm);}}}
    static String label(Context c,long task){ClockStore.Entry e=find(c,task);if(e==null)return "No reminder";return (e.enabled?"Reminder · ":e.due>System.currentTimeMillis()?"Reminder off · ":"Reminder passed · ")+java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.SHORT,java.text.DateFormat.SHORT).format(new java.util.Date(e.due));}
    private TaskReminders(){}
}
