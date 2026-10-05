package org.textphone.launcher;

import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Typeface;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/** The day printed as a till receipt: what Pocket saw you do, totalled at the bottom. */
public final class ReceiptActivity extends PocketActivity {
    static final int PAPER = 0xFFF2EFE6, INK = 0xFF161616, FADED = 0xFF6B675E;
    private long day;

    @Override protected void onCreate(Bundle state) { super.onCreate(state); day = start(state == null ? System.currentTimeMillis() : state.getLong("day", System.currentTimeMillis())); render(); }
    @Override protected void onResume() { super.onResume(); render(); }
    @Override protected void onSaveInstanceState(Bundle out) { out.putLong("day", day); super.onSaveInstanceState(out); }
    static long start(long when) {
        Calendar at = Calendar.getInstance(); at.setTimeInMillis(when);
        at.set(Calendar.HOUR_OF_DAY, 0); at.set(Calendar.MINUTE, 0); at.set(Calendar.SECOND, 0); at.set(Calendar.MILLISECOND, 0);
        return at.getTimeInMillis();
    }
    private boolean today() { return day == start(System.currentTimeMillis()); }
    private boolean twentyFour() { return getSharedPreferences("text_phone", 0).getBoolean("twenty_four_hour", android.text.format.DateFormat.is24HourFormat(this)); }
    private void move(int days) {
        Calendar at = Calendar.getInstance(); at.setTimeInMillis(day); at.add(Calendar.DAY_OF_MONTH, days);
        day = Math.min(start(at.getTimeInMillis()), start(System.currentTimeMillis())); render();
    }

