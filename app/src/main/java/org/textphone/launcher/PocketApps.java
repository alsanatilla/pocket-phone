package org.textphone.launcher;

import android.app.Activity;

/**
 * Pocket's own apps that a dashboard tile or tile group can open. Ids are stored, so never rename one.
 * Stored ids stay stable while visible labels describe each app's role in the workspace.
 */
final class PocketApps {
    static final String[] IDS = {"phone", "messages", "contacts", "clock", "camera", "calculator",
            "files", "today", "settings", "dice", "parking", "receipt", "journal", "movement", "gym"};
    /** What a tile or group can be set to. */
    static final String[] CHOICES = {"phone", "messages", "contacts", "clock", "camera", "calculator",
            "files", "today", "settings", "dice", "parking", "receipt", "journal", "movement", "gym"};
    /** Pocket apps listed in Tools after the everyday ones. */
    static final String[] TOOLS = {"contacts", "files", "dice", "receipt", "journal", "movement", "gym"};
    static final int GROUP_ICON = 14, APP_ICON = 18;

    static boolean known(String id) { for (String value : IDS) if (value.equals(id)) return true; return false; }
    static String label(String id) { return "parking".equals(id) ? "thoughts" : "files".equals(id) ? "photos" : "journal".equals(id) ? "paper" : "receipt".equals(id) ? "activity" : known(id) ? id : "app"; }
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
            case "parking": return 13;
            case "receipt": return 17;
            case "journal": return 19;
            case "movement": return 13;
            case "gym": return 13;
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
            case "gym": return GymActivity.class;
            default: return null;
        }
    }
    private PocketApps() { }
}
