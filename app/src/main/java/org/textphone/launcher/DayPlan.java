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
    static Result local(Context c,long now){List<Item> values=new ArrayList<>();for(AgendaStore.Event e:AgendaStore.list(c))values.add(new Item(e.id,e.when,e.end(),e.title,"Pocket calendar",false,false));java.util.Collections.sort(values,(a,b)->Long.compare(a.when,b.when));return new Result(values,now,"");}
    static Result read(Context c,long now){return local(c,now);}
    private DayPlan(){}
}
