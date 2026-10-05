package org.textphone.launcher;

import android.os.Build;
import android.os.Bundle;
import android.telecom.Call;
import android.telecom.CallAudioState;
import android.telecom.VideoProfile;
import android.view.WindowManager;
import android.os.PowerManager;
import java.util.List;

public final class InCallActivity extends PocketActivity {
    private final Runnable changed = () -> ui.post(this::renderCall);
    private PowerManager.WakeLock proximity;
    private boolean visible;
    @Override protected void onCreate(Bundle state) { super.onCreate(state);
        if (Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(true); }
        else getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        renderCall(); }
    @Override protected void onStart() { super.onStart(); visible = true; PocketCalls.observers.add(changed); renderCall(); }
    @Override protected void onStop() { visible = false; PocketCalls.observers.remove(changed); releaseProximity(PowerManager.RELEASE_FLAG_WAIT_FOR_NO_PROXIMITY); super.onStop(); }
    @Override protected void onDestroy() { releaseProximity(0); super.onDestroy(); }
    @Override protected void onPause() { for (Call call : PocketCalls.calls()) call.stopDtmfTone(); super.onPause(); }
    private void renderCall() { if (closed) return; Call call = PocketCalls.primary(); screen("call");
        updateProximity(call);
        if (call == null || call.getState() == Call.STATE_DISCONNECTED) { body.addView(label("Call ended", 18, GRAY)); return; }
        body.addView(label(PocketCalls.number(call), 25, WHITE));
        int state = call.getState();
        body.addView(label(state == Call.STATE_RINGING ? "incoming" : state == Call.STATE_ACTIVE ? "connected" : state == Call.STATE_HOLDING ? "on hold" : state == Call.STATE_DISCONNECTING ? "ending" : "connecting", 14, GRAY));
        if (state == Call.STATE_RINGING) keys(new String[]{"answer", "decline"}, () -> call.answer(VideoProfile.STATE_AUDIO_ONLY), () -> call.reject(false, null));
        else {
            keys(new String[]{"mute", "speaker", "end"}, () -> { if (PocketCalls.service != null) PocketCalls.service.setMuted(PocketCalls.audio == null || !PocketCalls.audio.isMuted()); },
                    () -> { if (PocketCalls.service != null) PocketCalls.service.setAudioRoute(PocketCalls.audio != null && PocketCalls.audio.getRoute() == CallAudioState.ROUTE_SPEAKER ? CallAudioState.ROUTE_WIRED_OR_EARPIECE : CallAudioState.ROUTE_SPEAKER); }, call::disconnect);
            if (call.getDetails() != null && call.getDetails().can(Call.Details.CAPABILITY_HOLD)) action(state == Call.STATE_HOLDING ? "resume call" : "hold", () -> { if (state == Call.STATE_HOLDING) call.unhold(); else call.hold(); });
            String[] tones = {"1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"};
            for (int i = 0; i < tones.length; i += 3) { final String a = tones[i], b = tones[i+1], c = tones[i+2];
                keys(new String[]{a, b, c}, () -> tone(call, a), () -> tone(call, b), () -> tone(call, c)); }
            if (PocketCalls.audio != null) message((PocketCalls.audio.isMuted() ? "muted" : "mic on") + " · " + (PocketCalls.audio.getRoute() == CallAudioState.ROUTE_SPEAKER ? "speaker" : "earpiece / headset"));
        }
        for (Call other : PocketCalls.calls()) if (other != call) action("end " + PocketCalls.number(other), other::disconnect);
    }
    private void tone(Call call, String key) { call.playDtmfTone(key.charAt(0)); ui.postDelayed(call::stopDtmfTone, 180); }
    private void updateProximity(Call call) {
        int route = PocketCalls.audio == null ? CallAudioState.ROUTE_EARPIECE : PocketCalls.audio.getRoute();
        boolean ear = visible && call != null && route == CallAudioState.ROUTE_EARPIECE && (call.getState() == Call.STATE_ACTIVE || call.getState() == Call.STATE_DIALING || call.getState() == Call.STATE_CONNECTING);
        PowerManager power = getSystemService(PowerManager.class);
        if (!ear || power == null || !power.isWakeLockLevelSupported(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK)) { releaseProximity(0); return; }
        if (proximity == null) { proximity = power.newWakeLock(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK, "Pocket:call-proximity"); proximity.setReferenceCounted(false); }
        if (!proximity.isHeld()) proximity.acquire();
    }
    private void releaseProximity(int flags) { if (proximity != null && proximity.isHeld()) proximity.release(flags); }
}