    private void render() {
        screen("receipt"); headerAction("share", this::share, false).setTag("receipt_share");
        LinearLayout days = keys(new String[]{"‹ prev", "today", "next ›"}, () -> move(-1), () -> { day = start(System.currentTimeMillis()); render(); }, () -> move(1));
        days.getChildAt(1).setEnabled(!today()); days.getChildAt(2).setEnabled(!today());
        List<ReceiptTape.Line> lines = ReceiptTape.lines(this, day);

        body.addView(new Edge(this, true), new LinearLayout.LayoutParams(-1, dp(8)));
        LinearLayout paper = new LinearLayout(this); paper.setOrientation(LinearLayout.VERTICAL); paper.setBackgroundColor(PAPER);
        paper.setPadding(dp(14), dp(14), dp(14), dp(18)); paper.setTag("receipt_paper");
        center(paper, "POCKET PHONE", PocketDesign.SECTION, true);
        center(paper, "** DAY RECEIPT **", PocketDesign.SMALL, false);
        center(paper, new SimpleDateFormat("EEE dd MMM yyyy", Locale.getDefault()).format(new Date(day)).toUpperCase(Locale.getDefault()), PocketDesign.SMALL, false);
        rule(paper);
        SimpleDateFormat time = new SimpleDateFormat(twentyFour() ? "HH:mm" : "h:mma", Locale.getDefault());
        if (lines.isEmpty()) center(paper, today() ? "NOTHING YET. GO DO SOMETHING." : "NO ITEMS", PocketDesign.SMALL, false);
        for (ReceiptTape.Line line : lines) {
            LinearLayout row = new LinearLayout(this); row.setPadding(0, dp(2), 0, dp(2));
            row.addView(ink(time.format(new Date(line.when)).toLowerCase(Locale.getDefault()), PocketDesign.META, FADED, false), new LinearLayout.LayoutParams(dp(52), -2));
            row.addView(ink(line.kind, PocketDesign.META, INK, true), new LinearLayout.LayoutParams(dp(50), -2));
            row.addView(ink(line.text, PocketDesign.META, INK, false), new LinearLayout.LayoutParams(0, -2, 1));
            paper.addView(row);
        }
        rule(paper);
        for (String[] total : ReceiptTape.totals(lines)) {
            LinearLayout row = new LinearLayout(this);
            row.addView(ink(total[0], PocketDesign.SMALL, INK, "ITEMS".equals(total[0])), new LinearLayout.LayoutParams(0, -2, 1));
            TextView value = ink(total[1], PocketDesign.SMALL, INK, "ITEMS".equals(total[0])); value.setGravity(Gravity.END); row.addView(value);
            paper.addView(row);
        }
        rule(paper);
        center(paper, "THANK YOU FOR LIVING", PocketDesign.SMALL, true);
        center(paper, "PLEASE COME AGAIN", PocketDesign.META, false);
        center(paper, barcode(lines.size() * 31 + (int) (day / 86_400_000L)), PocketDesign.BODY, false);
        body.addView(paper, new LinearLayout.LayoutParams(-1, -2));
        body.addView(new Edge(this, false), new LinearLayout.LayoutParams(-1, dp(8)));
        if (today()) action("+ add a line", this::addLine).setTag("receipt_add");
    }
    private TextView ink(String text, int size, int color, boolean bold) {
        TextView view = new TextView(this); view.setText(text); PocketDesign.text(view, size, color);
        view.setTypeface(Typeface.MONOSPACE, bold ? Typeface.BOLD : Typeface.NORMAL); return view;
    }
    private void center(LinearLayout paper, String text, int size, boolean bold) {
        TextView view = ink(text, size, INK, bold); view.setGravity(Gravity.CENTER); view.setPadding(0, dp(2), 0, dp(2));
        if (size >= PocketDesign.SECTION) view.setTypeface(PocketFonts.pixel(this));
        paper.addView(view, new LinearLayout.LayoutParams(-1, -2));
    }
    private void rule(LinearLayout paper) {
        TextView dashes = ink("- - - - - - - - - - - - - - - - - - - - - - - - - - - - - -", PocketDesign.META, FADED, false);
        dashes.setSingleLine(true); dashes.setEllipsize(null); dashes.setPadding(0, dp(6), 0, dp(6));
        paper.addView(dashes, new LinearLayout.LayoutParams(-1, -2));
    }
    /** A decorative bar pattern; the same day always prints the same stripes. */
    static String barcode(int seed) {
        StringBuilder out = new StringBuilder(); java.util.Random stripes = new java.util.Random(seed);
        for (int i = 0; i < 22; i++) out.append(stripes.nextInt(3) == 0 ? ' ' : '|');
        return out.toString();
    }
    private void addLine() {
        EditText line = new EditText(this); line.setTag("receipt_line_editor"); PocketDesign.input(line); line.setSingleLine(true);
        line.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES); line.setHint("Had a great coffee");
        line.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(120)});
        new AlertDialog.Builder(this).setTitle("Add to today's receipt").setView(line).setNegativeButton("Cancel", null)
                .setPositiveButton("Print", (d, w) -> {
                    if (closed || line.getText().toString().trim().isEmpty()) return;
                    ReceiptTape.log(this, ReceiptTape.MEMO, line.getText().toString()); render();
                }).show();
    }
    private void share() {
        String text = ReceiptTape.text(day, ReceiptTape.lines(this, day), twentyFour());
        startActivity(Intent.createChooser(new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text), "Share receipt"));
    }

    /** The torn top and bottom of the roll. */
    private static final class Edge extends View {
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG); private final Path path = new Path(); private final boolean top;
        Edge(Context context, boolean top) { super(context); this.top = top; paint.setColor(PAPER); setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO); }
        @Override protected void onDraw(Canvas canvas) {
            float w = getWidth(), h = getHeight(), step = h * 1.5f; path.reset();
            if (top) { path.moveTo(0, h); for (float x = 0; x < w; x += step) { path.lineTo(x + step / 2, 0); path.lineTo(Math.min(w, x + step), h); } }
            else { path.moveTo(0, 0); for (float x = 0; x < w; x += step) { path.lineTo(x + step / 2, h); path.lineTo(Math.min(w, x + step), 0); } }
            path.close(); canvas.drawPath(path, paint);
        }
    }
}
