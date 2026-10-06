package org.textphone.launcher;
import android.content.Context;
/** Legacy calendar-write entry points now operate only on Pocket's own calendar. */
final class AgendaSync {
    static void enqueue(Context c, AgendaStore.Event event) { sync(c,event); }
    static boolean sync(Context c, AgendaStore.Event event) { event.syncPending=false; AgendaStore.syncResult(c,event,true); return true; }
    static void delete(Context c,long id) { AgendaStore.delete(c,id); CloudSync.changed(c); }
    private AgendaSync() { }
}
