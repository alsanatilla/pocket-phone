package org.textphone.launcher;

import android.app.job.JobParameters;
import android.app.job.JobService;
import java.io.IOException;

/** Runs a cloud sync once Android reports a network. Network failures retry with Android's backoff. */
public final class SyncJob extends JobService {
    @Override public boolean onStartJob(JobParameters params) {
        new Thread(() -> {
            boolean retry = false;
            try { if (CloudSync.enabled(this)) CloudSync.run(this); }
            catch (CloudSync.SignInNeeded error) { CloudSync.prefs(this).edit().putString("last_error", error.getMessage()).apply(); }
            catch (IOException error) { retry = params.getJobId() == CloudSync.JOB_SOON; CloudSync.prefs(this).edit().putString("last_error", error.getMessage()).apply(); }
            catch (RuntimeException error) { CloudSync.prefs(this).edit().putString("last_error", "Sync failed. Try Sync now in Settings → Cloud sync.").apply(); }
            sendBroadcast(new android.content.Intent(CloudSync.ACTION_SYNCED).setPackage(getPackageName()));
            jobFinished(params, retry);
        }, "Pocket sync").start();
        return true;
    }
    @Override public boolean onStopJob(JobParameters params) { return true; }
}
