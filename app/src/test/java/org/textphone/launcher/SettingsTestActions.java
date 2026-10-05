package org.textphone.launcher;

import android.app.Activity;
import android.app.AlertDialog;
import android.view.View;
import org.robolectric.shadows.ShadowAlertDialog;
import static org.junit.Assert.*;

final class SettingsTestActions {
    static AlertDialog open(Activity activity){View button=activity.findViewById(android.R.id.content).findViewWithTag("app_settings");assertNotNull("App settings button",button);button.performClick();AlertDialog dialog=ShadowAlertDialog.getLatestAlertDialog();assertNotNull(dialog);return dialog;}
    static void choose(Activity activity,String label){item(open(activity),label);}
    static void item(AlertDialog dialog,String label){for(int i=0;i<dialog.getListView().getCount();i++)if(label.equals(dialog.getListView().getAdapter().getItem(i).toString())){dialog.getListView().performItemClick(null,i,i);return;}fail("Missing menu item: "+label);}
    private SettingsTestActions(){}
}
