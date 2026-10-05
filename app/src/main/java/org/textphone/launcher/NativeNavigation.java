package org.textphone.launcher;

import android.app.Activity;
import android.os.Build;
import android.view.View;
import android.window.BackEvent;
import android.window.OnBackInvokedCallback;
import android.window.OnBackAnimationCallback;
import android.window.OnBackInvokedDispatcher;

/** Only handles internal Back navigation. Home and Recents are always Android's gestures. */
final class NativeNavigation {
    interface Page {
        boolean internal(); void back(); View content();
        default void started(boolean fromLeft) { }
        default void progressed(float progress) { }
        default void cancelled() { }
    }
    private final Activity activity; private final Page page;
    private OnBackInvokedCallback callback; private boolean registered;
    NativeNavigation(Activity activity, Page page) { this.activity = activity; this.page = page; }
    void update() {
        if (Build.VERSION.SDK_INT < 33) return;
        if (page.internal() && !registered) {
            callback = Build.VERSION.SDK_INT >= 34 ? animated(page) : () -> page.back();
            activity.getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, callback); registered = true;
        } else if (!page.internal()) destroy();
    }
    @android.annotation.TargetApi(34) private static OnBackInvokedCallback animated(Page page) {
        return new OnBackAnimationCallback() {
            public void onBackStarted(BackEvent event) { page.started(event.getSwipeEdge() == BackEvent.EDGE_LEFT); }
            public void onBackProgressed(BackEvent event) { page.progressed(event.getProgress()); }
            public void onBackCancelled() { page.cancelled(); }
            public void onBackInvoked() { page.back(); }
        };
    }
    void destroy() { if (Build.VERSION.SDK_INT >= 33 && registered) { activity.getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(callback); registered = false; callback = null; } }
}
