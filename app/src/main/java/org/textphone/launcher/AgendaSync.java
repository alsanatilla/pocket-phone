package org.textphone.launcher;

import android.content.Context;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Local appointments are durable before any optional provider write. No polling or account login. */
final class AgendaSync {
    private static final ExecutorService WORK = Executors.newSingleThreadExecutor(r -> { Thread t=new Thread(r,"Pocket calendar write"); t.setDaemon(true); return t; });
    static void enqueue(Context c, AgendaStore.Event event) {
        Context app=c.getApplicationContext(); AgendaStore.Event snapshot=event.copy();
        WORK.execute(() -> { try { sync(app,snapshot); } catch (RuntimeException ignored) { /* A failed write stays visibly pending for an explicit retry. */ } });
    }
    static boolean sync(Context c, AgendaStore.Event snapshot) {
        synchronized (CalendarBridge.class) {
            if (AgendaStore.find(c,snapshot.id)==null) return true;
            boolean success=CalendarBridge.write(c,snapshot); AgendaStore.syncResult(c,snapshot,success); return success;
        }
    }
    static void delete(Context c,long id) {
        synchronized (CalendarBridge.class) { AgendaStore.Event event=AgendaStore.find(c,id); if(event==null)return;
            if(event.google!=0)CalendarBridge.delete(c,event.google); AgendaStore.delete(c,id);
        }
    }
}
