package org.textphone.launcher;

import android.app.Activity;
import android.app.ActivityOptions;
import android.content.Intent;
import android.view.View;

/** Reuse an app's own task; Android controls cross-task and Home/Recents animations. */
final class PocketLaunch {
    static void open(Activity activity, Intent intent, View source) {
        boolean own = intent.getComponent() != null && activity.getPackageName().equals(intent.getComponent().getPackageName());
        if (own
                && (intent.getFlags() & Intent.FLAG_ACTIVITY_NEW_TASK) != 0) intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        boolean appLaunch = own || Intent.ACTION_MAIN.equals(intent.getAction()) && intent.hasCategory(Intent.CATEGORY_LAUNCHER);
        if (appLaunch && source != null && source.isAttachedToWindow() && source.getWidth() > 0 && source.getHeight() > 0 && PageMotion.enabled(activity)) {
            activity.startActivity(intent, ActivityOptions.makeScaleUpAnimation(source, 0, 0, source.getWidth(), source.getHeight()).toBundle());
        } else activity.startActivity(intent, null);
    }
    private PocketLaunch() { }
}
