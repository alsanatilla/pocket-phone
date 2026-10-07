package org.textphone.launcher;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.ColorStateList;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.ColorFilter;
import android.graphics.Paint;
import android.graphics.PixelFormat;
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
    static final int INK = 0xFF12110F, PLANE = 0xFF1E1C18, CREAM = 0xFFF0E9DD;
    static final int BLACK = INK, WHITE = CREAM;
    /** Warm cream is used for both readable text and pixel titles. */
    static final int TEXT = CREAM;
    static final int LINE = 0xFF3E392F, MUTED = 0xFFB6AC9D;
    static final int DISABLED = 0xFF837C70, YELLOW = 0xFFECC981, WARNING = 0xFFEFA58E;
    static final int CALENDAR = 0xFFA5BFDC, THOUGHTS = 0xFFC1AED5, NOTES = THOUGHTS, MOVEMENT = 0xFFADBF9C;
    static final int INSET = 16, CONTROL = 52, ROW = 56, HEADER = 56, RADIUS = 0;
    /** META is the floor for sentences and metadata (13 sp); section metadata uses the same 13 sp floor. */
    static final int LABEL = 13, META = 13, SMALL = 14, BODY = 16, FIELD = 18, SECTION = 24, TITLE = 32, DISPLAY = 60;
    private static final int[][] CONTROL_STATES = {{-android.R.attr.state_enabled}, {android.R.attr.state_selected}, {android.R.attr.state_focused}, {}};
    private PocketDesign() {}
    static int dp(Context c, float value) { return Math.round(value * c.getResources().getDisplayMetrics().density); }
    private static SharedPreferences preferences(Context c) {
        if (Build.VERSION.SDK_INT >= 24) { UserManager user = c.getSystemService(UserManager.class); if (user != null && !user.isUserUnlocked()) return null; }
        return c.getSharedPreferences("text_phone", 0);
    }
    static int accent(Context c) {
        SharedPreferences p = preferences(c); int selected = p == null ? 0 : p.getInt("accent", 0);
        int[] choices = {YELLOW, MOVEMENT, CALENDAR, WHITE}; return choices[Math.max(0, Math.min(choices.length - 1, selected))];
    }
    static float role(float requested) {
        if (requested <= 13) return META; if (requested <= 14) return SMALL;
        if (requested <= 16) return BODY; if (requested <= 18) return FIELD;
        if (requested <= 21) return 20; if (requested <= 24) return SECTION;
        if (requested <= 32) return TITLE; if (requested <= 40) return 40; return DISPLAY;
    }
    static float typeSize(Context c, float requested) {
        SharedPreferences p = preferences(c); return role(requested) * (p != null && p.getBoolean("large_text", false) ? 1.15f : 1f);
    }
    /** Legacy platform black/white colours resolve to the shared warm palette. */
    static int ink(int color) { return color == Color.WHITE || color == WHITE ? TEXT : color == Color.BLACK ? INK : color; }
    /** Leading as a multiplier of the line: more air for body text and above, a little for small text, none for single-line pixel titles. */
    static float leading(float role) { return role >= SECTION ? 1f : role >= BODY ? 1.25f : 1.15f; }
    /** Leading for blocks that are read, not scanned: Pip replies, note previews, messages and notification bodies. */
    static final float READING = 1.35f;
    static void reading(TextView view) { view.setLineSpacing(0, READING); }
    /** Size of an uppercase section label: smaller than sentences, set apart by weight and tracking. */
    static float labelSize(Context c) { SharedPreferences p = preferences(c); return LABEL * (p != null && p.getBoolean("large_text", false) ? 1.15f : 1f); }
    static void text(TextView view, float requested, int color) {
        view.setTextSize(typeSize(view.getContext(), requested)); view.setTextColor(ink(color));
        view.setTypeface(PocketFonts.body(view.getContext())); view.setIncludeFontPadding(false);
        view.setGravity(Gravity.CENTER_VERTICAL); view.setLineSpacing(0, leading(role(requested)));
    }
    static ColorStateList colors(Context c, int normal) {
        int accent = accent(c); return new ColorStateList(CONTROL_STATES,
                new int[]{DISABLED, accent, accent, ink(normal)});
    }
    private static GradientDrawable shape(Context c, int fill, int stroke) {
        GradientDrawable d = new GradientDrawable(); d.setColor(fill); d.setCornerRadius(dp(c, RADIUS));
        if (stroke != Color.TRANSPARENT) d.setStroke(Math.max(1, dp(c, 1)), stroke); return d;
    }
    private static Drawable interaction(Context c) {
        return interaction(c, BLACK);
    }
    static Drawable interaction(Context c, int fill) {
        int accent = accent(c); StateListDrawable states = new StateListDrawable();
        states.addState(CONTROL_STATES[0], shape(c, fill, Color.TRANSPARENT));
        states.addState(CONTROL_STATES[1], new Rule(c, fill, accent));
        states.addState(CONTROL_STATES[2], new Rule(c, fill, accent));
        states.addState(CONTROL_STATES[3], shape(c, fill, Color.TRANSPARENT));
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
        view.setBackground(separator(c)); view.setStateListAnimator(null); view.setAllCaps(false); view.setFocusable(true);
        supporting(view);
    }
    static void quiet(TextView view, int normal) {
        Context c = view.getContext(); view.setMinHeight(dp(c, CONTROL)); view.setTextColor(colors(c, normal));
        view.setBackground(interaction(c)); view.setStateListAnimator(null); view.setAllCaps(false); view.setFocusable(true);
    }
    static void list(View view) { view.setBackground(separator(view.getContext())); }
    /** Plain rows keep a single neutral rule, with an amber focus mark and native touch feedback. */
    static Drawable separator(Context c) {
        StateListDrawable states = new StateListDrawable();
        states.addState(new int[]{android.R.attr.state_focused}, new Rule(c, INK, accent(c)));
        states.addState(new int[]{android.R.attr.state_selected}, new Rule(c, INK, accent(c)));
        states.addState(new int[]{}, new Rule(c, INK, LINE));
        return new RippleDrawable(ColorStateList.valueOf(0x22ECC981), states, shape(c, WHITE, Color.TRANSPARENT));
    }
    /** Animated real sprite; callers supply navigation actions and selected state. */
    static View navMascot(android.app.Activity activity, int frameDp) { return new PipNavView(activity, frameDp); }
    static void supporting(TextView view) {
        String value = view.getText().toString(); int end = value.indexOf('\n'); if (end < 0 || end + 1 == value.length()) return;
        SpannableString styled = new SpannableString(value); styled.setSpan(new ForegroundColorSpan(MUTED), end + 1, value.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        float floor = typeSize(view.getContext(), META) * view.getResources().getDisplayMetrics().scaledDensity;
        styled.setSpan(new RelativeSizeSpan(Math.max(.875f, floor / view.getTextSize())), end + 1, value.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE); view.setText(styled);
    }
    static void input(EditText view) {
        input(view, BLACK);
    }
    static void input(EditText view, int fill) {
        Context c = view.getContext(); text(view, FIELD, WHITE); view.setHintTextColor(MUTED); view.setMinHeight(dp(c, CONTROL));
        view.setPadding(0, dp(c, 12), 0, dp(c, 12));
        StateListDrawable states = new StateListDrawable(); states.addState(new int[]{android.R.attr.state_focused}, new Rule(c, fill, accent(c)));
        states.addState(new int[]{}, new Rule(c, fill, LINE)); view.setBackground(states);
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
        text(view, TITLE, WHITE); view.setTextColor(WHITE); view.setTypeface(PocketFonts.pixel(view.getContext()));
        view.setGravity(Gravity.CENTER); view.setMaxLines(1); view.setEllipsize(android.text.TextUtils.TruncateAt.END);
        if (Build.VERSION.SDK_INT >= 28) view.setAccessibilityHeading(true);
    }
    /** Pixel group heading with enough space to separate the plain rows below it. */
    static void section(TextView view, boolean first) {
        Context c = view.getContext(); text(view, SECTION, CREAM); view.setTypeface(PocketFonts.pixel(c));
        view.setAllCaps(false); view.setLetterSpacing(0); view.setPadding(0, dp(c, first ? 8 : 24), 0, dp(c, 8));
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
        view.setTypeface(selected ? PocketFonts.monoMedium(c) : PocketFonts.mono(c));
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
        /** A transparent fill stays transparent: setAlpha would otherwise turn it into opaque black. */
        public void draw(Canvas canvas) {
            if (Color.alpha(fill) != 0) { paint.setColor(fill); paint.setAlpha(Color.alpha(fill) * alpha / 255); canvas.drawRect(getBounds(), paint); }
            paint.setColor(line); paint.setAlpha(Color.alpha(line) * alpha / 255);
            canvas.drawRect(getBounds().left, getBounds().bottom - height, getBounds().right, getBounds().bottom, paint); }
        public void setAlpha(int value) { alpha = value; invalidateSelf(); }
        public void setColorFilter(ColorFilter filter) { paint.setColorFilter(filter); invalidateSelf(); }
        @SuppressWarnings("deprecation") public int getOpacity() { return alpha == 255 ? PixelFormat.OPAQUE : PixelFormat.TRANSLUCENT; }
    }
}
