package org.textphone.launcher;

import android.app.AlertDialog;
import android.content.SharedPreferences;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Bundle;
import android.os.SystemClock;
import android.text.InputType;
import android.view.Gravity;
import android.view.HapticFeedbackConstants;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;

/** Dice, a d20, a coin and a picker for your own lists. Shake the phone or tap to roll. */
public final class DiceActivity extends PocketActivity implements SensorEventListener {
    static final String[] MODES = {"dice", "d20", "coin", "pick"};
    private static final int SHUFFLE_FRAMES = 7, HISTORY = 8;
    private final SecureRandom random = new SecureRandom();
    private TextView result, detail;
    private Button roll;
    private SensorManager sensors;
    private long lastShake;
    private int shuffling;
    private final Runnable shuffle = new Runnable() { @Override public void run() { if (closed) return;
        if (shuffling-- > 0) { result.setText(face(preview())); ui.postDelayed(this, 55); } else finishRoll(); } };

    @Override protected void onCreate(Bundle state) { super.onCreate(state); sensors = getSystemService(SensorManager.class); render(); }
    @Override protected void onResume() { super.onResume(); listen(); }
    private void listen() { if (sensors == null) return; sensors.unregisterListener(this);
        Sensor motion = sensors == null ? null : sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
        if (motion != null && prefs().getBoolean("shake", true)) sensors.registerListener(this, motion, SensorManager.SENSOR_DELAY_UI); }
    @Override protected void onPause() { if (sensors != null) sensors.unregisterListener(this); ui.removeCallbacks(shuffle); if (shuffling > 0) { shuffling = 0; finishRoll(); } super.onPause(); }
    private SharedPreferences prefs() { return getSharedPreferences("pocket_dice", 0); }
    private String mode() { String mode = prefs().getString("mode", "dice"); for (String m : MODES) if (m.equals(mode)) return mode; return "dice"; }
    private int count() { return Math.max(1, Math.min(5, prefs().getInt("count", 2))); }
    private List<String> choices() {
        List<String> values = new ArrayList<>();
        for (String line : prefs().getString("list", "").split("\n")) if (!line.trim().isEmpty()) values.add(line.trim());
        return values;
    }

    private void render() {
        screen("dice"); appSettings(this::settings);
        LinearLayout modes = keys(new String[]{"dice", "d20", "coin", "pick"}, () -> mode("dice"), () -> mode("d20"), () -> mode("coin"), () -> mode("pick"));
        for (int i = 0; i < MODES.length; i++) { modes.getChildAt(i).setSelected(MODES[i].equals(mode())); modes.getChildAt(i).setTag("dice_mode_" + MODES[i]); }
        result = label(prefs().getString("last_face", "?"), "pick".equals(mode()) ? PocketDesign.TITLE : PocketDesign.DISPLAY, WHITE);
        result.setTypeface(PocketFonts.pixel(this)); result.setGravity(Gravity.CENTER); result.setMinHeight(dp(140)); result.setMaxLines(3);
        result.setTag("dice_result"); body.addView(result, new LinearLayout.LayoutParams(-1, -2));
        detail = label(prefs().getString("last_detail", ""), PocketDesign.SMALL, GRAY); detail.setGravity(Gravity.CENTER); detail.setTag("dice_detail");
        body.addView(detail, new LinearLayout.LayoutParams(-1, -2));
        if ("dice".equals(mode())) {
            LinearLayout amount = keys(new String[]{"−", count() + (count() == 1 ? " die" : " dice"), "+"},
                    () -> setCount(count() - 1), () -> { }, () -> setCount(count() + 1));
            amount.getChildAt(1).setEnabled(false); amount.getChildAt(1).setTag("dice_count");
        } else if ("pick".equals(mode())) {
            List<String> choices = choices();
            action(choices.isEmpty() ? "Add things to pick from" : "From " + choices.size() + ": " + android.text.TextUtils.join(", ", choices), this::editList).setTag("dice_list");
        }
        roll = action("coin".equals(mode()) ? "flip" : "pick".equals(mode()) ? "pick one" : "roll", this::roll);
        roll.setTag("dice_roll"); PocketDesign.primary(roll); roll.setGravity(Gravity.CENTER);
        Sensor motion = sensors == null ? null : sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
        if (motion != null && prefs().getBoolean("shake", true)) { TextView hint = label("or shake the phone", PocketDesign.META, GRAY); hint.setGravity(Gravity.CENTER); body.addView(hint, new LinearLayout.LayoutParams(-1, -2)); }
        List<String> history = history();
        if (!history.isEmpty()) {
            body.addView(label("LAST", PocketDesign.META, GRAY));
            TextView past = label(android.text.TextUtils.join("\n", history), PocketDesign.SMALL, GRAY); past.setTag("dice_history"); body.addView(past);
        }
    }
    private void mode(String mode) { if (!mode.equals(mode())) { prefs().edit().putString("mode", mode).remove("last_face").remove("last_detail").apply(); render(); } }
    private void setCount(int count) { prefs().edit().putInt("count", Math.max(1, Math.min(5, count))).apply(); render(); }
    private void editList() {
        EditText list = new EditText(this); list.setTag("dice_list_editor"); PocketDesign.input(list);
        list.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        list.setMinLines(4); list.setGravity(Gravity.TOP | Gravity.START); list.setHint("One per line: sushi, pizza, tacos…");
        list.setText(prefs().getString("list", ""));
        new AlertDialog.Builder(this).setTitle("Pick from").setView(list).setNegativeButton("Cancel", null)
                .setPositiveButton("Save", (d, w) -> { if (!closed) { prefs().edit().putString("list", list.getText().toString()).apply(); render(); } }).show();
    }
    private void settings() {
        boolean shake = prefs().getBoolean("shake", true);
        new AlertDialog.Builder(this).setTitle("Dice settings").setItems(new String[]{"Shake to roll · " + (shake ? "on" : "off"), "Clear history"}, (d, which) -> {
            if (closed) return;
            if (which == 0) { prefs().edit().putBoolean("shake", !shake).apply(); listen(); render(); }
            else { prefs().edit().remove("history").apply(); render(); }
        }).show();
    }

