package org.textphone.launcher;

import android.app.Activity;

/** Pocket's own apps that a dashboard tile or tile group can open. Ids are stored, so never rename one. */
final class PocketApps {
    static final String[] IDS = {"phone", "messages", "contacts", "clock", "camera", "calculator",
            "files", "today", "settings", "dice", "parking", "receipt", "journal", "movement"};
    static final int GROUP_ICON = 14, APP_ICON = 18;

    static boolean known(String id) { for (String value : IDS) if (value.equals(id)) return true; return false; }
    static String label(String id) { return known(id) ? id : "app"; }
    static int icon(String id) {
        switch (id == null ? "" : id) {
            case "phone": return 9;
            case "messages": return 2;
            case "contacts": return 3;
            case "clock": return 10;
            case "camera": return 7;
            case "calculator": return 11;
            case "files": return 12;
            case "today": return 13;
            case "settings": return 5;
            case "dice": return 15;
            case "parking": return 16;
            case "receipt": return 17;
            case "journal": return 19;
            case "movement": return 13;
            default: return APP_ICON;
        }
    }
    /** Settings is a page of the dashboard activity and has no class of its own. */
    static Class<? extends Activity> activity(String id) {
        switch (id == null ? "" : id) {
            case "phone": return PhoneActivity.class;
            case "messages": return ChatsActivity.class;
            case "contacts": return ContactsActivity.class;
            case "clock": return ClockActivity.class;
            case "camera": return CompactCameraActivity.class;
            case "calculator": return CalculatorActivity.class;
            case "files": return FilesActivity.class;
            case "today": return OrganizerActivity.class;
            case "dice": return DiceActivity.class;
            case "parking": return ParkingActivity.class;
            case "receipt": return ReceiptActivity.class;
            case "journal": return JournalActivity.class;
            case "movement": return MovementActivity.class;
            default: return null;
        }
    }
    private PocketApps() { }
}
