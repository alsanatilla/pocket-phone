package org.textphone.launcher;

import static org.junit.Assert.*;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.os.Looper;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ScrollView;
import android.widget.TextView;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.time.Duration;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;
import org.robolectric.util.ReflectionHelpers;

@RunWith(RobolectricTestRunner.class) @Config(sdk=28,qualifiers="w360dp-h800dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class MovementActivityTest {
    private Context c; private CorosRepository repo;
    @Before public void reset() {
        c=RuntimeEnvironment.getApplication();for(String key:new String[]{"text_phone","pocket_cloud","pocket_movement","pocket_coros_auth"})c.getSharedPreferences(key,0).edit().clear().commit();
        c.getSharedPreferences("text_phone",0).edit().putBoolean("reduce_motion",true).commit(); repo=new CorosRepository(c,new MovementRepositoryTest.FakeIO()); ReflectionHelpers.setStaticField(CorosRepository.class,"instance",repo);
    }
    @Test public void sampleShowsCompleteCockpitWithoutWritingInventedData() throws Exception {
        ActivityController<MovementActivity> ctl=Robolectric.buildActivity(MovementActivity.class).setup();MovementActivity a=ctl.get();
        try {
            assertNotNull(a.root.findViewWithTag("movement_sample"));assertEquals(3,countPrefix(a.body,"movement_activity_"));
            a.root.findViewWithTag("movement_score_0").performClick();assertTrue(text(a.body).contains("LAST SLEEP"));assertTrue(text(a.body).contains("STRESS · 0–100"));save(a,360,800,"recovery");
            a.root.findViewWithTag("movement_score_2").performClick();assertTrue(text(a.body).contains("VO2max"));assertTrue(text(a.body).contains("3:52:00"));save(a,360,800,"conditioning");
            a.root.findViewWithTag("movement_activity_sample-0").performClick();assertNotNull(a.root.findViewWithTag("movement_route"));assertNotNull(a.root.findViewWithTag("movement_chart_pace"));save(a,360,800,"activity");
            a.root.findViewWithTag("movement_more_charts").performClick();assertNotNull(a.root.findViewWithTag("movement_chart_cadence"));
            a.root.findViewWithTag("movement_more").performClick();assertNotNull(a.root.findViewWithTag("movement_splits"));assertTrue(text(a.body).contains("TIME BY HEART RATE"));saveBody(a,360,"activity-metrics");
            assertFalse(c.getSharedPreferences("pocket_movement",0).contains("snapshot"));assertFalse(c.getSharedPreferences("pocket_movement",0).contains("activity_details"));
        } finally {ctl.pause().stop().destroy();}
    }
    @Test public void offlineArchiveHasEveryActivityAndOpenedRoutesRemainUsable() throws Exception {
        seed();CorosData.Activity run=repo.cached().activities.get(0);repo.rememberDetail("local",run.id,MovementSample.detail(run),true);
        ActivityController<MovementActivity> ctl=Robolectric.buildActivity(MovementActivity.class).setup();MovementActivity a=ctl.get();
        try{
            assertNull(a.root.findViewWithTag("movement_sample"));assertEquals(39,countPrefix(a.body,"movement_activity_"));
            a.root.findViewWithTag("movement_activity_"+run.id).performClick();assertNotNull(a.root.findViewWithTag("movement_route"));assertNull(a.root.findViewWithTag("movement_detail_retry"));
            a.root.findViewWithTag("app_settings").performClick();assertEquals("movement settings",((TextView)a.root.findViewWithTag("page_heading")).getText().toString());
            a.onBackPressed();assertNotNull(a.root.findViewWithTag("movement_route"));a.onBackPressed();assertNotNull(a.root.findViewWithTag("movement_scores"));assertFalse(a.isFinishing());
        }finally{ctl.pause().stop().destroy();}
    }
    @Test public void homeScoreDeepLinkReturnsHomeAndOrdinaryScoreBackClosesPanel() throws Exception {
        seed();ActivityController<MovementActivity> ctl=Robolectric.buildActivity(MovementActivity.class,new Intent().putExtra("score",1)).setup();
        try{MovementActivity a=ctl.get();assertTrue(text(a.body).contains("active TRIMP"));a.onBackPressed();assertTrue(a.isFinishing());}finally{ctl.pause().stop().destroy();}
        ActivityController<MovementActivity> normal=Robolectric.buildActivity(MovementActivity.class).setup();
        try{MovementActivity a=normal.get();a.root.findViewWithTag("movement_score_1").performClick();a.onBackPressed();assertNull(a.root.findViewWithTag("movement_method"));assertFalse(a.isFinishing());}finally{normal.pause().stop().destroy();}
    }
    @Test public void linkedScrubberUpdatesEveryChartAndMoreSurvivesRecreation() throws Exception {
        seed();CorosData.Activity run=repo.cached().activities.get(0);repo.rememberDetail("local",run.id,MovementSample.detail(run),true);
        ActivityController<MovementActivity> ctl=Robolectric.buildActivity(MovementActivity.class).setup();
        try{
            MovementActivity a=ctl.get();a.root.findViewWithTag("movement_activity_"+run.id).performClick();a.root.findViewWithTag("movement_more_charts").performClick();a.root.findViewWithTag("movement_more").performClick();
            MovementChart pace=(MovementChart)a.root.findViewWithTag("movement_chart_pace"), hr=(MovementChart)a.root.findViewWithTag("movement_chart_hr");
            MovementChart.Cursor cursor=ReflectionHelpers.getField(pace,"cursor");assertSame(cursor,ReflectionHelpers.getField(hr,"cursor"));pace.onKeyDown(KeyEvent.KEYCODE_DPAD_RIGHT,new KeyEvent(KeyEvent.ACTION_DOWN,KeyEvent.KEYCODE_DPAD_RIGHT));assertTrue(cursor.index>=0);assertFalse(((TextView)a.root.findViewWithTag("movement_cursor")).getText().toString().equals("average"));
            ctl.recreate();a=ctl.get();assertNotNull(a.root.findViewWithTag("movement_splits"));assertNotNull(a.root.findViewWithTag("movement_chart_cadence"));
        }finally{ctl.pause().stop().destroy();}
    }
    @Test @Config(qualifiers="w320dp-h640dp-mdpi") public void smallestPhoneAndLandscapeKeepAllInstrumentsInsideViewport() throws Exception {
        ActivityController<MovementActivity> ctl=Robolectric.buildActivity(MovementActivity.class).setup();
        try{
            MovementActivity a=ctl.get();layout(a,320,640);View scores=a.root.findViewWithTag("movement_scores");assertTrue(scores.getWidth()<=320);checkWidths((ViewGroup)scores);assertEquals(1,((TextView)a.root.findViewWithTag("movement_score_name_2")).getLineCount());save(a,320,640,"small-phone");
            a.root.findViewWithTag("movement_score_0").performClick();layout(a,320,640);assertEquals(0,overflows(a.body,a.body.getWidth()));
            a.root.findViewWithTag("movement_activity_sample-0").performClick();save(a,640,360,"landscape");assertNotNull(a.root.findViewWithTag("movement_chart_hr"));
        }finally{ctl.pause().stop().destroy();}
    }
    @Test public void incomingSyncRepaintsCurrentPanelWithoutNavigatingAway() throws Exception {
        seed();ActivityController<MovementActivity> ctl=Robolectric.buildActivity(MovementActivity.class).setup();
        try{
            MovementActivity a=ctl.get();a.root.findViewWithTag("movement_score_2").performClick();JSONObject raw=new JSONObject(c.getSharedPreferences("pocket_movement",0).getString("snapshot","{}"));raw.getJSONObject("cockpit").getJSONObject("fitness").put("vo2max",61);c.getSharedPreferences("pocket_movement",0).edit().putString("snapshot",raw.toString()).commit();
            c.sendBroadcast(new Intent(CorosRepository.ACTION_UPDATED).setPackage(c.getPackageName()));Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(200));assertTrue(text(a.body).contains("61"));assertNotNull(a.root.findViewWithTag("movement_method"));
        }finally{ctl.pause().stop().destroy();}
    }
    @Test @Config(sdk={24,35}) @GraphicsMode(GraphicsMode.Mode.LEGACY) public void oldestAndCurrentAndroidSupportNativeScreensAndLifecycle() throws Exception {
        seed();ActivityController<MovementActivity> ctl=Robolectric.buildActivity(MovementActivity.class).setup();
        try {MovementActivity a=ctl.get();a.root.findViewWithTag("movement_score_0").performClick();assertNotNull(a.root.findViewWithTag("movement_method"));a.root.findViewWithTag("movement_activity_sample-0").performClick();assertNotNull(a.root.findViewWithTag("coros_connect"));a.onBackPressed();assertNotNull(a.root.findViewWithTag("movement_scores"));}finally{ctl.pause().stop().destroy();}
    }
    @Test @Config(qualifiers="w320dp-h640dp-mdpi") public void largeTextUsesFullWidthScoresWithoutClippedLabels() throws Exception {
        c.getSharedPreferences("text_phone",0).edit().putBoolean("large_text",true).commit();ActivityController<MovementActivity> ctl=Robolectric.buildActivity(MovementActivity.class).setup();
        try{MovementActivity a=ctl.get();layout(a,320,640);android.widget.LinearLayout scores=(android.widget.LinearLayout)a.root.findViewWithTag("movement_scores");assertEquals(android.widget.LinearLayout.VERTICAL,scores.getOrientation());checkWidths(scores);assertEquals(1,((TextView)a.root.findViewWithTag("movement_score_name_2")).getLineCount());save(a,320,640,"large-text");}finally{ctl.pause().stop().destroy();}
    }
    @Test public void lateFetchCachesTheActivityButNeverReopensItAfterBack() throws Exception {
        seed();CountDownLatch started=new CountDownLatch(1),finish=new CountDownLatch(1);
        repo=new CorosRepository(c,new CorosRepository.DetailIO(){
            public JSONObject api(String m,String p,JSONObject b)throws IOException{throw new IOException("offline");}
            public String tool(String name,JSONObject args)throws IOException{if(name.equals("getActivityDetail")){started.countDown();try{if(!finish.await(3,TimeUnit.SECONDS))throw new IOException("timeout");}catch(InterruptedException e){throw new IOException(e);}return "Distance: 6.2 km";}if(name.equals("queryActivityLapData"))return MovementRepositoryTest.lapText();return "No FIT file";}
            public byte[] download(String url)throws IOException{throw new IOException("No file");}
        });ReflectionHelpers.setStaticField(CorosRepository.class,"instance",repo);c.getSharedPreferences("pocket_coros_auth",0).edit().putString("tokens","fixture-presence").commit();
        ActivityController<MovementActivity> ctl=Robolectric.buildActivity(MovementActivity.class).setup();
        try{
            MovementActivity a=ctl.get();CorosData.Activity run=repo.cached().activities.get(0);a.root.findViewWithTag("movement_activity_"+run.id).performClick();assertTrue(started.await(3,TimeUnit.SECONDS));a.onBackPressed();finish.countDown();
            long until=System.nanoTime()+TimeUnit.SECONDS.toNanos(3);while(repo.cachedDetail(run.id)==null&&System.nanoTime()<until)Thread.sleep(10);Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(250));
            assertNotNull(repo.cachedDetail(run.id));assertNotNull(a.root.findViewWithTag("movement_scores"));assertNull(a.root.findViewWithTag("movement_chart_hr"));
        }finally{finish.countDown();ctl.pause().stop().destroy();}
    }
    @Test public void pullRefreshForcesCorosAndReplacesReadingsEvenWithoutPocketAccount() throws Exception {
        seed();java.util.concurrent.atomic.AtomicInteger reads=new java.util.concurrent.atomic.AtomicInteger();String today=java.time.LocalDate.now().toString();
        repo=new CorosRepository(c,new CorosRepository.DetailIO(){
            public JSONObject api(String m,String p,JSONObject b)throws IOException{throw new IOException("No account");}
            public String tool(String name,JSONObject args)throws IOException{
                reads.incrementAndGet();switch(name){case "querySportRecords":return "";case "queryRestingHeartRate":return today+": 51 bpm";case "querySleepHrv":return today+":\nHRV Avg: 70 ms\nNormal Range: 55 - 75\nBaseline: 63";case "queryDailyHealthData":return today+":\nSteps: 9100\nTotal: 8h | Deep: 1h | Awake: 10min";case "queryUserInfo":return "Age: 34\nGender: Male";case "queryDevices":return "Model Name: REFRESHED WATCH";default:return "";}
            }
            public byte[] download(String url)throws IOException{throw new IOException("No file");}
        });ReflectionHelpers.setStaticField(CorosRepository.class,"instance",repo);c.getSharedPreferences("pocket_coros_auth",0).edit().putString("tokens","fixture-presence").commit();
        ActivityController<MovementActivity> ctl=Robolectric.buildActivity(MovementActivity.class).setup();
        try{
            MovementActivity a=ctl.get();
            long settled=System.nanoTime()+TimeUnit.SECONDS.toNanos(3);
            while(ReflectionHelpers.<Boolean>getField(a,"busy")&&System.nanoTime()<settled){Thread.sleep(10);Shadows.shadowOf(Looper.getMainLooper()).idle();}
            ScrollView scroll=(ScrollView)a.body.getParent();scroll.performAccessibilityAction(0x01000001,null);
            long until=System.nanoTime()+TimeUnit.SECONDS.toNanos(3);while(reads.get()<10&&System.nanoTime()<until)Thread.sleep(10);
            until=System.nanoTime()+TimeUnit.SECONDS.toNanos(3);while(!"REFRESHED WATCH".equals(repo.cached().cockpit.optString("device"))&&System.nanoTime()<until)Thread.sleep(10);
            until=System.nanoTime()+TimeUnit.SECONDS.toNanos(3);
            while(!text(a.body).contains("REFRESHED WATCH")&&System.nanoTime()<until){Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(150));Thread.sleep(10);}
            assertEquals(10,reads.get());assertTrue(text(a.body).contains("REFRESHED WATCH"));assertEquals(39,repo.cached().activities.size());assertEquals(70,repo.cached().hrv.get(0).avg);
        }finally{ctl.pause().stop().destroy();}
    }
    private void seed()throws Exception{CorosRepository.Snapshot s=MovementSample.snapshot();JSONObject raw=new JSONObject().put("updated",s.updated).put("records",CorosData.recordsJson(s.activities)).put("cockpit",s.cockpit);c.getSharedPreferences("pocket_movement",0).edit().putString("snapshot",raw.toString()).commit();}
    private static int countPrefix(View view,String prefix){int total=view.getTag() instanceof String&&((String)view.getTag()).startsWith(prefix)?1:0;if(view instanceof ViewGroup)for(int i=0;i<((ViewGroup)view).getChildCount();i++)total+=countPrefix(((ViewGroup)view).getChildAt(i),prefix);return total;}
    private static String text(View view){StringBuilder s=new StringBuilder();if(view instanceof TextView)s.append(((TextView)view).getText()).append('\n');if(view instanceof ViewGroup)for(int i=0;i<((ViewGroup)view).getChildCount();i++)s.append(text(((ViewGroup)view).getChildAt(i)));return s.toString();}
    private static void checkWidths(ViewGroup view){for(int i=0;i<view.getChildCount();i++){View child=view.getChildAt(i);assertTrue(child.getRight()<=view.getWidth());if(child instanceof ViewGroup)checkWidths((ViewGroup)child);}}
    private static int overflows(ViewGroup group,int width){int n=0;for(int i=0;i<group.getChildCount();i++){View child=group.getChildAt(i);if(child.getRight()>width)n++;if(child instanceof ViewGroup)n+=overflows((ViewGroup)child,child.getWidth());}return n;}
    private static void layout(MovementActivity a,int w,int h){a.root.measure(View.MeasureSpec.makeMeasureSpec(w,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(h,View.MeasureSpec.EXACTLY));a.root.layout(0,0,w,h);}
    private static void save(MovementActivity a,int w,int h,String name)throws Exception{layout(a,w,h);image(a.root,w,h,name);}
    private static void saveBody(MovementActivity a,int w,String name)throws Exception{layout(a,w,800);a.body.measure(View.MeasureSpec.makeMeasureSpec(a.body.getWidth(),View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(0,View.MeasureSpec.UNSPECIFIED));a.body.layout(0,0,a.body.getMeasuredWidth(),a.body.getMeasuredHeight());image(a.body,a.body.getWidth(),Math.min(12000,a.body.getHeight()),name);}
    private static void image(View view,int w,int h,String name)throws Exception{File dir=new File("build/reports/movement-preview");dir.mkdirs();Bitmap b=Bitmap.createBitmap(w,h,Bitmap.Config.ARGB_8888);b.eraseColor(PocketDesign.INK);view.draw(new Canvas(b));try(FileOutputStream out=new FileOutputStream(new File(dir,name+".png"))){b.compress(Bitmap.CompressFormat.PNG,100,out);}b.recycle();}
}
