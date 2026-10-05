package org.textphone.launcher;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DatePickerDialog;
import android.app.AlarmManager;
import android.app.role.RoleManager;
import android.content.ActivityNotFoundException;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.AlarmClock;
import android.provider.ContactsContract;
import android.provider.CallLog;
import android.provider.CalendarContract;
import android.provider.MediaStore;
import android.provider.Settings;
import android.provider.Telephony;
import android.telephony.TelephonyManager;
import android.text.format.DateFormat;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.HapticFeedbackConstants;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.EditText;
import android.text.InputFilter;
import android.text.InputType;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.inputmethod.InputMethodManager;
import android.graphics.drawable.GradientDrawable;
import android.service.notification.StatusBarNotification;
import android.app.Notification;
import android.app.PendingIntent;
import android.text.TextUtils;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.Collections;
import java.util.Calendar;
import java.io.OutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

/** A lightweight native Home app based on the publicly visible Dumbphone 2 layout. */
public class MainActivity extends Activity {
    protected boolean workspace() { return false; }
    private static final int BACKGROUND = PocketDesign.BLACK;
    private static final int PRIMARY = PocketDesign.WHITE;
    private static final int SECONDARY = PocketDesign.MUTED;
    private static final int AMBER = PocketDesign.WARNING;
    private static final int CAMERA_REQUEST = 41;
    private static final int EXPORT_REQUEST = 72;
    private static final int[] ACCENTS = {0xFFF9F594, 0xFF9BE564, 0xFF8FDDE7, Color.WHITE};
    private static final String[] ACCENT_NAMES = {"Yellow", "Green", "Blue", "White"};
    private static final String[] SHORTCUTS = {"smart txt", "whatsapp", "dumb txt", "contacts",
            "call history", "settings", "maps", "camera", "rides"};
    private static final String[] ROM_SHORTCUTS = {"phone", "messages", "contacts", "clock",
            "camera", "calculator", "files", "today", "settings"};
    private String[] shortcuts = SHORTCUTS;
    private boolean romProfile;
    private LinearLayout planHost,todayFilters,todayActions;private TextView todayDate;private String todayFocusTitle="",focusTitle="";private boolean homePlan;private int planRequest;
    private PlannerStore planner;
    private EditText captureEditor;
    private EditText captureStepsEditor;
    private String captureKind = "note", captureText = "", appQuery = "";
    private String captureDue = "", captureSteps = "", taskFilter = "Open", organizerQuery = "";
    private boolean captureImportant;
    private int captureSelectionStart = -1, captureSelectionEnd = -1;
    private long captureId;
    private TextView nextTaskText, taskCountText;

    private SharedPreferences preferences;
    private DashboardTiles tiles;
    private boolean tileLabelsLoading;
    private String screen = "home";
    private final RouteTrail trail = new RouteTrail();
    private RouteTrail.Route activeRoute;
    private LinearLayout content;
    private TextView clock;
    private TextView date;
    private TextView network;
    private TextView battery;
    private TextView alarm;
    private TextView feedback;
    private TextView torchValue;
    private TextView homeStatus;
    private TextView notificationCount;
    private final List<LinearLayout> homeTiles = new ArrayList<>();
    private final List<PhoneIcon> homeIcons = new ArrayList<>();
    private final List<TextView> homeLabels = new ArrayList<>();
    private int selectedShortcut;
    private String assigningShortcut;
    private String appsReturnTo = "home";
    private Typeface pixelTypeface;
    private TextView homeDay;
    private TextView homeHint;
    private boolean receiverRegistered;
    private CameraManager cameraManager;
    private String torchCamera;
    private boolean torchOn;
    private boolean torchOwned;
    private NativeNavigation navigation;
    private PageMotion motion;
    private final Handler draftUi = new Handler(Looper.getMainLooper());
    private Runnable draftSave;
    private View launchOrigin;
    private final Handler appUi = new Handler(Looper.getMainLooper());
    private final java.util.concurrent.ExecutorService appWorker = java.util.concurrent.Executors.newSingleThreadExecutor();
    private List<InstalledApps.Entry> installedApps;
    private Runnable appFilter; private boolean indexLoading, appVisible, destroyed, appRowsReady;
    private int indexVersion, pageGeneration, filterGeneration;
    private String stoppedDraft, stoppedDraftKind; private long stoppedDraftId;
    private String stoppedDue, stoppedSteps; private boolean stoppedImportant;