    private void roll() {
        if (shuffling > 0) return;
        if ("pick".equals(mode()) && choices().size() < 2) { message("Add at least two things to pick from."); editList(); return; }
        result.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY);
        if (!PageMotion.enabled(this)) { finishRoll(); return; }
        shuffling = SHUFFLE_FRAMES; ui.post(shuffle);
    }
    private int[] preview() {
        switch (mode()) {
            case "d20": return new int[]{random.nextInt(20) + 1};
            case "coin": return new int[]{random.nextInt(2)};
            case "pick": return new int[]{random.nextInt(Math.max(1, choices().size()))};
            default: int[] faces = new int[count()]; for (int i = 0; i < faces.length; i++) faces[i] = random.nextInt(6) + 1; return faces;
        }
    }
    private String face(int[] values) {
        switch (mode()) {
            case "d20": return String.valueOf(values[0]);
            case "coin": return values[0] == 0 ? "HEADS" : "TAILS";
            case "pick": List<String> choices = choices(); return choices.isEmpty() ? "?" : choices.get(values[0] % choices.size());
            default: StringBuilder out = new StringBuilder(); for (int value : values) { if (out.length() > 0) out.append(' '); out.append(value); } return out.toString();
        }
    }
    private void finishRoll() {
        shuffling = 0; int[] values = preview(); String face = face(values), note = "", log;
        switch (mode()) {
            case "d20": note = values[0] == 20 ? "NAT 20!" : values[0] == 1 ? "critical fail" : ""; log = "d20 → " + face; break;
            case "coin": log = "coin → " + face; break;
            case "pick": note = "out of " + choices().size(); log = "pick → " + face; break;
            default:
                int total = 0; for (int value : values) total += value;
                note = values.length > 1 ? "total " + total : ""; log = values.length + "d6 → " + face + (values.length > 1 ? " = " + total : "");
        }
        result.setText(face); detail.setText(note);
        prefs().edit().putString("last_face", face).putString("last_detail", note).apply();
        remember(log); ReceiptTape.log(this, ReceiptTape.ROLL, log);
        TextView past = body.findViewWithTag("dice_history"); if (past != null) past.setText(android.text.TextUtils.join("\n", history()));
        else render();
    }
    private List<String> history() {
        List<String> values = new ArrayList<>();
        try { JSONArray array = new JSONArray(prefs().getString("history", "[]")); for (int i = 0; i < array.length(); i++) values.add(array.getString(i)); }
        catch (JSONException ignored) { /* History is only a convenience. */ }
        return values;
    }
    private void remember(String entry) {
        JSONArray next = new JSONArray().put(entry); List<String> old = history();
        for (int i = 0; i < Math.min(HISTORY - 1, old.size()); i++) next.put(old.get(i));
        prefs().edit().putString("history", next.toString()).apply();
    }

    @Override public void onSensorChanged(SensorEvent event) {
        float x = event.values[0], y = event.values[1], z = event.values[2];
        double force = Math.sqrt(x * x + y * y + z * z) / SensorManager.GRAVITY_EARTH;
        long now = SystemClock.elapsedRealtime();
        if (force > 2.6 && now - lastShake > 1200 && roll != null && roll.isEnabled()) { lastShake = now; roll(); }
    }
    @Override public void onAccuracyChanged(Sensor sensor, int accuracy) { }
}
