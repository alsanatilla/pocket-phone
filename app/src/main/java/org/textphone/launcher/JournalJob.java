package org.textphone.launcher;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import org.json.JSONObject;

/** Reads waiting journal pages once Android reports a network, one page at a time. Offline pages wait; nothing is lost. */
public final class JournalJob extends JobService {
    static final int JOB = 7303;
    private static final long STALE_READING = 10 * 60_000L;

    static void schedule(Context c) {
        JobScheduler jobs = c.getSystemService(JobScheduler.class); if (jobs == null) return;
        jobs.schedule(new JobInfo.Builder(JOB, new ComponentName(c, JournalJob.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPersisted(true).build());
    }

    @Override public boolean onStartJob(JobParameters params) {
        new Thread(() -> {
            boolean retry = false; long now = System.currentTimeMillis();
            for (JSONObject page : JournalStore.visible(this)) {
                String state = page.optString("state");
                // A page left "reading" by a job that was stopped half way is simply read again.
                boolean waiting = JournalStore.WAITING.equals(state) || JournalStore.READING.equals(state) && now - page.optLong("updated") > STALE_READING;
                if (!waiting) continue;
                try { JournalReader.read(this, page.optString("uid")); }
                catch (JournalReader.Later later) { retry = true; break; }
                catch (RuntimeException error) {
                    try { JournalStore.update(this, page.optString("uid"), p -> p.put("state", JournalStore.FAILED).put("error", "Reading failed. Try again from the page.")); }
                    catch (RuntimeException ignored) { /* The page was removed meanwhile. */ }
                }
                sendBroadcast(new Intent(CloudSync.ACTION_SYNCED).setPackage(getPackageName()));
            }
            CloudSync.changed(this);
            jobFinished(params, retry);
        }, "Pocket journal").start();
        return true;
    }
    @Override public boolean onStopJob(JobParameters params) { return true; }
}
