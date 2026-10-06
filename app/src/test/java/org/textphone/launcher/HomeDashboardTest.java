package org.textphone.launcher;

import static org.junit.Assert.*;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.io.File;
import java.io.FileOutputStream;
import java.time.LocalDate;
import java.util.ArrayList;
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
public class HomeDashboardTest {
    private Context context; private PlannerStore planner;
    @Before public void clear() {
        context=RuntimeEnvironment.getApplication();
        for(String name:new String[]{"text_phone","pocket_planner","pocket_agenda","pocket_parking","pocket_cloud","pocket_movement","pocket_coros_auth"})context.getSharedPreferences(name,0).edit().clear().commit();
        context.getSharedPreferences("text_phone",0).edit().putBoolean("reduce_motion",true).putBoolean("twenty_four_hour",true).commit();
        planner=new PlannerStore(context.getSharedPreferences("pocket_planner",0));
    }
    @Test public void busyDayFitsOnePageAndEachSourceOpensItsOwnRecord() throws Exception {
        if(!context.getResources().getBoolean(R.bool.pocket_rom)) return;
        long task=planner.save(0,"task","Call the insurance"), note=planner.save(0,"note","# Groceries\nMilk and coffee");
        ParkingStore.park(context,"Ask about the van seats",System.currentTimeMillis()-1000);
        for(int i=0;i<2;i++){AgendaStore.Event event=new AgendaStore.Event();event.title=i==0?"Planning session":"Pick up the parcel";event.when=System.currentTimeMillis()+i*3600000;AgendaStore.save(context,event);}
        seedMovement();
        ActivityController<MainActivity> c=Robolectric.buildActivity(MainActivity.class).setup();
        try {
            MainActivity a=c.get(); View root=layout(a,800);
            assertEquals(1,((LinearLayout)root.findViewWithTag("home_tiles")).getChildCount());
            assertNotNull(root.findViewWithTag("tile_camera")); assertNull(root.findViewWithTag("tile_contacts"));
            assertEquals(2,((LinearLayout)root.findViewWithTag("dashboard_plan")).getChildCount());
            assertTrue(root.findViewWithTag("dashboard_next").getWidth()>200);
            assertNotNull(PocketAppsTest.find(root,"Planning session")); assertTrue(PocketAppsTest.find(root,"Planning session").getWidth()>200);
            View footer=root.findViewWithTag("home_footer"); assertTrue("Full dashboard should fit: "+(y(footer)+footer.getHeight()),y(footer)+footer.getHeight()<=800);
            assertTrue(y(root.findViewWithTag("dashboard_note"))<y(root.findViewWithTag("home_tiles")));
            save(root,800,"pocket-dashboard.png");
            root.findViewWithTag("dashboard_movement_0").performClick(); Intent movement=Shadows.shadowOf(a).getNextStartedActivity();
            assertEquals(MovementActivity.class.getName(),movement.getComponent().getClassName());assertEquals(0,movement.getIntExtra("score",-1));
            // Home never converts an undecided thought into a task.
            assertEquals(1,ParkingStore.open(context).size());assertEquals(task,planner.nextTask().id);
            assertEquals("Call the insurance",((TextView)root.findViewWithTag("dashboard_next")).getText().toString());
            root.findViewWithTag("dashboard_next").performClick(); assertEquals(task,ReflectionHelpers.<Long>getField(a,"captureId").longValue()); assertNotNull(PocketAppsTest.find(a.findViewById(android.R.id.content),"Complete task"));
            a.onBackPressed(); layout(a,800); a.findViewById(android.R.id.content).findViewWithTag("dashboard_note").performClick();
            assertEquals(note,ReflectionHelpers.<Long>getField(a,"captureId").longValue());
        } finally { c.pause().stop().destroy(); }
    }
    @Test public void quietDayHidesEmptySourcesAndOldDataKeepsItsDate() throws Exception {
        if(!context.getResources().getBoolean(R.bool.pocket_rom)) return;
        seedMovement(); JSONObject raw=new JSONObject(context.getSharedPreferences("pocket_movement",0).getString("snapshot","{}"));
        raw.put("updated",System.currentTimeMillis()-2*86400000L);context.getSharedPreferences("pocket_movement",0).edit().putString("snapshot",raw.toString()).commit();
        CorosRepository.Snapshot snapshot=CorosRepository.get(context).cached(); assertFalse(snapshot.today()); assertEquals(LocalDate.now().minusDays(2),snapshot.date);
        // Keep this screen disconnected so an obsolete fixture never initiates a live request.
        context.getSharedPreferences("pocket_coros_auth",0).edit().clear().commit();
        ActivityController<MainActivity> c=Robolectric.buildActivity(MainActivity.class).setup();
        try{View root=layout(c.get(),640);assertEquals(View.GONE,root.findViewWithTag("dashboard_next").getVisibility());assertEquals(View.GONE,root.findViewWithTag("dashboard_note").getVisibility());assertEquals(View.GONE,root.findViewWithTag("dashboard_plan").getVisibility());assertNotNull(root.findViewWithTag("dashboard_movement_connect"));assertTrue(y(root.findViewWithTag("home_footer"))+root.findViewWithTag("home_footer").getHeight()<=640);save(root,640,"pocket-dashboard-quiet.png");}finally{c.pause().stop().destroy();}
    }
    @Test public void unpinnedCustomGroupRemainsReachableUnderAll() throws Exception {
        if(!context.getResources().getBoolean(R.bool.pocket_rom)) return;
        DashboardTiles tiles=new DashboardTiles(context.getSharedPreferences("text_phone",0));tiles.makeGroup("contacts","My tools");
        ArrayList<DashboardTiles.Member> members=new ArrayList<>();members.add(DashboardTiles.Member.pocket("dice"));tiles.saveMembers("contacts",members);
        ActivityController<MainActivity> c=Robolectric.buildActivity(MainActivity.class).setup();
        try{MainActivity a=c.get();PocketAppsTest.find(a.findViewById(android.R.id.content),"all").performClick();a.findViewById(android.R.id.content).findViewWithTag("all_shortcut_contacts").performClick();Intent intent=Shadows.shadowOf(a).getNextStartedActivity();assertEquals(TileGroupActivity.class.getName(),intent.getComponent().getClassName());assertEquals("contacts",intent.getStringExtra("slot"));}finally{c.pause().stop().destroy();}
    }
    private void seedMovement() throws Exception {
        String today=LocalDate.now().toString();StringBuilder rest=new StringBuilder();for(int i=0;i<10;i++)rest.append(LocalDate.now().minusDays(i)).append(": 55 bpm\n");
        JSONObject raw=new JSONObject().put("updated",System.currentTimeMillis()).put("activities","").put("resting",rest.toString())
                .put("hrv",today+":\nHRV Avg: 60 ms\nNormal Range: 50 - 70\nBaseline: 60\n")
                .put("daily",today+":\nSteps: 2400\nTotal: 7h 30min | Deep: 1h | Awake: 10min\n").put("profile","Age: 40\nGender: Male");
        context.getSharedPreferences("pocket_coros_auth",0).edit().putString("tokens","fixture-presence").commit();
        context.getSharedPreferences("pocket_movement",0).edit().putString("snapshot",raw.toString()).commit();
    }
    private View layout(Activity a,int height){PageMotion motion=ReflectionHelpers.getField(a,"motion");motion.settle();View root=a.findViewById(android.R.id.content);root.measure(View.MeasureSpec.makeMeasureSpec(360,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(height,View.MeasureSpec.EXACTLY));root.layout(0,0,360,height);return root;}
    private int y(View view){int[] xy=new int[2];view.getLocationOnScreen(xy);return xy[1];}
    private void save(View root,int height,String name)throws Exception{Bitmap bitmap=Bitmap.createBitmap(360,height,Bitmap.Config.ARGB_8888);root.draw(new Canvas(bitmap));File file=new File("build/screenshots",name);file.getParentFile().mkdirs();try(FileOutputStream out=new FileOutputStream(file)){assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG,100,out));}bitmap.recycle();}
}
