package org.textphone.launcher;

import android.app.AlertDialog;
import android.widget.EditText;
import org.robolectric.shadows.ShadowAlertDialog;
import static org.junit.Assert.*;

final class OrganizerSearchTestActions {
    static AlertDialog open(MainActivity activity){activity.findViewById(android.R.id.content).findViewWithTag("today_search").performClick();AlertDialog dialog=ShadowAlertDialog.getLatestAlertDialog();assertNotNull(dialog.findViewById(android.R.id.content).findViewWithTag("organizer_search"));return dialog;}
    static void find(MainActivity activity,String text){AlertDialog dialog=open(activity);((EditText)dialog.findViewById(android.R.id.content).findViewWithTag("organizer_search")).setText(text);dialog.getButton(AlertDialog.BUTTON_POSITIVE).performClick();org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle();}
}
