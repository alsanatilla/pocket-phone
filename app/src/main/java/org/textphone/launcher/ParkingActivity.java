package org.textphone.launcher;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

/**
 * Old Parking tiles, shortcuts and notifications open the Thoughts tab of the shared workspace.
 */
public final class ParkingActivity extends Activity {
    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        ParkingReceiver.arm(this); ParkingReceiver.clearNotice(this);
        startActivity(new Intent(this, OrganizerActivity.class).putExtra("workspace_tab", "thoughts").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        finish(); overridePendingTransition(0, 0);
    }
}
