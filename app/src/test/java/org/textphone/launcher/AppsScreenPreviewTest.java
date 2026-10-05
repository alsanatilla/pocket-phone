package org.textphone.launcher;

import static org.junit.Assert.*;
import android.Manifest;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Color;
import android.view.View;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;
import java.io.File;
import java.io.FileOutputStream;

/** Actual Android layouts, with permission gates and local fixture data where needed. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk=28,qualifiers="w360dp-h800dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class AppsScreenPreviewTest {
    @Test public void renderTheNativeApps() throws Exception {
        Shadows.shadowOf(RuntimeEnvironment.getApplication()).denyPermissions(Manifest.permission.READ_CONTACTS,Manifest.permission.READ_SMS);
        RuntimeEnvironment.getApplication().getSharedPreferences("pocket_clock",0).edit().clear().commit();
        RuntimeEnvironment.getApplication().getSharedPreferences("pocket_agenda",0).edit().clear().commit();
        RuntimeEnvironment.getApplication().getSharedPreferences("pocket_camera",0).edit().clear().commit();
        Shadows.shadowOf(RuntimeEnvironment.getApplication()).grantPermissions(Manifest.permission.READ_EXTERNAL_STORAGE);
        Class<?>[] apps={PhoneActivity.class,MessagesActivity.class,ContactsActivity.class,ClockActivity.class,CalculatorActivity.class,FilesActivity.class};
        String[] names={"phone","messages","contacts","clock","calculator","files"};
        Bitmap sheet=Bitmap.createBitmap(1120,1640,Bitmap.Config.ARGB_8888);Canvas canvas=new Canvas(sheet);canvas.drawColor(0xFF202020);
        for(int i=0;i<apps.length;i++) {
            @SuppressWarnings("unchecked") Class<PocketActivity> type=(Class<PocketActivity>)apps[i];
            ActivityController<PocketActivity> controller=Robolectric.buildActivity(type).setup();
            try {PocketActivity activity=controller.get();CameraAlbumTest.settle(activity);if(activity instanceof CalculatorActivity)((android.widget.EditText)activity.body.findViewWithTag("calculator_input")).setText("(120+45)×0.8");
                View view=activity.findViewById(android.R.id.content);view.measure(View.MeasureSpec.makeMeasureSpec(360,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(800,View.MeasureSpec.EXACTLY));view.layout(0,0,360,800);
                Bitmap image=Bitmap.createBitmap(360,800,Bitmap.Config.ARGB_8888);view.draw(new Canvas(image));
                save(image,"pocket-"+names[i]+".png");canvas.drawBitmap(image,10+(i%3)*370,10+(i/3)*820,new Paint());image.recycle();
            } finally {controller.pause().stop().destroy();}
        }
        save(sheet,"pocket-apps.png");sheet.recycle();
    }
    private void save(Bitmap image,String name)throws Exception {File output=new File("build/screenshots",name);assertTrue(output.getParentFile().isDirectory()||output.getParentFile().mkdirs());try(FileOutputStream stream=new FileOutputStream(output)){assertTrue(image.compress(Bitmap.CompressFormat.PNG,100,stream));}}
}
