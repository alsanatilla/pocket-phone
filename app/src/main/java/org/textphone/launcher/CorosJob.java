package org.textphone.launcher;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;

/** Android can supplement the daily server job when this phone has a network. */
public final class CorosJob extends JobService {
    private static final int ID = 5304;
    static void ensure(Context context) {
        JobScheduler jobs = context.getSystemService(JobScheduler.class); if (jobs == null) return;
        if (!CorosRepository.get(context).connected()) { jobs.cancel(ID); return; }
        if (jobs.getPendingJob(ID) == null) jobs.schedule(new JobInfo.Builder(ID, new ComponentName(context, CorosJob.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPeriodic(60 * 60_000L).setPersisted(true).build());
    }
    private volatile Thread worker;
    @Override public boolean onStartJob(JobParameters params) {
        worker = new Thread(() -> {
            try { CorosRepository.get(this).refresh(false); } catch (java.io.IOException | RuntimeException ignored) { }
            if (!Thread.currentThread().isInterrupted()) jobFinished(params, false);
        }, "Pocket COROS refresh"); worker.start(); return true;
    }
    @Override public boolean onStopJob(JobParameters params) { Thread thread = worker; if (thread != null) thread.interrupt(); return true; }
}