    private final BroadcastReceiver statusReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            if ("home".equals(screen)) updateHome();
            else if ("notifications".equals(screen)
                    && PhoneNotifications.ACTION_UPDATED.equals(intent.getAction())) render();
        }
    };

    private final CameraManager.TorchCallback torchCallback = new CameraManager.TorchCallback() {
        @Override public void onTorchModeChanged(String cameraId, boolean enabled) {
            if (!cameraId.equals(torchCamera)) return;
            torchOn = enabled;
            if (!enabled) torchOwned = false;
            updateTorchLabel();
        }

        @Override public void onTorchModeUnavailable(String cameraId) {
            if (!cameraId.equals(torchCamera)) return;
            torchOn = false;
            torchOwned = false;
            updateTorchLabel();
        }
    };

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (savedInstanceState == null && workspace()) screen = "today";
        romProfile = getResources().getBoolean(R.bool.pocket_rom);
        shortcuts = romProfile ? ROM_SHORTCUTS : SHORTCUTS;
        planner = new PlannerStore(getSharedPreferences("pocket_planner", MODE_PRIVATE));
        preferences = getSharedPreferences("text_phone", MODE_PRIVATE);
        tiles = new DashboardTiles(preferences);
        pixelTypeface = PocketFonts.pixel(this);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().setNavigationBarColor(BACKGROUND);
        getWindow().getDecorView().setSystemUiVisibility(0);
        if (Build.VERSION.SDK_INT >= 29) getWindow().setNavigationBarContrastEnforced(false);
        motion = new PageMotion(this); if (savedInstanceState != null) motion.restore(savedInstanceState.getBundle("page_scrolls")); setContentView(motion.host());
        navigation = new NativeNavigation(this, new NativeNavigation.Page() {
            public boolean internal() { return noteWheelShowing() || trail.peek()!=null || !workspace() || !"today".equals(screen); }
            public void back() { onBackPressed(); }
            public View content() { return "home".equals(screen) ? null : content; }
            public void started(boolean fromLeft) { if (!noteWheelShowing() && !"home".equals(screen)) motion.startBack(backPageKey(), fromLeft); }
            public void progressed(float progress) { if (!noteWheelShowing()) motion.progressBack(progress); }
            public void cancelled() { if (!noteWheelShowing()) motion.cancelBack(); }
        });
        if (savedInstanceState != null) screen = savedInstanceState.getString("screen", "home");
        if (savedInstanceState != null) trail.restore(savedInstanceState.getBundle("navigation_trail"));
        if (savedInstanceState != null) {
            selectedShortcut = savedInstanceState.getInt("selected", 0);
            assigningShortcut = savedInstanceState.getString("assigning");
            appsReturnTo = savedInstanceState.getString("apps_return", "home");
            captureKind = savedInstanceState.getString("capture_kind", "note");
            captureText = savedInstanceState.getString("capture_text", "");
            captureId = savedInstanceState.getLong("capture_id", 0);
            appQuery = savedInstanceState.getString("app_query", "");
            taskFilter = savedInstanceState.getString("task_filter", "Open");
            organizerQuery = savedInstanceState.getString("organizer_query", "");focusTitle=savedInstanceState.getString("focus_title","");
            captureDue = savedInstanceState.getString("capture_due", "");
            captureSteps = savedInstanceState.getString("capture_steps", "");
            captureImportant = savedInstanceState.getBoolean("capture_important");
            captureSelectionStart = savedInstanceState.getInt("capture_selection_start", -1);
            captureSelectionEnd = savedInstanceState.getInt("capture_selection_end", -1);
        }
        if ("assign".equals(screen) && assigningShortcut == null) screen = "home";
        if (savedInstanceState == null && "today".equals(getIntent().getStringExtra("pocket_screen"))) screen = "today";
        if (savedInstanceState == null && "notifications".equals(getIntent().getStringExtra("pocket_screen"))) screen = "notifications";
        if (savedInstanceState == null && !workspace() && "settings".equals(getIntent().getStringExtra("pocket_screen"))) screen = "settings";
        if (!workspace() && Intent.ACTION_MAIN.equals(getIntent().getAction()) && getIntent().hasCategory(Intent.CATEGORY_HOME)) { screen = "home"; trail.clear(); }
        if (!validScreen(screen)) screen = "home";
        long task=getIntent().getLongExtra("pocket_task",0);if(savedInstanceState==null&&task>0){captureId=task;captureKind="task";screen="task_detail";if(trail.peek()==null)trail.push(new RouteTrail.Route("today",0,"note",null,"home",""));}
        setupTorch();
        render();
        if (savedInstanceState == null) receiveSharedText(getIntent());
    }

    // Before Android 13 the two-argument registration is the platform-compatible overload.
    // Android 13+ explicitly keeps the app-specific notification broadcast private.
    @android.annotation.SuppressLint("UnspecifiedRegisterReceiverFlag")
    @Override protected void onStart() {
        super.onStart();
        appVisible = true;
        IntentFilter filter = new IntentFilter();
        filter.addAction(Intent.ACTION_BATTERY_CHANGED);
        filter.addAction(Intent.ACTION_TIME_TICK);
        filter.addAction(Intent.ACTION_TIME_CHANGED);
        filter.addAction(Intent.ACTION_TIMEZONE_CHANGED);
        filter.addAction(ConnectivityManager.CONNECTIVITY_ACTION);
        filter.addAction(AlarmManager.ACTION_NEXT_ALARM_CLOCK_CHANGED);
        filter.addAction(PhoneNotifications.ACTION_UPDATED);
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(statusReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(statusReceiver, filter);
        }
        receiverRegistered = true;
    }

    @Override protected void onResume() {
        super.onResume();
        if (stoppedDraft != null && "capture".equals(screen) && captureEditor != null && captureId == stoppedDraftId
                && captureKind.equals(stoppedDraftKind) && stoppedDraft.contentEquals(captureEditor.getText())) {
            PlannerStore.Entry saved = captureId == 0 ? null : planner.find(captureId);
            String latest = planner.hasDraft(captureKind, captureId) ? planner.draft(captureKind, captureId) : saved == null ? "" : saved.text;
            if (!latest.equals(stoppedDraft)) { int start = captureEditor.getSelectionStart(), end = captureEditor.getSelectionEnd(); captureText = latest; captureEditor.setText(latest);
                captureEditor.setSelection(Math.min(Math.max(0, start), latest.length()), Math.min(Math.max(0, end), latest.length())); }
            if ("task".equals(captureKind) && captureStepsEditor != null && captureDue.equals(stoppedDue)
                    && captureImportant == stoppedImportant && captureStepsEditor.getText().toString().equals(stoppedSteps)) {
                PlannerStore.TaskDraft metadata = planner.taskDraft(captureId, saved); captureDue = metadata.due; captureImportant = metadata.important; captureSteps = metadata.steps;
                int start = captureStepsEditor.getSelectionStart(), end = captureStepsEditor.getSelectionEnd(); captureStepsEditor.setText(captureSteps);
                captureStepsEditor.setSelection(Math.min(Math.max(0, start), captureSteps.length()), Math.min(Math.max(0, end), captureSteps.length()));
                ((TextView)content.findViewWithTag("task_due")).setText("Due · " + PlannerDates.label(captureDue));
                ((TextView)content.findViewWithTag("task_important")).setText(captureImportant ? "! Important · on" : "Important · off");
            }
        }
        stoppedDraft = null;
        if("today".equals(screen)||"task_detail".equals(screen))render();else if(planHost!=null)refreshDayPlan();
        NotificationAccess.connect(this);
        if ("home".equals(screen)) { updateHome(); refreshTileLabels(); }
        else if ("settings".equals(screen)) updateHomeStatus();
        else if ("notifications".equals(screen)) render();
        else if ("apps".equals(screen) || "assign".equals(screen)) ensureAppIndex();
    }

    @Override protected void onStop() {
        persistDraft();
        if ("capture".equals(screen)) { stoppedDraft = captureText; stoppedDraftKind = captureKind; stoppedDraftId = captureId; stoppedDue = captureDue; stoppedImportant = captureImportant; stoppedSteps = captureSteps; }
        motion.discardHistory();
        appVisible = false; installedApps = null; indexVersion++; filterGeneration++; if (appFilter != null) appUi.removeCallbacks(appFilter);
        if (receiverRegistered) {
            unregisterReceiver(statusReceiver);
            receiverRegistered = false;
        }
        // Do not leave the torch running after opening another app or locking the phone.
        turnOffOwnedTorch();
        super.onStop();
    }
    @Override protected void onPause() { dismissNoteWheel(); persistDraft(); motion.settle(); super.onPause(); }

    @Override protected void onDestroy() {
        navigation.destroy();
        motion.destroy();
        destroyed = true; draftUi.removeCallbacksAndMessages(null); appUi.removeCallbacksAndMessages(null); appWorker.shutdownNow();
        if (cameraManager != null) cameraManager.unregisterTorchCallback(torchCallback);
        super.onDestroy();
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        state.putBundle("navigation_trail", trail.save());
        Bundle positions = new Bundle(); motion.save(positions::putInt); state.putBundle("page_scrolls", positions);
        state.putString("screen", screen);
        state.putInt("selected", selectedShortcut);
        state.putString("assigning", assigningShortcut);
        state.putString("apps_return", appsReturnTo);
        persistDraft();
        state.putString("capture_kind", captureKind);
        state.putString("capture_text", captureText);
        state.putLong("capture_id", captureId);
        state.putString("app_query", appQuery);
        state.putString("task_filter", taskFilter);
        state.putString("organizer_query", organizerQuery);state.putString("focus_title",focusTitle);
        state.putString("capture_due", captureDue);
        state.putString("capture_steps", captureSteps);
        state.putBoolean("capture_important", captureImportant);
        state.putInt("capture_selection_start", captureSelectionStart);
        state.putInt("capture_selection_end", captureSelectionEnd);
        super.onSaveInstanceState(state);
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if(intent.getLongExtra("pocket_task",0)>0){captureKind="task";openTask(intent.getLongExtra("pocket_task",0));return;}
        if (receiveSharedText(intent)) return;
        if ("today".equals(intent.getStringExtra("pocket_screen"))) { navigate("today"); return; }
        if ("notifications".equals(intent.getStringExtra("pocket_screen"))) { navigate("notifications"); return; }
        if (!workspace() && "settings".equals(intent.getStringExtra("pocket_screen"))) { navigate("settings"); return; }
        if (workspace()) return;
        // Android is already animating the Home gesture. Present the final Home surface immediately.
        if (Intent.ACTION_MAIN.equals(intent.getAction()) && intent.hasCategory(Intent.CATEGORY_HOME)) motion.instant(() -> navigate("home"));
        else navigate("home");
    }

    @Override public void onBackPressed() {
        if (noteWheelShowing()) { dismissNoteWheel(); return; }
        if (trail.peek()!=null) { returnToPrevious(); return; }
        if (workspace() && "today".equals(screen)) { super.onBackPressed(); return; }
        if (!"home".equals(screen)) {persistDraft();if(captureEditor!=null)hideKeyboard(captureEditor);finishPage(backDestination());}
        // A Home app stays on Home when Back is pressed again.
    }
    private String backDestination() {
        if (trail.peek()!=null) return trail.peek().page;
        if ("apps".equals(screen)) return appsReturnTo;
        if ("note_preview".equals(screen)) return "capture";
        if ("capture".equals(screen)) return "task".equals(captureKind) && captureId != 0 ? "task_detail" : "today";
        if ("focus".equals(screen) || "task_detail".equals(screen)) return "today";
        return "home";
    }
    private String backPageKey() { return trail.peek()!=null ? trail.peek().key() : pageKey(backDestination()); }
    private void restoreRoute(RouteTrail.Route route) {
        screen=route.page;captureId=route.id;captureKind=route.kind;assigningShortcut=route.assigning;appsReturnTo=route.appsReturn;appQuery=route.appQuery;
        if ("capture".equals(screen)||"note_preview".equals(screen)) {
            PlannerStore.Entry entry=captureId==0?null:planner.find(captureId);
            captureText=planner.hasDraft(captureKind,captureId)?planner.draft(captureKind,captureId):entry==null?"":entry.text;
            if ("task".equals(captureKind)) {PlannerStore.TaskDraft metadata=planner.taskDraft(captureId,entry);captureDue=metadata.due;captureSteps=metadata.steps;captureImportant=metadata.important;}
        }
    }
    private void returnToPrevious() {
        persistDraft();dismissNoteWheel();if(captureEditor!=null)hideKeyboard(captureEditor);
        RouteTrail.Route parent=trail.pop();if(parent==null)return;
        restoreRoute(parent);motion.back(this::render);
    }
    private void finishPage(String destination) {
        RouteTrail.Route parent=trail.take(pageKey(destination));
        if(parent!=null)restoreRoute(parent);else screen=destination;
        if("home".equals(destination))trail.clear();motion.back(this::render);
    }
    private String pageKey(String page) {
        if ("capture".equals(page) || "note_preview".equals(page)) return page + ":" + captureKind + ":" + captureId;
        if ("task_detail".equals(page)) return page + ":" + captureId;
        if ("assign".equals(page)) return page + ":" + assigningShortcut;
        return page;
    }

    @Override public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (!"home".equals(screen)) return super.onKeyDown(keyCode, event);
        if (keyCode >= KeyEvent.KEYCODE_1 && keyCode <= KeyEvent.KEYCODE_9) {
            int index = keyCode - KeyEvent.KEYCODE_1;
            selectShortcut(index); openShortcut(index); return true;
        }
        int destination = selectedShortcut;
        switch (keyCode) {
            case KeyEvent.KEYCODE_DPAD_UP: destination = Math.max(0, destination - 3); break;
            case KeyEvent.KEYCODE_DPAD_DOWN: destination = Math.min(8, destination + 3); break;
            case KeyEvent.KEYCODE_DPAD_LEFT: destination = Math.max(0, destination - 1); break;
            case KeyEvent.KEYCODE_DPAD_RIGHT: destination = Math.min(8, destination + 1); break;
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER: openShortcut(selectedShortcut); return true;
            default: return super.onKeyDown(keyCode, event);
        }
        selectShortcut(destination);
        return true;
    }

    private boolean validScreen(String value) {
        return "home".equals(value) || "tools".equals(value)
                || "settings".equals(value) || "apps".equals(value)
                || "notifications".equals(value) || "assign".equals(value)
                || "today".equals(value) || "capture".equals(value) || "focus".equals(value)
                || "task_detail".equals(value) || "note_preview".equals(value);
    }

    private int accent() {
        int index = preferences.getInt("accent", 0);
        return ACCENTS[Math.max(0, Math.min(ACCENTS.length - 1, index))];
    }

    private float size(float base) {
        return base * (preferences.getBoolean("large_text", false) ? 1.15f : 1f);
    }

    private boolean twentyFourHour() {
        return preferences.getBoolean("twenty_four_hour", DateFormat.is24HourFormat(this));
    }

    private int dp(float value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void navigate(String destination) {
        persistDraft();
        if (workspace() && "home".equals(destination)) { startActivity(new Intent(this, MainActivity.class).setAction(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); return; }
        if (destination.equals(screen)) { if ("home".equals(screen)) updateHome(); else if ("notifications".equals(screen)) render(); return; }
        boolean backwards = !"home".equals(screen) && destination.equals(backDestination());
        if("home".equals(destination))trail.clear();
        else {
            RouteTrail.Route origin=activeRoute;
            if(origin!=null)trail.push(new RouteTrail.Route(origin.page,origin.id,origin.kind,origin.assigning,origin.appsReturn,appQuery));
        }
        if (!destination.equals(screen) && getCurrentFocus() instanceof EditText) hideKeyboard(getCurrentFocus());
        if (!destination.equals(screen)) appQuery = "";
        if ("apps".equals(destination) && !"apps".equals(screen)) appsReturnTo = screen;
        if("focus".equals(destination))focusTitle="today".equals(screen)?todayFocusTitle:"";
        screen = destination;
        if (backwards) motion.back(this::render); else render();
    }

    private void render() {
        dismissNoteWheel();
        activeRoute=new RouteTrail.Route(screen,captureId,captureKind,assigningShortcut,appsReturnTo,appQuery);
        navigation.update();
        pageGeneration++; filterGeneration++; if (appFilter != null) appUi.removeCallbacks(appFilter); appFilter = null; appRowsReady = false;
        clock = date = network = battery = alarm = torchValue = null;
        homeStatus = null;
        notificationCount = null;
        homeDay = homeHint = null;
        nextTaskText = taskCountText = null;
        captureEditor = null;
        captureStepsEditor = null;planHost=null;todayFilters=todayActions=null;todayDate=null;todayFocusTitle="";planRequest++;
        homeTiles.clear();
        homeIcons.clear();
        homeLabels.clear();
        ScrollView viewport = new ScrollView(this);
        viewport.setBackgroundColor(BACKGROUND);
        viewport.setFillViewport(true);
        viewport.setVerticalScrollBarEnabled(false);
        viewport.setOverScrollMode(View.OVER_SCROLL_NEVER);
        int horizontal = PocketDesign.INSET;
        viewport.setPadding(dp(horizontal), dp(4), dp(horizontal), dp(4));
        viewport.setOnApplyWindowInsetsListener((view, insets) -> {
            int left, top, right, bottom;
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets safe = insets.getInsets(
                        WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                left = safe.left; top = safe.top; right = safe.right; bottom = safe.bottom;
            } else {
                left = insets.getSystemWindowInsetLeft();
                top = insets.getSystemWindowInsetTop();
                right = insets.getSystemWindowInsetRight();
                bottom = insets.getSystemWindowInsetBottom();
            }
            view.setPadding(dp(horizontal) + left, dp(4) + top,
                    dp(horizontal) + right, dp(4) + bottom);
            return insets.consumeSystemWindowInsets();
        });

        content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setGravity(Gravity.TOP);
        viewport.addView(content, new ScrollView.LayoutParams(
                ScrollView.LayoutParams.MATCH_PARENT, ScrollView.LayoutParams.WRAP_CONTENT));

        switch (screen) {
            case "tools": renderTools(); break;
            case "settings": renderSettings(); break;
            case "apps": renderApps(); break;
            case "notifications": renderNotifications(); break;
            case "assign": renderAppPicker(); break;
            case "today": renderToday(); break;
            case "capture": renderCapture(); break;
            case "task_detail": renderTaskDetail(); break;
            case "note_preview": renderNotePreview(); break;
            case "focus": renderFocus(); break;
            default: renderHome(); break;
        }
        View page=viewport;
        if("today".equals(screen)){
            LinearLayout shell=new LinearLayout(this);shell.setOrientation(LinearLayout.VERTICAL);shell.setBackgroundColor(BACKGROUND);shell.setTag("today_workspace");
            shell.setPadding(dp(horizontal),dp(4),dp(horizontal),dp(4));
            shell.setOnApplyWindowInsetsListener((view,insets)->{int left,top,right,bottom;
                if(Build.VERSION.SDK_INT>=30){android.graphics.Insets safe=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout()|WindowInsets.Type.ime());left=safe.left;top=safe.top;right=safe.right;bottom=safe.bottom;}
                else{left=insets.getSystemWindowInsetLeft();top=insets.getSystemWindowInsetTop();right=insets.getSystemWindowInsetRight();bottom=insets.getSystemWindowInsetBottom();}
                view.setPadding(dp(horizontal)+left,dp(4)+top,dp(horizontal)+right,dp(4)+bottom);return insets.consumeSystemWindowInsets();});
            View header=content.findViewWithTag("page_header");content.removeView(header);content.removeView(todayDate);
            shell.addView(header,new LinearLayout.LayoutParams(-1,-2));shell.addView(todayDate,new LinearLayout.LayoutParams(-1,-2));
            viewport.setPadding(0,0,0,0);viewport.setOnApplyWindowInsetsListener(null);viewport.setTag("today_scroll");
            shell.addView(viewport,new LinearLayout.LayoutParams(-1,0,1));shell.addView(todayActions,new LinearLayout.LayoutParams(-1,-2));page=shell;
        }
        motion.show(page, pageKey(screen)); if (appRowsReady || !"apps".equals(screen) && !"assign".equals(screen)) motion.dataReady(); page.requestApplyInsets();if(planHost!=null)refreshDayPlan();
    }

    private TextView text(String label, float sp, int color) {
        TextView text = new TextView(this);
        text.setText(label);
        PocketDesign.text(text, sp, color);
        text.setLayoutParams(new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        return text;
    }

    private ColorStateList interactiveColors(int normal) {
        return new ColorStateList(new int[][] {
                {android.R.attr.state_pressed},
                {android.R.attr.state_focused},
                {android.R.attr.state_selected},
                {}
        }, new int[] {accent(), accent(), accent(), normal});
    }

    private TextView action(String label, float sp, int color, Runnable callback) {
        return actionInto(content, label, sp, color, callback);
    }

    private TextView actionInto(LinearLayout parent, String label, float sp, int color, Runnable callback) {
        TextView view = text(label, sp, color);
        PocketDesign.row(view, color);
        view.setClickable(true);
        view.setFocusable(true);
        view.setOnClickListener(v -> { launchOrigin = v; try { callback.run(); } finally { launchOrigin = null; } });
        parent.addView(view);
        return view;
    }

    private TextView valueAction(String label, String value, Runnable callback) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(0, dp(12), 0, dp(12));
        row.setMinimumHeight(dp(56));
        row.setClickable(true);
        row.setFocusable(true);
        PocketDesign.list(row);
        row.setContentDescription(label + ", " + value);

        TextView title = text(label, 18, PRIMARY);
        title.setTextColor(interactiveColors(PRIMARY));
        title.setDuplicateParentStateEnabled(true);
        title.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        row.addView(title, new LinearLayout.LayoutParams(0,
                LinearLayout.LayoutParams.WRAP_CONTENT, 1));

        TextView detail = text(value, 13, accent());
        detail.setGravity(Gravity.END | Gravity.CENTER_VERTICAL);
        detail.setPadding(dp(12), 0, 0, 0);
        detail.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        row.addView(detail, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        row.setOnClickListener(v -> { launchOrigin = v; try { callback.run(); } finally { launchOrigin = null; } });
        content.addView(row);
        return detail;
    }

    private void gap(int height) {
        View space = new View(this);
        content.addView(space, new LinearLayout.LayoutParams(1, dp(Math.round(height / 4f) * 4)));
    }

    private void flexibleSpace() {
        View space = new View(this);
        LinearLayout.LayoutParams layout = new LinearLayout.LayoutParams(1, 0, 1);
        layout.topMargin = dp(8);
        content.addView(space, layout);
    }

    private void addFeedback() {
        feedback = text("", 14, AMBER);
        feedback.setVisibility(View.GONE);
        feedback.setPadding(0, dp(12), 0, dp(12));
        feedback.setBackgroundColor(BACKGROUND); feedback.setPadding(0, dp(12), 0, dp(12));
        feedback.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        content.addView(feedback);
    }

    private void showFeedback(String message) {
        if (feedback != null) {
            feedback.setText(message);
            feedback.setVisibility(View.VISIBLE);
        }
    }

    private void heading(String title, String backTo) {
        heading(title, backTo, "Home", () -> navigate("home"), false);
    }

    private void heading(String title, String backTo, String rightLabel, Runnable rightAction, boolean commit) {
        LinearLayout header = new LinearLayout(this);header.setTag("page_header"); header.setGravity(Gravity.CENTER_VERTICAL); PocketDesign.header(header);
        TextView previous = text("Back", 14, SECONDARY); PocketDesign.headerControl(previous, SECONDARY); previous.setGravity(Gravity.CENTER);
        previous.setTag("navigation_back");previous.setOnClickListener(v -> onBackPressed()); header.addView(previous, new LinearLayout.LayoutParams(PocketDesign.headerWidth(previous,64), PocketDesign.headerHeight(this)));
        TextView heading = text(title, 24, PRIMARY);
        heading.setTag("page_heading");
        heading.setTypeface(pixelTypeface); heading.setGravity(Gravity.CENTER); heading.setMaxLines(1); heading.setEllipsize(TextUtils.TruncateAt.END);
        if (Build.VERSION.SDK_INT >= 28) heading.setAccessibilityHeading(true);
        header.addView(heading, new LinearLayout.LayoutParams(0, PocketDesign.headerHeight(this), 1));
        TextView right = text(rightLabel, 14, commit ? accent() : SECONDARY); PocketDesign.headerControl(right, commit ? accent() : SECONDARY); right.setGravity(Gravity.CENTER);
        right.setOnClickListener(v -> rightAction.run());if("Settings".equals(rightLabel))right.setTag("app_settings"); header.addView(right, new LinearLayout.LayoutParams(PocketDesign.headerWidth(right,rightLabel.length()>5?96:64), PocketDesign.headerHeight(this)));
        content.addView(header); gap(4);
    }

    private void renderHome() {
        LinearLayout status = new LinearLayout(this);
        status.setOrientation(LinearLayout.HORIZONTAL);
        status.setGravity(Gravity.CENTER_VERTICAL);
        status.setMinimumHeight(dp(28));
        date = text("", 12, SECONDARY);
        date.setSingleLine(true);
        date.setEllipsize(TextUtils.TruncateAt.END);
        status.addView(date, new LinearLayout.LayoutParams(0, -2, 1));
        clock = text("", 12, PRIMARY);
        clock.setPadding(dp(6), 0, dp(6), 0);
        status.addView(clock, new LinearLayout.LayoutParams(-2, -2));
        if (romProfile) clock.setVisibility(View.GONE);
        notificationCount = text("", 12, PRIMARY);
        notificationCount.setGravity(Gravity.CENTER);
        notificationCount.setMinHeight(dp(48)); notificationCount.setMinWidth(dp(48));
        notificationCount.setFocusable(true); notificationCount.setOnClickListener(v -> navigate("notifications"));
        PocketDesign.quiet(notificationCount, PRIMARY); notificationCount.setGravity(Gravity.CENTER);
        status.addView(notificationCount, new LinearLayout.LayoutParams(-2, -2));
        network = text("", 11, SECONDARY);
        network.setSingleLine(true);
        status.addView(network, new LinearLayout.LayoutParams(-2, -2));
        battery = text("", 12, SECONDARY);
        battery.setPadding(dp(8), 0, 0, 0);
        status.addView(battery, new LinearLayout.LayoutParams(-2, -2));
        content.addView(status);
        // Keep the main panel compact: classic phone proportions on a tall touch screen.
        gap(romProfile ? 8 : 16);
        TextView wordmark = text("pocket", 22, accent());
        wordmark.setTypeface(pixelTypeface);
        content.addView(wordmark);
        gap(2);
        TextView bigClock = text("", PocketDesign.DISPLAY, PRIMARY);
        bigClock.setTypeface(pixelTypeface);
        bigClock.setTag("home_clock");
        content.addView(bigClock);
        homeDay = text("", 11, SECONDARY);
        homeDay.setTypeface(Typeface.MONOSPACE);
        homeDay.setLetterSpacing(.08f);
        content.addView(homeDay);
        gap(romProfile ? 12 : 16);
        if (romProfile) renderDashboardAgenda();

        LinearLayout grid = new LinearLayout(this);
        grid.setOrientation(LinearLayout.VERTICAL);
        for (int rowIndex = 0; rowIndex < 3; rowIndex++) {
            LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.HORIZONTAL);
            row.setGravity(Gravity.CENTER_VERTICAL);
            row.setMinimumHeight(dp(romProfile ? 80 : 102));
            for (int column = 0; column < 3; column++) {
                int index = rowIndex * 3 + column;
                LinearLayout tile = new LinearLayout(this) {
                    @Override protected void onMeasure(int widthSpec, int heightSpec) {
                        super.onMeasure(widthSpec, heightSpec);
                        if (romProfile) return;
                        int square = Math.max(getMeasuredWidth(), getMeasuredHeight());
                        super.onMeasure(widthSpec, View.MeasureSpec.makeMeasureSpec(square, View.MeasureSpec.EXACTLY));
                    }
                };
                tile.setOrientation(LinearLayout.VERTICAL);
                tile.setGravity(Gravity.CENTER);
                if (romProfile) tile.setMinimumHeight(dp(72));
                tile.setPadding(dp(8), dp(8), dp(8), dp(8));
                tile.setFocusable(true);
                tile.setClickable(true);
                tile.setTag("tile_" + shortcuts[index]);
                tile.setContentDescription(tiles.label(shortcuts[index]) + ". Hold to edit shortcut.");
                PhoneIcon icon = new PhoneIcon(this, romProfile ? tiles.icon(shortcuts[index]) : index);
                icon.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
                int iconSize = romProfile ? 26 : 34;
                tile.addView(icon, new LinearLayout.LayoutParams(dp(iconSize), dp(iconSize)));
                TextView label = text(tiles.label(shortcuts[index]), 12, PRIMARY);
                label.setTag("tile_label_" + shortcuts[index]); label.setMaxLines(2); label.setEllipsize(TextUtils.TruncateAt.END);
                label.setTypeface(Typeface.MONOSPACE);
                label.setGravity(Gravity.CENTER);
                label.setPadding(0, dp(6), 0, 0);
                label.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
                tile.addView(label);
                tile.setOnClickListener(v -> {
                    v.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY);
                    selectShortcut(index);
                    openShortcut(index);
                });
                tile.setOnLongClickListener(v -> {
                    editShortcut(shortcuts[index]);
                    return true;
                });
                tile.setOnFocusChangeListener((v, focused) -> { if (focused) selectShortcut(index); });
                LinearLayout.LayoutParams cell = new LinearLayout.LayoutParams(0, -2, 1);
                cell.setMargins(dp(4), dp(4), dp(4), dp(4));
                row.addView(tile, cell);
                homeTiles.add(tile);
                homeIcons.add(icon);
                homeLabels.add(label);
            }
            grid.addView(row, new LinearLayout.LayoutParams(-1, -2));
        }
        content.addView(grid, new LinearLayout.LayoutParams(-1, -2));
        if (!romProfile) {
            gap(14);
            nextTaskText = action("", 13, accent(), () -> navigate("today"));
            nextTaskText.setMinHeight(dp(48));
            nextTaskText.setSingleLine(true);
            nextTaskText.setEllipsize(TextUtils.TruncateAt.END);
            nextTaskText.setVisibility(View.GONE);
            homeHint = text("", 13, SECONDARY);
            homeHint.setVisibility(View.GONE);
            content.addView(homeHint);
        }
        flexibleSpace();
        addFeedback();
        LinearLayout footer = new LinearLayout(this);
        footer.setOrientation(LinearLayout.HORIZONTAL);
        String[] names = {"notifs", "select", "all"};
        for (int i = 0; i < names.length; i++) {
            int item = i;
            TextView link = text(names[i], 21, accent());
            link.setTypeface(pixelTypeface);
            PocketDesign.quiet(link, accent());
            link.setGravity(i == 0 ? Gravity.START | Gravity.CENTER_VERTICAL
                    : i == 2 ? Gravity.END | Gravity.CENTER_VERTICAL : Gravity.CENTER);
            link.setMinHeight(dp(56));
            link.setPadding(dp(8), dp(12), dp(8), dp(12));
            link.setFocusable(true);
            link.setOnClickListener(v -> {
                if (item == 0) navigate("notifications");
                else if (item == 1) openShortcut(selectedShortcut);
                else navigate("apps");
            });
            footer.addView(link, new LinearLayout.LayoutParams(0, -2, 1));
        }
        PocketDesign.header(footer); content.addView(footer);
        selectShortcut(selectedShortcut);
        updateHome();
    }

    private void renderDashboardAgenda() {
        LinearLayout agenda = new LinearLayout(this); agenda.setOrientation(LinearLayout.VERTICAL);
        agenda.setPadding(0, dp(4), 0, dp(4));
        taskCountText = text("", 11, accent());
        taskCountText.setLetterSpacing(.06f);
        agenda.addView(taskCountText);
        nextTaskText = actionInto(agenda, "", 16, PRIMARY, () -> {
            try {
                if (planner.nextTask() == null) openCapture("task", 0, "");
                else openTask(planner.nextTask().id);
            } catch (IllegalStateException error) { showFeedback("Organizer data unavailable"); }
        });
        nextTaskText.setTag("dashboard_next");
        PocketDesign.quiet(nextTaskText, PRIMARY); nextTaskText.setMinHeight(dp(52));
        nextTaskText.setPadding(0, dp(6), 0, dp(6));
        nextTaskText.setMaxLines(2);
        nextTaskText.setEllipsize(TextUtils.TruncateAt.END);
        planHost=new LinearLayout(this);planHost.setOrientation(LinearLayout.VERTICAL);planHost.setTag("dashboard_plan");homePlan=true;agenda.addView(planHost);
        homeHint = actionInto(agenda, "", 13, SECONDARY,
                () -> openPocket(ClockActivity.class));
        homeHint.setTag("dashboard_alarm");
        PocketDesign.quiet(homeHint, SECONDARY); homeHint.setMinHeight(dp(52));
        homeHint.setPadding(0, dp(8), 0, dp(8));
        homeHint.setSingleLine(true);
        homeHint.setEllipsize(TextUtils.TruncateAt.END);
        content.addView(agenda); gap(8);

        LinearLayout quick = new LinearLayout(this);
        quick.setOrientation(LinearLayout.HORIZONTAL);
        String[] labels = {"+ task", "+ note", "focus"};
        for (int i = 0; i < labels.length; i++) {
            int item = i;
            TextView link = actionInto(quick, labels[i], 14, accent(), () -> {
                if (item == 0) openCapture("task", 0, "");
                else if (item == 1) openCapture("note", 0, "");
                else navigate("focus");
            });
            link.setTag("dashboard_quick_" + i);
            PocketDesign.control(link);
            PocketDesign.quiet(link, accent());
            LinearLayout.LayoutParams cell = new LinearLayout.LayoutParams(0, -2, 1); if (i > 0) cell.leftMargin = dp(4); link.setLayoutParams(cell);
        }
        content.addView(quick);
        gap(8);
    }

    private void selectShortcut(int index) {
        selectedShortcut = Math.max(0, Math.min(8, index));
        for (int i = 0; i < homeTiles.size(); i++) {
            boolean selected = i == selectedShortcut;
            homeTiles.get(i).setBackground(PocketDesign.tile(this, selected));
            homeTiles.get(i).setSelected(selected);
            homeLabels.get(i).setTextColor(selected ? BACKGROUND : PRIMARY);
            homeIcons.get(i).setTint(selected ? BACKGROUND : PRIMARY, selected ? accent() : BACKGROUND);
        }
    }

    private void openShortcut(int index) {
        if (index < 0 || index >= shortcuts.length) return;
        String shortcut = shortcuts[index];
        if (romProfile && tiles.group(shortcut)) {
            turnOffOwnedTorch(); startActivity(new Intent(this, TileGroupActivity.class).putExtra("slot", shortcut).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); return;
        }
        String assigned = tiles.app(shortcut);
        if (assigned != null) {
            Intent app = getPackageManager().getLaunchIntentForPackage(assigned);
            if (app != null) { launch(shortcut, app); return; }
            showFeedback("Your chosen app was removed. Hold the shortcut to choose another.");
            return;
        }
        if (romProfile) { openPocketApp(tiles.pocket(shortcut)); return; }
        switch (index) {
            case 0:
                if (!launchPackageIfInstalled("org.thoughtcrime.securesms")) assignShortcut(shortcut);
                break;
            case 1:
                if (!launchPackageIfInstalled("com.whatsapp")
                        && !launchPackageIfInstalled("com.whatsapp.w4b")) assignShortcut(shortcut);
                break;
            case 2: openMessages(); break;
            case 3: openPocket(ContactsActivity.class); break;
            case 4: openPocket(PhoneActivity.class); break;
            case 5: navigate("settings"); break;
            case 6: launch("Maps", new Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0"))); break;
            case 7: openCamera(); break;
            case 8:
                if (!launchPackageIfInstalled("com.ubercab")
                        && !launchPackageIfInstalled("ee.mtakso.client")
                        && !launchPackageIfInstalled("taxi.android.client")) assignShortcut(shortcut);
                break;
            default: break;
        }
    }

    private void openPocketApp(String id) {
        if ("settings".equals(id)) navigate("settings");
        else if ("camera".equals(id)) openCamera();
        else if (PocketApps.activity(id) != null) openPocket(PocketApps.activity(id));
    }

    private boolean launchPackageIfInstalled(String packageName) {
        Intent intent = getPackageManager().getLaunchIntentForPackage(packageName);
        if (intent == null) return false;
        try { startActivity(intent); return true; }
        catch (ActivityNotFoundException | SecurityException ignored) { return false; }
    }

    private void openCamera() {
        turnOffOwnedTorch();
        startActivity(new Intent(this, CompactCameraActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    }

    private void openPocket(Class<? extends android.app.Activity> activity) {
        turnOffOwnedTorch(); startActivity(new Intent(this, activity).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    }
    @Override public void startActivity(Intent intent) {
        View source = launchOrigin;
        if (source == null && "home".equals(screen) && selectedShortcut < homeTiles.size()) source = homeTiles.get(selectedShortcut);
        PocketLaunch.open(this, intent, source == null ? getCurrentFocus() : source);
    }

    private void assignShortcut(String shortcut) {
        assigningShortcut = shortcut;
        navigate("assign");
    }

    /** Each choice is a label and what it does; the list only shows choices that apply to this tile. */
    private void choose(String title, List<String> labels, List<Runnable> actions) {
        new AlertDialog.Builder(this).setTitle(title).setItems(labels.toArray(new String[0]), (dialog, item) -> {
            if ("home".equals(screen) && !destroyed) actions.get(item).run();
        }).show();
    }
    private void editRomTile(String slot) {
        List<String> labels = new ArrayList<>(); List<Runnable> actions = new ArrayList<>();
        if (tiles.group(slot)) {
            labels.add("Open group"); actions.add(() -> openShortcut(java.util.Arrays.asList(shortcuts).indexOf(slot)));
            labels.add("Rename group"); actions.add(() -> renameShortcut(slot));
            labels.add("Move to…"); actions.add(() -> moveTile(slot));
            labels.add("Ungroup"); actions.add(() -> ungroup(slot));
        } else {
            labels.add("Installed app"); actions.add(() -> assignShortcut(slot));
            labels.add("Pocket app"); actions.add(() -> choosePocketApp(slot));
            labels.add("Make a group"); actions.add(() -> makeGroup(slot));
            labels.add("Move to…"); actions.add(() -> moveTile(slot));
            labels.add("Rename"); actions.add(() -> renameShortcut(slot));
            if (tiles.app(slot) != null) { labels.add("Use app name"); actions.add(() -> { tiles.useAppName(slot); updateTileNames(); }); }
            labels.add("Reset tile"); actions.add(() -> { tiles.reset(slot); refreshTiles(); });
        }
        choose(tiles.label(slot), labels, actions);
    }
    private void refreshTiles() { if ("home".equals(screen)) { render(); refreshTileLabels(); } }
    private void choosePocketApp(String slot) {
        List<String> labels = new ArrayList<>(); List<Runnable> actions = new ArrayList<>();
        for (String id : PocketApps.IDS) { labels.add(id); actions.add(() -> { tiles.usePocket(slot, id); refreshTiles(); }); }
        choose("Pocket app", labels, actions);
    }
    private void moveTile(String slot) {
        List<String> labels = new ArrayList<>(); List<Runnable> actions = new ArrayList<>();
        for (int i = 0; i < shortcuts.length; i++) {
            int target = i; String other = shortcuts[i]; if (other.equals(slot)) continue;
            labels.add((i + 1) + " · swap with " + tiles.label(other));
            actions.add(() -> { tiles.swap(slot, other); selectedShortcut = target; refreshTiles(); });
        }
        choose("Move " + tiles.label(slot), labels, actions);
    }
    private void makeGroup(String slot) {
        EditText name = new EditText(this); name.setTag("group_name_editor"); name.setSingleLine(true); name.setHint("tools");
        name.setFilters(new InputFilter[]{new InputFilter.LengthFilter(40)}); PocketDesign.input(name);
        new AlertDialog.Builder(this).setTitle("Group name").setView(name).setNegativeButton("Cancel", null)
                .setPositiveButton("Make group", (dialog, button) -> {
                    if (!"home".equals(screen) || destroyed) return;
                    tiles.makeGroup(slot, name.getText().toString()); refreshTiles();
                    showFeedback("Group made. Tap it to add up to nine apps.");
                }).show();
    }
    /** The group's first app goes back on the tile; the rest leave Home but stay installed. */
    private void ungroup(String slot) {
        List<DashboardTiles.Member> members = tiles.members(slot);
        new AlertDialog.Builder(this).setTitle("Ungroup " + tiles.label(slot) + "?")
                .setMessage(members.isEmpty() ? "The tile goes back to its default app." : "The tile keeps " + members.get(0).label + "."
                        + (members.size() > 1 ? " The other " + (members.size() - 1) + " leave Home." : ""))
                .setNegativeButton("Cancel", null).setPositiveButton("Ungroup", (dialog, button) -> {
                    if (!"home".equals(screen) || destroyed) return;
                    if (members.isEmpty()) tiles.reset(slot);
                    else if (members.get(0).pocket != null) tiles.usePocket(slot, members.get(0).pocket);
                    else { tiles.reset(slot); tiles.assign(slot, members.get(0).app, members.get(0).label); }
                    refreshTiles();
                }).show();
    }

    private void editShortcut(String slot) {
        if (romProfile) { editRomTile(slot); return; }
        String[] options = {"Change app", "Rename", "Use app name", "Reset shortcut"};
        new AlertDialog.Builder(this).setTitle(tiles.label(slot)).setItems(options, (dialog, item) -> {
            if (!"home".equals(screen)) return;
            if (item == 0) assignShortcut(slot);
            else if (item == 1) renameShortcut(slot);
            else if (item == 2) { tiles.useAppName(slot); updateTileNames(); }
            else { tiles.reset(slot); updateTileNames(); }
        }).show();
    }
    private void renameShortcut(String slot) {
        EditText name = new EditText(this); name.setTag("tile_name_editor"); name.setSingleLine(true);
        name.setText(tiles.label(slot)); name.selectAll(); name.setFilters(new InputFilter[]{new InputFilter.LengthFilter(40)});
        PocketDesign.input(name);
        new AlertDialog.Builder(this).setTitle("Shortcut name").setView(name).setNegativeButton("Cancel", null)
                .setPositiveButton("Save", (dialog, button) -> {
                    if (!"home".equals(screen)) return;
                    tiles.rename(slot, name.getText().toString()); updateTileNames();
                }).show();
    }
    private void updateTileNames() {
        if (!"home".equals(screen)) return;
        for (int i = 0; i < homeLabels.size(); i++) {
            String label = tiles.label(shortcuts[i]); homeLabels.get(i).setText(label);
            homeTiles.get(i).setContentDescription(label + ". Hold to edit shortcut.");
        }
    }
    private void refreshTileLabels() {
        if (destroyed || !appVisible || tileLabelsLoading) return;
        java.util.Map<String, String> bindings = new java.util.LinkedHashMap<>();
        for (String slot : shortcuts) { String app = tiles.app(slot); if (app != null) bindings.put(slot, app); }
        if (bindings.isEmpty()) return;
        tileLabelsLoading = true;
        appWorker.execute(() -> {
            java.util.Map<String, String> labels = new java.util.LinkedHashMap<>();
            for (java.util.Map.Entry<String, String> binding : bindings.entrySet()) {
                if (Thread.currentThread().isInterrupted()) break;
                try {
                    Intent launch = getPackageManager().getLaunchIntentForPackage(binding.getValue());
                    if (launch != null && launch.getComponent() != null) labels.put(binding.getKey(),
                            getPackageManager().getActivityInfo(launch.getComponent(), 0).loadLabel(getPackageManager()).toString());
                    else labels.put(binding.getKey(), getPackageManager().getApplicationInfo(binding.getValue(), 0).loadLabel(getPackageManager()).toString());
                } catch (PackageManager.NameNotFoundException | SecurityException ignored) { /* Keep last known name for a removed app. */ }
            }
            appUi.post(() -> {
                tileLabelsLoading = false; if (destroyed) return;
                for (java.util.Map.Entry<String, String> label : labels.entrySet()) tiles.resolved(label.getKey(), bindings.get(label.getKey()), label.getValue());
                updateTileNames();
            });
        });
    }

    private void renderAppPicker() {
        heading(assigningShortcut, "home");
        content.addView(text("Choose an installed app for this shortcut.", 16, SECONDARY));
        gap(16);
        action("Use default", 20, accent(), () -> {
            tiles.reset(assigningShortcut);
            navigate("home");
        });
        addInstalledApps(true);
        addFeedback();
    }

    private void updateHome() {
        if (clock == null) return;
        updateTileNames();
        Locale locale = Locale.getDefault();
        Date now = new Date();
        clock.setText(new SimpleDateFormat(twentyFourHour() ? "HH:mm" : "h:mm a", locale).format(now));
        clock.setTypeface(Typeface.MONOSPACE);
        TextView bigClock = content.findViewWithTag("home_clock");
        if (bigClock != null) {
            bigClock.setText(new SimpleDateFormat(twentyFourHour() ? "HH:mm" : "h:mm", locale).format(now));
            bigClock.setContentDescription(clock.getText());
        }
        if (homeDay != null) homeDay.setText(
                new SimpleDateFormat("EEE dd MMM", locale).format(now).toUpperCase(locale));
        date.setText(carrierName());
        String connection = networkStatus();
        network.setText(connection.replace("Mobile data", "Mobile").replace("Data offline", "Offline")
                .replace("Airplane mode", "Airplane").replace(" · No internet", ""));
        network.setContentDescription(connection);
        StatusBarNotification[] notices = NotificationAccess.allowed(this) ? PhoneNotifications.active() : new StatusBarNotification[0];
        notificationCount.setText("[" + notices.length + "]");
        notificationCount.setContentDescription(notices.length + " active notifications. Open notifications.");

        Intent state = registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        int level = state == null ? -1 : state.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
        int scale = state == null ? -1 : state.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
        int status = state == null ? -1 : state.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
        boolean charging = status == BatteryManager.BATTERY_STATUS_CHARGING
                || status == BatteryManager.BATTERY_STATUS_FULL;
        battery.setText(level >= 0 && scale > 0 ? Math.round(level * 100f / scale) + "%" : "—");
        battery.setContentDescription(StatusText.battery(level, scale, charging));
        boolean low = level >= 0 && scale > 0 && level * 100f / scale <= 15;
        battery.setTextColor(low ? AMBER : PRIMARY);
        if (nextTaskText != null) {
            try {
                PlannerStore.Entry next = planner.nextTask();
                if (romProfile) {
                    int count = planner.openTasks();
                    taskCountText.setText(getString(R.string.dashboard_task_count, count));
                    taskCountText.setContentDescription(count + " open tasks");
                    nextTaskText.setText(next == null ? "No open tasks" : next.text);
                    nextTaskText.setContentDescription(next == null ? "No open tasks. Add a task."
                            : "Next task: " + next.text + ". Open Today.");
                } else {
                    nextTaskText.setVisibility(next == null ? View.GONE : View.VISIBLE);
                    nextTaskText.setText(next == null ? "" : "next [" + planner.openTasks() + "]  " + next.text);
                }
            } catch (IllegalStateException error) {
                if (taskCountText != null) taskCountText.setText(R.string.dashboard_next);
                nextTaskText.setVisibility(View.VISIBLE);
                nextTaskText.setText(R.string.organizer_unavailable);
                nextTaskText.setContentDescription(getString(R.string.organizer_unavailable));
            }
        }
        for (int i = 0; i < homeIcons.size(); i++) {
            boolean hasNotification = false;
            for (StatusBarNotification notice : notices) {
                String pkg = notice.getPackageName();
                String assigned = preferences.getString("shortcut_" + shortcuts[i], null);
                String sms = Telephony.Sms.getDefaultSmsPackage(this);
                boolean messages = romProfile && !tiles.group(shortcuts[i]) && "messages".equals(tiles.pocket(shortcuts[i]));
                if (pkg.equals(assigned) || (messages && (pkg.equals(sms)||assigned==null&&NoticeFeed.message(notice)))
                        || (!romProfile && ((i == 0 && pkg.equals("org.thoughtcrime.securesms"))
                        || (i == 1 && pkg.startsWith("com.whatsapp"))
                        || (i == 2 && pkg.equals(sms))))) hasNotification = true;
            }
            homeIcons.get(i).setNotificationDot(hasNotification);
        }
        if (homeHint != null) {
            AlarmManager manager = (AlarmManager) getSystemService(ALARM_SERVICE);
            AlarmManager.AlarmClockInfo next = manager == null ? null : manager.getNextAlarmClock();
            homeHint.setVisibility(next == null && !romProfile ? View.GONE : View.VISIBLE);
            homeHint.setText(next == null ? (romProfile ? "Set alarm" : "")
                    : StatusText.alarm(next.getTriggerTime(), locale, twentyFourHour()));
            if (romProfile) homeHint.setContentDescription(next == null ? "No alarm set. Open Clock."
                    : homeHint.getText() + ". Open Clock.");
        }
    }

    private String carrierName() {
        TelephonyManager telephony = (TelephonyManager) getSystemService(TELEPHONY_SERVICE);
        if (telephony != null) {
            try {
                String carrier = telephony.getSimOperatorName();
                if (carrier != null && !carrier.trim().isEmpty()) return carrier;
                if (telephony.getSimState() == TelephonyManager.SIM_STATE_ABSENT) return "No SIM";
            } catch (SecurityException ignored) { /* Some vendor builds restrict SIM labels. */ }
        }
        return "Phone";
    }

    private String networkStatus() {
        boolean airplane = Settings.Global.getInt(getContentResolver(),
                Settings.Global.AIRPLANE_MODE_ON, 0) != 0;
        ConnectivityManager connectivity = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        NetworkCapabilities capabilities = connectivity == null ? null
                : connectivity.getNetworkCapabilities(connectivity.getActiveNetwork());
        if (capabilities != null) {
            String connection;
            if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) connection = "Wi-Fi";
            else if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) connection = "Mobile data";
            else if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) connection = "Ethernet";
            else if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) connection = "VPN";
            else connection = "Connected";
            if (!capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)) {
                connection += " · No internet";
            }
            return airplane ? "Airplane mode · " + connection : connection;
        }
        return airplane ? "Airplane mode" : "Data offline";
    }

    private void renderTools() {
        heading("Tools", "home");
        action("Today", 20, accent(), () -> navigate("today"));
        action("Alarm", 20, PRIMARY, () -> openPocket(ClockActivity.class));
        action("Calendar", 20, PRIMARY, () -> openPocket(AgendaActivity.class));
        action("Camera", 20, PRIMARY, this::openCamera);
        action("Calculator", 20, PRIMARY, () -> openPocket(CalculatorActivity.class));
        if (preferences.getBoolean("show_maps", true)) {
            action("Maps", 20, PRIMARY, () -> launch("Maps", new Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0"))));
        }
        if (torchCamera != null) {
            torchValue = valueAction("Flashlight", torchOn ? "On" : "Off", this::toggleTorch);
        } else {
            valueAction("Flashlight", "Unavailable", () -> showFeedback("This phone has no available flashlight."));
        }
        flexibleSpace();
        addFeedback();
    }

    private void renderSettings() {
        heading("Settings", "home");
        valueAction("Text size", preferences.getBoolean("large_text", false) ? "Large" : "Standard", () -> {
            preferences.edit().putBoolean("large_text", !preferences.getBoolean("large_text", false)).apply();
            render();
        });
        valueAction("Colour", ACCENT_NAMES[Math.max(0, Math.min(3, preferences.getInt("accent", 0)))], () -> {
            preferences.edit().putInt("accent", (preferences.getInt("accent", 0) + 1) % ACCENTS.length).apply();
            render();
        });
        valueAction("Clock", twentyFourHour() ? "24-hour" : "12-hour", () -> {
            preferences.edit().putBoolean("twenty_four_hour", !twentyFourHour()).apply();
            render();
        });
        valueAction("Motion", preferences.getBoolean("reduce_motion", false) ? "Off" : "Android", () -> {
            preferences.edit().putBoolean("reduce_motion", !preferences.getBoolean("reduce_motion", false)).apply(); render();
        });
        gap(16);
        homeStatus = valueAction("Use as home screen", "", this::chooseHome);
        homeStatus.setTag("home_default_status"); updateHomeStatus();
        action("Tools", 18, PRIMARY, () -> navigate("tools"));
        action("All apps", 18, PRIMARY, () -> navigate("apps"));
        action("Phone settings", 18, PRIMARY, () -> openPocket(DeviceSettingsActivity.class));
        action("Permissions", 18, PRIMARY, () -> openPocket(PermissionsActivity.class));
        if (romProfile) action("Cloud sync", 18, PRIMARY, () -> openPocket(CloudActivity.class));
        flexibleSpace();
        addFeedback();
        TextView version = text("Pocket Phone 0.5.13\nHold a shortcut to change its app or name.", 13, SECONDARY);
        version.setPadding(0, dp(16), 0, dp(16));
        content.addView(version);
    }

    private void renderApps() {
        heading("All apps", appsReturnTo);
        action("Tools", 18, accent(), () -> navigate("tools"));
        action("Settings", 18, accent(), () -> navigate("settings"));
        addInstalledApps(false);
        addFeedback();
    }

    private void addInstalledApps(boolean assign) {
        int page = pageGeneration;
        EditText search = new EditText(this);
        search.setTag("app_search");
        search.setTextColor(PRIMARY); search.setHintTextColor(SECONDARY);
        search.setTypeface(Typeface.MONOSPACE); search.setTextSize(16);
        search.setSingleLine(true); search.setHint("Find app: name or 2–9");
        search.setText(appQuery); search.setMinHeight(dp(48));
        PocketDesign.input(search);
        content.addView(search, new LinearLayout.LayoutParams(-1, -2));
        LinearLayout results = new LinearLayout(this);
        results.setOrientation(LinearLayout.VERTICAL); results.setTag("app_results");
        content.addView(results, new LinearLayout.LayoutParams(-1, -2));
        Runnable filter = () -> {
            if (page != pageGeneration || destroyed) return;
            int filtered = ++filterGeneration; results.removeAllViews();
            if (installedApps == null) { results.addView(text("Loading apps…", 16, SECONDARY)); ensureAppIndex(); return; }
            List<InstalledApps.Entry> matches = new ArrayList<>(); for (InstalledApps.Entry entry : installedApps) if (AppSearch.matches(entry.label, appQuery)) matches.add(entry);
            if (matches.isEmpty()) { results.addView(text(appQuery.isEmpty() ? "No other apps found" : "No matches", 16, SECONDARY)); appRowsReady = true; motion.dataReady(); return; }
            appendApps(matches, 0, results, search, assign, page, filtered);
        };
        appFilter = filter;
        search.addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence value, int start, int count, int after) { }
            public void onTextChanged(CharSequence value, int start, int before, int count) {
                appQuery = value.toString(); filterGeneration++; appUi.removeCallbacks(filter); appUi.postDelayed(filter, 80);
            }
            public void afterTextChanged(Editable value) { }
        });
        filter.run();
    }
    private void ensureAppIndex() {
        if (installedApps != null) { if (appFilter != null) appFilter.run(); return; }
        if (indexLoading || destroyed) return; indexLoading = true; int version = indexVersion;
        Context context = getApplicationContext();
        appWorker.submit(() -> {
            List<InstalledApps.Entry> entries; try { entries = InstalledApps.read(context); } catch (RuntimeException error) { entries = null; }
            List<InstalledApps.Entry> result = entries;
            appUi.post(() -> { if (destroyed) return; indexLoading = false;
                if (version == indexVersion && result != null) installedApps = result;
                if (!appVisible || !("apps".equals(screen) || "assign".equals(screen))) return;
                if (version != indexVersion) { ensureAppIndex(); return; }
                if (result == null) { showFeedback("Could not load installed apps. Reopen All apps to retry."); return; }
                if (appFilter != null) appFilter.run();
            });
        });
    }
    private void appendApps(List<InstalledApps.Entry> matches, int start, LinearLayout results, EditText search, boolean assign, int page, int filtered) {
        if (page != pageGeneration || filtered != filterGeneration || destroyed || !appVisible) return;
        int end = Math.min(matches.size(), start + 24);
        for (int i = start; i < end; i++) { InstalledApps.Entry app = matches.get(i);
            actionInto(results, app.label, 16, PRIMARY, () -> { hideKeyboard(search);
                if (assign) { tiles.assign(assigningShortcut, app.packageName, app.label); navigate("home"); }
                else launch(app.label, new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setClassName(app.packageName, app.activityName)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED));
            });
        }
        if (end < matches.size()) results.postOnAnimation(() -> appendApps(matches, end, results, search, assign, page, filtered));
        else { appRowsReady = true; motion.dataReady(); }
    }

    private void plannerAction(Runnable action) {
        try { action.run(); }
        catch (IllegalArgumentException | IllegalStateException error) { showFeedback(error.getMessage()); }
    }

    private void captureNoteTask(){persistDraft();if(captureText.trim().isEmpty()){showFeedback("Write a note first.");return;}startActivity(TaskCaptureActivity.intent(this,TaskSource.note(captureId,captureText)));}
    private void captureDrafts(){List<CaptureDrafts.Draft> drafts=CaptureDrafts.list(this);if(drafts.isEmpty()){showFeedback("No task drafts.");return;}String[] names=new String[drafts.size()];for(int i=0;i<names.length;i++)names[i]=drafts.get(i).title.isEmpty()?drafts.get(i).source.name:drafts.get(i).title;
        new AlertDialog.Builder(this).setTitle("Task drafts").setItems(names,(dialog,index)->{CaptureDrafts.Draft draft=drafts.get(index);new AlertDialog.Builder(this).setTitle(names[index]).setItems(new String[]{"Continue","Discard"},(choice,which)->{if(which==0)startActivity(new Intent(this,TaskCaptureActivity.class).putExtra("draft_key",draft.key));else new AlertDialog.Builder(this).setTitle("Discard this task draft?").setNegativeButton("Keep",null).setPositiveButton("Discard",(confirm,button)->{CaptureDrafts.clear(this,draft.key,draft.token);render();}).show();}).show();}).setNegativeButton("Cancel",null).show();}
    private void organizerSettings(){new AlertDialog.Builder(this).setTitle("Today settings").setItems(new String[]{"Share tasks and notes","Export Markdown","Task drafts","Calendar settings","Focus timer"},(dialog,index)->{
        if(index==0)launch("Share",Intent.createChooser(new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT,planner.exportText()),"Share tasks and notes"));
        else if(index==1){try{startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("text/markdown").putExtra(Intent.EXTRA_TITLE,"pocket-notes.md"),EXPORT_REQUEST);}catch(ActivityNotFoundException|SecurityException e){showFeedback("Files is unavailable.");}}
        else if(index==2)captureDrafts();else if(index==4)navigate("focus");else startActivity(new Intent(this,AgendaActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("app_settings",true));}).setNegativeButton("Close",null).show();}
    private void openTaskSource(TaskSource source){if(source.kind.equals("note")&&source.note>0){PlannerStore.Entry note=planner.find(source.note);if(note!=null){openCapture("note",note.id,note.text);return;}}
        if(source.kind.equals("message")){NoticeFeed.Item notice=NoticeFeed.find(source.ref);if(NotificationAccess.allowed(this)&&notice!=null&&notice.identity().equals(source.identity)){try{NoticeActions.open(this,notice);return;}catch(android.app.PendingIntent.CanceledException|RuntimeException expired){}}Intent app=getPackageManager().getLaunchIntentForPackage(source.pkg);if(app!=null){startActivity(app);return;}}
        String link=source.kind.equals("shared")?source.link():"";if(!link.isEmpty()){startActivity(new Intent(Intent.ACTION_VIEW,android.net.Uri.parse(link)));return;}
        TextView context=text(source.text,16,PRIMARY);context.setTextIsSelectable(true);ScrollView scroll=new ScrollView(this);scroll.setPadding(dp(16),dp(8),dp(16),dp(8));scroll.addView(context);new AlertDialog.Builder(this).setTitle(source.name).setView(scroll).setPositiveButton("Close",null).show();}
    private void refreshDayPlan(){if(planHost==null||destroyed)return;int request=++planRequest,page=pageGeneration;boolean home=homePlan;LinearLayout target=planHost;long selected=CalendarBridge.selected(this);android.content.Context app=getApplicationContext();
        try{drawDayPlan(target,DayPlan.local(app,System.currentTimeMillis()),home);}catch(IllegalStateException failure){return;}
        appWorker.submit(()->{DayPlan.Result plan;try{plan=DayPlan.read(app,System.currentTimeMillis());}catch(RuntimeException unavailable){return;}appUi.post(()->{if(destroyed||!appVisible||page!=pageGeneration||request!=planRequest||target!=planHost||selected!=CalendarBridge.selected(this))return;drawDayPlan(target,plan,home);motion.dataReady();});});}
    private void drawDayPlan(LinearLayout target,DayPlan.Result plan,boolean home){
        target.removeAllViews();target.setVisibility(View.VISIBLE);
        if(home){DayPlan.Item next=plan.next();if(next==null){target.setVisibility(View.GONE);return;}planRow(target,next,plan,true);return;}
        DayPlan.Item focus=plan.next();
        for(DayPlan.Item item:plan.items)if(!item.allDay&&item.when<=plan.now&&item.end>plan.now){focus=item;break;}
        todayFocusTitle=focus==null||!organizerQuery.trim().isEmpty()?"":focus.title;
        if(!organizerQuery.trim().isEmpty()||focus==null){target.setVisibility(View.GONE);return;}
        DayPlan.Item item=focus;boolean current=item.when<=plan.now&&item.end>plan.now;
        String time=item.allDay?"All day":new SimpleDateFormat(twentyFourHour()?"HH:mm":"h:mma",Locale.getDefault()).format(new Date(item.when));
        String day=item.when>=plan.start&&item.when<plan.end?"Today":new SimpleDateFormat("EEE d MMM",Locale.getDefault()).format(new Date(item.when));
        LinearLayout hero=new LinearLayout(this);hero.setOrientation(LinearLayout.VERTICAL);hero.setPadding(0,dp(8),0,dp(8));hero.setTag("today_event_"+item.id);hero.setMinimumHeight(dp(56));PocketDesign.list(hero);hero.setFocusable(true);
        TextView timeView=todayText(time,16,accent(),false);timeView.setTag("today_focus_time");hero.addView(timeView);
        TextView title=todayText(item.title,18,PRIMARY,false);title.setPadding(0,dp(8),0,dp(8));title.setTag("today_focus_title");hero.addView(title);
        TextView meta=todayText((current?"Now · ":"Next · ")+day+" · "+item.source,12,accent(),false);meta.setTag("today_focus_meta");hero.addView(meta);
        hero.setContentDescription(time+", "+item.title+", "+meta.getText());for(int i=0;i<hero.getChildCount();i++)hero.getChildAt(i).setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        hero.setOnClickListener(view->{if(item.external)startActivity(new Intent(Intent.ACTION_VIEW,android.content.ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI,item.id)));else startActivity(new Intent(this,AgendaActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("appointment_id",item.id));});target.addView(hero);
        if(!plan.issue.isEmpty())target.addView(todayText(plan.issue+" · Settings",12,SECONDARY,false));
    }
    private void planRow(LinearLayout host,DayPlan.Item item,DayPlan.Result plan,boolean home){boolean current=item.when<=plan.now&&item.end>plan.now;String time=item.allDay?"All day":new SimpleDateFormat(twentyFourHour()?"HH:mm":"h:mma",Locale.getDefault()).format(new Date(item.when));String day=item.when>=plan.start&&item.when<plan.end?"Today":new SimpleDateFormat("EEE d MMM",Locale.getDefault()).format(new Date(item.when));
        Runnable open=()->{if(item.external)startActivity(new Intent(Intent.ACTION_VIEW,android.content.ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI,item.id)));else startActivity(new Intent(this,AgendaActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("appointment_id",item.id));};
        LinearLayout row=new LinearLayout(this);row.setGravity(Gravity.CENTER_VERTICAL);row.setTag((home?"dashboard_event_":"today_event_")+item.id);row.setMinimumHeight(dp(56));PocketDesign.list(row);row.setFocusable(true);row.setOnClickListener(v->open.run());
        TextView clock=text(time,home?14:16,current?accent():PRIMARY);clock.setPadding(0,dp(8),dp(8),dp(8));row.addView(clock,new LinearLayout.LayoutParams(dp(76),-2));
        LinearLayout title=ReadableRows.item(this,item.title,(current?"Now · ":"")+day+(home?"":" · "+item.source),current?accent():SECONDARY,"plan_title_"+item.id,null);row.addView(title,new LinearLayout.LayoutParams(0,-2,1));
        row.setContentDescription(day+", "+time+", "+item.title+", "+item.source);clock.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);title.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);host.addView(row);}

    private float todaySize(float sp){return sp*(preferences.getBoolean("large_text",false)?1.15f:1f);}
    private TextView todayText(String value,float sp,int color,boolean bold){TextView view=text(value,sp,color);view.setTextSize(todaySize(sp));view.setTypeface(Typeface.MONOSPACE,bold?Typeface.BOLD:Typeface.NORMAL);return view;}
    private void renderToday() {
        heading("Today", "home","Settings",this::organizerSettings,false);
        TextView heading=content.findViewWithTag("page_heading");heading.setTypeface(Typeface.MONOSPACE,Typeface.BOLD);heading.setTextSize(todaySize(14));
        todayDate=todayText(new SimpleDateFormat("EEE · d MMM",Locale.getDefault()).format(new Date()),12,SECONDARY,false);todayDate.setTag("today_date");todayDate.setGravity(Gravity.CENTER);todayDate.setPadding(0,0,0,dp(4));content.addView(todayDate);
        planHost=new LinearLayout(this);planHost.setOrientation(LinearLayout.VERTICAL);planHost.setTag("today_plan");homePlan=false;content.addView(planHost);
        LinearLayout commands=new LinearLayout(this);commands.setTag("today_commands");
        String[] names={"+ Task","Note","Focus"};Runnable[] callbacks={()->openCapture("task",0,""),()->openCapture("note",0,""),()->navigate("focus")};
        for(int i=0;i<names.length;i++){TextView key=actionInto(commands,names[i],14,PRIMARY,callbacks[i]);PocketDesign.control(key);key.setGravity(Gravity.CENTER);key.setMinHeight(dp(56));key.setTag(new String[]{"today_add_task","today_add_note","today_focus"}[i]);key.setLayoutParams(new LinearLayout.LayoutParams(0,-2,1));}content.addView(commands);
        TextView tasksTitle=todayText("TASKS",12,PRIMARY,true);tasksTitle.setPadding(0,dp(16),0,dp(4));tasksTitle.setTag("today_tasks_heading");content.addView(tasksTitle);
        todayFilters=new LinearLayout(this);todayFilters.setTag("today_filters");
        for(String name:new String[]{"Open","Today","Later","Done"}){
            TextView filter=actionInto(todayFilters,name,14,name.equals(taskFilter)?accent():SECONDARY,()->{taskFilter=name;render();});
            filter.setTag("task_filter_"+name);filter.setGravity(Gravity.CENTER);PocketDesign.control(filter);filter.setMinHeight(dp(48));
            filter.setContentDescription(name+" tasks"+(name.equals(taskFilter)?", selected":""));filter.setSelected(name.equals(taskFilter));
            LinearLayout.LayoutParams cell=new LinearLayout.LayoutParams(0,-2,1);if(todayFilters.getChildCount()>1)cell.leftMargin=dp(4);filter.setLayoutParams(cell);
        }
        content.addView(todayFilters);
        if(!organizerQuery.trim().isEmpty()){TextView query=action("Search · "+organizerQuery,14,accent(),this::searchOrganizer);query.setTag("organizer_query");query.setMaxLines(1);query.setEllipsize(TextUtils.TruncateAt.END);}
        LinearLayout taskResults=new LinearLayout(this);taskResults.setOrientation(LinearLayout.VERTICAL);taskResults.setTag("today_tasks");content.addView(taskResults);
        LinearLayout noteResults=new LinearLayout(this);noteResults.setOrientation(LinearLayout.VERTICAL);noteResults.setTag("today_notes");content.addView(noteResults);renderOrganizerLists(taskResults,noteResults);
        todayActions=new LinearLayout(this);todayActions.setTag("today_actions");
        String[] footer={"Search","Calendar"};Runnable[] actions={this::searchOrganizer,()->openPocket(AgendaActivity.class)};
        for(int i=0;i<footer.length;i++){TextView key=actionInto(todayActions,footer[i],14,SECONDARY,actions[i]);PocketDesign.control(key);key.setGravity(Gravity.CENTER);key.setMinHeight(dp(56));key.setTag(i==0?"today_search":"today_calendar");key.setLayoutParams(new LinearLayout.LayoutParams(0,-2,1));}
        addFeedback();
    }
    private void searchOrganizer(){
        int page=pageGeneration;EditText search=new EditText(this);search.setTag("organizer_search");search.setTextColor(PRIMARY);search.setHintTextColor(SECONDARY);search.setTextSize(16);search.setTypeface(Typeface.MONOSPACE);search.setSingleLine(true);search.setImeOptions(android.view.inputmethod.EditorInfo.IME_ACTION_SEARCH);search.setMinHeight(dp(48));search.setHint("> Find tasks or notes");search.setText(organizerQuery);PocketDesign.input(search);
        android.widget.FrameLayout field=new android.widget.FrameLayout(this);field.setPadding(dp(16),dp(8),dp(16),dp(8));field.addView(search);
        AlertDialog.Builder builder=new AlertDialog.Builder(this).setTitle("Find tasks or notes").setView(field).setNegativeButton("Cancel",null).setPositiveButton("Find",(dialog,which)->{if(!destroyed&&page==pageGeneration&&"today".equals(screen)){organizerQuery=search.getText().toString().trim();render();}});
        if(!organizerQuery.isEmpty())builder.setNeutralButton("Clear",(dialog,which)->{if(!destroyed&&page==pageGeneration&&"today".equals(screen)){organizerQuery="";render();}});
        AlertDialog dialog=builder.create();search.setOnEditorActionListener((view,action,event)->{if(action==android.view.inputmethod.EditorInfo.IME_ACTION_SEARCH){dialog.getButton(AlertDialog.BUTTON_POSITIVE).performClick();return true;}return false;});dialog.getWindow().setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE);dialog.setOnShowListener(ignored->{search.requestFocus();search.setSelection(search.length());});dialog.show();
    }

    private void renderOrganizerLists(LinearLayout tasks, LinearLayout notes) {
        tasks.removeAllViews(); notes.removeAllViews();
        try {
            List<PlannerStore.Entry> entries = planner.entries(), matches = new ArrayList<>();
            Collections.sort(entries,(a,b)->Boolean.compare("note".equals(b.kind)&&planner.notePinned(b.id),"note".equals(a.kind)&&planner.notePinned(a.id)));
            String query = organizerQuery.trim().toLowerCase(Locale.getDefault()), today = PlannerDates.today();
            int noteCount = 0;
            long pinned=getSharedPreferences("pocket_planner",0).getLong("next_task",0);
            for (PlannerStore.Entry entry : entries) {
                String searchable = entry.text + "\n" + PlannerStore.stepsText(entry.steps);
                if (!searchable.toLowerCase(Locale.getDefault()).contains(query)) continue;
                if ("note".equals(entry.kind)) {
                    if(noteCount++==0){TextView title=todayText("NOTES",12,PRIMARY,true);title.setPadding(0,dp(24),0,dp(8));notes.addView(title);}
                    String[] excerpt=ReadableRows.excerpt(entry.text);
                    if(planner.notePinned(entry.id))excerpt[1]="Pinned"+(excerpt[1].isEmpty()?"":" · "+excerpt[1]);
                    LinearLayout row=ReadableRows.item(this,excerpt[0],excerpt[1],SECONDARY,"note_open_"+entry.id,()->openCapture("note",entry.id,entry.text));
                    ((TextView)row.getChildAt(0)).setTextSize(todaySize(17));if(row.getChildCount()>1)((TextView)row.getChildAt(1)).setTextSize(todaySize(12));
                    row.setOnLongClickListener(v -> { entryMenu(entry); return true; });notes.addView(row,new LinearLayout.LayoutParams(-1,-2));continue;
                }
                if (!"task".equals(entry.kind) || entry.done != "Done".equals(taskFilter)) continue;
                if ("Today".equals(taskFilter) && entry.id!=pinned && (entry.due.isEmpty() || entry.due.compareTo(today) > 0)) continue;
                if ("Later".equals(taskFilter) && (entry.due.isEmpty() || entry.due.compareTo(today) <= 0)) continue;
                matches.add(entry);
            }
            Collections.sort(matches,(a,b)->a.id==b.id?0:a.id==pinned?-1:b.id==pinned?1:PlannerStore.compareTasks(a,b));
            java.util.Set<String> groups=new java.util.HashSet<>();for(PlannerStore.Entry entry:matches)groups.add(taskGroup(entry,pinned,today));
            PlannerStore.Entry next = planner.nextTask(); String lastGroup = "";
            for (PlannerStore.Entry entry : matches) {
                String group=taskGroup(entry,pinned,today);
                if (groups.size()>1&&!group.equals(lastGroup)) {
                    TextView label = todayText(group.toUpperCase(Locale.getDefault()),12,group.equals("Overdue")?accent():SECONDARY,true);
                    label.setPadding(0, dp(lastGroup.isEmpty()?4:12), 0, dp(4)); tasks.addView(label); lastGroup = group;
                }
                LinearLayout line = new LinearLayout(this); line.setGravity(Gravity.CENTER_VERTICAL);
                TextView check = text(entry.done ? "[x]" : "[ ]", 17, entry.done ? SECONDARY : accent());
                check.setGravity(Gravity.CENTER); check.setMinHeight(dp(56)); check.setFocusable(true);
                check.setContentDescription((entry.done ? "Reopen " : "Complete ") + entry.text);
                check.setTag("task_check_" + entry.id);
                check.setOnClickListener(v -> plannerAction(() -> { TaskReminders.toggle(this,entry.id); render(); }));
                line.addView(check, new LinearLayout.LayoutParams(dp(56), -2));
                boolean isNext=next!=null&&entry.id==next.id;
                String details = (isNext?"Next · ":"")+(entry.important ? "Important · " : "") + PlannerDates.label(entry.due);
                if (!entry.steps.isEmpty()) details += " · " + entry.completedSteps() + "/" + entry.steps.size() + " steps";
                int metadataColor=(!entry.due.isEmpty()&&entry.due.compareTo(today)<0&&!entry.done)||isNext?accent():SECONDARY;
                LinearLayout item=ReadableRows.item(this,entry.text,details,metadataColor,"task_open_"+entry.id,()->openTask(entry.id));
                ((TextView)item.getChildAt(0)).setTextSize(todaySize(17));((TextView)item.getChildAt(1)).setTextSize(todaySize(12));
                if(entry.done)((TextView)item.getChildAt(0)).setTextColor(SECONDARY);
                item.setOnLongClickListener(v -> { entryMenu(entry); return true; });line.addView(item,new LinearLayout.LayoutParams(0,-2,1));tasks.addView(line);
            }
            if (matches.isEmpty()) tasks.addView(todayText(query.isEmpty()?"No "+taskFilter.toLowerCase(Locale.US)+" tasks":"No matching tasks",14,SECONDARY,false));
            if(noteCount==0){TextView title=todayText("NOTES",12,PRIMARY,true);title.setPadding(0,dp(24),0,dp(8));notes.addView(title);notes.addView(todayText(query.isEmpty()?"No notes":"No matching notes",14,SECONDARY,false));}

        } catch (IllegalStateException | IllegalArgumentException error) { tasks.addView(text(error.getMessage(), 16, AMBER)); }
    }

    private String taskGroup(PlannerStore.Entry entry,long pinned,String today){return entry.done?"Completed":entry.id==pinned?"Next":entry.due.isEmpty()?"Anytime":entry.due.compareTo(today)<0?"Overdue":entry.due.equals(today)?"Today":"Upcoming";}

    private void openTask(long id) {
        persistDraft(); captureEditor = null; captureStepsEditor = null; captureId = id; navigate("task_detail");
    }

    private void renderTaskDetail() {
        heading("Task", "today");
        PlannerStore.Entry entry;
        try { entry = planner.find(captureId); }
        catch (IllegalStateException error) { content.addView(text(error.getMessage(), 16, AMBER)); return; }
        if (entry == null) { content.addView(text("This task was removed.", 16, SECONDARY)); return; }
        content.addView(text(entry.text, 18, PRIMARY)); gap(4);
        content.addView(text((entry.important ? "! Important · " : "") + PlannerDates.label(entry.due), 14, accent()));
        if(entry.source!=null)action("Source · "+entry.source.name,14,SECONDARY,()->openTaskSource(entry.source));
        if(!entry.done)content.addView(text(TaskReminders.label(this,entry.id),14,SECONDARY));
        action(entry.done ? "Reopen task" : "Complete task", 18, accent(), () -> plannerAction(() -> { TaskReminders.toggle(this,entry.id); render(); }));
        if (!entry.steps.isEmpty()) content.addView(text("Steps · " + entry.completedSteps() + "/" + entry.steps.size(), 15, SECONDARY));
        for (int i = 0; i < entry.steps.size(); i++) {
            int index = i; PlannerStore.Step step = entry.steps.get(i);
            TextView row = action((step.done ? "[x] " : "[ ] ") + step.text, 16, step.done ? SECONDARY : PRIMARY,
                    () -> plannerAction(() -> { planner.toggleStep(entry.id, index); render(); }));
            row.setTag("task_step_" + i); row.setContentDescription((step.done ? "Reopen step " : "Complete step ") + step.text);
        }
        gap(12);
        action("Edit task", 18, PRIMARY, () -> openCapture("task", entry.id, entry.text));
        if (!planner.draft("task", entry.id).isEmpty()) content.addView(text("An unsaved edit is kept in the editor.", 13, SECONDARY));
        if (!entry.done) {
            action("Make next", 16, PRIMARY, () -> plannerAction(() -> { planner.makeNext(entry.id); render(); showFeedback("Set as the next task on Home."); }));
            action("Focus · 25 min", 16, PRIMARY, () -> startActivity(new Intent(this, ClockActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    .putExtra("seconds", 1500).putExtra("title", "Focus: " + entry.text.substring(0, Math.min(60, entry.text.length())))));
            action("Schedule reminder", 16, PRIMARY, () -> startActivity(new Intent(this,TaskReminderActivity.class).putExtra("task",entry.id)));
        }
        action("Delete task", 15, SECONDARY, () -> new AlertDialog.Builder(this).setTitle("Delete task?")
                .setNegativeButton("Cancel", null).setPositiveButton("Delete", (dialog, button) -> plannerAction(() -> {
                    TaskReminders.delete(this,entry.id); planner.clearDraft("task", entry.id); finishPage("today");
                })).show());
        addFeedback();
    }

    private void entryMenu(PlannerStore.Entry entry) {
        boolean task = "task".equals(entry.kind);
        String[] choices = task && !entry.done ? new String[]{"Make next", "Schedule", "Edit", "Delete"}
                : task ? new String[]{"Edit", "Delete"} : new String[]{"Edit","Delete",planner.notePinned(entry.id)?"Unpin":"Pin"};
        new AlertDialog.Builder(this).setTitle(task ? "Task" : "Note").setItems(choices, (dialog, which) -> {
            String choice = choices[which];
            if ("Make next".equals(choice)) plannerAction(() -> { planner.makeNext(entry.id); render(); });
            else if ("Schedule".equals(choice)) startActivity(new Intent(this,TaskReminderActivity.class).putExtra("task",entry.id));
            else if ("Edit".equals(choice)) openCapture(entry.kind, entry.id, entry.text);
            else if("Pin".equals(choice)||"Unpin".equals(choice))plannerAction(()->{planner.pinNote(entry.id,"Pin".equals(choice));render();});
            else new AlertDialog.Builder(this).setTitle("Delete " + (task ? "task" : "note") + "?")
                    .setNegativeButton("Cancel", null).setPositiveButton("Delete", (confirmation, button) ->
                            plannerAction(() -> { TaskReminders.delete(this,entry.id); planner.clearDraft(entry.kind, entry.id); if("note_preview".equals(screen))finishPage("today");else render(); })).show();
        }).show();
    }

    private void openCapture(String kind, long id, String text) {
        persistDraft();
        captureEditor = null;
        captureStepsEditor = null; captureSelectionStart = captureSelectionEnd = -1;
        captureKind = kind; captureId = id;
        String draft = planner.draft(kind, id);
        captureText = planner.hasDraft(kind, id) ? draft : text;
        if ("task".equals(kind)) {
            PlannerStore.TaskDraft metadata = planner.taskDraft(id, id == 0 ? null : planner.find(id));
            captureDue = metadata.due; captureImportant = metadata.important; captureSteps = metadata.steps;
        }
        navigate("capture");
    }

    private void renderCapture() {
        boolean task = "task".equals(captureKind);
        captureEditor = task ? new EditText(this) : new MarkdownEditor(this);
        EditText editorForPage = captureEditor;
        Runnable saveCapture = () -> saveCapture(editorForPage, task);
        String title = captureId == 0 ? (task ? "Add task" : "Note") : "Edit";
        if (task) heading(title, captureId != 0 ? "task_detail" : "today");
        else heading(title, "today", "save", saveCapture, true);
        captureEditor.setTag("capture_editor");
        captureEditor.setTextColor(PRIMARY); captureEditor.setHintTextColor(SECONDARY);
        captureEditor.setTypeface(Typeface.MONOSPACE); captureEditor.setTextSize(17);
        captureEditor.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE
                | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        PocketDesign.input(captureEditor);
        if (!task) PocketDesign.editor(captureEditor);
        captureEditor.setFilters(new InputFilter[]{new InputFilter.LengthFilter(
                "task".equals(captureKind) ? PlannerStore.TASK_LIMIT : PlannerStore.NOTE_LIMIT)});
        captureEditor.setHint(task ? "Task title" : "Write a note…");
        captureEditor.setMinLines(task ? 2 : 5); captureEditor.setMaxLines(task ? 5 : 12);
        captureEditor.setGravity(Gravity.TOP); captureEditor.setText(captureText);
        if (captureSelectionStart >= 0 && captureSelectionEnd >= 0) captureEditor.setSelection(
                Math.min(captureSelectionStart, captureEditor.length()), Math.min(captureSelectionEnd, captureEditor.length()));
        else captureEditor.setSelection(captureEditor.length());
        // Fill a tall window; keep the editor's minimum height and scrollable controls in a short one.
        content.addView(captureEditor, new LinearLayout.LayoutParams(-1, -2, task ? 0 : 1));
        if (task) {
            TextView due = action("Due · " + PlannerDates.label(captureDue), 16, PRIMARY, () -> {});
            due.setTag("task_due"); due.setOnClickListener(v -> chooseTaskDate(captureDue, value -> {
                captureDue = value; due.setText("Due · " + PlannerDates.label(value)); persistDraft();
            }));
            TextView important = action(captureImportant ? "! Important · on" : "Important · off", 16, PRIMARY, () -> {});
            important.setTag("task_important"); important.setOnClickListener(v -> {
                captureImportant = !captureImportant; important.setText(captureImportant ? "! Important · on" : "Important · off"); persistDraft();
            });
            content.addView(text("Steps · one per line", 14, SECONDARY));
            captureStepsEditor = new EditText(this); captureStepsEditor.setTag("task_steps_editor");
            captureStepsEditor.setTextColor(PRIMARY); captureStepsEditor.setHintTextColor(SECONDARY);
            captureStepsEditor.setTypeface(Typeface.MONOSPACE); captureStepsEditor.setTextSize(16);
            captureStepsEditor.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
            PocketDesign.input(captureStepsEditor); captureStepsEditor.setGravity(Gravity.TOP);
            captureStepsEditor.setFilters(new InputFilter[]{new InputFilter.LengthFilter(PlannerStore.STEPS_TEXT_LIMIT)});
            captureStepsEditor.setHint("Break it into smaller steps"); captureStepsEditor.setMinLines(3); captureStepsEditor.setMaxLines(8);
            captureStepsEditor.setText(captureSteps); content.addView(captureStepsEditor, new LinearLayout.LayoutParams(-1, -2));
            content.addView(text("Due date sorts this task. Schedule reminder in its details adds an alert.", 13, SECONDARY));
        } else {
            gap(16);
            LinearLayout tools = new LinearLayout(this); tools.setTag("note_actions");
            MarkdownEditor note = (MarkdownEditor) captureEditor;
            note.configureWheel(this::noteFormatMenu);
            NoteFormatControl format = new NoteFormatControl(this, note);
            format.setTag("note_format_control"); tools.addView(format, new LinearLayout.LayoutParams(0, -2, 1));
            TextView preview = actionInto(tools, "Preview", 15, accent(), () -> { persistDraft(); hideKeyboard(captureEditor); navigate("note_preview"); });
            PocketDesign.control(preview); preview.setMinHeight(dp(56)); preview.setLayoutParams(new LinearLayout.LayoutParams(0, -2, 1));
            TextView make=actionInto(tools,"Task",14,PRIMARY,this::captureNoteTask);PocketDesign.control(make);make.setMinHeight(dp(56));make.setLayoutParams(new LinearLayout.LayoutParams(0,-2,1));
            content.addView(tools);
        }
        if (task) {
            TextView save = action("save", 20, accent(), saveCapture); PocketDesign.primary(save);
            action("Clear draft", 15, SECONDARY, () -> clearCaptureDraft(editorForPage));
        }
        watchDraft(captureEditor); if (captureStepsEditor != null) watchDraft(captureStepsEditor);
        addFeedback();
    }

    private void saveCapture(EditText editorForPage, boolean task) {
        if (captureEditor != editorForPage || !"capture".equals(screen)) return;
        plannerAction(() -> {
            long saved;
            if (task) {saved = planner.saveTask(captureId, captureEditor.getText().toString(), captureDue, captureImportant, captureStepsEditor.getText().toString());if(captureId!=0)TaskReminders.rename(this,saved,captureEditor.getText().toString().trim());}
            else saved = planner.save(captureId, captureKind, captureEditor.getText().toString());
            planner.clearDraft(captureKind, captureId);
            hideKeyboard(captureEditor); captureEditor = null; captureStepsEditor = null; captureText = "";
            captureId = saved; captureSelectionStart = captureSelectionEnd = -1;
            if(task)finishPage("task_detail");
            else if(trail.peek()!=null){restoreRoute(trail.pop());motion.back(this::render);}
            else finishPage(workspace()?"today":"home");
        });
    }

    private void clearCaptureDraft(EditText editorForPage) {
        if (captureEditor != editorForPage || !"capture".equals(screen)) return;
        new AlertDialog.Builder(this).setTitle("Clear this draft?").setMessage("The saved entry is kept.")
                .setNegativeButton("Keep editing", null).setPositiveButton("Clear", (dialog, button) -> {
                    if (captureEditor != editorForPage || !"capture".equals(screen)) return;
                    if (draftSave != null) draftUi.removeCallbacks(draftSave);
                    captureEditor.setText(""); captureText = ""; captureSteps = ""; captureDue = ""; captureImportant = false;
                    captureSelectionStart = captureSelectionEnd = -1; planner.clearDraft(captureKind, captureId); render();
                }).show();
    }

    private interface DateChoice { void accept(String day); }
    private void chooseTaskDate(String initial, DateChoice result) {
        String[] options = {"Today", "Tomorrow", "Choose date", "No due date"};
        new AlertDialog.Builder(this).setTitle("Due date").setItems(options, (dialog, choice) -> {
            if (choice == 3) result.accept("");
            else if (choice == 2) {
                Calendar date = PlannerDates.calendar(initial);
                new DatePickerDialog(this, (picker, year, month, day) -> result.accept(PlannerDates.day(year, month, day)),
                        date.get(Calendar.YEAR), date.get(Calendar.MONTH), date.get(Calendar.DAY_OF_MONTH)).show();
            } else {
                Calendar date = Calendar.getInstance(); if (choice == 1) date.add(Calendar.DAY_OF_MONTH, 1);
                result.accept(PlannerDates.day(date.get(Calendar.YEAR), date.get(Calendar.MONTH), date.get(Calendar.DAY_OF_MONTH)));
            }
        }).show();
    }

    private void formatNote(NoteMarkdown.Style style) {
        if (captureEditor instanceof MarkdownEditor && !((MarkdownEditor) captureEditor).format(style)) showFeedback("This note has reached its text limit.");
    }

    private void noteFormatMenu() {
        if (!(captureEditor instanceof MarkdownEditor) || !"capture".equals(screen)) return;
        MarkdownEditor editorForPage = (MarkdownEditor) captureEditor;
        String[] labels = {"Heading 1", "Heading 2", "Heading 3", "Bullet list", "Numbered list", "Checkbox list", "Quote", "Plain text", "Bold", "Undo", "Wheel help", "Clear draft"};
        NoteMarkdown.Style[] styles = {NoteMarkdown.Style.H1, NoteMarkdown.Style.H2, NoteMarkdown.Style.H3, NoteMarkdown.Style.BULLET,
                NoteMarkdown.Style.NUMBERED, NoteMarkdown.Style.CHECKBOX, NoteMarkdown.Style.QUOTE, NoteMarkdown.Style.PLAIN};
        new AlertDialog.Builder(this).setTitle("Format").setItems(labels, (dialog, item) -> {
            if (captureEditor != editorForPage || !"capture".equals(screen)) return;
            if (item < styles.length) formatNote(styles[item]);
            else if (item == 8) formatNote(NoteMarkdown.Style.BOLD);
            else if (item == 9) { if (!editorForPage.undoFormat()) showFeedback("No formatting to undo."); }
            else if (item == 10) new AlertDialog.Builder(this).setTitle("Formatting wheel")
                    .setMessage("Hold in your note, move to a format and release. Or release first, then tap a choice.\n\nHeading cycles through three sizes. More opens all formats. Select opens Android selection and clipboard controls. Tap the centre or press Back to cancel.\n\nYou can also tap Format below the editor.")
                    .setPositiveButton("OK", null).show();
            else clearCaptureDraft(editorForPage);
        }).show();
    }

    private boolean noteWheelShowing() { return captureEditor instanceof MarkdownEditor && ((MarkdownEditor) captureEditor).wheelShowing(); }
    private void dismissNoteWheel() { if (captureEditor instanceof MarkdownEditor) ((MarkdownEditor) captureEditor).dismissWheel(); }

    private void renderNotePreview() {
        heading("Preview", "capture");
        TextView preview = text("", PocketDesign.BODY, PRIMARY); preview.setTag("note_markdown_preview"); preview.setTextIsSelectable(true);
        preview.setGravity(Gravity.TOP | Gravity.START); preview.setMinHeight(dp(120));
        io.noties.markwon.Markwon.builder(this)
                .usePlugin(new io.noties.markwon.AbstractMarkwonPlugin() {
                    @Override public void configureTheme(io.noties.markwon.core.MarkwonTheme.Builder builder) {
                        builder.headingBreakHeight(0).headingTextSizeMultipliers(new float[]{1.5f, 1.25f, 1.125f, 1f, 1f, 1f})
                                .linkColor(accent()).thematicBreakColor(PocketDesign.LINE).thematicBreakHeight(dp(1));
                    }
                })
                .usePlugin(io.noties.markwon.ext.tasklist.TaskListPlugin.create(accent(), accent(), BACKGROUND))
                .usePlugin(io.noties.markwon.ext.strikethrough.StrikethroughPlugin.create())
                .build().setMarkdown(preview, captureText);
        content.addView(preview, new LinearLayout.LayoutParams(-1, -2, 1)); gap(16);
        LinearLayout tools = new LinearLayout(this); tools.setTag("preview_actions");
        TextView edit = actionInto(tools, "Edit", 14, accent(), () -> navigate("capture"));
        TextView share = actionInto(tools, "Share", 14, PRIMARY, () -> launch("Share", Intent.createChooser(new Intent(Intent.ACTION_SEND)
                .setType("text/plain").putExtra(Intent.EXTRA_TEXT, captureText), "Share note")));
        TextView make=actionInto(tools,"Task",14,PRIMARY,this::captureNoteTask);
        TextView more=actionInto(tools,"More",14,SECONDARY,()->{if(captureId==0)showFeedback("Save this note to pin it.");else{PlannerStore.Entry note=planner.find(captureId);if(note!=null)entryMenu(note);else showFeedback("This note was removed.");}});
        for (TextView control : new TextView[]{edit, share,make,more}) {
            PocketDesign.control(control); PocketDesign.quiet(control, control == edit ? accent() : PRIMARY);
            control.setMinHeight(dp(56)); control.setLayoutParams(new LinearLayout.LayoutParams(0, -2, 1));
        }
        content.addView(tools);
        addFeedback();
    }

    private void persistDraft() {
        if (draftSave != null) { draftUi.removeCallbacks(draftSave); draftSave = null; }
        if ("capture".equals(screen) && captureEditor != null) {
            captureText = captureEditor.getText().toString();
            captureSelectionStart = captureEditor.getSelectionStart(); captureSelectionEnd = captureEditor.getSelectionEnd();
            if ("task".equals(captureKind) && captureStepsEditor != null) {
                captureSteps = captureStepsEditor.getText().toString(); planner.draft(captureId, captureText, captureDue, captureImportant, captureSteps);
            } else planner.draft(captureKind, captureId, captureText);
        }
    }
    private void watchDraft(EditText editor) {
        editor.addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence value, int start, int count, int after) {}
            public void onTextChanged(CharSequence value, int start, int before, int count) {
                if (draftSave != null) draftUi.removeCallbacks(draftSave);
                EditText owner = captureEditor;
                draftSave = () -> { if (!destroyed && "capture".equals(screen) && captureEditor == owner) persistDraft(); };
                draftUi.postDelayed(draftSave, 400);
            }
            public void afterTextChanged(Editable value) {}
        });
    }

    private boolean receiveSharedText(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return false;
        CharSequence value = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        if (value == null || value.length() == 0) return false;
        persistDraft();
        String draft = planner.draft("note", 0);
        String merged = draft.isEmpty() || draft.contentEquals(value) ? value.toString() : draft + "\n\n" + value;
        if (merged.length() > PlannerStore.NOTE_LIMIT) {
            showFeedback("Finish or clear your note draft before sharing more."); return true;
        }
        captureKind = "note"; captureId = 0; captureText = merged;
        captureSelectionStart = captureSelectionEnd = -1;
        // Clear the old editor reference so navigation cannot write into this new draft.
        captureEditor = null;
        if ("capture".equals(screen)) render(); else navigate("capture");
        return true;
    }

    private void renderFocus() {
        heading("Focus", "today");
        PlannerStore.Entry next;
        try { next = planner.nextTask(); }
        catch (IllegalStateException error) { next = null; }
        if(!focusTitle.isEmpty())content.addView(text(focusTitle,18,PRIMARY));else if (next != null) content.addView(text(next.text, 16, PRIMARY));
        action("Focus · 25 min", 18, accent(), () -> startFocusTimer(25, "Focus"));
        action("Focus · 50 min", 18, PRIMARY, () -> startFocusTimer(50, "Focus"));
        action("Break · 5 min", 18, PRIMARY, () -> startFocusTimer(5, "Break"));
        action("Timer controls", 16, SECONDARY, () -> openPocket(ClockActivity.class));
        addFeedback();
    }

    private void startFocusTimer(int minutes, String label) {
        PlannerStore.Entry next;
        try { next = planner.nextTask(); } catch (IllegalStateException error) { next = null; }
        String message = label;
        if("Focus".equals(label)){String topic=!focusTitle.isEmpty()?focusTitle:next==null?"":next.text;if(!topic.isEmpty())message+=": "+topic.substring(0,Math.min(60,topic.length()));}
        turnOffOwnedTorch();
        startActivity(new Intent(this, ClockActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("seconds", minutes * 60).putExtra("title", message));
    }

    private void hideKeyboard(View editor) {
        InputMethodManager input = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
        if (input != null) input.hideSoftInputFromWindow(editor.getWindowToken(), 0);
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != EXPORT_REQUEST || resultCode != RESULT_OK || data == null || data.getData() == null) return;
        try (OutputStream output = getContentResolver().openOutputStream(data.getData(), "wt")) {
            if (output == null) throw new IOException("No writable file.");
            output.write(planner.exportText().getBytes(StandardCharsets.UTF_8));
            showFeedback("Exported.");
        } catch (IOException | SecurityException | IllegalStateException error) {
            showFeedback("File could not be saved.");
        }
    }

    private void renderNotifications() {
        heading("Notifications", "home","Settings",()->startActivity(new Intent(this,NotificationSetupActivity.class)),false);
        if (!NotificationAccess.allowed(this) || !PhoneNotifications.connected()) {
            content.addView(text(NotificationAccess.allowed(this) ? "Access allowed. Waiting for Android to connect the notification reader." : "Notification access is off. Enable it to show other apps' current notices here.", 16, SECONDARY));

        } else {
            List<NoticeFeed.Item> notices=NoticeFeed.read(false);
            NoticeLabels.load(this,notices);
            if(notices.isEmpty())content.addView(text("No active notifications",18,SECONDARY));
            for(NoticeFeed.Item notice:notices)NoticeRows.add(this,content,notice,this::showFeedback,this::render);
        }
        addFeedback();
    }

    private Intent categoryIntent(String category) {
        return new Intent(Intent.ACTION_MAIN).addCategory(category);
    }

    private void openMessages() {
        openPocket(MessagesActivity.class);
    }

    private void launch(String label, Intent... choices) {
        for (Intent intent : choices) {
            if (intent == null) continue;
            try {
                startActivity(intent);
                return;
            } catch (ActivityNotFoundException | SecurityException ignored) {
                // Try the next system intent; package names differ between Nokia models.
            }
        }
        showFeedback(label + " is unavailable. Check installed apps in Settings.");
    }

    private void chooseHome() {
        if (Build.VERSION.SDK_INT >= 29) {
            RoleManager roles = (RoleManager) getSystemService(ROLE_SERVICE);
            if (roles != null && roles.isRoleAvailable(RoleManager.ROLE_HOME)) {
                if (roles.isRoleHeld(RoleManager.ROLE_HOME)) {
                    showFeedback("Pocket Phone is already your home screen.");
                } else {
                    launch("Home selection", roles.createRequestRoleIntent(RoleManager.ROLE_HOME));
                }
                return;
            }
        }
        launch("Home selection", new Intent(Settings.ACTION_HOME_SETTINGS), new Intent(Settings.ACTION_SETTINGS));
    }

    private void updateHomeStatus() {
        if (homeStatus == null) return;
        String state = HomeChoice.active(this) ? "Active" : "Choose Pocket";
        homeStatus.setText(state); ((View) homeStatus.getParent()).setContentDescription("Use as home screen, " + state);
    }

    private void setupTorch() {
        cameraManager = (CameraManager) getSystemService(CAMERA_SERVICE);
        if (cameraManager == null) return;
        try {
            for (String camera : cameraManager.getCameraIdList()) {
                CameraCharacteristics info = cameraManager.getCameraCharacteristics(camera);
                Boolean flash = info.get(CameraCharacteristics.FLASH_INFO_AVAILABLE);
                Integer facing = info.get(CameraCharacteristics.LENS_FACING);
                if (Boolean.TRUE.equals(flash) && facing != null
                        && facing == CameraCharacteristics.LENS_FACING_BACK) {
                    torchCamera = camera;
                    break;
                }
            }
            cameraManager.registerTorchCallback(torchCallback, new Handler(Looper.getMainLooper()));
        } catch (CameraAccessException | SecurityException | IllegalArgumentException ignored) {
            torchCamera = null;
        }
    }

    private void toggleTorch() {
        if (torchCamera == null || cameraManager == null) {
            showFeedback("Flashlight is unavailable on this phone.");
            return;
        }
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            showFeedback("Allow camera access to use the flashlight.");
            requestPermissions(new String[]{Manifest.permission.CAMERA}, CAMERA_REQUEST);
            return;
        }
        try {
            boolean enable = !torchOn;
            cameraManager.setTorchMode(torchCamera, enable);
            torchOn = enable;
            torchOwned = enable;
            updateTorchLabel();
        } catch (CameraAccessException | SecurityException | IllegalArgumentException exception) {
            showFeedback("Flashlight is busy or unavailable. Close the camera and try again.");
        }
    }

    private void updateTorchLabel() {
        if (torchValue == null) return;
        torchValue.setText(torchOn ? "On" : "Off");
        ((View) torchValue.getParent()).setContentDescription("Flashlight, " + (torchOn ? "On" : "Off"));
    }

    private void turnOffOwnedTorch() {
        if (!torchOwned || torchCamera == null || cameraManager == null) return;
        try {
            cameraManager.setTorchMode(torchCamera, false);
            torchOn = false;
            torchOwned = false;
            updateTorchLabel();
        } catch (CameraAccessException | SecurityException | IllegalArgumentException ignored) {
            // Camera service callbacks correct the displayed state after interruptions.
        }
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != CAMERA_REQUEST) return;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            toggleTorch();
        } else {
            showFeedback("Flashlight needs camera permission. Other tools still work.");
        }
    }
}
