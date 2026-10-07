package org.textphone.launcher;

import static org.junit.Assert.*;
import android.app.Notification;
import android.app.PendingIntent;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.view.View;
import android.widget.EditText;
import android.widget.TextView;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.android.controller.ServiceController;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;
import java.io.File;
import java.io.FileOutputStream;

@RunWith(RobolectricTestRunner.class)
@Config(sdk=28,qualifiers="w360dp-h800dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class OrganizerPreviewTest {
    @Before public void clear() {RuntimeEnvironment.getApplication().getSharedPreferences("pocket_planner",0).edit().clear().commit();}
    @Test public void renderRealTaskAndMarkwonNoteLayouts() throws Exception {
        PlannerStore store=new PlannerStore(RuntimeEnvironment.getApplication().getSharedPreferences("pocket_planner",0));
        long task=store.saveTask(0,"Prepare weekend trip",PlannerDates.today(),true,"- [x] Book train\nPack camera\nDownload tickets");
        store.save(0,"task","Send invoice");store.save(0,"note","# Weekend\nPlatform 4 · bring the camera");
        ActivityController<MainActivity> controller=Robolectric.buildActivity(MainActivity.class,new Intent().putExtra("pocket_screen","today")).setup();
        try {MainActivity activity=controller.get();save(activity,"pocket-todo.png");
            activity.findViewById(android.R.id.content).findViewWithTag("task_open_"+task).performClick();save(activity,"pocket-task-detail.png");
            activity.findViewById(android.R.id.content).findViewWithTag("task_edit").performClick();save(activity,"pocket-task-editor.png");
            activity.onBackPressed();activity.onBackPressed();
            PocketAppsTest.find(activity.findViewById(android.R.id.content),"notes").performClick();
            PocketAppsTest.find(activity.findViewById(android.R.id.content),"+ note").performClick();
            save(activity,"pocket-notes-empty.png");
            ((EditText)activity.findViewById(android.R.id.content).findViewWithTag("capture_editor")).setText("# Weekend plan\n\n## Before leaving\n- [x] Book train\n- [ ] Charge camera\n- [ ] Pack light\n\n**Meet at 09:30**\n\n> Keep the afternoon free.");
            save(activity,"pocket-notes-editor.png");
            MarkdownEditor editor=activity.findViewById(android.R.id.content).findViewWithTag("capture_editor");
            int[] position=new int[2];editor.getLocationOnScreen(position);assertTrue(editor.openWheel(position[0]+180,position[1]+160));
            save(activity,"pocket-note-wheel.png");editor.dismissWheel();
            PocketAppsTest.find(activity.findViewById(android.R.id.content),"Preview").performClick();save(activity,"pocket-notes-preview.png");
            TextView preview=activity.findViewById(android.R.id.content).findViewWithTag("note_markdown_preview");assertTrue(preview.getText().toString().contains("Before leaving"));
            activity.onBackPressed();
            ((EditText)activity.findViewById(android.R.id.content).findViewWithTag("capture_editor")).setText("# yo");
            PocketAppsTest.find(activity.findViewById(android.R.id.content),"Preview").performClick();save(activity,"pocket-notes-short-preview.png");
        } finally {controller.pause().stop().destroy();}
    }
    @Test public void renderNotificationsAndMeasureHomeControls() throws Exception {
        Shadows.shadowOf(RuntimeEnvironment.getApplication().getSystemService(android.app.NotificationManager.class)).setNotificationListenerAccessGranted(NotificationAccess.component(RuntimeEnvironment.getApplication()),true);
        ServiceController<PhoneNotifications> service=Robolectric.buildService(PhoneNotifications.class).create();
        ActivityController<MainActivity> controller=Robolectric.buildActivity(MainActivity.class).setup();
        try {MainActivity activity=controller.get();save(activity,"pocket-controls-home.png");View root=activity.findViewById(android.R.id.content);
            for(String key:new String[]{"workspace_today","today_search","workspace_capture","today_chat","workspace_apps"}){View target=root.findViewWithTag(key);assertNotNull(key,target);assertTrue(key,target.getHeight()>=56&&target.getWidth()>=56);}
            PendingIntent open=PendingIntent.getActivity(activity,19,new Intent(activity,MainActivity.class),PendingIntent.FLAG_IMMUTABLE);
            Notification notice=new Notification.Builder(activity).setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle("Calendar").setContentText("Planning session · 10:30").setContentIntent(open).build();
            Shadows.shadowOf(service.get()).addActiveNotification("com.example.calendar",17,notice);service.get().onListenerConnected();
            org.robolectric.util.ReflectionHelpers.<View>getField(activity,"notificationCount").performClick();save(activity,"pocket-notifications.png");
            root=activity.findViewById(android.R.id.content);for(String key:new String[]{"Open","More"}){TextView target=PocketAppsTest.find(root,key);assertTrue(key,target.getHeight()>=56&&target.getWidth()>=56);}
        }finally {controller.pause().stop().destroy();service.destroy();}
    }
    private void save(MainActivity activity,String name) throws Exception {
        org.robolectric.util.ReflectionHelpers.<PageMotion>getField(activity,"motion").settle();
        View view=activity.findViewById(android.R.id.content);view.measure(View.MeasureSpec.makeMeasureSpec(360,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(800,View.MeasureSpec.EXACTLY));view.layout(0,0,360,800);
        TextView title=view.findViewWithTag("page_heading");
        if(title!=null) { assertTrue("Page title has usable width",title.getWidth()>128); assertNotNull(title.getLayout()); assertTrue("Centered title layout stays within its view",title.getLayout().getWidth()<=title.getWidth()); }
        Bitmap bitmap=Bitmap.createBitmap(360,800,Bitmap.Config.ARGB_8888);view.draw(new Canvas(bitmap));File path=new File("build/screenshots",name);
        assertTrue(path.getParentFile().isDirectory()||path.getParentFile().mkdirs());try(FileOutputStream stream=new FileOutputStream(path)){assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG,100,stream));}bitmap.recycle();
    }
}
