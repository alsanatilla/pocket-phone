package org.textphone.launcher;

import static org.junit.Assert.*;
import android.app.job.JobScheduler;
import android.content.Context;
import android.os.Looper;
import android.widget.TextView;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.CommonStatusCodes;
import com.google.android.gms.common.api.Status;
import java.io.IOException;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.Implementation;
import org.robolectric.annotation.Implements;

@RunWith(RobolectricTestRunner.class) @Config(sdk={23,35},shadows=CloudSyncFlowTest.FakeSync.class)
public class CloudSyncFlowTest {
    @Implements(value=CloudSync.class,isInAndroidSdk=false)
    public static class FakeSync {
        static volatile int calls; static boolean fail;
        @Implementation protected static void run(Context context) throws IOException {
            calls++; if(fail)throw new IOException("No connection to Google (code 7).");
            CloudSync.prefs(context).edit().putLong("last_ok",System.currentTimeMillis()).remove("last_error").commit();
        }
    }
    private Context context;
    @Before public void setup(){context=RuntimeEnvironment.getApplication();context.getSharedPreferences("pocket_cloud",0).edit().clear().putBoolean("enabled",true).commit();FakeSync.calls=0;FakeSync.fail=false;}
    @Test public void syncNowRunsWithoutWaitingForAndroidJobAndReportsSuccess() throws Exception {
        ActivityController<CloudActivity> controller=Robolectric.buildActivity(CloudActivity.class).setup();
        try{CloudActivity activity=controller.get();assertEquals(0,FakeSync.calls);activity.root.findViewWithTag("cloud_sync").performClick();await(activity);
            assertEquals(1,FakeSync.calls);assertTrue(CloudSync.prefs(context).getLong("last_ok",0)>0);
            assertTrue(activity.root.findViewWithTag("cloud_sync").isEnabled());
            assertFalse(context.getSystemService(JobScheduler.class).getAllPendingJobs().stream().anyMatch(job->job.getId()==CloudSync.JOB_SOON));
        }finally{controller.pause().stop().destroy();}
    }
    @Test public void failedImmediateSyncKeepsReadableErrorAndCanBeRetried() throws Exception {
        FakeSync.fail=true; ActivityController<CloudActivity> controller=Robolectric.buildActivity(CloudActivity.class).setup();
        try{CloudActivity activity=controller.get();activity.root.findViewWithTag("cloud_sync").performClick();await(activity);
            assertEquals("No connection to Google (code 7).",CloudSync.prefs(context).getString("last_error",""));
            assertNotNull(PocketAppsTest.find(activity.root,"No connection to Google (code 7)."));
            FakeSync.fail=false;activity.root.findViewWithTag("cloud_sync").performClick();await(activity);assertEquals(2,FakeSync.calls);assertFalse(CloudSync.prefs(context).contains("last_error"));
        }finally{controller.pause().stop().destroy();}
    }
    @Test public void cancelledGoogleResultDoesNotEnableSyncAndErrorsNameTheFailure() {
        CloudSync.prefs(context).edit().putBoolean("enabled",false).commit();
        ActivityController<CloudActivity> controller=Robolectric.buildActivity(CloudActivity.class).setup();
        try{CloudActivity activity=controller.get();activity.onActivityResult(731,android.app.Activity.RESULT_CANCELED,null);assertFalse(CloudSync.enabled(context));assertEquals("Google sign-in was cancelled.",CloudSync.prefs(context).getString("last_error",""));}finally{controller.pause().stop().destroy();}
        assertTrue(CloudSync.explain(new ApiException(new Status(CommonStatusCodes.DEVELOPER_ERROR))).contains("code 10"));
        assertEquals("No connection to Google (code 7).",CloudSync.explain(new ApiException(new Status(CommonStatusCodes.NETWORK_ERROR))));
    }
    private void await(CloudActivity activity) throws Exception {
        for(int i=0;i<200;i++){Shadows.shadowOf(Looper.getMainLooper()).idle();TextView button=activity.root.findViewWithTag("cloud_sync");if(FakeSync.calls>0&&button!=null&&button.isEnabled())return;Thread.sleep(10);}
        fail("Foreground sync did not finish");
    }
}
