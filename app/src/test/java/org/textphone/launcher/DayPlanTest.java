package org.textphone.launcher;

import static org.junit.Assert.*;
import android.Manifest;
import android.app.Application;
import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowContentResolver;

@RunWith(RobolectricTestRunner.class)
@Config(sdk={24,35})
public class DayPlanTest {
    private Context context;private long now;private EventsProvider provider;
    @Before public void setup(){context=RuntimeEnvironment.getApplication();context.getSharedPreferences("pocket_agenda",0).edit().clear().commit();Shadows.shadowOf((Application)context).grantPermissions(Manifest.permission.READ_CALENDAR);Calendar date=Calendar.getInstance();date.set(2026,Calendar.OCTOBER,5,12,0,0);date.set(Calendar.MILLISECOND,0);now=date.getTimeInMillis();provider=Robolectric.buildContentProvider(EventsProvider.class).create().get();ShadowContentResolver.registerProviderInternal("com.android.calendar",provider);}
    private AgendaStore.Event local(String title,long when,long google,boolean pending){AgendaStore.Event e=new AgendaStore.Event();e.title=title;e.when=when;e.google=google;e.syncPending=pending;AgendaStore.save(context,e);return e;}
    private void selected(){context.getSharedPreferences("pocket_agenda",0).edit().putLong("google_calendar",42).commit();}
    @Test public void todayIncludesAnOngoingAppointmentAndKeepsTomorrowOut(){local("Finished",now-7200000,0,false);AgendaStore.Event current=local("Review",now-1800000,0,false);local("Next",now+7200000,0,false);local("Tomorrow",now+86400000,0,false);DayPlan.Result r=DayPlan.local(context,now);assertEquals(2,r.today().size());assertEquals(current.id,r.next().id);}
    @Test public void anUnconnectedOrRevokedCalendarDoesNotQueryTheProvider(){local("Keep local",now+3600000,0,false);assertEquals(1,DayPlan.read(context,now).today().size());assertEquals(0,provider.queries);selected();Shadows.shadowOf((Application)context).denyPermissions(Manifest.permission.READ_CALENDAR);DayPlan.Result result=DayPlan.read(context,now);assertEquals("Calendar access is off",result.issue);assertEquals(1,result.today().size());assertEquals(0,provider.queries);}
    @Test public void aSyncedLocalEventIsShownOnceAndPendingEditsWin(){selected();AgendaStore.Event a=local("Local synced",now+3600000,1,false);AgendaStore.Event b=local("Changed here",now+7200000,2,true);provider.add(1,a.when,a.when+3600000,a.title,false);provider.add(2,b.when,b.when+3600000,"Old remote",false);provider.add(3,now+10800000,now+14400000,"Native appointment",false);DayPlan.Result r=DayPlan.read(context,now);assertEquals(3,r.today().size());assertFalse(r.today().get(0).external);assertEquals("Changed here",r.today().get(1).title);assertEquals("Calendar sync pending",r.today().get(1).source);assertTrue(r.today().get(2).external);assertEquals("42",provider.calendar);}
    @Test public void remoteTimeAndDurationChangesReplaceTheStaleLocalRow(){selected();AgendaStore.Event a=local("Call",now+3600000,7,false);provider.add(7,a.when,a.when+7200000,a.title,false);DayPlan.Result r=DayPlan.read(context,now);assertEquals(1,r.today().size());DayPlan.Item item=r.next();assertTrue(item.external);assertEquals(a.when+7200000,item.end);assertEquals("Changed in calendar",item.source);assertEquals(a.when,AgendaStore.find(context,a.id).when);}
    @Test public void anAllDayEventUsesTheLocalDateInADifferentTimezone(){java.util.TimeZone previous=java.util.TimeZone.getDefault();try{java.util.TimeZone.setDefault(java.util.TimeZone.getTimeZone("Pacific/Honolulu"));Calendar date=Calendar.getInstance();date.set(2026,Calendar.OCTOBER,5,12,0,0);date.set(Calendar.MILLISECOND,0);long midday=date.getTimeInMillis();Calendar utc=Calendar.getInstance(java.util.TimeZone.getTimeZone("UTC"));utc.clear();utc.set(2026,Calendar.OCTOBER,5);selected();provider.add(8,utc.getTimeInMillis(),utc.getTimeInMillis()+86400000,"Day off",true);DayPlan.Result r=DayPlan.read(context,midday);assertEquals(1,r.today().size());assertEquals(r.start,r.next().when);assertEquals(r.end,r.next().end);assertTrue(r.next().allDay);}finally{java.util.TimeZone.setDefault(previous);}}
    @Test public void providerFailuresKeepLocalPlansAndReportTheRefreshProblem(){selected();local("Local meeting",now+3600000,0,false);provider.fail=true;DayPlan.Result r=DayPlan.read(context,now);assertEquals(1,r.today().size());assertEquals("Calendar could not refresh",r.issue);}
    public static class EventsProvider extends ContentProvider {
        final List<Object[]> rows=new ArrayList<>();int queries;boolean fail;String calendar;
        void add(long id,long begin,long end,String title,boolean day){rows.add(new Object[]{id,begin,end,title,day?1:0});}
        public boolean onCreate(){return true;}public String getType(Uri u){return "vnd.android.cursor.dir/event";}
        public Uri insert(Uri u,ContentValues v){throw new AssertionError("Read-only planning view");}public int update(Uri u,ContentValues v,String s,String[] a){throw new AssertionError("Read-only planning view");}public int delete(Uri u,String s,String[] a){throw new AssertionError("Read-only planning view");}
        public Cursor query(Uri u,String[] p,String s,String[] args,String order){queries++;if(fail)throw new SecurityException("Fixture calendar denied");calendar=args[0];MatrixCursor result=new MatrixCursor(p);List<Object[]> sorted=new ArrayList<>(rows);java.util.Collections.sort(sorted,(a,b)->Long.compare((long)a[1],(long)b[1]));for(Object[] row:sorted)result.addRow(row);return result;}
    }
}
