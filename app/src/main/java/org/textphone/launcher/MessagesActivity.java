package org.textphone.launcher;

import android.Manifest;
import android.app.role.RoleManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.ContentObserver;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Telephony;
import android.telephony.SubscriptionInfo;
import android.telephony.SubscriptionManager;
import android.text.InputType;
import android.text.Editable;
import android.text.TextWatcher;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import java.util.List;

public final class MessagesActivity extends PocketActivity {
    private String address = ""; private long thread; private boolean composing; private int generation;
    private EditText recipient, text; private LinearLayout messages; private boolean started, observing, receiverRegistered, resumedOnce;
    private Button sendControl; private PendingSend pendingSend, restoredSend; private android.app.AlertDialog simChoice;
    private LinearLayout inboxRows; private List<MessageBook.Message> inboxValues;
    private static final Object DRAFT_LOCK = new Object();
    private static final class PendingSend {
        final String address, body; final int generation; final EditText editor;
        boolean awaitingPermission, submitted; volatile boolean accepted;
        PendingSend(String address, String body, int generation, EditText editor) { this.address = address; this.body = body; this.generation = generation; this.editor = editor; }
    }
    private final ContentObserver observer = new ContentObserver(ui) { @Override public void onChange(boolean self) { if (composing) readThread(); else inbox(); } };
    private final BroadcastReceiver changed = new BroadcastReceiver() { public void onReceive(Context c, Intent i) { if (composing) readThread(); else inbox(); } };
    static boolean isDefault(Context c) {
        if (Build.VERSION.SDK_INT >= 29) { RoleManager roles = c.getSystemService(RoleManager.class); if (roles != null && roles.isRoleHeld(RoleManager.ROLE_SMS)) return true; }
        return c.getPackageName().equals(Telephony.Sms.getDefaultSmsPackage(c)); }
    @Override protected void onCreate(Bundle state) { super.onCreate(state); address = getIntent().getStringExtra("address"); if (address == null) address = "";
        sharedBody(getIntent());
        if (getIntent().getData() != null) { String uriAddress = getIntent().getData().getSchemeSpecificPart(); int query = uriAddress.indexOf('?'); address = query < 0 ? uriAddress : uriAddress.substring(0, query); }
        if (state != null) { address = state.getString("address", ""); thread = state.getLong("thread"); composing = state.getBoolean("composing"); }
        if (!address.isEmpty() || composing || getIntent().hasExtra("sms_body")) compose(address, thread); else inbox();
    }
    @android.annotation.SuppressLint("UnspecifiedRegisterReceiverFlag") // API 33+ uses NOT_EXPORTED; older Android requires the legacy overload.
    @Override protected void onStart() { super.onStart(); started = true; observeIfAllowed();
        IntentFilter filter = new IntentFilter("org.textphone.launcher.MESSAGES_CHANGED");
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(changed, filter, Context.RECEIVER_NOT_EXPORTED); else registerReceiver(changed, filter); receiverRegistered = true; }
    private void observeIfAllowed() {
        boolean allowed = started && isDefault(this) && permitted(Manifest.permission.READ_SMS);
        if (!allowed && observing) { getContentResolver().unregisterContentObserver(observer); observing = false; }
        if (allowed && !observing) try { getContentResolver().registerContentObserver(Telephony.Sms.CONTENT_URI, true, observer);
            getContentResolver().registerContentObserver(Telephony.Mms.CONTENT_URI, true, observer); observing = true;
        } catch (SecurityException e) { getContentResolver().unregisterContentObserver(observer); message("Android blocked message access. Open app info to review it."); }
    }
    @Override protected void onResume() { super.onResume(); observeIfAllowed(); if (resumedOnce) refreshAccess(); resumedOnce = true; }
    private void refreshAccess() { observeIfAllowed(); draft(); if (composing) { if (text == null || !isDefault(this) || !permitted(Manifest.permission.READ_SMS)) compose(address, thread); else readThread(); } else inbox(); }
    @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent);
        sharedBody(intent);
        if (intent.hasExtra("address") || intent.getData() != null || intent.hasExtra("sms_body")) { String to = intent.getStringExtra("address");
            if (to == null && intent.getData() != null) { to = intent.getData().getSchemeSpecificPart(); int q = to.indexOf('?'); if (q >= 0) to = to.substring(0, q); }
            compose(to, 0);
        } else if (!composing) inbox();
    }
    private void sharedBody(Intent intent) {
        if (Intent.ACTION_SEND.equals(intent.getAction())) { CharSequence body = intent.getCharSequenceExtra(Intent.EXTRA_TEXT); if (body != null) intent.putExtra("sms_body", body.toString()); }
        if (intent.getData() != null) { String raw = intent.getData().getEncodedSchemeSpecificPart(); int q = raw.indexOf('?');
            if (q >= 0) { String body = Uri.parse("pocket://compose/?" + raw.substring(q + 1)).getQueryParameter("body"); if (body != null) intent.putExtra("sms_body", body); }
        }
    }
    @Override protected void onStop() { started = false; if (observing) { getContentResolver().unregisterContentObserver(observer); observing = false; }
        if (receiverRegistered) { unregisterReceiver(changed); receiverRegistered = false; } draft(); super.onStop(); }
    private void defaultSms() {
        if (Build.VERSION.SDK_INT >= 29) { RoleManager roles = getSystemService(RoleManager.class); if (roles != null && roles.isRoleAvailable(RoleManager.ROLE_SMS)) { startActivityForResult(roles.createRequestRoleIntent(RoleManager.ROLE_SMS), 502); return; }
            startActivityForResult(new Intent(android.provider.Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS), 502); return; }
        startActivityForResult(new Intent(Telephony.Sms.Intents.ACTION_CHANGE_DEFAULT).putExtra(Telephony.Sms.Intents.EXTRA_PACKAGE_NAME, getPackageName()), 502);
    }
    private boolean access(){if(!isDefault(this)||!permitted(Manifest.permission.READ_SMS)){releaseVisualHistory();inboxValues=null;body.addView(label("SMS access is off. Open Settings to choose the SMS app and message access.",16,GRAY));return false;}return true;}
    private void smsSettings(){new android.app.AlertDialog.Builder(this).setTitle("SMS settings").setItems(new String[]{"Use Pocket for SMS","Allow messages","Enable message alerts","Open app info"},(dialog,index)->{
        if(index==0)defaultSms();else if(index==1){if(!isDefault(this)){message("Choose Pocket as the SMS app first.");return;}permissions(this::refreshAccess,Manifest.permission.READ_SMS);}
        else if(index==2){if(Build.VERSION.SDK_INT>=33)permissions(()->message("Alerts allowed."),Manifest.permission.POST_NOTIFICATIONS);else NotificationAccess.appInfo(this);}else NotificationAccess.appInfo(this);}).setNegativeButton("Close",null).show();}
    private void inbox() {
        if (!composing && inboxRows != null && isDefault(this) && permitted(Manifest.permission.READ_SMS)) { refreshInbox(); return; }
        cancelPreparation(); draft(); composing = false; screen("messages");appSettings(this::smsSettings); recipient = text = null; messages = null; sendControl = null; restoredSend = null; inboxRows = null; generation++; if (!access()) return;
        keys(new String[]{"+ message", "Refresh"}, () -> compose("", 0), this::refreshInbox);
        inboxRows = new LinearLayout(this); inboxRows.setOrientation(LinearLayout.VERTICAL); body.addView(inboxRows);
        if (inboxValues != null) fillInbox(inboxValues); else inboxRows.addView(label("Loading messages…", 13, GRAY)); refreshInbox();

    }
    private void refreshInbox() {
        if (composing) return;
        if (inboxRows == null || !isDefault(this) || !permitted(Manifest.permission.READ_SMS)) { inboxRows = null; inbox(); return; }
        int current = ++generation;
        load(() -> MessageBook.conversations(this), list -> { if (current != generation || composing) return;
            if (!sameConversations(inboxValues, list)) fillInbox(list); inboxValues = list;
        }, error -> { if (current != generation || composing) return; inboxValues = null; inboxRows.removeAllViews(); releaseVisualHistory();
            inboxRows.addView(label(error instanceof SecurityException ? "Android blocked message access." : "Could not read Android's message store. Tap Refresh to retry.", 14, GRAY));
            inboxRows.addView(button("Open app info", () -> NotificationAccess.appInfo(this)), new LinearLayout.LayoutParams(-1, dp(56))); });
    }
    private void fillInbox(List<MessageBook.Message> values) {
        inboxRows.removeAllViews(); if (values.isEmpty()) inboxRows.addView(label("No saved SMS/MMS. RCS conversations stay in their current app.", 14, GRAY));
        for (MessageBook.Message m : values) inboxRows.addView(item((m.read ? "" : "• ") + m.address + "\n" + (m.text == null ? "MMS" : m.text), () -> compose(m.address, m.thread)), new LinearLayout.LayoutParams(-1, -2));
    }
    private static boolean sameConversations(List<MessageBook.Message> a, List<MessageBook.Message> b) {
        if (a == null || a.size() != b.size()) return false;
        for (int i = 0; i < a.size(); i++) { MessageBook.Message x = a.get(i), y = b.get(i);
            if (x.id != y.id || x.thread != y.thread || x.date != y.date || x.type != y.type || x.read != y.read || !java.util.Objects.equals(x.address, y.address) || !java.util.Objects.equals(x.text, y.text)) return false;
        } return true;
    }
    private void compose(String selected, long id) { cancelPreparation(); draft(); address = selected == null ? "" : selected; thread = id; composing = true; generation++; screen("message", "message:" + address);appSettings(this::smsSettings);
        recipient = text = null; messages = null; sendControl = null; restoredSend = null; inboxRows = null; if (!access()) return;
        recipient = input("Recipient", InputType.TYPE_CLASS_PHONE); recipient.setText(address); recipient.setTag("message_address");
        recipient.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(80)});
        messages = new LinearLayout(this); messages.setOrientation(LinearLayout.VERTICAL); body.addView(messages);
        text = input("Message", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        text.setMinLines(3); text.setTag("message_body"); text.setText(getSharedPreferences("pocket_message_drafts", 0).getString(address, ""));
        text.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(4000)});
        boolean incomingBody = getIntent().hasExtra("sms_body");
        if (incomingBody) { text.setText(getIntent().getStringExtra("sms_body")); getIntent().removeExtra("sms_body"); }
        if (!incomingBody && pendingSend != null && pendingSend.submitted && address.equals(pendingSend.address) && text.getText().toString().equals(pendingSend.body)) restoredSend = pendingSend;
        TextWatcher draftChanges = new TextWatcher() {
            public void beforeTextChanged(CharSequence s, int start, int count, int after) { }
            public void onTextChanged(CharSequence s, int start, int before, int count) { }
            public void afterTextChanged(Editable value) { restoredSend = null; String to = recipient.getText().toString().trim();
                if (!to.equals(address)) { address = to; thread = 0; generation++; messages.removeAllViews(); }
                draft();
            }
        };
        recipient.addTextChangedListener(draftChanges); text.addTextChangedListener(draftChanges);
        LinearLayout controls = row(); sendControl = button("send", this::send); PocketDesign.primary(sendControl); sendControl.setTag("message_send"); updateSendControl();
        controls.addView(sendControl, new LinearLayout.LayoutParams(0, dp(56), 1));
        controls.addView(button("contacts", () -> startActivity(new Intent(this, ContactsActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))), new LinearLayout.LayoutParams(0, dp(56), 1)); body.addView(controls);
        if (thread == 0 && !address.isEmpty()) { int current = generation; String selectedAddress = address;
            load(() -> Telephony.Threads.getOrCreateThreadId(this, selectedAddress), idFound -> { if (current != generation) return; thread = idFound; readThread(); });
        } else readThread();
    }
    private void readThread() { if (!composing || messages == null || thread == 0 || !isDefault(this) || !permitted(Manifest.permission.READ_SMS)) return; int current = generation; long id = thread;
        load(() -> MessageBook.sms(this, id), values -> { if (current != generation || !composing) return; messages.removeAllViews();
            for (int i = values.size() - 1; i >= 0; i--) { MessageBook.Message m = values.get(i);
                String state = sendState(m.type);
                messages.addView(label(state + " · " + java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.SHORT, java.text.DateFormat.SHORT).format(new java.util.Date(m.date)), 11, GRAY));
                String display = m.text == null ? "MMS attachment" : m.text;
                if (display.length() > 8000) display = display.substring(0, 8000) + "…";
                android.widget.TextView view = label(display, 16, m.type == Telephony.Sms.MESSAGE_TYPE_INBOX ? WHITE : YELLOW); messages.addView(view);
                view.setOnLongClickListener(v -> { confirm("Delete this message?", () -> load(() -> {
                    if (m.uri != null) getContentResolver().delete(m.uri, null, null); else MmsInbox.delete(this, m.id); return true;
                }, ignored -> readThread())); return true; });
                if (m.attachment != null) messages.addView(button("open attachment", () -> startActivity(new Intent(this, MessageAttachmentActivity.class).setAction(Intent.ACTION_VIEW).setDataAndType(Uri.parse(m.attachment), m.mime))), new LinearLayout.LayoutParams(-1, dp(48)));
                if (m.retry != null) messages.addView(button("retry MMS", () -> MmsReceiver.download(this, m.retry, m.subscription, m.id)), new LinearLayout.LayoutParams(-1, dp(48)));
            }
            boolean unread = false; for (MessageBook.Message m : values) unread |= !m.read;
            if (unread) load(() -> { android.content.ContentValues read = new android.content.ContentValues(); read.put("read", 1); read.put("seen", 1);
                getContentResolver().update(Telephony.Sms.CONTENT_URI, read, "thread_id = ? AND read = 0", new String[]{Long.toString(id)}); NativeMms.markRead(this, id); MmsInbox.markRead(this, id); return true;
            }, ignored -> { });
        });
    }
    static String sendState(int type) { return type == Telephony.Sms.MESSAGE_TYPE_INBOX ? "received" : type == Telephony.Sms.MESSAGE_TYPE_SENT ? "sent"
            : type == Telephony.Sms.MESSAGE_TYPE_FAILED ? "failed" : type == Telephony.Sms.MESSAGE_TYPE_DRAFT ? "draft"
            : type == Telephony.Sms.MESSAGE_TYPE_OUTBOX || type == Telephony.Sms.MESSAGE_TYPE_QUEUED ? "sending" : "pending"; }
    private void draft() { if (text != null && recipient != null) { address = recipient.getText().toString().trim(); String value = text.getText().toString();
        if (pendingSend != null && pendingSend.accepted && (sameComposer(pendingSend) || restoredComposer(pendingSend)) && value.equals(pendingSend.body)) { clearSubmittedDraft(this, address, value); return; }
        synchronized (DRAFT_LOCK) { android.content.SharedPreferences.Editor saved = getSharedPreferences("pocket_message_drafts", 0).edit();
            if (value.isEmpty()) saved.remove(address); else saved.putString(address, value); saved.apply(); }
    } }
    private static void clearSubmittedDraft(Context context, String address, String value) { synchronized (DRAFT_LOCK) {
        android.content.SharedPreferences drafts = context.getSharedPreferences("pocket_message_drafts", 0);
        if (value.equals(drafts.getString(address, null))) drafts.edit().remove(address).apply();
    } }
    private void updateSendControl() { if (sendControl != null) { sendControl.setEnabled(pendingSend == null); sendControl.setText(pendingSend == null ? "send" : "sending…"); } }
    private boolean sameComposer(PendingSend request) { return composing && request.generation == generation && request.editor == text && recipient != null
            && request.address.equals(recipient.getText().toString().trim()); }
    private boolean restoredComposer(PendingSend request) { return composing && restoredSend == request && recipient != null && text != null && request.address.equals(recipient.getText().toString().trim()); }
    private void releaseSend(PendingSend request) { if (pendingSend == request) { pendingSend = null; updateSendControl(); } }
    private void cancelPreparation() { if (pendingSend != null && !pendingSend.submitted) { PendingSend request = pendingSend; releaseSend(request);
        if (simChoice != null) { simChoice.dismiss(); simChoice = null; } } }
    private void send() { if (pendingSend != null || recipient == null || text == null) return;
        String to = recipient.getText().toString().trim(), bodyText = text.getText().toString();
        if (!to.matches("[+0-9*#(). -]{1,80}")) throw new IllegalArgumentException("Enter a recipient number.");
        if (bodyText.trim().isEmpty()) throw new IllegalArgumentException("Enter a message.");
        draft(); PendingSend request = new PendingSend(to, bodyText, generation, text); pendingSend = request; updateSendControl();
        request.awaitingPermission = !permitted(Manifest.permission.SEND_SMS) || !permitted(Manifest.permission.READ_PHONE_STATE);
        try { permissions(() -> {
            if (pendingSend != request) return; request.awaitingPermission = false;
            if (!sameComposer(request) || !request.body.equals(text.getText().toString())) { releaseSend(request); return; }
            try {
            SubscriptionManager manager = getSystemService(SubscriptionManager.class); List<SubscriptionInfo> sim = manager == null ? null : manager.getActiveSubscriptionInfoList();
            if (sim != null && sim.size() > 1) { String[] labels = new String[sim.size()]; for (int i = 0; i < labels.length; i++) labels[i] = sim.get(i).getDisplayName().toString();
                android.app.AlertDialog choice = new android.app.AlertDialog.Builder(this).setTitle("Send with").setItems(labels, (d, i) -> transmit(request, sim.get(i).getSubscriptionId())).setNegativeButton("Cancel", null).create(); simChoice = choice;
                choice.setOnDismissListener(d -> { if (!request.submitted) releaseSend(request); if (simChoice == choice) simChoice = null; }); choice.show();
            } else transmit(request, Build.VERSION.SDK_INT >= 24 ? SubscriptionManager.getDefaultSmsSubscriptionId() : SubscriptionManager.INVALID_SUBSCRIPTION_ID);
            } catch (SecurityException e) { releaseSend(request); message("SIM access was denied. Your draft is saved."); }
        }, Manifest.permission.SEND_SMS, Manifest.permission.READ_PHONE_STATE);
        } catch (RuntimeException failure) { releaseSend(request); throw failure; }
    }
    private void transmit(PendingSend request, int sim) {
        if (pendingSend != request) return;
        if (!sameComposer(request) || !request.body.equals(text.getText().toString())) { releaseSend(request); message("Message changed. Tap Send again."); return; }
        if (!isDefault(this) || !permitted(Manifest.permission.READ_SMS) || !permitted(Manifest.permission.SEND_SMS)) { releaseSend(request); refreshAccess(); message("Review message permissions. Your draft is saved."); return; }
        request.submitted = true; Context context = getApplicationContext();
        load(() -> { long id = MessageBook.send(context, request.address, request.body, sim); request.accepted = true; clearSubmittedDraft(context, request.address, request.body); return id; }, id -> {
            releaseSend(request);
            if (sameComposer(request) || restoredComposer(request)) { address = request.address; thread = id;
                if (request.body.equals(text.getText().toString())) text.setText(""); readThread(); }
            draft();
            message("Sending…");
        }, error -> { releaseSend(request); draft(); message(error instanceof SecurityException ? "Android blocked sending. Your draft is saved." : "Could not send. Your draft is saved. Tap Send to retry."); });
    }
    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] results) { super.onRequestPermissionsResult(code, permissions, results);
        if (code == 410 && pendingSend != null && pendingSend.awaitingPermission) releaseSend(pendingSend);
    }
    @Override protected void onDestroy() { if (simChoice != null) { simChoice.dismiss(); simChoice = null; } super.onDestroy(); }
    @Override protected void onActivityResult(int request, int result, Intent data) { super.onActivityResult(request, result, data); if (request == 502) {
        if (result == RESULT_OK && isDefault(this) && !permitted(Manifest.permission.READ_SMS)) permissions(this::refreshAccess, Manifest.permission.READ_SMS);
        else refreshAccess(); } }
    @Override protected void onSaveInstanceState(Bundle out) { draft(); out.putString("address", address); out.putLong("thread", thread); out.putBoolean("composing", composing); super.onSaveInstanceState(out); }
    @Override protected boolean hasInternalBack() { return composing; }
    @Override public void onBackPressed() { if (composing) back(this::inbox); else super.onBackPressed(); }
}
