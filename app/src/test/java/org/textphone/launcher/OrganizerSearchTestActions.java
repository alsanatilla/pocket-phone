package org.textphone.launcher;

import android.widget.EditText;
import static org.junit.Assert.*;

final class OrganizerSearchTestActions {
    static EditText open(MainActivity activity){EditText field=activity.findViewById(android.R.id.content).findViewWithTag("workspace_search");if(field==null){activity.findViewById(android.R.id.content).findViewWithTag("today_search").performClick();field=activity.findViewById(android.R.id.content).findViewWithTag("workspace_search");}assertNotNull(field);return field;}
    static void find(MainActivity activity,String text){open(activity).setText(text);org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle();}
}
