package org.textphone.launcher;

import android.Manifest;
import android.app.role.RoleManager;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.CallLog;
import android.telecom.PhoneAccountHandle;
import android.telecom.TelecomManager;
import android.telephony.TelephonyManager;
import android.text.InputType;
import android.widget.EditText;
import android.widget.LinearLayout;
import java.util.ArrayList;
import java.util.List;

public final class PhoneActivity extends PocketActivity {
    private EditText number;
    private boolean history;
    private android.widget.Button callControl;
    private PendingCall pendingCall;
    private static final class PendingCall { final EditText editor; boolean handed; PendingCall(EditText editor) { this.editor = editor; } }
    @Override protected void onCreate(Bundle state) { super.onCreate(state); dialpad();
        String initial = state == null ? getIntent().getStringExtra("number") : state.getString("number");
        if (initial == null && getIntent().getData() != null && "tel".equals(getIntent().getData().getScheme())) initial = getIntent().getData().getSchemeSpecificPart();
        if (initial != null) {number.setText(initial);number.setSelection(number.length());}
        if (state != null && state.getBoolean("history")) callHistory();
    }
    @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); if (intent.getData() == null && !intent.hasExtra("number")) return; dialpad();
        if (intent.getData() != null) number.setText(intent.getData().getSchemeSpecificPart());
        else if (intent.hasExtra("number")) number.setText(intent.getStringExtra("number"));number.setSelection(number.length()); }
    static boolean isDefault(android.content.Context context) { TelecomManager telecom = context.getSystemService(TelecomManager.class);
        return telecom != null && context.getPackageName().equals(telecom.getDefaultDialerPackage()); }
    private void chooseDefault() {
        if (Build.VERSION.SDK_INT >= 29) { RoleManager role = getSystemService(RoleManager.class);
            if (role != null && role.isRoleAvailable(RoleManager.ROLE_DIALER)) { startActivityForResult(role.createRequestRoleIntent(RoleManager.ROLE_DIALER), 501); return; } }
        startActivityForResult(new Intent(TelecomManager.ACTION_CHANGE_DEFAULT_DIALER)
                .putExtra(TelecomManager.EXTRA_CHANGE_DEFAULT_DIALER_PACKAGE_NAME, getPackageName()), 501);
    }
    private void dialpad() { cancelCall(); String previous = number == null ? "" : number.getText().toString(); history = false; screen("phone");
        number = input("Number", InputType.TYPE_CLASS_PHONE); number.setTag("phone_number"); number.setText(previous);
        number.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(80)});number.setTextSize(PocketDesign.typeSize(this,32));number.setSelection(number.length());
        String[] digits = {"1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"};
        for (int r = 0; r < 12; r += 3) { LinearLayout row = row(); for (int c = 0; c < 3; c++) {
            String key = digits[r + c]; android.widget.Button b = button(key, () -> {
                int start = Math.max(0, number.getSelectionStart()), end = Math.max(start, number.getSelectionEnd());
                number.getText().replace(start, end, key); });
            if ("0".equals(key)) b.setOnLongClickListener(v -> { insertPlus(); return true; });
            PocketDesign.text(b, PocketDesign.SECTION, WHITE);
            b.setGravity(android.view.Gravity.CENTER);
            LinearLayout.LayoutParams keyLayout = new LinearLayout.LayoutParams(0, dp(52), 1); if (c > 0) keyLayout.leftMargin = dp(4); row.addView(b, keyLayout); }
            LinearLayout.LayoutParams digitRow = new LinearLayout.LayoutParams(-1, -2); digitRow.bottomMargin = dp(4); body.addView(row, digitRow); }
        LinearLayout controls = keys(new String[]{"+", "⌫", "call"}, this::insertPlus, () -> {
            int start = Math.max(0, number.getSelectionStart()), end = Math.max(start, number.getSelectionEnd());
            if (start == end && start > 0) start--; number.getText().delete(start, end);
        }, this::call);
        callControl = (android.widget.Button) controls.getChildAt(2);
        PocketDesign.primary(callControl);
        keys(new String[]{"history", "contacts"}, this::callHistory, () -> startActivity(new Intent(this, ContactsActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)));
        appSettings(this::phoneSettings);
        if (!PocketCalls.calls().isEmpty()) action("current call", () -> startActivity(new Intent(this, InCallActivity.class)));
    }
    private void insertPlus(){int start=Math.max(0,number.getSelectionStart()),end=Math.max(start,number.getSelectionEnd());number.getText().replace(start,end,"+");}
    private void phoneSettings(){new android.app.AlertDialog.Builder(this).setTitle("Phone settings").setItems(new String[]{"Use Pocket for calls","Allow incoming-call alerts","Android app settings"},(dialog,index)->{if(index==0)chooseDefault();else if(index==1&&Build.VERSION.SDK_INT>=33)permissions(()->message("Call alerts allowed."),Manifest.permission.POST_NOTIFICATIONS);else NotificationAccess.appInfo(this);}).setNegativeButton("Close",null).show();}
    private void call() {
        if (pendingCall != null) return;
        String dial = number.getText().toString().replaceAll("[\\s().-]", "");
        if (!dial.matches("[+0-9*#]{1,80}")) throw new IllegalArgumentException("Enter a phone number.");
        TelecomManager telecom = getSystemService(TelecomManager.class);
        boolean emergency = "112".equals(dial) || "110".equals(dial) || "911".equals(dial);
        if (Build.VERSION.SDK_INT >= 29) try { TelephonyManager manager = getSystemService(TelephonyManager.class);
            if (manager != null) emergency |= manager.isEmergencyNumber(dial); } catch (SecurityException ignored) { /* Known local emergency numbers still use the system dialer. */ }
        Uri uri = Uri.fromParts("tel", dial, null);
        if (emergency) { Intent intent = new Intent(Intent.ACTION_DIAL, uri);
            if (telecom != null && Build.VERSION.SDK_INT >= 29) intent.setPackage(telecom.getSystemDialerPackage());
            else for (android.content.pm.ResolveInfo match : getPackageManager().queryIntentActivities(intent, 0)) {
                if (!getPackageName().equals(match.activityInfo.packageName) && (match.activityInfo.applicationInfo.flags & android.content.pm.ApplicationInfo.FLAG_SYSTEM) != 0) { intent.setPackage(match.activityInfo.packageName); break; }
            }
            if (intent.getPackage() == null) { message("System emergency dialer unavailable."); return; }
            startActivity(intent); return; }
        if (!isDefault(this)) { message("Choose Pocket as the phone app first."); chooseDefault(); return; }
        if (PocketCalls.primary() != null) { startActivity(new Intent(this, InCallActivity.class)); return; }
        PendingCall request = new PendingCall(number); pendingCall = request; callControl.setEnabled(false);
        permissions(() -> {
            if (!currentCall(request)) return;
            if (telecom == null) { cancelCall(); message("Calling is unavailable."); return; }
            try {
            List<PhoneAccountHandle> accounts = telecom.getCallCapablePhoneAccounts();
            if (accounts.size() < 2) { placeCall(telecom, uri, new Bundle(), request); return; }
            String[] labels = new String[accounts.size()]; for (int i = 0; i < labels.length; i++) {
                android.telecom.PhoneAccount account = telecom.getPhoneAccount(accounts.get(i)); labels[i] = account == null ? "SIM " + (i + 1) : account.getLabel().toString(); }
            new android.app.AlertDialog.Builder(this).setTitle("Call with").setItems(labels, (d, which) -> {
                Bundle extras = new Bundle(); extras.putParcelable(TelecomManager.EXTRA_PHONE_ACCOUNT_HANDLE, accounts.get(which));
                placeCall(telecom, uri, extras, request);
            }).setNegativeButton("Cancel", null).setOnDismissListener(dialog -> { if (pendingCall == request && !request.handed) cancelCall(); }).show();
            } catch (SecurityException denied) { cancelCall(); message("Phone access was denied. Review Android permissions and try again."); }
            catch (RuntimeException e) { cancelCall(); message("Android could not start the call. Check phone access and try again."); }
        }, Manifest.permission.CALL_PHONE, Manifest.permission.READ_PHONE_STATE);
    }
    private boolean currentCall(PendingCall request) { return !closed && pendingCall == request && request.editor == number && !history; }
    private void cancelCall() { pendingCall = null; if (callControl != null) callControl.setEnabled(true); }
    private void placeCall(TelecomManager telecom, Uri uri, Bundle extras, PendingCall request) {
        if (!currentCall(request)) return;
        if (!isDefault(this) || !permitted(Manifest.permission.CALL_PHONE)) { cancelCall(); message("Call access changed. Tap call again after reviewing permissions."); return; }
        try { telecom.placeCall(uri, extras); request.handed = true; message("Calling…"); ui.postDelayed(() -> { if (pendingCall == request) cancelCall(); }, 2500); }
        catch (SecurityException denied) { cancelCall(); message("Phone access changed. Review Android permissions and try again."); }
        catch (RuntimeException error) { cancelCall(); message("Android could not start the call. Try again."); }
    }
    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code == 410) { boolean granted = results.length > 0; for (int result : results) granted &= result == android.content.pm.PackageManager.PERMISSION_GRANTED; if (!granted) cancelCall(); }
    }
    @Override protected void onStop() { if (pendingCall != null && !pendingCall.handed) cancelCall(); super.onStop(); }
    private void callHistory() { cancelCall(); history = true; screen("call history");
        if (!permitted(Manifest.permission.READ_CALL_LOG)) {
            body.addView(label("Read recent incoming, outgoing and missed numbers from Android's call history. No audio recording.", 14, GRAY));
            action("Allow call history", () -> permissions(this::callHistory, Manifest.permission.READ_CALL_LOG)); return; }
        loadPage(() -> { List<String[]> rows = new ArrayList<>(); try (Cursor c = getContentResolver().query(CallLog.Calls.CONTENT_URI,
                new String[]{"number", "name", "date", "type"}, null, null, "date DESC")) {
            if (c != null) while (c.moveToNext() && rows.size() < 100) rows.add(new String[]{c.getString(0), c.getString(1),
                    java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.SHORT, java.text.DateFormat.SHORT).format(new java.util.Date(c.getLong(2))),
                    c.getInt(3) == CallLog.Calls.MISSED_TYPE ? "missed" : c.getInt(3) == CallLog.Calls.OUTGOING_TYPE ? "outgoing" : "incoming"});
        } return rows; }, rows -> { if (!history) return; if (rows.isEmpty()) body.addView(label("No calls", 14, GRAY));
            for (String[] item : rows) { action((item[1] == null ? item[0] : item[1]) + "\n" + item[3] + " · " + item[2], () -> { dialpad(); number.setText(item[0]); }); }
        });
    }
    @Override protected void onActivityResult(int request, int result, Intent data) { super.onActivityResult(request, result, data); if (request == 501) dialpad(); }
    @Override protected void onSaveInstanceState(Bundle out) { out.putBoolean("history", history); if (number != null) out.putString("number", number.getText().toString()); super.onSaveInstanceState(out); }
    @Override protected boolean hasInternalBack() { return history; }
    @Override public void onBackPressed() { if (history) back(this::dialpad); else super.onBackPressed(); }
}
