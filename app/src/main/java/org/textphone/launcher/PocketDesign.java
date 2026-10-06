package org.textphone.launcher;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.ColorStateList;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.ColorFilter;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.graphics.drawable.StateListDrawable;
import android.os.Build;
import android.os.UserManager;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.text.style.RelativeSizeSpan;
import android.view.Gravity;
import android.view.View;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Pocket's shared native visual language. No custom gesture or navigation layer.
 * Header, section, row, tab, item command and soft key are the only chrome patterns; see DESIGN.md.
 */
final class PocketDesign {
    static final int BLACK = Color.BLACK, WHITE = Color.WHITE;
    static final int LINE = 0xFF303438, MUTED = 0xFFAAAAAA;
    static final int DISABLED = 0xFF858B91, YELLOW = 0xFFF9F594, WARNING = 0xFFFFBF69;
    static final int INSET = 16, CONTROL = 52, ROW = 56, HEADER = 48, RADIUS = 2;
    static final int META = 12, SMALL = 14, BODY = 16, FIELD = 18, SECTION = 24, TITLE = 32, DISPLAY = 60;
    private static final int[][] CONTROL_STATES = {{-android.R.attr.state_enabled}, {android.R.attr.state_selected}, {android.R.attr.state_focused}, {}};
    private PocketDesign() {}
    static int dp(Context c, float value) { return Math.round(value * c.getResources().getDisplayMetrics().density); }
    private static SharedPreferences preferences(Context c) {
        if (Build.VERSION.SDK_INT >= 24) { UserManager user = c.getSystemService(UserManager.class); if (user != null && !user.isUserUnlocked()) return null; }
        return c.getSharedPreferences("text_phone", 0);
    }
    static int accent(Context c) {
        SharedPreferences p = preferences(c); int selected = p == null ? 0 : p.getInt("accent", 0);
        int[] choices = {YELLOW, 0xFF9BE564, 0xFF8FDDE7, WHITE}; return choices[Math.max(0, Math.min(choices.length - 1, selected))];
    }
    static float role(float requested) {
        if (requested <= 12) return META; if (requested <= 14) return SMALL;
        if (requested <= 16) return BODY; if (requested <= 18) return FIELD;
        if (requested <= 21) return 20; if (requested <= 24) return SECTION;
        if (requested <= 32) return TITLE; if (requested <= 40) return 40; return DISPLAY;
    }
    static float typeSize(Context c, float requested) {
        SharedPreferences p = preferences(c); return role(requested) * (p != null && p.getBoolean("large_text", false) ? 1.15f : 1f);
    }
    static void text(TextView view, float requested, int color) {
        view.setTextSize(typeSize(view.getContext(), requested)); view.setTextColor(color);
        view.setTypeface(Typeface.MONOSPACE); view.setIncludeFontPadding(false);
        view.setGravity(Gravity.CENTER_VERTICAL); view.setLineSpacing(dp(view.getContext(), 2), 1f);
    }
    static ColorStateList colors(Context c, int normal) {
        int accent = accent(c); return new ColorStateList(CONTROL_STATES,
                new int[]{DISABLED, accent, accent, normal});
    }
    private static GradientDrawable shape(Context c, int fill, int stroke) {
        GradientDrawable d = new GradientDrawable(); d.setColor(fill); d.setCornerRadius(dp(c, RADIUS));
        if (stroke != Color.TRANSPARENT) d.setStroke(Math.max(1, dp(c, 1)), stroke); return d;
    }
    private static Drawable interaction(Context c) {
        int accent = accent(c); StateListDrawable states = new StateListDrawable();
        states.addState(CONTROL_STATES[0], shape(c, BLACK, Color.TRANSPARENT));
        states.addState(CONTROL_STATES[1], new Rule(c, BLACK, accent));
        states.addState(CONTROL_STATES[2], new Rule(c, BLACK, accent));
        states.addState(CONTROL_STATES[3], shape(c, BLACK, Color.TRANSPARENT));
        int ripple = (accent & 0x00FFFFFF) | 0x33000000;
        return new RippleDrawable(ColorStateList.valueOf(ripple), states, shape(c, WHITE, Color.TRANSPARENT));
    }
    static void control(TextView view) {
        Context c = view.getContext(); view.setMinHeight(dp(c, CONTROL)); view.setMinWidth(0); view.setMinimumWidth(0);
        view.setPadding(dp(c, 8), dp(c, 8), dp(c, 8), dp(c, 8)); view.setGravity(Gravity.CENTER);
        view.setTextColor(colors(c, WHITE)); view.setBackground(interaction(c));
        view.setStateListAnimator(null); view.setAllCaps(false); view.setFocusable(true);
    }
    static void primary(TextView view) {
        Context c = view.getContext(); control(view); view.setMinHeight(dp(c, ROW));
        view.setTextSize(typeSize(c, BODY));
        view.setTextColor(colors(c, accent(c))); view.setBackground(interaction(c));
    }
    static void row(TextView view, int normal) {
        Context c = view.getContext(); view.setMinHeight(dp(c, ROW)); view.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
        view.setPadding(0, dp(c, 12), 0, dp(c, 12)); view.setTextColor(colors(c, normal));
        view.setBackground(interaction(c)); view.setStateListAnimator(null); view.setAllCaps(false); view.setFocusable(true);
        supporting(view);
    }
    static void quiet(TextView view, int normal) {
        Context c = view.getContext(); view.setMinHeight(dp(c, CONTROL)); view.setTextColor(colors(c, normal));
        view.setBackground(interaction(c)); view.setStateListAnimator(null); view.setAllCaps(false); view.setFocusable(true);
    }
    static void list(View view) { view.setBackground(interaction(view.getContext())); }
    static void supporting(TextView view) {
        String value = view.getText().toString(); int end = value.indexOf('\n'); if (end < 0 || end + 1 == value.length()) return;
        SpannableString styled = new SpannableString(value); styled.setSpan(new ForegroundColorSpan(MUTED), end + 1, value.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        styled.setSpan(new RelativeSizeSpan(.875f), end + 1, value.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE); view.setText(styled);
    }
    static void input(EditText view) {
        Context c = view.getContext(); text(view, FIELD, WHITE); view.setHintTextColor(MUTED); view.setMinHeight(dp(c, CONTROL));
        view.setPadding(0, dp(c, 12), 0, dp(c, 12));
        StateListDrawable states = new StateListDrawable(); states.addState(new int[]{android.R.attr.state_focused}, new Rule(c, BLACK, accent(c)));
        states.addState(new int[]{}, shape(c, BLACK, Color.TRANSPARENT)); view.setBackground(states);
    }
    static void editor(EditText view) { input(view); view.setBackgroundColor(BLACK); }
    static void header(android.widget.LinearLayout header) { header.setBackgroundColor(BLACK); }
    static int headerHeight(Context c){return Math.max(dp(c,HEADER),(int)Math.ceil(typeSize(c,SECTION)*c.getResources().getDisplayMetrics().scaledDensity)+dp(c,8));}
    static int headerWidth(TextView v,int base){return Math.max(dp(v.getContext(),base),(int)Math.ceil(v.getPaint().measureText(v.getText().toString()))+dp(v.getContext(),16));}
    static void headerControl(TextView view,int color){quiet(view,color);view.setTextSize(typeSize(view.getContext(),SMALL));view.setMinHeight(dp(view.getContext(),HEADER));view.setMinimumHeight(dp(view.getContext(),HEADER));view.setPadding(dp(view.getContext(),8),dp(view.getContext(),4),dp(view.getContext(),8),dp(view.getContext(),4));}
    static Drawable tile(Context c, boolean selected) {
        int accent = accent(c); return new RippleDrawable(ColorStateList.valueOf(selected ? 0x22000000 : 0x33FFFFFF),
                shape(c, selected ? accent : BLACK, Color.TRANSPARENT), shape(c, WHITE, Color.TRANSPARENT));
    }

    // ── Shared components. Every app builds its chrome from these, so pages scan the same way. ──

    /** Page title: centered pixel type. Titles and other chrome are lowercase; content keeps its own case. */
    static void title(TextView view) {
        text(view, SECTION, WHITE); view.setTypeface(PocketFonts.pixel(view.getContext()));
        view.setGravity(Gravity.CENTER); view.setMaxLines(1); view.setEllipsize(android.text.TextUtils.TruncateAt.END);
        if (Build.VERSION.SDK_INT >= 28) view.setAccessibilityHeading(true);
    }
    /** Section label: small bold uppercase in the supporting colour, with the larger gap above it. */
    static void section(TextView view, boolean first) {
        Context c = view.getContext(); text(view, META, MUTED); view.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        view.setAllCaps(true); view.setLetterSpacing(.08f); view.setPadding(0, dp(c, first ? 8 : 24), 0, dp(c, 8));
        if (Build.VERSION.SDK_INT >= 28) view.setAccessibilityHeading(true);
    }
    /** Bottom soft key. Like a keypad phone: the first key sits left, the last right, any middle key centered. */
    static void softKey(TextView view, int index, int count, boolean primary) {
        Context c = view.getContext(); text(view, SMALL, WHITE); quiet(view, primary ? accent(c) : WHITE);
        view.setMinHeight(dp(c, ROW)); view.setMinimumHeight(dp(c, ROW)); view.setPadding(dp(c, 8), dp(c, 12), dp(c, 8), dp(c, 12));
        int horizontal = count > 1 && index == 0 ? Gravity.START : count > 1 && index == count - 1 ? Gravity.END : Gravity.CENTER_HORIZONTAL;
        view.setGravity(horizontal | Gravity.CENTER_VERTICAL); view.setMaxLines(1); view.setEllipsize(android.text.TextUtils.TruncateAt.END);
    }
    /** Soft keys share the width equally; the outer keys' text lines up with the page edges. */
    static LinearLayout.LayoutParams softKeyCell(Context c, int index, int count) {
        LinearLayout.LayoutParams cell = new LinearLayout.LayoutParams(0, -2, 1);
        if (count > 1 && index == 0) cell.leftMargin = -dp(c, 8);
        if (count > 1 && index == count - 1) cell.rightMargin = -dp(c, 8);
        return cell;
    }
    /** View switch inside a page: muted labels, the selected one in accent above a short accent bar. */
    static void tab(TextView view, boolean selected) {
        Context c = view.getContext(); text(view, SMALL, WHITE); view.setGravity(Gravity.CENTER);
        view.setMinHeight(dp(c, HEADER)); view.setMinimumHeight(dp(c, HEADER)); view.setPadding(dp(c, 4), dp(c, 8), dp(c, 4), dp(c, 8));
        view.setTextColor(new ColorStateList(new int[][]{{-android.R.attr.state_enabled}, {android.R.attr.state_selected}, {}},
                new int[]{DISABLED, accent(c), MUTED}));
        view.setTypeface(Typeface.MONOSPACE, selected ? Typeface.BOLD : Typeface.NORMAL);
        StateListDrawable states = new StateListDrawable();
        states.addState(new int[]{android.R.attr.state_selected}, new Bar(c, accent(c), 2));
        states.addState(new int[]{android.R.attr.state_focused}, new Bar(c, WHITE, 1));
        states.addState(new int[]{}, shape(c, BLACK, Color.TRANSPARENT));
        view.setBackground(new RippleDrawable(ColorStateList.valueOf((accent(c) & 0x00FFFFFF) | 0x33000000), states, shape(c, WHITE, Color.TRANSPARENT)));
        view.setStateListAnimator(null); view.setAllCaps(false); view.setFocusable(true); view.setSelected(selected);
    }
    /** Commands that belong to one item: compact text buttons whose first label lines up with the item text. */
    static void command(TextView view, boolean primary) {
        Context c = view.getContext(); text(view, SMALL, WHITE); quiet(view, primary ? accent(c) : WHITE);
        // Commands act on content (reply, delete, complete), so they keep the full 56 dp row height.
        view.setMinWidth(dp(c, ROW)); view.setMinimumWidth(dp(c, ROW)); view.setMinHeight(dp(c, ROW)); view.setMinimumHeight(dp(c, ROW));
        view.setPadding(dp(c, 8), dp(c, 8), dp(c, 8), dp(c, 8)); view.setGravity(Gravity.CENTER); view.setMaxLines(1);
    }
    static LinearLayout.LayoutParams commandCell(Context c, boolean first) {
        LinearLayout.LayoutParams cell = new LinearLayout.LayoutParams(-2, -2); cell.leftMargin = first ? -dp(c, 8) : dp(c, 8); return cell;
    }
    /** Three-column rows on Home (readings, quick actions and tiles) share these cells, so their centres line up. */
    static LinearLayout.LayoutParams column(Context c) {
        LinearLayout.LayoutParams cell = new LinearLayout.LayoutParams(0, -2, 1); cell.leftMargin = cell.rightMargin = dp(c, 4); return cell;
    }
    /** An accent bar along the bottom edge: the selected tab. */
    private static final class Bar extends Drawable {
        private final Paint paint = new Paint(); private final int height, inset; private int alpha = 255;
        Bar(Context c, int color, int dp) { paint.setColor(color); height = Math.max(1, dp(c, dp)); inset = dp(c, 12); }
        public void draw(Canvas canvas) { paint.setAlpha(alpha); android.graphics.Rect b = getBounds(); int side = Math.min(inset, b.width() / 4);
            canvas.drawRect(b.left + side, b.bottom - height, b.right - side, b.bottom, paint); }
        public void setAlpha(int value) { alpha = value; invalidateSelf(); }
        public void setColorFilter(ColorFilter filter) { paint.setColorFilter(filter); invalidateSelf(); }
        @SuppressWarnings("deprecation") public int getOpacity() { return PixelFormat.TRANSLUCENT; }
    }
    /** A single active focus/selection mark; never used as an idle decorative divider. */
    private static final class Rule extends Drawable {
        private final Paint paint = new Paint(); private final int fill, line, height; private int alpha = 255;
        Rule(Context c, int fill, int line) { this.fill = fill; this.line = line; height = Math.max(1, dp(c, 1)); }
        public void draw(Canvas canvas) { paint.setColor(fill); paint.setAlpha(alpha); canvas.drawRect(getBounds(), paint); paint.setColor(line); paint.setAlpha(alpha);
            canvas.drawRect(getBounds().left, getBounds().bottom - height, getBounds().right, getBounds().bottom, paint); }
        public void setAlpha(int value) { alpha = value; invalidateSelf(); }
        public void setColorFilter(ColorFilter filter) { paint.setColorFilter(filter); invalidateSelf(); }
        @SuppressWarnings("deprecation") public int getOpacity() { return alpha == 255 ? PixelFormat.OPAQUE : PixelFormat.TRANSLUCENT; }
    }
}
