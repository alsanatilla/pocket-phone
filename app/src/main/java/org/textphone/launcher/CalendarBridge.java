package org.textphone.launcher;
import android.content.Context;
import java.util.Collections;
import java.util.List;
/** Old calendar hooks are inert. Pocket never reads or writes an account calendar. */
final class CalendarBridge {
    static final class Calendar { long id; String name; }
    static final class Event { long id,begin,end;String title;boolean allDay; }
    static long selected(Context c){return 0;}
    static List<Calendar> calendars(Context c){return Collections.emptyList();}
    static List<Event> upcoming(Context c){return Collections.emptyList();}
    static List<Event> timeline(Context c,boolean past){return Collections.emptyList();}
    static List<Event> range(Context c,long from,long to,boolean past){return Collections.emptyList();}
    static boolean write(Context c,AgendaStore.Event e){return true;}
    static void delete(Context c,long id){}
    static long localAllDay(long value){return value;}
    private CalendarBridge(){}
}
