package org.textphone.launcher;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.ActivityNotFoundException;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;


/** Shared native controls for Pocket's apps. Provider work never runs on the UI thread. */
public abstract class PocketActivity extends Activity {
    static final int YELLOW = PocketDesign.YELLOW, WHITE = PocketDesign.WHITE, GRAY = PocketDesign.MUTED;
    protected LinearLayout root, body;
    protected final Handler ui = new Handler(Looper.getMainLooper());
    // Completed reads must still discard resource results after destroy; ordinary UI timers are cancelled separately.
    private final Handler resultUi = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private static final ExecutorService WRITES = Executors.newSingleThreadExecutor(r -> { Thread thread = new Thread(r, "Pocket save"); thread.setDaemon(true); return thread; });
    protected boolean closed;
    private Runnable permissionGranted;
    private int pageGeneration, permissionPage;
    private TextView notice;private LinearLayout header;private Button headerRight;
    private NativeNavigation navigation;
    private PageMotion motion; private String homePage;
    private View launchOrigin;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().setNavigationBarColor(Color.BLACK);
        if (Build.VERSION.SDK_INT >= 29) getWindow().setNavigationBarContrastEnforced(false);
        motion = new PageMotion(this); if (state != null) motion.restore(state.getBundle("page_scrolls")); setContentView(motion.host());
        navigation = new NativeNavigation(this, new NativeNavigation.Page() {
            public boolean internal() { return hasInternalBack(); }
            public void back() { PocketActivity.this.onBackPressed(); }
            public View content() { return root; }
            public void started(boolean fromLeft) { motion.startBack(backPageKey(homePage), fromLeft); }
            public void progressed(float progress) { motion.progressBack(progress); }
            public void cancelled() { motion.cancelBack(); }
        });
    }
    protected int dp(float value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    protected void screen(String title) {
        screen(title, title);
    }
    protected void screen(String title, String pageKey) {
        pageGeneration++;
        if (!hasInternalBack()) homePage = pageKey;
        root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.BLACK); root.setPadding(dp(PocketDesign.INSET), dp(4), dp(PocketDesign.INSET), dp(4));
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            int l, t, r, b;
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets safe = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                l = safe.left; t = safe.top; r = safe.right; b = safe.bottom;
            } else { l = insets.getSystemWindowInsetLeft(); t = insets.getSystemWindowInsetTop();
                r = insets.getSystemWindowInsetRight(); b = insets.getSystemWindowInsetBottom(); }
            view.setPadding(dp(PocketDesign.INSET) + l, dp(4) + t, dp(PocketDesign.INSET) + r, dp(4) + b); return insets;
        });
        header = row();header.setTag("page_header");
        Button previous = button("back", this::onBackPressed); previous.setTag("navigation_back"); PocketDesign.headerControl(previous, GRAY);
        header.addView(previous, new LinearLayout.LayoutParams(PocketDesign.headerWidth(previous,64), PocketDesign.headerHeight(this)));
        TextView name = label(title, PocketDesign.SECTION, WHITE);name.setTag("page_heading"); PocketDesign.title(name);
        header.addView(name, new LinearLayout.LayoutParams(0, PocketDesign.headerHeight(this), 1));
        Button home = button("home", () -> { startActivity(new Intent(this, MainActivity.class)
                .setAction(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NEW_TASK)); }); PocketDesign.headerControl(home, GRAY);headerRight=home;
        header.addView(home, new LinearLayout.LayoutParams(PocketDesign.headerWidth(home,64), PocketDesign.headerHeight(this))); PocketDesign.header(header);
        if (scene() != null) { root.setBackground(new PixelBackdrop(this, PocketDesign.accent(this), 88, scene())); header.setBackgroundColor(Color.TRANSPARENT); name.setShadowLayer(dp(6), 0, 0, Color.BLACK); }
        root.addView(header);
        ScrollView scroll = new ScrollView(this); scroll.setFillViewport(true);
        body = new LinearLayout(this); body.setOrientation(LinearLayout.VERTICAL); body.setPadding(0, dp(4), 0, dp(4));
        scroll.addView(body, new ScrollView.LayoutParams(-1, -2));
        root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
        notice = label("", 12, PocketDesign.WARNING); notice.setMinHeight(dp(32)); notice.setPadding(0, dp(8), 0, dp(8));
        notice.setBackgroundColor(Color.BLACK); notice.setVisibility(View.GONE); notice.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE); root.addView(notice);
        motion.show(root, pageKey); root.requestApplyInsets();
        navigation.update();
    }
    protected LinearLayout row() { LinearLayout view = new LinearLayout(this); view.setGravity(Gravity.CENTER_VERTICAL); return view; }
    protected Button headerAction(String label,Runnable action,boolean commit){header.removeView(headerRight);headerRight=button(label,action);PocketDesign.headerControl(headerRight,commit?PocketDesign.accent(this):GRAY);headerRight.setTag("app_settings".equals(label)?label:"header_action");header.addView(headerRight,new LinearLayout.LayoutParams(PocketDesign.headerWidth(headerRight,label.length()>5?96:64),PocketDesign.headerHeight(this)));return headerRight;}
    protected void appSettings(Runnable action){Button settings=headerAction("settings",action,false);settings.setTag("app_settings");settings.setContentDescription("App settings");}
    /** A group label in the page body. */
    protected TextView section(String text) {
        TextView view = label(text, PocketDesign.META, GRAY); PocketDesign.section(view, body.getChildCount() == 0); body.addView(view); return view;
    }
    /** Switches between views of the same page. */
    protected LinearLayout tabs(String[] names, int selected, Runnable... actions) {
        LinearLayout line = row();
        for (int i = 0; i < names.length; i++) { Button tab = button(names[i], actions[i]); PocketDesign.tab(tab, i == selected); line.addView(tab, new LinearLayout.LayoutParams(0, -2, 1)); }
        LinearLayout.LayoutParams layout = new LinearLayout.LayoutParams(-1, -2); layout.bottomMargin = dp(8); body.addView(line, layout); return line;
    }
    /** Page-level commands fixed at the bottom, below feedback. {@code primary} is -1 when none is a commit. */
    protected LinearLayout softKeys(String[] names, int primary, Runnable... actions) {
        LinearLayout bar = row(); bar.setTag("soft_keys");
        for (int i = 0; i < names.length; i++) { Button key = button(names[i], actions[i]); PocketDesign.softKey(key, i, names.length, i == primary); bar.addView(key, PocketDesign.softKeyCell(this, i, names.length)); }
        root.addView(bar, new LinearLayout.LayoutParams(-1, -2)); return bar;
    }
    /** Commands for the item directly above them. */
    protected LinearLayout commands(LinearLayout host, String[] names, int primary, Runnable... actions) {
        LinearLayout line = row();
        for (int i = 0; i < names.length; i++) { Button command = button(names[i], actions[i]); PocketDesign.command(command, i == primary); line.addView(command, PocketDesign.commandCell(this, i == 0)); }
        host.addView(line, new LinearLayout.LayoutParams(-1, -2)); return line;
    }
    protected TextView label(String text, int size, int color) {
        TextView view = new TextView(this); view.setText(text); PocketDesign.text(view, size, color);
        view.setPadding(0, dp(8), 0, dp(8)); return view;
    }
    protected Button button(String text, Runnable action) {
        Button view = new Button(this); view.setText(text); view.setAllCaps(false);
        PocketDesign.text(view, PocketDesign.SMALL, WHITE); PocketDesign.control(view);
        view.setOnClickListener(v -> { launchOrigin = v; try { action.run(); } catch (SecurityException e) { message("Access was denied."); }
            catch (IllegalArgumentException e) { message(e.getMessage() == null ? "Invalid value." : e.getMessage()); }
            catch (ActivityNotFoundException e) { message("This Android screen is unavailable."); }
            catch (IllegalStateException e) { message(e.getMessage() == null ? "Could not complete this action." : e.getMessage()); }
            finally { launchOrigin = null; } });
        return view;
    }
    protected Button item(String text, Runnable callback) { Button view = button(text, callback); PocketDesign.text(view, PocketDesign.BODY, WHITE); PocketDesign.row(view, WHITE); view.setMaxLines(2); view.setEllipsize(android.text.TextUtils.TruncateAt.END); return view; }
    protected Button action(String text, Runnable callback) { Button view = item(text, callback); body.addView(view, new LinearLayout.LayoutParams(-1, -2)); return view; }
    protected LinearLayout keys(String[] names, Runnable... callbacks) { LinearLayout line = row();
        for (int i = 0; i < names.length; i++) { LinearLayout.LayoutParams cell = new LinearLayout.LayoutParams(0, -2, 1); if (i > 0) cell.leftMargin = dp(4); line.addView(button(names[i], callbacks[i]), cell); }
        LinearLayout.LayoutParams layout = new LinearLayout.LayoutParams(-1, -2); layout.topMargin = dp(8); layout.bottomMargin = dp(8); body.addView(line, layout); return line; }
    protected EditText input(String hint, int type) { EditText view = new EditText(this);
        view.setHint(hint); view.setInputType(type); PocketDesign.input(view); view.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(8000)});
        LinearLayout.LayoutParams layout = new LinearLayout.LayoutParams(-1, -2); layout.bottomMargin = dp(8); body.addView(view, layout); return view; }
    protected void message(String value) { if (!closed && notice != null) { notice.setText(value); notice.setVisibility(value == null || value.isEmpty() ? View.GONE : View.VISIBLE); } }
    protected boolean permitted(String permission) { return checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED; }
    protected void permissions(Runnable done, String... permissions) {
        if (closed) return;
        if (permissionGranted != null) { message("Finish the open Android permission dialog first."); return; }
        java.util.List<String> missing = new java.util.ArrayList<>(); for (String p : permissions) if (!permitted(p)) missing.add(p);
        if (missing.isEmpty()) { done.run(); return; }
        permissionGranted = done; permissionPage = pageGeneration;
        try { requestPermissions(missing.toArray(new String[0]), 410); }
        catch (RuntimeException error) { permissionGranted = null; message("Could not open Android permissions. Try again."); }
    }
    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code != 410) return;
        Runnable callback = permissionGranted; permissionGranted = null;
        boolean all = results.length > 0; for (int result : results) all &= result == PackageManager.PERMISSION_GRANTED;
        if (closed || permissionPage != pageGeneration) return;
        if (all && callback != null) {
            try { callback.run(); }
            catch (SecurityException error) { message("Access was denied."); }
            catch (IllegalArgumentException | IllegalStateException error) { message(error.getMessage() == null ? "Could not complete this action." : error.getMessage()); }
        } else message("Not allowed. Review access in Pocket settings → Permissions.");
    }
    protected interface Result<T> { void accept(T value); }
    protected <T> void load(Callable<T> operation, Result<T> ready) {
        int page = pageGeneration;
        load(operation, ready, error -> { if (page == pageGeneration) message(error instanceof SecurityException ? "Access was denied." : "Could not complete this action."); });
    }
    protected <T> void load(Callable<T> operation, Result<T> ready, Result<Exception> failed) {
        load(operation, ready, failed, value -> {});
    }
    protected <T> void load(Callable<T> operation, Result<T> ready, Result<Exception> failed, Result<T> discarded) {
        loadWith(worker, operation, ready, failed, discarded);
    }
    private <T> void loadWith(ExecutorService executor, Callable<T> operation, Result<T> ready, Result<Exception> failed, Result<T> discarded) {
        if (closed) return;
        int page = pageGeneration;
        executor.submit(() -> { try { T value = operation.call(); resultUi.post(() -> { if (!closed) { ready.accept(value); if (page == pageGeneration) motion.dataReady(); } else discarded.accept(value); }); }
            catch (Exception e) { resultUi.post(() -> { if (!closed) { failed.accept(e); if (page == pageGeneration) motion.dataReady(); } }); }
            catch (OutOfMemoryError e) { resultUi.post(() -> { if (!closed) { failed.accept(new java.io.IOException("Not enough memory. Close other apps and try again.")); if (page == pageGeneration) motion.dataReady(); } }); }
        });
    }
    /** Read results belong to the page that requested them, including a rebuild of that page. */
    protected <T> void loadPage(Callable<T> operation, Result<T> ready) {
        int page = pageGeneration;
        load(operation, value -> { if (page == pageGeneration) { ready.accept(value); motion.dataReady(); } }, error -> {
            if (page == pageGeneration) message(error instanceof SecurityException ? "Access was denied." : "Could not load. Try again.");
        });
    }
    /** A tapped write finishes once; its result cannot navigate a newer page. */
    protected <T> void loadAction(View control, Callable<T> operation, Result<T> ready) {
        loadAction(control,operation,ready,error->message(error instanceof SecurityException ? "Access was denied." : error.getMessage() == null ? "Could not save. Try again." : error.getMessage()));
    }
    protected <T> void loadAction(View control,Callable<T> operation,Result<T> ready,Result<Exception> failed){
        if (!control.isEnabled() || closed) return;
        int page = pageGeneration; control.setEnabled(false);
        loadWith(WRITES, operation, value -> { control.setEnabled(true); if (page == pageGeneration) ready.accept(value); }, error -> {
            control.setEnabled(true);
            if (page == pageGeneration) failed.accept(error);
        }, value -> {});
    }
    protected void confirm(String title, Runnable action) { new AlertDialog.Builder(this).setTitle(title)
            .setNegativeButton("Cancel", null).setPositiveButton("Confirm", (d, w) -> action.run()).show(); }
    /** A page that is leaving accepts no late results: a permission answer or read tied to it can no longer act. */
    @Override public void finish() { pageGeneration++; super.finish(); }
    /** The header artwork of this app's area, or null for a plain header. */
    protected String scene() { return null; }
    protected boolean hasInternalBack() { return false; }
    protected String backPageKey(String rootPage) { return rootPage; }
    protected void back(Runnable action) { motion.back(action); }
    protected void releaseVisualHistory() { motion.discardHistory(); }
    @Override public void startActivity(Intent intent) {
        try { PocketLaunch.open(this, intent, launchOrigin == null ? getCurrentFocus() : launchOrigin); }
        catch (ActivityNotFoundException error) { message("This Android screen is unavailable."); }
        catch (SecurityException error) { message("Android blocked opening this screen."); }
    }
    /** Called on the UI thread after a cloud sync changed local data while this page is visible. */
    protected void onCloudSynced() { }
    private final android.content.BroadcastReceiver synced = new android.content.BroadcastReceiver() {
        @Override public void onReceive(android.content.Context context, Intent intent) { if (!closed) onCloudSynced(); }
    };
    @android.annotation.SuppressLint("UnspecifiedRegisterReceiverFlag")
    @Override protected void onStart() { super.onStart();
        android.content.IntentFilter filter = new android.content.IntentFilter(CloudSync.ACTION_SYNCED);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(synced, filter, android.content.Context.RECEIVER_NOT_EXPORTED); else registerReceiver(synced, filter);
        CloudSync.soon(this); }
    @Override protected void onStop() { unregisterReceiver(synced); motion.discardHistory(); super.onStop(); }
    @Override protected void onSaveInstanceState(Bundle state) { Bundle positions = new Bundle(); motion.save(positions::putInt); state.putBundle("page_scrolls", positions); super.onSaveInstanceState(state); }
    @Override protected void onDestroy() { closed = true; permissionGranted = null; navigation.destroy(); motion.destroy(); ui.removeCallbacksAndMessages(null); worker.shutdown(); super.onDestroy(); }
}
