package org.textphone.launcher;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import java.util.Calendar;
import java.util.List;
import java.util.ArrayList;

/** Foreground planning data from local appointments and an already selected phone calendar. */
final class DayPlan {
    static final class Item {final long id,when,end;final String title,source;final boolean allDay,external;Item(long id,long when,long end,String title,String source,boolean allDay,boolean external){this.id=id;this.when=when;this.end=end;this.title=title;this.source=source;this.allDay=allDay;this.external=external;}}
    static final class Result {final List<Item> items;final long now,start,end;final String issue;Result(List<Item> items,long now,String issue){this.items=items;this.now=now;Calendar date=Calendar.getInstance();date.setTimeInMillis(now);date.set(Calendar.HOUR_OF_DAY,0);date.set(Calendar.MINUTE,0);date.set(Calendar.SECOND,0);date.set(Calendar.MILLISECOND,0);start=date.getTimeInMillis();date.add(Calendar.DAY_OF_MONTH,1);end=date.getTimeInMillis();this.issue=issue;}
        List<Item> today(){List<Item> values=new ArrayList<>();for(Item i:items)if(i.when<end&&i.end>now&&i.end>start)values.add(i);return values;}
        Item next(){for(Item i:items)if(i.end>now)return i;return null;}}
    static Result local(Context c,long now){List<Item> values=new ArrayList<>();for(AgendaStore.Event e:AgendaStore.list(c))values.add(new Item(e.id,e.when,e.end(),e.title,e.syncPending?"Calendar sync pending":e.google!=0?"Google Calendar":"Local",false,false));java.util.Collections.sort(values,(a,b)->Long.compare(a.when,b.when));return new Result(values,now,"");}
    static Result read(Context c,long now){Result local=local(c,now);List<Item> values=new ArrayList<>(local.items);String issue="";
        if(CalendarBridge.selected(c)!=0){if(c.checkSelfPermission(Manifest.permission.READ_CALENDAR)!=PackageManager.PERMISSION_GRANTED)issue="Calendar access is off";
            else try{List<AgendaStore.Event> records=AgendaStore.list(c);for(CalendarBridge.Event remote:CalendarBridge.range(c,local.start,local.end+7L*86400000,false)){AgendaStore.Event own=null;for(AgendaStore.Event e:records)if(e.google==remote.id){own=e;break;}
                if(own!=null&&own.syncPending)continue;if(own!=null&&own.when==remote.begin&&remote.end==own.end()&&!remote.allDay&&own.title.equals(remote.title))continue;
                if(own!=null){long id=own.id;for(int n=values.size()-1;n>=0;n--)if(!values.get(n).external&&values.get(n).id==id)values.remove(n);}
                long begin=remote.begin,end=remote.end;if(remote.allDay){Calendar utc=Calendar.getInstance(java.util.TimeZone.getTimeZone("UTC"));utc.setTimeInMillis(begin);Calendar day=Calendar.getInstance();day.clear();day.set(utc.get(Calendar.YEAR),utc.get(Calendar.MONTH),utc.get(Calendar.DAY_OF_MONTH));begin=day.getTimeInMillis();utc.setTimeInMillis(end);day.clear();day.set(utc.get(Calendar.YEAR),utc.get(Calendar.MONTH),utc.get(Calendar.DAY_OF_MONTH));end=day.getTimeInMillis();}
                values.add(new Item(remote.id,begin,end,remote.title,own==null?"Google Calendar":"Changed in calendar",remote.allDay,true));
            }}catch(RuntimeException failure){issue="Calendar could not refresh";}}
        java.util.Collections.sort(values,(a,b)->Long.compare(a.when,b.when));return new Result(values,now,issue);}
    private DayPlan(){}
}
