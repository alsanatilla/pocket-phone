package org.textphone.launcher;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;

public final class RingingActivity extends PocketActivity {
    @Override protected void onCreate(Bundle state) { super.onCreate(state);
        if (Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(true); }
        else getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); renderAlarm();
    }
    @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); renderAlarm(); }
    private void renderAlarm() { screen("alarm");
        body.addView(label(getIntent().getStringExtra("title") == null ? "Alarm" : getIntent().getStringExtra("title"), 26, WHITE));
        android.widget.LinearLayout controls = keys(new String[]{"stop", "+5 min"}, () -> command("STOP"), () -> command("SNOOZE"));
        PocketDesign.primary((android.widget.TextView)controls.getChildAt(0));
        ClockStore.Entry record=ClockStore.find(this,getIntent().getLongExtra("id",0));if(record!=null&&record.task>0)action("Open task",()->{android.app.KeyguardManager keyguard=getSystemService(android.app.KeyguardManager.class);if(keyguard!=null&&keyguard.isDeviceLocked()){message("Unlock the phone to open the task.");return;}startActivity(new Intent(this,OrganizerActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("pocket_task",record.task));});
    }
    private void command(String command) {
        if ("SNOOZE".equals(command) && !AlarmScheduler.allowed(this)) { message("Snooze needs exact-alarm access. The alarm is still ringing; you can stop it."); return; }
        startService(new Intent(this, AlarmService.class).setAction(command)
            .putExtra("id", getIntent().getLongExtra("id", 0)).putExtra("occurrence", getIntent().getLongExtra("occurrence", 0))); finish(); }
}
