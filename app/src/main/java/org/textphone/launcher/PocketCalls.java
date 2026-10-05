package org.textphone.launcher;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;
import android.telecom.Call;
import android.telecom.CallAudioState;
import android.telecom.InCallService;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/** Telecom owns telephony; Pocket owns the incoming and active call interface. */
public final class PocketCalls extends InCallService {
    private static final CopyOnWriteArrayList<Call> active = new CopyOnWriteArrayList<>();
    static final CopyOnWriteArrayList<Runnable> observers = new CopyOnWriteArrayList<>();
    static volatile PocketCalls service;
    static volatile CallAudioState audio;
    static List<Call> calls() { return new ArrayList<>(active); }
    static Call primary() { for (Call c : active) if (c.getState() == Call.STATE_RINGING) return c;
        for (Call c : active) if (c.getState() == Call.STATE_ACTIVE) return c; return active.isEmpty() ? null : active.get(0); }
    private final Call.Callback callback = new Call.Callback() {
        @Override public void onStateChanged(Call call, int state) { update(); }
        @Override public void onDetailsChanged(Call call, Call.Details details) { update(); }
    };
    @Override public void onCallAdded(Call call) { super.onCallAdded(call); service = this; active.addIfAbsent(call); call.registerCallback(callback); update();
        try { startActivity(new Intent(this, InCallActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)); }
        catch (RuntimeException ignored) { /* Android can require the incoming/ongoing notification to open the screen. */ }
    }
    @Override public void onCallRemoved(Call call) { call.unregisterCallback(callback); active.remove(call); update(); super.onCallRemoved(call); }
    @Override public void onCallAudioStateChanged(CallAudioState state) { audio = state; update(); }
    private void update() {
        for (Runnable observer : observers) observer.run();
        NotificationManager manager = getSystemService(NotificationManager.class); if (manager == null) return;
        Call call = primary(); if (call == null) { manager.cancel(710); return; }
        if (Build.VERSION.SDK_INT >= 26) { NotificationChannel channel = new NotificationChannel("pocket_calls", "Calls", NotificationManager.IMPORTANCE_HIGH);
            channel.setSound(null, null); manager.createNotificationChannel(channel); }
        PendingIntent open = PendingIntent.getActivity(this, 710, new Intent(this, InCallActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, "pocket_calls") : new Notification.Builder(this);
        builder.setSmallIcon(R.drawable.ic_launcher).setContentTitle(call.getState() == Call.STATE_RINGING ? "Incoming call" : "Call")
                .setContentText(number(call)).setCategory(Notification.CATEGORY_CALL).setOngoing(true).setContentIntent(open).setPriority(Notification.PRIORITY_MAX);
        if (call.getState() == Call.STATE_RINGING) builder.setFullScreenIntent(open, true);
        try { manager.notify(710, builder.build()); }
        catch (SecurityException denied) { /* Android permission settings can change while a call is active. */ }
    }
    static String number(Call call) { return call.getDetails() != null && call.getDetails().getHandlePresentation() == android.telecom.TelecomManager.PRESENTATION_ALLOWED
            && call.getDetails().getHandle() != null ? call.getDetails().getHandle().getSchemeSpecificPart() : "Private number"; }
    @Override public void onDestroy() { for (Call c : active) c.unregisterCallback(callback); active.clear(); service = null; audio = null;
        for (Runnable observer : observers) observer.run(); super.onDestroy(); }
}
