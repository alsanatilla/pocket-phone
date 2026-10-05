package org.textphone.launcher;

import static org.junit.Assert.*;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.ResolveInfo;
import android.os.Looper;
import android.view.View;
import android.widget.EditText;
import android.widget.TextView;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowAlertDialog;

@RunWith(RobolectricTestRunner.class)
@Config(sdk={23,35})
public class DashboardEditingTest {
    private ActivityController<MainActivity> controller;
    private MainActivity activity;
    private SharedPreferences prefs;
    private String slot;
    @Before public void setup() {
        prefs=RuntimeEnvironment.getApplication().getSharedPreferences("text_phone",0);prefs.edit().clear().commit();
        RuntimeEnvironment.getApplication().getSharedPreferences("pocket_planner",0).edit().clear().commit();
        install("fixture.chatgpt","ChatGPT"); install("fixture.calendar","Calendar");
        controller=Robolectric.buildActivity(MainActivity.class).setup();activity=controller.get();
        slot=activity.getResources().getBoolean(R.bool.pocket_rom)?"phone":"smart txt";
    }
    @After public void cleanup() throws Exception { AppIndexTest.settle(activity);controller.pause().stop().destroy(); }
    private void install(String app,String label) {
        ApplicationInfo application=new ApplicationInfo();application.packageName=app;application.nonLocalizedLabel=label;
        ActivityInfo activity=new ActivityInfo();activity.name=app+".Main";activity.packageName=app;activity.applicationInfo=application;activity.nonLocalizedLabel=label;activity.exported=true;
        PackageInfo pkg=new PackageInfo();pkg.packageName=app;pkg.applicationInfo=application;pkg.activities=new ActivityInfo[]{activity};
        org.robolectric.shadows.ShadowPackageManager pm=Shadows.shadowOf(RuntimeEnvironment.getApplication().getPackageManager());pm.installPackage(pkg);
        ResolveInfo resolved=new ResolveInfo();resolved.activityInfo=activity;resolved.nonLocalizedLabel=label;
        pm.addResolveInfoForIntent(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER),resolved);
        pm.addResolveInfoForIntent(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setPackage(app),resolved);
    }
    private View root() { return activity.findViewById(android.R.id.content); }
    private TextView name() { return root().findViewWithTag("tile_label_"+slot); }
    private void menu(int option) {
        assertTrue(root().findViewWithTag("tile_"+slot).performLongClick());AlertDialog menu=ShadowAlertDialog.getLatestAlertDialog();
        assertTrue(menu.isShowing());Shadows.shadowOf(menu).clickOnItem(option);
    }
    private void assign(String label) throws Exception {
        menu(0);AppIndexTest.settle(activity);TextView choice=PocketAppsTest.find(root(),label);assertNotNull(label,choice);choice.performClick();
    }
    @Test public void choosingAnAppNamesTheTileAndLaunchesThatApp() throws Exception {
        assign("ChatGPT");assertEquals("ChatGPT",name().getText().toString());assertEquals("fixture.chatgpt",prefs.getString("shortcut_"+slot,null));
        assertNotNull("Fixture has a launchable Android activity",activity.getPackageManager().getLaunchIntentForPackage("fixture.chatgpt"));
        assertTrue(root().findViewWithTag("tile_"+slot).getContentDescription().toString().startsWith("ChatGPT"));
        root().findViewWithTag("tile_"+slot).performClick();assertEquals("fixture.chatgpt",Shadows.shadowOf(activity).getNextStartedActivity().getComponent().getPackageName());
    }
    @Test public void renamePersistsAndChangingAppsClearsTheOldCustomName() throws Exception {
        assign("ChatGPT");menu(1);AlertDialog rename=ShadowAlertDialog.getLatestAlertDialog();EditText input=rename.findViewById(android.R.id.content).findViewWithTag("tile_name_editor");
        input.setText("  Ask  ");rename.getButton(AlertDialog.BUTTON_POSITIVE).performClick();Shadows.shadowOf(Looper.getMainLooper()).idle();assertEquals("Ask",name().getText().toString());
        controller.recreate();activity=controller.get();assertEquals("Ask",name().getText().toString());
        assign("Calendar");assertEquals("Calendar",name().getText().toString());assertFalse(prefs.contains("shortcut_name_"+slot));
    }
    @Test public void useAppNameAndResetAffectOnlyThisTileAndKeepOrganizerData() throws Exception {
        PlannerStore planner=new PlannerStore(activity.getSharedPreferences("pocket_planner",0));long note=planner.save(0,"note","Keep my note");
        assign("ChatGPT");new DashboardTiles(prefs).rename(slot,"Ask");controller.newIntent(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME));assertEquals("Ask",name().getText().toString());
        menu(2);assertEquals("ChatGPT",name().getText().toString());menu(3);assertEquals(slot,name().getText().toString());assertFalse(prefs.contains("shortcut_"+slot));
        assertEquals("Keep my note",planner.find(note).text);assertNotNull(root().findViewWithTag("tile_settings"));
    }
    @Test public void oldPackageOnlyBindingsResolveActualNamesWithoutRebuildingHome() throws Exception {
        prefs.edit().putString("shortcut_"+slot,"fixture.chatgpt").commit();View home=root().getRootView();
        controller.pause().resume();AppIndexTest.settle(activity);assertEquals("ChatGPT",name().getText().toString());assertSame(home,root().getRootView());
        assertEquals("ChatGPT",prefs.getString("shortcut_app_label_"+slot,""));
    }
    @Test public void staleLabelResultsCannotRenameANewAssignment() {
        DashboardTiles tiles=new DashboardTiles(prefs);tiles.assign(slot,"fixture.chatgpt","ChatGPT");tiles.rename(slot,"Ask");
        tiles.assign(slot,"fixture.calendar","Calendar");tiles.resolved(slot,"fixture.chatgpt","Old ChatGPT");assertEquals("Calendar",tiles.label(slot));
        tiles.rename(slot,"Plan");tiles.resolved(slot,"fixture.calendar","New Calendar");assertEquals("Plan",tiles.label(slot));tiles.useAppName(slot);assertEquals("New Calendar",tiles.label(slot));
    }
}
