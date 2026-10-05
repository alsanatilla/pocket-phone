package org.textphone.launcher;

import android.Manifest;
import android.app.AlertDialog;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.widget.EditText;
import android.widget.TextView;
import java.text.DateFormat;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/** Park a thought for later. When it comes back you clear it, move it to Today, park it again or let it go. */
public final class ParkingActivity extends PocketActivity {
    private EditText field;

    @Override protected void onCreate(Bundle state) { super.onCreate(state); render(state == null ? prefs().getString("draft", "") : state.getString("draft", "")); }
    @Override protected void onResume() { super.onResume(); ParkingReceiver.clearNotice(this); render(field == null ? "" : field.getText().toString()); }
    @Override protected void onCloudSynced() { ParkingReceiver.arm(this); render(field == null ? "" : field.getText().toString()); }
    @Override protected void onPause() { if (field != null) prefs().edit().putString("draft", field.getText().toString()).apply(); super.onPause(); }
    @Override protected void onSaveInstanceState(Bundle out) { if (field != null) out.putString("draft", field.getText().toString()); super.onSaveInstanceState(out); }
    private android.content.SharedPreferences prefs() { return getSharedPreferences("pocket_parking_ui", 0); }

    private void render(String draft) {
        screen("parking");
        field = input("park a thought…", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES); field.setTag("parking_input");
        field.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(200)});
        field.setText(draft); field.setSelection(field.length());
        body.addView(label("back in", PocketDesign.META, GRAY));
        Runnable[] delays = new Runnable[ParkingStore.DELAYS.length];
        for (int i = 0; i < delays.length; i++) { String delay = ParkingStore.DELAYS[i]; delays[i] = () -> park(delay); }
        keys(new String[]{"1h", "tonight", "tmrw", "next wk"}, delays).setTag("parking_delays");

        long now = System.currentTimeMillis(); List<ParkingStore.Item> back = new ArrayList<>(), waiting = new ArrayList<>();
        for (ParkingStore.Item item : ParkingStore.open(this)) (item.back(now) ? back : waiting).add(item);
        if (back.isEmpty() && waiting.isEmpty()) {
            body.addView(label("Nothing parked. Type a thought, then choose when it should come back.", PocketDesign.SMALL, GRAY));
            return;
        }
        if (!back.isEmpty()) {
            TextView heading = label("BACK NOW [" + back.size() + "]", PocketDesign.META, PocketDesign.accent(this)); heading.setTag("parking_back"); body.addView(heading);
            for (ParkingStore.Item item : back) backItem(item, now);
        }
        if (!waiting.isEmpty()) {
            body.addView(label("PARKED [" + waiting.size() + "]", PocketDesign.META, GRAY));
            for (ParkingStore.Item item : waiting) action(item.text + "\nback " + relative(item.due, now) + (item.notches > 0 ? "  " + ParkingStore.meter(item.notches) : "") + from(item),
                    () -> waitingItem(item)).setTag("parked_" + item.id);
        }
    }
    private void backItem(ParkingStore.Item item, long now) {
        TextView title = label(item.text, PocketDesign.BODY, WHITE); title.setTag("back_" + item.id); body.addView(title);
        String since = ParkingStore.days(item, now) == 0 ? "today" : ParkingStore.days(item, now) + "d ago";
        body.addView(label(ParkingStore.meter(item.notches) + "  parked " + (item.notches + 1) + "× · first " + since, PocketDesign.META, GRAY));
        String heckle = ParkingStore.heckle(item, now);
        if (!heckle.isEmpty()) { TextView nag = label(heckle, PocketDesign.META, PocketDesign.WARNING); nag.setTag("heckle_" + item.id); body.addView(nag); }
        if (note(item) != null) { TextView source = label("from note · " + noteTitle(note(item)), PocketDesign.META, PocketDesign.accent(this)); PocketDesign.quiet(source, PocketDesign.accent(this)); source.setOnClickListener(v -> openNote(item)); source.setTag("note_" + item.id); body.addView(source); }
        keys(new String[]{"clear", "today", "park", "let go"}, () -> clear(item), () -> toToday(item), () -> repark(item), () -> letGo(item));
    }
    /** The note a thought was written in, if it still exists on this phone. */
    private PlannerStore.Entry note(ParkingStore.Item item) { return item.note.isEmpty() ? null : NoteSync.byUid(planner(), item.note); }
    private PlannerStore planner() { return new PlannerStore(getSharedPreferences("pocket_planner", 0)); }
    static String noteTitle(PlannerStore.Entry note) {
        for (String line : note.text.split("\n")) if (!line.trim().isEmpty())
            return line.replaceFirst("^\\s*(#+|>>)\\s*", "").replaceFirst("(?i)\\s+@(1h|tonight|tomorrow|tmrw|nextweek)\\s*$", "").trim();
        return "note";
    }
    private String from(ParkingStore.Item item) { PlannerStore.Entry note = note(item); return note == null ? "" : "  · " + noteTitle(note); }
    private void openNote(ParkingStore.Item item) {
        PlannerStore.Entry note = note(item); if (note == null) { message("The note is not on this phone."); return; }
        startActivity(new Intent(this, OrganizerActivity.class).putExtra("pocket_note", note.id).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    }
    private void waitingItem(ParkingStore.Item item) {
        new AlertDialog.Builder(this).setTitle(item.text).setItems(note(item) == null ? new String[]{"Bring back now", "Clear", "Move to Today", "Let go"} : new String[]{"Bring back now", "Clear", "Move to Today", "Let go", "Open note"}, (d, which) -> safely(() -> {
            if (which == 0) { ParkingStore.bringBack(this, item.id); ParkingReceiver.arm(this); refresh(""); }
            else if (which == 1) clear(item); else if (which == 2) toToday(item); else if (which == 3) letGo(item); else openNote(item);
        })).setNegativeButton("Cancel", null).show();
    }

    private void park(String delay) {
        long due = ParkingStore.when(delay, System.currentTimeMillis());
        ParkingStore.Item item = ParkingStore.park(this, field.getText().toString(), due);
        ReceiptTape.log(this, ReceiptTape.PARK, item.text);
        field.setText(""); prefs().edit().remove("draft").apply(); ParkingReceiver.arm(this);
        refresh("Parked until " + relative(due, System.currentTimeMillis()) + ".");
        if (Build.VERSION.SDK_INT >= 33 && !permitted(Manifest.permission.POST_NOTIFICATIONS) && !prefs().getBoolean("asked_notifications", false)) {
            prefs().edit().putBoolean("asked_notifications", true).apply();
            permissions(() -> message("It will come back as a notification."), Manifest.permission.POST_NOTIFICATIONS);
        }
    }
    private void repark(ParkingStore.Item item) {
        new AlertDialog.Builder(this).setTitle("Park again").setItems(ParkingStore.DELAYS, (d, which) -> safely(() -> {
            ParkingStore.Item again = ParkingStore.repark(this, item.id, ParkingStore.when(ParkingStore.DELAYS[which], System.currentTimeMillis()));
            ReceiptTape.log(this, ReceiptTape.PARK, again.text + " (" + (again.notches + 1) + "×)"); ParkingReceiver.arm(this);
            refresh(again.notches >= ParkingStore.HECKLE ? "Parked. Again." : "Parked until " + relative(again.due, System.currentTimeMillis()) + ".");
        })).setNegativeButton("Cancel", null).show();
    }
    private void clear(ParkingStore.Item item) {
        ParkingStore.close(this, item.id, ParkingStore.CLEARED); ReceiptTape.log(this, ReceiptTape.CLEAR, item.text); ParkingReceiver.arm(this);
        refresh("Cleared. Nice.");
    }
    private void toToday(ParkingStore.Item item) {
        new PlannerStore(getSharedPreferences("pocket_planner", 0)).captureTask(item.text, null);
        ParkingStore.close(this, item.id, ParkingStore.TASK); ReceiptTape.log(this, ReceiptTape.TASK, item.text); ParkingReceiver.arm(this);
        refresh("Moved to Today.");
    }
    private void letGo(ParkingStore.Item item) {
        ParkingStore.close(this, item.id, ParkingStore.KILLED); ReceiptTape.log(this, ReceiptTape.KILL, item.text); ParkingReceiver.arm(this);
        refresh(item.notches >= ParkingStore.HECKLE ? "Let go. That was overdue." : "Let go.");
    }
    private void refresh(String notice) { render(field == null ? "" : field.getText().toString()); message(notice); }

    static String relative(long due, long now) {
        long minutes = Math.max(0, (due - now + 59_999) / 60_000);
        if (minutes < 60) return minutes <= 1 ? "now" : "in " + minutes + " min";
        Calendar day = Calendar.getInstance(); day.setTimeInMillis(now);
        String time = DateFormat.getTimeInstance(DateFormat.SHORT).format(new Date(due));
        if (sameDay(day, due)) return "today " + time;
        day.add(Calendar.DAY_OF_MONTH, 1);
        if (sameDay(day, due)) return "tomorrow " + time;
        return new SimpleDateFormat("EEE d MMM", Locale.getDefault()).format(new Date(due)) + " " + time;
    }
    private static boolean sameDay(Calendar day, long when) {
        Calendar other = Calendar.getInstance(); other.setTimeInMillis(when);
        return day.get(Calendar.YEAR) == other.get(Calendar.YEAR) && day.get(Calendar.DAY_OF_YEAR) == other.get(Calendar.DAY_OF_YEAR);
    }
    /** Dialog choices run outside the shared button guard; an item cleared elsewhere only shows a notice. */
    private void safely(Runnable action) {
        if (closed) return;
        try { action.run(); } catch (IllegalArgumentException | IllegalStateException error) { refresh(error.getMessage() == null ? "Could not complete this action." : error.getMessage()); }
    }
}
