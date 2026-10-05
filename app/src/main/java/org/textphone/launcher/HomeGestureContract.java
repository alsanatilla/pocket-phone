package org.textphone.launcher;

import android.app.Activity;
import android.content.ComponentName;
import android.content.Intent;
import android.graphics.RectF;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.os.Messenger;
import android.os.ParcelUuid;
import android.os.Parcelable;
import android.os.Process;
import android.os.RemoteException;
import android.os.UserHandle;
import android.view.View;
import android.view.ViewTreeObserver;
import java.lang.ref.WeakReference;
import java.util.UUID;

/** Supplies a real Home tile destination when Android's optional gesture handshake is present. */
final class HomeGestureContract {
    interface Resolver {
        /** Visible tile bounds in screen coordinates, or null when this app has no matching tile. */
        RectF bounds(ComponentName component, UserHandle user);
    }

    // AOSP Launcher3 GestureNavContract. These are protocol keys, not hidden Android APIs.
    private static final String CONTRACT = "gesture_nav_contract_v1";
    private static final String COMPONENT = "android.intent.extra.COMPONENT_NAME";
    private static final String USER = "android.intent.extra.USER";
    private static final String CALLBACK = "android.intent.extra.REMOTE_CALLBACK";
    private static final String POSITION = "gesture_nav_contract_icon_position";
    private static final String SURFACE = "gesture_nav_contract_surface_control";
    private static final String FINISH = "gesture_nav_contract_finish_callback";
    private static final int FINISH_MESSAGE = 0;
    private static final long HANDOFF_TIMEOUT_MS = 750;

    private final Activity activity;
    private final Resolver resolver;
    private final Runnable finished;
    private final FinishReceiver finishReceiver;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable timeout = this::cancel;
    private final ViewTreeObserver.OnPreDrawListener preDraw = () -> { sendIfReady(); return true; };
    private ViewTreeObserver observer;
    private View observedView;
    private ComponentName component;
    private UserHandle user;
    private Message callback;
    private ParcelUuid request;
    private boolean positionSent;
    private boolean destroyed;

    HomeGestureContract(Activity activity, Resolver resolver) {
        this(activity, resolver, () -> { });
    }

    HomeGestureContract(Activity activity, Resolver resolver, Runnable finished) {
        this.activity = activity;
        this.resolver = resolver;
        this.finished = finished;
        finishReceiver = new FinishReceiver(this);
    }

    /** Remains true after sending the tile position until Android ends the animation or times out. */
    boolean pending() { return request != null; }

    /** Returns whether a valid contract was consumed; unsupported/missing targets keep OS fallback. */
    boolean accept(Intent intent) {
        cancel();
        if (destroyed || Build.VERSION.SDK_INT < 30 || intent == null
                || !Intent.ACTION_MAIN.equals(intent.getAction()) || !intent.hasCategory(Intent.CATEGORY_HOME)
                || (intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return false;
        Message pending = null;
        try {
            Bundle extras = intent.getBundleExtra(CONTRACT);
            if (extras == null) return false;
            // Consume once, including malformed extras; never replay a stale system callback.
            intent.removeExtra(CONTRACT);
            ComponentName requested = parcel(extras, COMPONENT, ComponentName.class);
            UserHandle requestedUser = parcel(extras, USER, UserHandle.class);
            Message original = parcel(extras, CALLBACK, Message.class);
            if (requested == null || requestedUser == null || !Process.myUserHandle().equals(requestedUser)
                    || original == null || original.replyTo == null) return false;
            pending = Message.obtain();
            // Preserve obj: AOSP uses it to identify the current gesture and reject stale responses.
            pending.copyFrom(original);
            component = requested;
            user = requestedUser;
            callback = pending;
            pending = null;
            request = new ParcelUuid(UUID.randomUUID());
            positionSent = false;
            View decor = activity.getWindow().getDecorView();
            observedView = decor;
            observer = decor.getViewTreeObserver();
            observer.addOnPreDrawListener(preDraw);
            main.postDelayed(timeout, HANDOFF_TIMEOUT_MS);
            sendIfReady();
            return true;
        } catch (RuntimeException malformed) {
            if (pending != null) pending.recycle();
            cancel();
            return false;
        }
    }

    @SuppressWarnings("deprecation")
    private static <T extends Parcelable> T parcel(Bundle extras, String key, Class<T> type) {
        Parcelable value = extras.getParcelable(key);
        return type.isInstance(value) ? type.cast(value) : null;
    }

    private void sendIfReady() {
        if (callback == null || positionSent || destroyed) return;
        if (activity.isFinishing() || activity.isDestroyed()) { cancel(); return; }
        try {
            View decor = activity.getWindow().getDecorView();
            if (!decor.isAttachedToWindow() || !decor.isLaidOut() || decor.isLayoutRequested()) return;
            RectF found = resolver.bounds(component, user);
            if (!valid(found)) return;
            Bundle result = new Bundle();
            result.putParcelable(POSITION, new RectF(found));
            // Rect-only handoff. Android retains animation ownership; Pocket allocates no surfaces.
            result.putParcelable(SURFACE, null);
            Message onFinish = Message.obtain();
            onFinish.what = FINISH_MESSAGE;
            onFinish.obj = request;
            onFinish.replyTo = finishReceiver.messenger;
            result.putParcelable(FINISH, onFinish);
            Message response = Message.obtain();
            response.copyFrom(callback);
            response.setData(result);
            // Remove position work before IPC. Keep the bounded hold until Android signals finish.
            positionSent = true;
            clearPosition();
            response.replyTo.send(response);
        } catch (RemoteException | RuntimeException unavailable) {
            cancel();
        }
    }

    private static boolean valid(RectF rect) {
        return rect != null && !rect.isEmpty() && finite(rect.left) && finite(rect.top)
                && finite(rect.right) && finite(rect.bottom) && finite(rect.width()) && finite(rect.height());
    }

    private static boolean finite(float value) { return !Float.isNaN(value) && !Float.isInfinite(value); }

    private void clearPosition() {
        if (observer != null && observer.isAlive()) observer.removeOnPreDrawListener(preDraw);
        if (observedView != null) {
            ViewTreeObserver current = observedView.getViewTreeObserver();
            if (current != observer && current.isAlive()) current.removeOnPreDrawListener(preDraw);
        }
        observer = null;
        observedView = null;
        if (callback != null) callback.recycle();
        callback = null;
        component = null;
        user = null;
    }

    private void receiveFinish(Message message) {
        if (!destroyed && positionSent && request != null && message.what == FINISH_MESSAGE
                && request.equals(message.obj)) cancel();
    }

    /** Cancels an unfinished handoff and releases the owner's hold exactly once. */
    void cancel() {
        boolean notify = request != null;
        request = null;
        positionSent = false;
        main.removeCallbacks(timeout);
        clearPosition();
        if (notify) finished.run();
    }

    void destroy() { destroyed = true; cancel(); finishReceiver.target.clear(); }

    /** The gesture provider may retain its callback Message beyond an Activity's lifetime. */
    private static final class FinishReceiver implements Handler.Callback {
        private final WeakReference<HomeGestureContract> target;
        private final Messenger messenger;

        FinishReceiver(HomeGestureContract contract) {
            target = new WeakReference<>(contract);
            messenger = new Messenger(new Handler(Looper.getMainLooper(), this));
        }

        @Override public boolean handleMessage(Message message) {
            HomeGestureContract contract = target.get();
            if (contract != null) contract.receiveFinish(message);
            return true;
        }
    }
}
