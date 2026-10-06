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
import android.content.ComponentName;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Rect;
import android.graphics.RectF;
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
import android.os.UserHandle;
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
    private String workspaceTab = "today";
    private LinearLayout workspaceTabs;
    private LinearLayout pocketAppResults;
    private long captureReview;
    private String workspaceSearchQuery="";
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
    private final List<Integer> homeSlotIndices = new ArrayList<>();
    private TextView noteText;
    private final List<TextView> movementValues = new ArrayList<>(), movementStates = new ArrayList<>();
    private boolean movementLoading;
    private long homeNoteId;
    private int selectedShortcut;
    private String assigningShortcut;
    private String appsReturnTo = "home";
    private Typeface pixelTypeface;
    private TextView homeDay;
    private TextView homeHint;
    private boolean receiverRegistered;
    private long notesRevision, tasksRevision;
    private CameraManager cameraManager;
    private String torchCamera;
    private boolean torchOn;
    private boolean torchOwned;
    private NativeNavigation navigation;
    private PageMotion motion;
    private ClaudeSidebar claude;
    private HomeGestureContract homeGesture;
    private final java.util.Map<Integer, ComponentName> homeGestureTargets = new java.util.HashMap<>();
    private boolean homeRefreshQueued, homeExtraRefresh, homePlanRefresh, homeRebuild, homeResumed;
    private final Runnable homeRefresh = () -> {
        homeRefreshQueued = false;
        if (this.destroyed || !this.appVisible || !homeResumed || !"home".equals(screen)) return;
        if (homeGesture.pending()) return;
        boolean extra = homeExtraRefresh, plan = homePlanRefresh, rebuild = homeRebuild;
        homeExtraRefresh = homePlanRefresh = homeRebuild = false;
        if (rebuild) motion.instant(this::render); else updateHome();
        if (extra) { refreshTileLabels(); refreshMovement(); }
        if (plan && !rebuild && planHost != null) refreshDayPlan();
    };
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
            if (CloudSync.ACTION_SYNCED.equals(intent.getAction())) { if ("today".equals(screen) || "task_detail".equals(screen) || "thought_detail".equals(screen) || "search".equals(screen)) render(); else if ("home".equals(screen)) { homePlanRefresh = true; requestHomeRefresh(false); } return; }
            if (CorosRepository.ACTION_UPDATED.equals(intent.getAction())) { if ("home".equals(screen)) { homeRebuild |= romProfile && CorosRepository.get(MainActivity.this).connected() != (movementValues.size() == 3); requestHomeRefresh(false); } return; }
            if ("home".equals(screen)) requestHomeRefresh(false);
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
        ParkingReceiver.arm(this);
        preferences = getSharedPreferences("text_phone", MODE_PRIVATE);
        tiles = new DashboardTiles(preferences);
        pixelTypeface = PocketFonts.pixel(this);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().setNavigationBarColor(BACKGROUND);
        getWindow().getDecorView().setSystemUiVisibility(0);
        if (Build.VERSION.SDK_INT >= 29) getWindow().setNavigationBarContrastEnforced(false);
        motion = new PageMotion(this); if (savedInstanceState != null) motion.restore(savedInstanceState.getBundle("page_scrolls"));
        claude = new ClaudeSidebar(this, motion.host(), () -> { if (navigation != null) navigation.update(); },
                () -> !noteWheelShowing() && ("home".equals(screen) || "today".equals(screen) || "tools".equals(screen)));
        setContentView(claude);
        homeGesture = new HomeGestureContract(this, this::homeGestureBounds, () -> {
            if (!destroyed && "home".equals(screen)) requestHomeRefresh(false);
        });
        navigation = new NativeNavigation(this, new NativeNavigation.Page() {
            public boolean internal() { return claude.isOpen() || noteWheelShowing() || trail.peek()!=null || !workspace() || !"today".equals(screen); }
            public void back() { onBackPressed(); }
            public View content() { return claude.isOpen() || "home".equals(screen) ? null : content; }
            public void started(boolean fromLeft) { if (!claude.isOpen() && !noteWheelShowing() && !"home".equals(screen)) motion.startBack(backPageKey(), fromLeft); }
            public void progressed(float progress) { if (!claude.isOpen() && !noteWheelShowing()) motion.progressBack(progress); }
            public void cancelled() { if (!claude.isOpen() && !noteWheelShowing()) motion.cancelBack(); }
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
            workspaceTab = savedInstanceState.getString("workspace_tab", "today");
            captureReview = savedInstanceState.getLong("capture_review", 0);
            workspaceSearchQuery=savedInstanceState.getString("workspace_search_query","");
            captureDue = savedInstanceState.getString("capture_due", "");
            captureSteps = savedInstanceState.getString("capture_steps", "");
            captureImportant = savedInstanceState.getBoolean("capture_important");
            captureSelectionStart = savedInstanceState.getInt("capture_selection_start", -1);
            captureSelectionEnd = savedInstanceState.getInt("capture_selection_end", -1);
        }
        if ("assign".equals(screen) && assigningShortcut == null) screen = "home";
        if (savedInstanceState == null && "today".equals(getIntent().getStringExtra("pocket_screen"))) screen = "today";
        if (savedInstanceState == null && getIntent().hasExtra("workspace_tab")) { workspaceTab = getIntent().getStringExtra("workspace_tab"); screen = "today"; }
        if (!java.util.Arrays.asList("today", "thoughts", "tasks", "notes").contains(workspaceTab)) workspaceTab = "today";
        if (savedInstanceState == null && "notifications".equals(getIntent().getStringExtra("pocket_screen"))) screen = "notifications";
        if (savedInstanceState == null && !workspace() && "settings".equals(getIntent().getStringExtra("pocket_screen"))) screen = "settings";
        if (!workspace() && Intent.ACTION_MAIN.equals(getIntent().getAction()) && getIntent().hasCategory(Intent.CATEGORY_HOME)
                && (getIntent().getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) == 0) { screen = "home"; trail.clear(); }
        if (!validScreen(screen)) screen = "home";
        long task=getIntent().getLongExtra("pocket_task",0);if(savedInstanceState==null&&task>0){captureId=task;captureKind="task";screen="task_detail";if(trail.peek()==null)trail.push(new RouteTrail.Route("today",0,"note",null,"home",""));}
        long note=getIntent().getLongExtra("pocket_note",0);PlannerStore.Entry linked=note>0?planner.find(note):null;if(savedInstanceState==null&&linked!=null){captureId=note;captureKind="note";captureText=planner.hasDraft("note",note)?planner.draft("note",note):linked.text;screen="note_preview";if(trail.peek()==null)trail.push(new RouteTrail.Route("today",0,"note",null,"home",""));}
        long thought=getIntent().getLongExtra("pocket_thought",0);if(savedInstanceState==null&&thought>0&&ParkingStore.find(this,thought)!=null){captureId=thought;captureKind="thought";workspaceTab="thoughts";screen="thought_detail";if(trail.peek()==null)trail.push(new RouteTrail.Route("today",0,"note",null,"home",""));}
        setupTorch();
        render();
        if (savedInstanceState == null) receiveSharedText(getIntent());
        boolean homeHandoff = !workspace() && "home".equals(screen) && homeGesture.accept(getIntent());
        if (savedInstanceState != null && !homeHandoff) claude.restore(savedInstanceState.getBundle("claude_sidebar"));
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
        filter.addAction(CloudSync.ACTION_SYNCED);
        filter.addAction(CorosRepository.ACTION_UPDATED);
        notesRevision = planner.notesRevision(); tasksRevision = planner.tasksRevision(); CloudSync.soon(this);
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(statusReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(statusReceiver, filter);
        }
        receiverRegistered = true;
    }

    @Override protected void onResume() {
        super.onResume();
        homeResumed = true;
        claude.resume();
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
                ((TextView)content.findViewWithTag("task_due")).setText(dueLabel(captureDue));
                ((TextView)content.findViewWithTag("task_important")).setText(importantLabel(captureImportant));
            }
        }
        stoppedDraft = null;
        // Rebuilding a page while Android animates the window back in drops frames; only rebuild what changed.
        if(("today".equals(screen)||"task_detail".equals(screen)||"thought_detail".equals(screen)||"search".equals(screen))&&!organizerState().equals(renderedOrganizer))render();
        else if(planHost!=null && !"home".equals(screen))refreshDayPlan();
        NotificationAccess.connect(this);
        if ("home".equals(screen)) requestHomeRefresh(true);
        else if ("settings".equals(screen)) updateHomeStatus();
        else if ("notifications".equals(screen)) render();
        else if ("apps".equals(screen) || "assign".equals(screen)) ensureAppIndex();
    }

    @Override protected void onStop() {
        cancelHomeRefresh();
        persistDraft();
        if (planner.notesRevision() != notesRevision || planner.tasksRevision() != tasksRevision) CloudSync.changed(this);
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
    @Override protected void onPause() { homeResumed = false; homeGesture.cancel(); claude.pause(); dismissNoteWheel(); persistDraft(); motion.settle(); super.onPause(); }

    @Override protected void onDestroy() {
        navigation.destroy();
        claude.destroy();
        homeGesture.destroy();
        cancelHomeRefresh();
        motion.destroy();
        destroyed = true; draftUi.removeCallbacksAndMessages(null); appUi.removeCallbacksAndMessages(null); appWorker.shutdownNow();
        if (cameraManager != null) cameraManager.unregisterTorchCallback(torchCallback);
        super.onDestroy();
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        Bundle chat = new Bundle(); claude.save(chat); state.putBundle("claude_sidebar", chat);
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
        state.putString("workspace_tab", workspaceTab); state.putLong("capture_review", captureReview);state.putString("workspace_search_query",workspaceSearchQuery);
        state.putString("capture_due", captureDue);
        state.putString("capture_steps", captureSteps);
        state.putBoolean("capture_important", captureImportant);
        state.putInt("capture_selection_start", captureSelectionStart);
        state.putInt("capture_selection_end", captureSelectionEnd);
        super.onSaveInstanceState(state);
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        homeGesture.cancel();
        homeGestureTargets.clear();
        if (!workspace() && Intent.ACTION_MAIN.equals(intent.getAction()) && intent.hasCategory(Intent.CATEGORY_HOME)) {
            if ((intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) { setIntent(intent); return; }
            claude.closeImmediately();
            setIntent(intent);
            // Keep an already visible Home intact while Android animates its task surface.
            motion.instant(() -> navigate("home"));
            trail.clear();
            homeGesture.accept(intent);
            return;
        }
        claude.close();
        setIntent(intent);
        if (intent.hasExtra("workspace_tab")) { selectWorkspace(intent.getStringExtra("workspace_tab")); return; }
        if(intent.getLongExtra("pocket_task",0)>0){captureKind="task";openTask(intent.getLongExtra("pocket_task",0));return;}
        if(intent.getLongExtra("pocket_note",0)>0){openNote(intent.getLongExtra("pocket_note",0));return;}
        if(intent.getLongExtra("pocket_thought",0)>0){openThought(intent.getLongExtra("pocket_thought",0));return;}
        if (receiveSharedText(intent)) return;
        if ("today".equals(intent.getStringExtra("pocket_screen"))) { navigate("today"); return; }
        if ("notifications".equals(intent.getStringExtra("pocket_screen"))) { navigate("notifications"); return; }
        if (!workspace() && "settings".equals(intent.getStringExtra("pocket_screen"))) { navigate("settings"); return; }
        if (workspace()) return;
        navigate("home");
    }

    @Override public void onBackPressed() {
        if (claude.isOpen()) { claude.close(); return; }
        if (noteWheelShowing()) { dismissNoteWheel(); return; }
        if (trail.peek()!=null) { returnToPrevious(); return; }
        if (workspace() && "today".equals(screen)) { super.onBackPressed(); return; }
        if (!"home".equals(screen)) {persistDraft();if(captureEditor!=null)hideKeyboard(captureEditor);finishPage(backDestination());}
        // A Home app stays on Home when Back is pressed again.
    }
    private void openChat() {
        persistDraft(); dismissNoteWheel(); motion.settle(); claude.open();
    }
    private String backDestination() {
        if (trail.peek()!=null) return trail.peek().page;
        if ("apps".equals(screen)) return appsReturnTo;
        if ("note_preview".equals(screen)) return "capture";
        if ("capture".equals(screen)) return "task".equals(captureKind) && captureId != 0 ? "task_detail" : "today";
        if ("focus".equals(screen) || "task_detail".equals(screen) || "thought_detail".equals(screen) || "search".equals(screen)) return "today";
        return "home";
    }
    private String backPageKey() { return trail.peek()!=null ? trail.peek().key() : pageKey(backDestination()); }
    private void restoreRoute(RouteTrail.Route route) {
        screen=route.page;captureId=route.id;captureKind=route.kind;assigningShortcut=route.assigning;appsReturnTo=route.appsReturn;appQuery=route.appQuery;
        if ("capture".equals(screen)||"note_preview".equals(screen)) {
            PlannerStore.Entry entry=captureId==0?null:planner.find(captureId);
            captureText=planner.hasDraft(captureKind,captureId)?planner.draft(captureKind,captureId):entry==null?"":entry.text;
            if ("thought".equals(captureKind)) { ParkingStore.Item thought = ParkingStore.find(this, captureId); if (!planner.hasDraft(captureKind,captureId)) captureText = thought == null ? "" : thought.text; captureReview = thought == null ? 0 : thought.due; }
            if ("task".equals(captureKind)) {PlannerStore.TaskDraft metadata=planner.taskDraft(captureId,entry);captureDue=metadata.due;captureSteps=metadata.steps;captureImportant=metadata.important;}
        }
    }
    private void returnToPrevious() {
        persistDraft();dismissNoteWheel();if(captureEditor!=null)hideKeyboard(captureEditor);
        RouteTrail.Route parent=trail.pop();if(parent==null)return;
        restoreRoute(parent);motion.back(this::render);
    }
    /** After saving or deleting, go back where the user came from; the fallback applies only without a trail. */
    private void leave(String fallback) { if (trail.peek() != null) returnToPrevious(); else finishPage(fallback); }
    private void finishPage(String destination) {
        RouteTrail.Route parent=trail.take(pageKey(destination));
        if(parent!=null)restoreRoute(parent);else screen=destination;
        if("home".equals(destination))trail.clear();motion.back(this::render);
    }
    private String pageKey(String page) {
        if ("capture".equals(page) || "note_preview".equals(page)) return page + ":" + captureKind + ":" + captureId;
        if ("task_detail".equals(page)) return page + ":" + captureId;
        if ("thought_detail".equals(page)) return page + ":" + captureId;
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
        if (romProfile && (keyCode == KeyEvent.KEYCODE_DPAD_LEFT || keyCode == KeyEvent.KEYCODE_DPAD_RIGHT)) {
            int at = Math.max(0, homeSlotIndices.indexOf(selectedShortcut));
            selectShortcut(homeSlotIndices.get(Math.max(0, Math.min(homeSlotIndices.size() - 1, at + (keyCode == KeyEvent.KEYCODE_DPAD_LEFT ? -1 : 1))))); return true;
        }
        if (romProfile && (keyCode == KeyEvent.KEYCODE_DPAD_UP || keyCode == KeyEvent.KEYCODE_DPAD_DOWN)) return super.onKeyDown(keyCode, event);
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
                || "task_detail".equals(value) || "thought_detail".equals(value) || "search".equals(value) || "note_preview".equals(value);
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
        if (!"home".equals(destination)) { homeGesture.cancel(); cancelHomeRefresh(); }
        if (workspace() && "home".equals(destination)) { startActivity(new Intent(this, MainActivity.class).setAction(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); return; }
        if (destination.equals(screen)) { if ("home".equals(screen)) requestHomeRefresh(false); else if ("notifications".equals(screen)) render(); return; }
        boolean backwards = !"home".equals(screen) && destination.equals(backDestination());
        if("home".equals(destination))trail.clear();
        else {
            RouteTrail.Route origin=activeRoute;
            if(origin!=null)trail.push(new RouteTrail.Route(origin.page,origin.id,origin.kind,origin.assigning,origin.appsReturn,appQuery));
        }
        if (!destination.equals(screen) && getCurrentFocus() instanceof EditText) hideKeyboard(getCurrentFocus());
        if (!destination.equals(screen)) appQuery = "";
        if ("apps".equals(destination) && !"apps".equals(screen)) appsReturnTo = screen;
        if("focus".equals(destination)){PlannerStore.Entry source="task_detail".equals(screen)?planner.find(captureId):null;focusTitle=source!=null?source.text:"today".equals(screen)?todayFocusTitle:"";}
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
        noteText = null; homeNoteId = 0; movementValues.clear(); movementStates.clear(); homeSlotIndices.clear();
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
            case "thought_detail": renderThoughtDetail(); break;
            case "search": renderWorkspaceSearch(); break;
            case "note_preview": renderNotePreview(); break;
            case "focus": renderFocus(); break;
            default: renderHome(); break;
        }
        View page=viewport;
        boolean todayPage="today".equals(screen),taskEditor="capture".equals(screen)&&"task".equals(captureKind);
        if(todayPage||taskEditor){
            LinearLayout shell=new LinearLayout(this);shell.setOrientation(LinearLayout.VERTICAL);shell.setBackgroundColor(BACKGROUND);shell.setTag(todayPage?"today_workspace":"task_editor_workspace");
            shell.setPadding(dp(horizontal),dp(4),dp(horizontal),dp(4));
            shell.setOnApplyWindowInsetsListener((view,insets)->{int left,top,right,bottom;
                if(Build.VERSION.SDK_INT>=30){android.graphics.Insets safe=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout()|WindowInsets.Type.ime());left=safe.left;top=safe.top;right=safe.right;bottom=safe.bottom;}
                else{left=insets.getSystemWindowInsetLeft();top=insets.getSystemWindowInsetTop();right=insets.getSystemWindowInsetRight();bottom=insets.getSystemWindowInsetBottom();}
                view.setPadding(dp(horizontal)+left,dp(4)+top,dp(horizontal)+right,dp(4)+bottom);return insets.consumeSystemWindowInsets();});
            View header=content.findViewWithTag("page_header");content.removeView(header);
            if(todayPage&&"today".equals(workspaceTab)){shell.setBackground(new PixelBackdrop(this,accent(),140));header.setBackgroundColor(android.graphics.Color.TRANSPARENT);}
            shell.addView(header,new LinearLayout.LayoutParams(-1,-2));
            if(todayPage){content.removeView(todayDate);shell.addView(todayDate,new LinearLayout.LayoutParams(-1,-2));content.removeView(workspaceTabs);shell.addView(workspaceTabs,new LinearLayout.LayoutParams(-1,-2));}
            viewport.setPadding(0,0,0,0);viewport.setOnApplyWindowInsetsListener(null);viewport.setTag(todayPage?"today_scroll":"task_editor_scroll");
            shell.addView(viewport,new LinearLayout.LayoutParams(-1,0,1));if(todayPage)shell.addView(todayActions,new LinearLayout.LayoutParams(-1,-2));page=shell;
        }
        motion.show(page, pageKey(screen)); if (appRowsReady || !"apps".equals(screen) && !"assign".equals(screen)) motion.dataReady(); page.requestApplyInsets();if(planHost!=null)refreshDayPlan();
        renderedOrganizer = "today".equals(screen) || "task_detail".equals(screen) || "thought_detail".equals(screen) || "search".equals(screen) ? organizerState() : "";
    }
    private String renderedOrganizer = "";
    /** Everything the Today and task pages show that can change while another app is in front. */
    private String organizerState() {
        return screen + ":" + captureId + ":" + workspaceTab + ":" + planner.tasksRevision() + ":" + planner.notesRevision() + ":" + getSharedPreferences("pocket_parking",0).getString("items","[]").hashCode() + ":" + PlannerDates.today() + ":" + taskFilter + ":" + organizerQuery
                + ":" + ClockStore.prefs(this).getString("entries", "").hashCode() + ":" + planner.preferences().getLong("next_task", 0)
                + ":" + planner.hasDraft("task", captureId);
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
        heading(title, backTo, "home", () -> navigate("home"), false);
    }

    /** The same header as every Pocket app: back, lowercase pixel title, one contextual action. */
    private void heading(String title, String backTo, String rightLabel, Runnable rightAction, boolean commit) {
        LinearLayout header = new LinearLayout(this);header.setTag("page_header"); header.setGravity(Gravity.CENTER_VERTICAL); PocketDesign.header(header);
        TextView previous = text("back", 14, SECONDARY); PocketDesign.headerControl(previous, SECONDARY); previous.setGravity(Gravity.CENTER);
        previous.setTag("navigation_back");previous.setOnClickListener(v -> onBackPressed()); header.addView(previous, new LinearLayout.LayoutParams(PocketDesign.headerWidth(previous,64), PocketDesign.headerHeight(this)));
        TextView heading = text(title, 24, PRIMARY);
        heading.setTag("page_heading"); PocketDesign.title(heading);
        header.addView(heading, new LinearLayout.LayoutParams(0, PocketDesign.headerHeight(this), 1));
        TextView right = text(rightLabel, 14, commit ? accent() : SECONDARY); PocketDesign.headerControl(right, commit ? accent() : SECONDARY); right.setGravity(Gravity.CENTER);
        right.setOnClickListener(v -> rightAction.run());if("settings".equalsIgnoreCase(rightLabel))right.setTag("app_settings"); header.addView(right, new LinearLayout.LayoutParams(PocketDesign.headerWidth(right,rightLabel.length()>5?96:64), PocketDesign.headerHeight(this)));
        content.addView(header); gap(4);
    }
    /** A group label, the same in every app. */
    private TextView section(LinearLayout host, String label, boolean first) {
        TextView view = text(label, 12, SECONDARY); PocketDesign.section(view, first); host.addView(view); return view;
    }
    /** Page-level commands pinned to the bottom of a page. */
    private LinearLayout softKeys(String tag, String[] names, String[] tags, int primary, Runnable... actions) {
        LinearLayout bar = new LinearLayout(this); bar.setTag(tag);
        for (int i = 0; i < names.length; i++) {
            TextView key = actionInto(bar, names[i], 14, PRIMARY, actions[i]); PocketDesign.softKey(key, i, names.length, i == primary);
            if (tags != null) key.setTag(tags[i]); key.setLayoutParams(PocketDesign.softKeyCell(this, i, names.length));
        }
        return bar;
    }
    /** Commands for the item above them, starting at the content edge. */
    private LinearLayout commands(LinearLayout host, String tag, String[] names, String[] tags, int primary, Runnable... actions) {
        LinearLayout line = new LinearLayout(this); line.setTag(tag);
        for (int i = 0; i < names.length; i++) {
            TextView command = actionInto(line, names[i], 14, PRIMARY, actions[i]); PocketDesign.command(command, i == primary);
            if (tags != null) command.setTag(tags[i]); command.setLayoutParams(PocketDesign.commandCell(this, i == 0));
        }
        host.addView(line, new LinearLayout.LayoutParams(-1, -2)); return line;
    }

    private void renderHome() {
        content.setBackground(new PixelBackdrop(this,accent(),212));
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
        if(romProfile&&!HomeChoice.active(this))action("use Pocket as home",14,accent(),this::chooseHome).setTag("home_setup");
        gap(romProfile ? 12 : 16);
        if (romProfile) renderDashboardAgenda();

        LinearLayout grid = new LinearLayout(this);
        grid.setTag("home_tiles");
        grid.setOrientation(LinearLayout.VERTICAL);
        for (int rowIndex = 0; rowIndex < (romProfile ? 1 : 3); rowIndex++) {
            LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.HORIZONTAL);
            row.setGravity(Gravity.CENTER_VERTICAL);
            row.setMinimumHeight(dp(romProfile ? 80 : 102));
            for (int column = 0; column < 3; column++) {
                int index = romProfile && column == 2 ? 4 : rowIndex * 3 + column;
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
                homeSlotIndices.add(index);
            }
            grid.addView(row, new LinearLayout.LayoutParams(-1, -2));
        }
        content.addView(grid, new LinearLayout.LayoutParams(-1, -2));
        if (romProfile && !homeSlotIndices.contains(selectedShortcut)) selectedShortcut = homeSlotIndices.get(0);
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
        footer.setTag("home_footer");
        footer.setOrientation(LinearLayout.HORIZONTAL);
        String[] names = {"capture", "today", "pip", "all"};
        for (int i = 0; i < names.length; i++) {
            int item = i;
            TextView link = text(names[i], 14, accent());
            link.setTag("home_" + names[i]);
            // Home keeps the classic accent soft keys; elsewhere only a commit key uses accent.
            PocketDesign.softKey(link, i, names.length, true);
            link.setFocusable(true);
            link.setOnClickListener(v -> {
                if (item == 0) captureMenu();
                else if (item == 1) openPocket(OrganizerActivity.class);
                else if (item == 2) openChat();
                else navigate("apps");
            });
            footer.addView(link, PocketDesign.softKeyCell(this, i, names.length));
        }
        PocketDesign.header(footer); content.addView(footer);
        selectShortcut(selectedShortcut);
        updateHome();
    }

    /**
     * Home reads top to bottom as now → next → body → act: up to two appointments, the next task and the latest note
     * share one list with a fixed time/kind column; the health readings, quick actions and tiles then share one
     * three-column grid, so every centre lines up.
     */
    private void renderDashboardAgenda() {
        LinearLayout agenda = new LinearLayout(this); agenda.setOrientation(LinearLayout.VERTICAL); agenda.setTag("dashboard_agenda");
        planHost=new LinearLayout(this);planHost.setOrientation(LinearLayout.VERTICAL);planHost.setTag("dashboard_plan");homePlan=true;agenda.addView(planHost);
        LinearLayout taskRow = dashboardRow(agenda, "task", accent(), () -> {
            try {
                if (planner.nextTask() == null) openCapture("task", 0, "");
                else openTask(planner.nextTask().id);
            } catch (IllegalStateException error) { showFeedback("Organizer data unavailable"); }
        });
        nextTaskText = (TextView) taskRow.getChildAt(1); nextTaskText.setTag("dashboard_next");
        taskCountText = text("", 12, SECONDARY); taskCountText.setGravity(Gravity.END | Gravity.CENTER_VERTICAL);
        taskCountText.setPadding(dp(8), 0, 0, 0); taskCountText.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        taskRow.addView(taskCountText, new LinearLayout.LayoutParams(-2, -2));
        noteText = (TextView) dashboardRow(agenda, "note", SECONDARY, () -> { if (homeNoteId > 0) openNote(homeNoteId); }).getChildAt(1);
        noteText.setTag("dashboard_note");
        content.addView(agenda); gap(8);
        renderDashboardMovement(content);

        LinearLayout quick = new LinearLayout(this); quick.setTag("dashboard_quick");
        quick.setOrientation(LinearLayout.HORIZONTAL);
        String[] labels = {"+ thought", "today", "focus"};
        for (int i = 0; i < labels.length; i++) {
            int item = i;
            TextView link = actionInto(quick, labels[i], 14, accent(), () -> {
                if (item == 0) openThoughtCapture(0);
                else if (item == 1) openPocket(OrganizerActivity.class);
                else navigate("focus");
            });
            link.setTag("dashboard_quick_" + i);
            PocketDesign.control(link);
            PocketDesign.quiet(link, accent());
            link.setLayoutParams(PocketDesign.column(this));
        }
        content.addView(quick);
        gap(4);
    }

    /** Width of the dashboard's time/kind column: wide enough for a 12-hour time at the current text size. */
    private int dashboardColumn() {
        TextView probe = text("10:30PM", 12, SECONDARY); return Math.round(probe.getPaint().measureText("10:30PM")) + dp(12);
    }
    /** One dashboard list line: a short label in the time column, then the title. The whole line is the target. */
    private LinearLayout dashboardRow(LinearLayout host, String kind, int kindColor, Runnable open) {
        LinearLayout row = new LinearLayout(this); row.setGravity(Gravity.CENTER_VERTICAL); row.setMinimumHeight(dp(48));
        row.setFocusable(true); row.setClickable(true); PocketDesign.list(row); row.setVisibility(View.GONE);
        row.setOnClickListener(v -> { launchOrigin = v; try { open.run(); } finally { launchOrigin = null; } });
        TextView label = text(kind, 12, kindColor); label.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        row.addView(label, new LinearLayout.LayoutParams(dashboardColumn(), -2));
        TextView title = text("", 14, PRIMARY); title.setSingleLine(true); title.setEllipsize(TextUtils.TruncateAt.END);
        title.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        // Tests and accessibility services may click the title itself; it opens the same thing as the line.
        title.setOnClickListener(v -> row.performClick()); title.setBackground(null);
        row.addView(title, new LinearLayout.LayoutParams(0, -2, 1));
        host.addView(row, new LinearLayout.LayoutParams(-1, -2));
        return row;
    }
    private static void showRow(TextView title, boolean visible, String description) {
        View row = (View) title.getParent(); title.setVisibility(visible ? View.VISIBLE : View.GONE);
        row.setVisibility(visible ? View.VISIBLE : View.GONE); if (description != null) row.setContentDescription(description);
    }
    private void updateDashboardSources(List<PlannerStore.Entry> entries) {
        if (noteText == null) return;
        PlannerStore.Entry latest = null; long edited = 0;
        for (PlannerStore.Entry entry : entries) if ("note".equals(entry.kind) && (latest == null || planner.noteUpdated(entry) > edited)) { latest = entry; edited = planner.noteUpdated(entry); }
        homeNoteId = latest == null ? 0 : latest.id;
        noteText.setText(latest == null ? "" : NoteThoughts.title(latest));
        showRow(noteText, latest != null, latest == null ? null : "Latest note: " + NoteThoughts.title(latest) + ". Open note.");
    }
    private void renderDashboardMovement(LinearLayout host) {
        CorosRepository repository = CorosRepository.get(this);
        if (!repository.connected()) {
            LinearLayout connect = dashboardRow((LinearLayout) content.findViewWithTag("dashboard_agenda"), "move", SECONDARY, () -> openPocket(MovementActivity.class));
            connect.setTag("dashboard_movement_connect"); TextView title = (TextView) connect.getChildAt(1);
            title.setText("connect COROS"); title.setTextColor(SECONDARY); showRow(title, true, "Movement. Connect COROS."); return;
        }
        LinearLayout row = new LinearLayout(this); row.setTag("dashboard_movement");
        String[] names = {"recovery", "strain", "condition"};
        for (int i = 0; i < names.length; i++) {
            int score = i; LinearLayout cell = new LinearLayout(this); cell.setOrientation(LinearLayout.VERTICAL); cell.setGravity(Gravity.CENTER_HORIZONTAL);
            cell.setPadding(0, dp(8), 0, dp(8)); cell.setMinimumHeight(dp(84)); cell.setFocusable(true); PocketDesign.list(cell);
            TextView name = text(names[i], 12, SECONDARY), value = text("—", 25, PRIMARY), state = text("", 12, SECONDARY);
            value.setTypeface(pixelTypeface);
            for (TextView line : new TextView[]{name, value, state}) { line.setGravity(Gravity.CENTER); line.setSingleLine(true); line.setEllipsize(TextUtils.TruncateAt.END); cell.addView(line); }
            cell.setTag("dashboard_movement_" + i); movementValues.add(value); movementStates.add(state);
            for (int j = 0; j < cell.getChildCount(); j++) cell.getChildAt(j).setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
            cell.setOnClickListener(v -> startActivity(new Intent(this, MovementActivity.class).putExtra("score", score).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)));
            row.addView(cell, PocketDesign.column(this));
        }
        host.addView(row, new LinearLayout.LayoutParams(-1, -2)); updateMovement();
    }
    private void updateMovement() {
        if (movementValues.size() != 3) return;
        CorosRepository.Snapshot snapshot = CorosRepository.get(this).cached();
        if (snapshot == null) { for (int i = 0; i < 3; i++) { movementValues.get(i).setText("—"); movementStates.get(i).setText("not loaded"); } return; }
        Scores.Result result = snapshot.scores;
        String stale = snapshot.today() ? "" : snapshot.date.toString() + " · ";
        String[] values = {result.recovery == null ? "—" : result.recovery.score + "%", result.strain.strain + "%", String.valueOf(result.conditioning.score)};
        String[] states = {result.recovery == null ? "no reading" : result.recovery.zone, "of " + result.strain.low + "–" + result.strain.high, result.conditioning.status};
        for (int i = 0; i < 3; i++) {
            movementValues.get(i).setText(values[i]); movementStates.get(i).setText(stale + states[i]);
            movementValues.get(i).setTextColor(i == 0 && result.recovery != null && result.recovery.score < 34 ? accent() : PRIMARY);
            View cell = (View) movementValues.get(i).getParent(); cell.setContentDescription(new String[]{"Recovery", "Strain", "Conditioning"}[i] + " " + values[i] + ", " + stale + states[i] + ". Open movement.");
        }
    }
    private void refreshMovement() {
        if (!romProfile || movementLoading || !CorosRepository.get(this).connected()) return;
        movementLoading = true; CorosRepository repository = CorosRepository.get(this);
        appWorker.execute(() -> {
            try { repository.refresh(false); } catch (IOException ignored) { /* The Movement screen keeps the actionable error. */ }
            appUi.post(() -> { movementLoading = false; if (!destroyed && "home".equals(screen)) requestHomeRefresh(false); });
        });
    }
    private void dashboardEvent(LinearLayout host, DayPlan.Item item, DayPlan.Result plan) {
        boolean current = item.when <= plan.now && item.end > plan.now;
        boolean soon = current || item.when - plan.now <= 30 * 60_000;
        String time = item.allDay ? "all day" : new SimpleDateFormat(twentyFourHour() ? "HH:mm" : "h:mma", Locale.getDefault()).format(new Date(item.when));
        LinearLayout row = new LinearLayout(this); row.setGravity(Gravity.CENTER_VERTICAL); row.setMinimumHeight(dp(48)); row.setTag("dashboard_event_" + item.id); PocketDesign.list(row); row.setFocusable(true);
        TextView when = text(time, 12, soon ? accent() : SECONDARY);
        TextView title = text(item.title, 14, PRIMARY); title.setSingleLine(true); title.setEllipsize(TextUtils.TruncateAt.END);
        row.addView(when, new LinearLayout.LayoutParams(dashboardColumn(), -2)); row.addView(title, new LinearLayout.LayoutParams(0, -2, 1));
        row.setContentDescription(time + ", " + item.title + (current ? ", now" : "") + ". Open calendar.");
        when.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO); title.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        row.setOnClickListener(v -> { if (item.external) startActivity(new Intent(Intent.ACTION_VIEW, android.content.ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, item.id)));
            else startActivity(new Intent(this, AgendaActivity.class).putExtra("appointment_id", item.id).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); });
        host.addView(row);
    }

    private void selectShortcut(int index) {
        selectedShortcut = Math.max(0, Math.min(8, index));
        for (int i = 0; i < homeTiles.size(); i++) {
            boolean selected = homeSlotIndices.get(i) == selectedShortcut;
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
    private void openPocket(Class<? extends android.app.Activity> activity, String page) {
        turnOffOwnedTorch(); startActivity(new Intent(this, activity).putExtra("page", page).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    }
    @Override public void startActivity(Intent intent) {
        View source = launchOrigin;
        int visibleSlot = homeSlotIndices.indexOf(selectedShortcut);
        if (source == null && "home".equals(screen) && visibleSlot >= 0) source = homeTiles.get(visibleSlot);
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
        for (String id : PocketApps.CHOICES) { labels.add(id); actions.add(() -> { tiles.usePocket(slot, id); refreshTiles(); }); }
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
            String label = tiles.label(shortcuts[homeSlotIndices.get(i)]); homeLabels.get(i).setText(label);
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
                if ("home".equals(screen)) requestHomeRefresh(false);
            });
        });
    }

    private void renderAppPicker() {
        heading(assigningShortcut, "home");
        gap(16);
        action("Use default", 20, accent(), () -> {
            tiles.reset(assigningShortcut);
            navigate("home");
        });
        addInstalledApps(true);
        addFeedback();
    }

    private void requestHomeRefresh(boolean extra) {
        if (destroyed || !"home".equals(screen)) return;
        homeExtraRefresh |= extra;
        homePlanRefresh |= extra;
        if (homeRefreshQueued) return;
        homeRefreshQueued = true;
        claude.postOnAnimation(homeRefresh);
    }

    private void cancelHomeRefresh() {
        if (claude != null) claude.removeCallbacks(homeRefresh);
        homeRefreshQueued = homeExtraRefresh = homePlanRefresh = homeRebuild = false;
    }

    private RectF homeGestureBounds(ComponentName component, UserHandle user) {
        if (destroyed || workspace() || !"home".equals(screen) || claude.isOpen()
                || !android.os.Process.myUserHandle().equals(user)) return null;
        for (int pass = 0; pass < 2; pass++) for (int i = 0; i < homeSlotIndices.size(); i++) {
            int slot = homeSlotIndices.get(i);
            if ((slot == selectedShortcut) != (pass == 0)) continue;
            PhoneIcon icon = homeIcons.get(i);
            if (!icon.isAttachedToWindow() || !icon.isLaidOut() || icon.isLayoutRequested()
                    || !icon.isShown() || icon.getAlpha() <= 0 || icon.getWidth() <= 0 || icon.getHeight() <= 0) continue;
            Rect visible = new Rect();
            if (!icon.getGlobalVisibleRect(visible) || visible.width() != icon.getWidth() || visible.height() != icon.getHeight()) continue;
            if (!homeGestureTargets.containsKey(slot)) homeGestureTargets.put(slot, homeTileComponent(slot));
            if (!component.equals(homeGestureTargets.get(slot))) continue;
            int[] location = new int[2];
            icon.getLocationOnScreen(location);
            return new RectF(location[0], location[1], location[0] + icon.getWidth(), location[1] + icon.getHeight());
        }
        return null;
    }

    private ComponentName homeTileComponent(int slot) {
        String key = shortcuts[slot];
        if (tiles.group(key)) return null;
        String assigned = tiles.app(key);
        if (assigned != null) return firstLaunchComponent(assigned);
        Class<? extends Activity> own = null;
        if (romProfile) own = PocketApps.activity(tiles.pocket(key));
        else switch (slot) {
            case 0: return firstLaunchComponent("org.thoughtcrime.securesms");
            case 1: return firstLaunchComponent("com.whatsapp", "com.whatsapp.w4b");
            case 2: own = MessagesActivity.class; break;
            case 3: own = ContactsActivity.class; break;
            case 4: own = PhoneActivity.class; break;
            case 7: own = CompactCameraActivity.class; break;
            case 8: return firstLaunchComponent("com.ubercab", "ee.mtakso.client", "taxi.android.client");
            default: break; // Internal settings and implicit Maps launches have no unique app icon target.
        }
        return own == null ? null : new ComponentName(this, own);
    }

    private ComponentName firstLaunchComponent(String... packages) {
        try {
            for (String name : packages) {
                Intent launch = getPackageManager().getLaunchIntentForPackage(name);
                if (launch != null && launch.getComponent() != null) return launch.getComponent();
            }
        } catch (RuntimeException unavailable) { }
        return null;
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
        List<PlannerStore.Entry> entries = null;
        try { entries = planner.entries(); } catch (IllegalStateException unreadable) { }
        if (nextTaskText != null) {
            try {
                if (entries == null) throw new IllegalStateException("Organizer data unavailable");
                PlannerStore.Entry next = planner.nextTask(entries);
                int count = 0, done = 0;
                for (PlannerStore.Entry entry : entries) if ("task".equals(entry.kind)) { if (entry.done) done++; else count++; }
                if (romProfile) {
                    taskCountText.setText(count + " open");
                    nextTaskText.setText(next == null ? "No open tasks" : next.text);
                    showRow(nextTaskText, next != null, next == null ? "No open tasks. Add a task."
                            : "Next task: " + next.text + ". " + count + " open, " + done + " completed. Open task.");
                } else {
                    nextTaskText.setVisibility(next == null ? View.GONE : View.VISIBLE);
                    nextTaskText.setText(next == null ? "" : "next [" + count + "]  " + next.text);
                }
            } catch (IllegalStateException error) {
                if (taskCountText != null) taskCountText.setText("");
                nextTaskText.setText(R.string.organizer_unavailable);
                if (romProfile) showRow(nextTaskText, true, getString(R.string.organizer_unavailable));
                else { nextTaskText.setVisibility(View.VISIBLE); nextTaskText.setContentDescription(getString(R.string.organizer_unavailable)); }
            }
        }
        String sms = Telephony.Sms.getDefaultSmsPackage(this);
        for (int i = 0; i < homeIcons.size(); i++) {
            boolean hasNotification = false;
            for (StatusBarNotification notice : notices) {
                String pkg = notice.getPackageName();
                int slot = homeSlotIndices.get(i);
                String assigned = preferences.getString("shortcut_" + shortcuts[slot], null);
                boolean messages = romProfile && !tiles.group(shortcuts[slot]) && "messages".equals(tiles.pocket(shortcuts[slot]));
                if (pkg.equals(assigned) || (messages && (pkg.equals(sms)||assigned==null&&NoticeFeed.message(notice)))
                        || (!romProfile && ((i == 0 && pkg.equals("org.thoughtcrime.securesms"))
                        || (i == 1 && pkg.startsWith("com.whatsapp"))
                        || (i == 2 && pkg.equals(sms))))) hasNotification = true;
            }
            homeIcons.get(i).setNotificationDot(hasNotification);
        }
        if (romProfile) { updateDashboardSources(entries == null ? Collections.emptyList() : entries); updateMovement(); }
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
        heading("tools", "home");
        section(content, "plan & think", true);
        // Today always opens its own task, the same as its tile, so Back behaves the same from both.
        action("today", 18, PRIMARY, () -> openPocket(OrganizerActivity.class));
        action("thoughts", 18, PRIMARY, () -> selectWorkspace("thoughts"));
        action("tasks", 18, PRIMARY, () -> selectWorkspace("tasks"));
        action("notes", 18, PRIMARY, () -> selectWorkspace("notes"));
        action("pip", 18, PRIMARY, this::openChat);
        action("clock", 18, PRIMARY, () -> openPocket(ClockActivity.class));
        action("calendar", 18, PRIMARY, () -> openPocket(AgendaActivity.class));
        section(content, "capture & keep", false);
        action("camera", 18, PRIMARY, this::openCamera);
        action("photos",18,PRIMARY,()->openPocket(FilesActivity.class));
        action("paper",18,PRIMARY,()->openPocket(JournalActivity.class));
        section(content,"extras",false);
        action("calculator", 18, PRIMARY, () -> openPocket(CalculatorActivity.class));
        action("dice",18,PRIMARY,()->openPocket(DiceActivity.class));
        section(content, "phone", false);
        if (preferences.getBoolean("show_maps", true)) {
            action("maps", 18, PRIMARY, () -> launch("Maps", new Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0"))));
        }
        if (torchCamera != null) {
            torchValue = valueAction("flashlight", torchOn ? "on" : "off", this::toggleTorch);
        } else {
            valueAction("flashlight", "unavailable", () -> showFeedback("This phone has no available flashlight."));
        }
        flexibleSpace();
        addFeedback();
    }

    private void renderSettings() {
        heading("settings", "home");
        section(content, "display", true);
        valueAction("text size", preferences.getBoolean("large_text", false) ? "large" : "standard", () -> {
            preferences.edit().putBoolean("large_text", !preferences.getBoolean("large_text", false)).apply();
            render();
        });
        valueAction("colour", ACCENT_NAMES[Math.max(0, Math.min(3, preferences.getInt("accent", 0)))].toLowerCase(Locale.ROOT), () -> {
            preferences.edit().putInt("accent", (preferences.getInt("accent", 0) + 1) % ACCENTS.length).apply();
            render();
        });
        valueAction("clock", twentyFourHour() ? "24-hour" : "12-hour", () -> {
            preferences.edit().putBoolean("twenty_four_hour", !twentyFourHour()).apply();
            render();
        });
        valueAction("motion", preferences.getBoolean("reduce_motion", false) ? "off" : "on", () -> {
            preferences.edit().putBoolean("reduce_motion", !preferences.getBoolean("reduce_motion", false)).apply(); render();
        });
        section(content, "phone", false);
        homeStatus = valueAction("home screen", "", this::chooseHome);
        homeStatus.setTag("home_default_status"); updateHomeStatus();
        action("phone settings", 18, PRIMARY, () -> openPocket(DeviceSettingsActivity.class));
        action("permissions", 18, PRIMARY, () -> openPocket(PermissionsActivity.class));
        action("activity log",18,PRIMARY,()->openPocket(ReceiptActivity.class));
        section(content,"connections",false);
        if (romProfile) action("storage & devices", 18, PRIMARY, () -> openPocket(CloudActivity.class));
        if (romProfile) action("movement · COROS", 18, PRIMARY, () -> openPocket(MovementActivity.class));
        flexibleSpace();
        addFeedback();
        TextView version = text("Pocket Phone " + versionName() + "\nHold a shortcut to change its app or name.", 12, SECONDARY);
        version.setPadding(0, dp(16), 0, dp(16));
        content.addView(version);
    }
    private String versionName() {
        try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; }
        catch (PackageManager.NameNotFoundException | RuntimeException unavailable) { return ""; }
    }

    private void renderApps() {
        heading("apps", appsReturnTo,"settings",()->navigate("settings"),false);
        pocketAppResults = new LinearLayout(this);pocketAppResults.setOrientation(LinearLayout.VERTICAL);pocketAppResults.setTag("pocket_apps");content.addView(pocketAppResults);
        renderPocketApps();
        section(content, "installed", false);
        addInstalledApps(false);
        View search=content.findViewWithTag("app_search");content.removeView(search);content.addView(search,1);
        addFeedback();
    }
    private void renderPocketApps() {
        if(pocketAppResults==null)return;pocketAppResults.removeAllViews();
        boolean customHeading=false;
        for(int i=0;i<shortcuts.length;i++){
            String slot=shortcuts[i];
            if(!tiles.group(slot)&&tiles.app(slot)==null&&tiles.pocket(slot).equals(slot)&&!preferences.contains("shortcut_name_"+slot))continue;
            if(!AppSearch.matches(tiles.label(slot),appQuery))continue;
            if(!customHeading){section(pocketAppResults,"your shortcuts",true);customHeading=true;}
            int index=i;TextView row=actionInto(pocketAppResults,tiles.label(slot),18,PRIMARY,()->openShortcut(index));
            row.setTag("all_shortcut_"+slot);row.setOnLongClickListener(v->{editShortcut(slot);return true;});
        }
        String[][] groups={{"communicate","phone","messages","contacts"},{"plan & think","today","thoughts","tasks","notes","calendar","clock","pip"},{"capture & keep","camera","photos","paper"},{"extras","calculator","dice","movement"}};
        for(String[] group:groups){boolean heading=false;for(int i=1;i<group.length;i++){String name=group[i];if(!AppSearch.matches(name,appQuery))continue;
            if(!heading){section(pocketAppResults,group[0],pocketAppResults.getChildCount()==0);heading=true;}
            actionInto(pocketAppResults,name,18,PRIMARY,()->{
                if("thoughts".equals(name)||"tasks".equals(name)||"notes".equals(name))selectWorkspace(name);
                else if("calendar".equals(name))openPocket(AgendaActivity.class);else if("photos".equals(name))openPocket(FilesActivity.class);else if("paper".equals(name))openPocket(JournalActivity.class);else if("pip".equals(name))openChat();else openPocketApp(name);
            }).setTag("pocket_app_"+name);
        }}
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
            if(!assign)renderPocketApps();
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
        long notesBefore = planner.notesRevision(), tasksBefore = planner.tasksRevision();
        try { action.run(); }
        catch (IllegalArgumentException | IllegalStateException error) { showFeedback(error.getMessage()); }
        finally { if (planner.notesRevision() != notesBefore || planner.tasksRevision() != tasksBefore) CloudSync.changed(this); }
    }

    private void captureNoteTask(){persistDraft();if(captureText.trim().isEmpty()){showFeedback("Write a note first.");return;}startActivity(TaskCaptureActivity.intent(this,TaskSource.note(captureId,captureText)));}
    private void captureDrafts(){List<CaptureDrafts.Draft> drafts=CaptureDrafts.list(this);if(drafts.isEmpty()){showFeedback("No task drafts.");return;}String[] names=new String[drafts.size()];for(int i=0;i<names.length;i++)names[i]=drafts.get(i).title.isEmpty()?drafts.get(i).source.name:drafts.get(i).title;
        new AlertDialog.Builder(this).setTitle("Task drafts").setItems(names,(dialog,index)->{CaptureDrafts.Draft draft=drafts.get(index);new AlertDialog.Builder(this).setTitle(names[index]).setItems(new String[]{"Continue","Discard"},(choice,which)->{if(which==0)startActivity(new Intent(this,TaskCaptureActivity.class).putExtra("draft_key",draft.key));else new AlertDialog.Builder(this).setTitle("Discard this task draft?").setNegativeButton("Keep",null).setPositiveButton("Discard",(confirm,button)->{CaptureDrafts.clear(this,draft.key,draft.token);render();}).show();}).show();}).setNegativeButton("Cancel",null).show();}
    private void organizerSettings(){new AlertDialog.Builder(this).setTitle("Workspace settings").setItems(new String[]{"Share tasks and notes","Export Markdown","Task drafts","Calendar","Focus timer","Storage & devices"},(dialog,index)->{
        if(index==0)launch("Share",Intent.createChooser(new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT,planner.exportText()),"Share tasks and notes"));
        else if(index==1){try{startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("text/markdown").putExtra(Intent.EXTRA_TITLE,"pocket-notes.md"),EXPORT_REQUEST);}catch(ActivityNotFoundException|SecurityException e){showFeedback("Files is unavailable.");}}
        else if(index==2)captureDrafts();else if(index==4)navigate("focus");else if(index==5)openPocket(CloudActivity.class);else startActivity(new Intent(this,AgendaActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("app_settings",true));}).setNegativeButton("Close",null).show();}
    private void openTaskSource(TaskSource source){if(source.token.startsWith("thought:")){try{long thought=Long.parseLong(source.token.substring(8));if(ParkingStore.find(this,thought)!=null){openThought(thought);return;}}catch(NumberFormatException ignored){}}if(source.kind.equals("note")&&source.note>0){PlannerStore.Entry note=planner.find(source.note);if(note!=null){openCapture("note",note.id,note.text);return;}}
        if(source.kind.equals("message")){NoticeFeed.Item notice=NoticeFeed.find(source.ref);if(NotificationAccess.allowed(this)&&notice!=null&&notice.identity().equals(source.identity)){try{NoticeActions.open(this,notice);return;}catch(android.app.PendingIntent.CanceledException|RuntimeException expired){}}Intent app=getPackageManager().getLaunchIntentForPackage(source.pkg);if(app!=null){startActivity(app);return;}}
        String link=source.kind.equals("shared")?source.link():"";if(!link.isEmpty()){startActivity(new Intent(Intent.ACTION_VIEW,android.net.Uri.parse(link)));return;}
        TextView context=text(source.text,16,PRIMARY);context.setTextIsSelectable(true);ScrollView scroll=new ScrollView(this);scroll.setPadding(dp(16),dp(8),dp(16),dp(8));scroll.addView(context);new AlertDialog.Builder(this).setTitle(source.name).setView(scroll).setPositiveButton("Close",null).show();}
    private void refreshDayPlan(){if(planHost==null||destroyed||(!homePlan&&!"today".equals(workspaceTab)))return;if(homePlan&&homeGesture.pending()){homePlanRefresh=true;requestHomeRefresh(false);return;}int request=++planRequest,page=pageGeneration;boolean home=homePlan;LinearLayout target=planHost;long selected=CalendarBridge.selected(this);android.content.Context app=getApplicationContext();
        try{drawDayPlan(target,DayPlan.local(app,System.currentTimeMillis()),home);}catch(IllegalStateException failure){return;}
        appWorker.submit(()->{DayPlan.Result plan;try{plan=DayPlan.read(app,System.currentTimeMillis());}catch(RuntimeException unavailable){return;}appUi.post(()->{if(destroyed||!appVisible||page!=pageGeneration||request!=planRequest||target!=planHost||selected!=CalendarBridge.selected(this))return;if(home&&homeGesture.pending()){homePlanRefresh=true;requestHomeRefresh(false);return;}drawDayPlan(target,plan,home);motion.dataReady();});});}
    private void drawDayPlan(LinearLayout target,DayPlan.Result plan,boolean home){
        target.removeAllViews();target.setVisibility(View.VISIBLE);
        if(home){int shown=0;for(DayPlan.Item item:plan.items){if(item.end<=plan.now||item.when>=plan.end)continue;dashboardEvent(target,item,plan);if(++shown==2)break;}target.setVisibility(shown==0?View.GONE:View.VISIBLE);return;}
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
        heading(workspaceTab, "home","settings",this::organizerSettings,false);
        todayDate=todayText(new SimpleDateFormat("EEE · d MMM",Locale.getDefault()).format(new Date()),12,SECONDARY,false);todayDate.setTag("today_date");todayDate.setGravity(Gravity.CENTER);todayDate.setPadding(0,0,0,dp(4));content.addView(todayDate);
        workspaceTabs = new LinearLayout(this); workspaceTabs.setTag("workspace_tabs");
        for (String tab : new String[]{"today", "thoughts", "tasks", "notes"}) {
            TextView link = actionInto(workspaceTabs, tab, 14, SECONDARY, () -> selectWorkspace(tab));
            link.setTag("workspace_tab_" + tab); PocketDesign.tab(link, tab.equals(workspaceTab));
            link.setContentDescription(tab + (tab.equals(workspaceTab) ? ", selected" : "")); link.setLayoutParams(new LinearLayout.LayoutParams(0,-2,1));
        }
        content.addView(workspaceTabs);
        if ("thoughts".equals(workspaceTab)) { renderThoughts(content); workspaceBottom("+ new", () -> openThoughtCapture(0)); addFeedback(); return; }
        if ("notes".equals(workspaceTab)) { renderWorkspaceNotes(content); workspaceBottom("+ note", () -> openCapture("note",0,"")); addFeedback(); return; }
        boolean daily = "today".equals(workspaceTab);
        planHost=new LinearLayout(this);planHost.setOrientation(LinearLayout.VERTICAL);planHost.setTag("today_plan");homePlan=false;content.addView(planHost);
        if (!daily) planHost.setVisibility(View.GONE);
        if (daily) {
            int ready = ParkingStore.backCount(this, System.currentTimeMillis());
            if (ready > 0) action(ready + (ready == 1 ? " thought to revisit" : " thoughts to revisit"),14,accent(),()->selectWorkspace("thoughts")).setTag("today_thought_review");
            resumeWriting();
        }
        if(daily)commands(content,"today_commands",new String[]{"+ task","+ note","focus"},new String[]{"today_add_task","today_add_note","today_focus"},0,
                ()->openCapture("task",0,""),()->openCapture("note",0,""),()->navigate("focus"));
        section(content,"tasks",false).setTag("today_tasks_heading");
        todayFilters=new LinearLayout(this);todayFilters.setTag("today_filters");
        for(String name:new String[]{"Open","Today","Later","Done"}){
            TextView filter=actionInto(todayFilters,name.toLowerCase(Locale.ROOT),14,SECONDARY,()->{taskFilter=name;workspaceTab="tasks";render();});
            filter.setTag("task_filter_"+name);PocketDesign.tab(filter,name.equals(daily ? "Today" : taskFilter));
            filter.setContentDescription(name+" tasks"+(name.equals(taskFilter)?", selected":""));
            filter.setLayoutParams(new LinearLayout.LayoutParams(0,-2,1));
        }
        if(!daily)content.addView(todayFilters);
        if(!organizerQuery.trim().isEmpty()){TextView query=action("search · "+organizerQuery,14,accent(),this::searchOrganizer);query.setTag("organizer_query");query.setMaxLines(1);query.setEllipsize(TextUtils.TruncateAt.END);}
        LinearLayout taskResults=new LinearLayout(this);taskResults.setOrientation(LinearLayout.VERTICAL);taskResults.setTag("today_tasks");content.addView(taskResults);
        LinearLayout noteResults=new LinearLayout(this);noteResults.setOrientation(LinearLayout.VERTICAL);noteResults.setTag("today_notes");content.addView(noteResults);renderOrganizerLists(taskResults,noteResults);
        noteResults.setVisibility(View.GONE);
        if(daily){action("all tasks",14,SECONDARY,()->selectWorkspace("tasks")).setTag("today_all_tasks");
            section(content,"review",false);action("done tasks",14,SECONDARY,()->{taskFilter="Done";selectWorkspace("tasks");});action("today's activity",14,SECONDARY,()->openPocket(ReceiptActivity.class));}
        workspaceBottom(daily ? "capture" : "+ task", daily ? this::captureMenu : () -> openCapture("task",0,""));
        addFeedback();
    }
    private void workspaceBottom(String label, Runnable capture) {
        todayActions = softKeys("today_actions",new String[]{label,"search","calendar","pip"},new String[]{"workspace_capture","today_search","today_calendar","today_chat"},0,
                capture,()->navigate("search"),()->openPocket(AgendaActivity.class),this::openChat);
    }
    private void selectWorkspace(String tab) {
        if (!java.util.Arrays.asList("today","thoughts","tasks","notes").contains(tab)) return;
        persistDraft(); workspaceTab = tab; organizerQuery = "";
        if ("today".equals(screen)) { motion.settle(); render(); } else navigate("today");
    }
    private void captureMenu() {
        new AlertDialog.Builder(this).setTitle("Capture").setItems(new String[]{"Thought","Task","Note","Appointment"},(dialog,index)->{
            if(index==0)openThoughtCapture(0);else if(index==1)openCapture("task",0,"");else if(index==2)openCapture("note",0,"");else startActivity(new Intent(this,AgendaActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("title",""));
        }).show();
    }
    private void resumeWriting() {
        List<String> kinds = new ArrayList<>(); for(String kind:new String[]{"thought","task","note"})if(!planner.draft(kind,0).trim().isEmpty())kinds.add(kind);
        if(!kinds.isEmpty())action("continue writing · "+String.join(", ",kinds),14,SECONDARY,()->new AlertDialog.Builder(this).setTitle("Continue writing").setItems(kinds.toArray(new String[0]),(dialog,index)->{
            String kind=kinds.get(index);if("thought".equals(kind))openThoughtCapture(0);else openCapture(kind,0,"");
        }).show()).setTag("workspace_resume");
    }
    private void renderWorkspaceNotes(LinearLayout host) {
        commands(host,"notes_capture",new String[]{"+ note","+ paper page"},new String[]{"notes_new","notes_paper"},0,()->openCapture("note",0,""),()->openPocket(JournalActivity.class));
        List<PlannerStore.Entry> notes = new ArrayList<>();for(PlannerStore.Entry entry:planner.entries())if("note".equals(entry.kind))notes.add(entry);
        Collections.sort(notes,(a,b)->planner.notePinned(a.id)!=planner.notePinned(b.id)?(planner.notePinned(a.id)?-1:1):Long.compare(planner.noteUpdated(b),planner.noteUpdated(a)));
        section(host,"notes · "+notes.size(),true);
        if(notes.isEmpty())host.addView(text("No notes yet.",16,SECONDARY));
        for(PlannerStore.Entry entry:notes){String[] excerpt=ReadableRows.excerpt(entry.text);
            LinearLayout row=ReadableRows.item(this,excerpt[0],(planner.notePinned(entry.id)?"Pinned · ":"")+excerpt[1],SECONDARY,"note_open_"+entry.id,()->openNote(entry.id));
            row.setOnLongClickListener(v->{entryMenu(entry);return true;});host.addView(row);
        }
    }
    private void renderThoughts(LinearLayout host) {
        List<ParkingStore.Item> items = ParkingStore.open(this); section(host,"thoughts · "+items.size(),true);
        if(items.isEmpty())host.addView(text("No thoughts yet.",16,SECONDARY));
        long now=System.currentTimeMillis();for(ParkingStore.Item item:items){
            String meta=item.due==0?"Undecided":item.back(now)?"Ready to revisit":"Revisit · "+java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.SHORT,java.text.DateFormat.SHORT).format(new Date(item.due));
            if(!item.note.isEmpty())meta+=" · from a note";
            host.addView(ReadableRows.item(this,item.text,meta,item.back(now)?accent():SECONDARY,"thought_open_"+item.id,()->openThought(item.id)));
        }
        List<ParkingStore.Item> handled=new ArrayList<>();for(ParkingStore.Item item:ParkingStore.items(this))if(!item.open())handled.add(item);
        if(!handled.isEmpty())actionInto(host,"handled thoughts · "+handled.size(),14,SECONDARY,()->{
            String[] labels=new String[handled.size()];for(int i=0;i<labels.length;i++)labels[i]=handled.get(i).text;
            new AlertDialog.Builder(this).setTitle("Handled thoughts").setItems(labels,(dialog,index)->openThought(handled.get(index).id)).show();
        });
    }
    private void openThought(long id) { persistDraft();captureEditor=null;captureStepsEditor=null;captureId=id;captureKind="thought";navigate("thought_detail"); }
    private void openThoughtCapture(long id) {
        persistDraft();ParkingStore.Item item=id==0?null:ParkingStore.find(this,id);captureKind="thought";captureId=id;
        captureText=planner.hasDraft("thought",id)?planner.draft("thought",id):item==null?"":item.text;
        captureReview=getSharedPreferences("pocket_planner",0).getLong("draft_thought_review_"+id,item==null?0:item.due);
        captureEditor=null;captureStepsEditor=null;captureSelectionStart=captureSelectionEnd=-1;
        if("capture".equals(screen))render();else navigate("capture");
    }
    private void renderThoughtDetail() {
        heading("thought","today");ParkingStore.Item item=ParkingStore.find(this,captureId);
        if(item==null){content.addView(text("This thought was removed.",16,SECONDARY));return;}
        content.addView(text(item.text,20,PRIMARY));long linked=ParkingStore.task(this,item.id);
        if(!item.open()){
            content.addView(text(ParkingStore.TASK.equals(item.state)?"Made into a task":"Let go",14,SECONDARY));
            if(linked!=0)action("open task",18,accent(),()->openTask(linked));return;
        }
        commands(content,"thought_commands",new String[]{"make task","edit"},new String[]{"thought_promote","thought_edit"},0,
                ()->plannerAction(()->openTask(ParkingStore.promote(this,item.id))),()->openThoughtCapture(item.id));
        valueAction("revisit",item.due==0?"when I choose":java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.SHORT,java.text.DateFormat.SHORT).format(new Date(item.due)),()->chooseThoughtReview(item.due,value->{ParkingStore.repark(this,item.id,value);ParkingReceiver.arm(this);render();})).setTag("thought_review");
        PlannerStore.Entry note=NoteSync.byUid(planner,item.note);if(note!=null)action("from note · "+NoteThoughts.title(note),16,SECONDARY,()->openNote(note.id));
        action("let go",14,SECONDARY,()->new AlertDialog.Builder(this).setTitle("Let this thought go?").setNegativeButton("Keep",null).setPositiveButton("Let go",(d,w)->{ParkingStore.close(this,item.id,ParkingStore.KILLED);ParkingReceiver.arm(this);leave("today");}).show());
        addFeedback();
    }
    private void chooseThoughtReview(long initial, java.util.function.LongConsumer result) {
        new AlertDialog.Builder(this).setTitle("Revisit this thought").setItems(new String[]{"When I choose","Tomorrow morning","Next week","Choose date and time"},(dialog,index)->{
            if(index==0)result.accept(0);else if(index<3)result.accept(ParkingStore.when(index==1?"tomorrow":"next week",System.currentTimeMillis()));
            else ReminderPicker.show(this,initial>System.currentTimeMillis()?initial:System.currentTimeMillis()+3600000,result::accept);
        }).show();
    }
    private void renderThoughtCapture() {
        heading(captureId==0?"new thought":"edit thought","thought_detail","save",this::saveThought,true);
        captureEditor=new EditText(this);PocketDesign.input(captureEditor);captureEditor.setTag("capture_editor");captureEditor.setHint("What's on your mind?");captureEditor.setMinLines(4);
        captureEditor.setFilters(new InputFilter[]{new InputFilter.LengthFilter(PlannerStore.TASK_LIMIT)});captureEditor.setText(captureText);content.addView(captureEditor);
        watchDraft(captureEditor);
        valueAction("revisit",captureReview==0?"when I choose":java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.SHORT,java.text.DateFormat.SHORT).format(new Date(captureReview)),()->chooseThoughtReview(captureReview,value->{persistDraft();captureReview=value;planner.preferences().edit().putLong("draft_thought_review_"+captureId,value).apply();render();}));
        addFeedback();
    }
    private void saveThought() { plannerAction(()->{
        long old=captureId;String value=captureEditor.getText().toString();
        if(old==0)ParkingStore.park(this,value,captureReview);else{ParkingStore.edit(this,old,value);ParkingStore.repark(this,old,captureReview);}
        planner.clearDraft("thought",old);planner.preferences().edit().remove("draft_thought_review_"+old).apply();ParkingReceiver.arm(this);
        hideKeyboard(captureEditor);captureEditor=null;captureText="";leave(workspace()?"today":"home");showFeedback("Thought saved.");
    }); }
    private void renderWorkspaceSearch() {
        heading("search","today");EditText search=new EditText(this);PocketDesign.input(search);search.setSingleLine(true);search.setTag("workspace_search");search.setHint("Thoughts, tasks, notes and appointments");search.setText(workspaceSearchQuery);content.addView(search);
        LinearLayout results=new LinearLayout(this);results.setOrientation(LinearLayout.VERTICAL);results.setTag("workspace_search_results");content.addView(results);
        Runnable find=()->{workspaceSearchQuery=search.getText().toString();results.removeAllViews();String query=workspaceSearchQuery.trim().toLowerCase(Locale.ROOT);
            if(query.isEmpty()){results.addView(text("Find a thought, an action, a note or time you set aside.",16,SECONDARY));return;}int count=0;
            for(ParkingStore.Item item:ParkingStore.open(this))if(item.text.toLowerCase(Locale.ROOT).contains(query)){results.addView(ReadableRows.item(this,item.text,"Thought",SECONDARY,"search_thought_"+item.id,()->openThought(item.id)));count++;}
            for(PlannerStore.Entry entry:planner.entries()){String haystack=entry.text+"\n"+PlannerStore.stepsText(entry.steps)+(entry.source==null?"":"\n"+entry.source.text);
                if(haystack.toLowerCase(Locale.ROOT).contains(query)){results.addView(ReadableRows.item(this,ReadableRows.excerpt(entry.text)[0],"task".equals(entry.kind)?(entry.done?"Task · done":"Task"):"Note",SECONDARY,"search_entry_"+entry.id,()->{if("task".equals(entry.kind))openTask(entry.id);else openNote(entry.id);}));count++;}}
            for(AgendaStore.Event event:AgendaStore.list(this))if(event.title.toLowerCase(Locale.ROOT).contains(query)){results.addView(ReadableRows.item(this,event.title,"Appointment · "+java.text.DateFormat.getDateTimeInstance().format(new Date(event.when)),SECONDARY,"search_appointment_"+event.id,()->startActivity(new Intent(this,AgendaActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("appointment_id",event.id))));count++;}
            if(count==0)results.addView(text("Nothing found.",16,SECONDARY));
        };search.addTextChangedListener(new TextWatcher(){public void beforeTextChanged(CharSequence s,int a,int c,int f){}public void onTextChanged(CharSequence s,int a,int b,int c){find.run();}public void afterTextChanged(Editable e){}});find.run();addFeedback();
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
            String filter = "today".equals(workspaceTab) ? "Today" : taskFilter;
            int noteCount = 0;
            long pinned=getSharedPreferences("pocket_planner",0).getLong("next_task",0);
            for (PlannerStore.Entry entry : entries) {
                String searchable = entry.text + "\n" + PlannerStore.stepsText(entry.steps);
                if (!searchable.toLowerCase(Locale.getDefault()).contains(query)) continue;
                if ("note".equals(entry.kind)) {
                    if (!"notes".equals(workspaceTab)) continue;
                    if(noteCount++==0)section(notes,"notes",false);
                    String[] excerpt=ReadableRows.excerpt(entry.text);
                    if(planner.notePinned(entry.id))excerpt[1]="Pinned"+(excerpt[1].isEmpty()?"":" · "+excerpt[1]);
                    LinearLayout row=ReadableRows.item(this,excerpt[0],excerpt[1],SECONDARY,"note_open_"+entry.id,()->openCapture("note",entry.id,entry.text));
                    row.setOnLongClickListener(v -> { entryMenu(entry); return true; });notes.addView(row,new LinearLayout.LayoutParams(-1,-2));continue;
                }
                if (!"task".equals(entry.kind) || entry.done != "Done".equals(filter)) continue;
                if ("Today".equals(filter) && entry.id!=pinned && (entry.due.isEmpty() || entry.due.compareTo(today) > 0)) continue;
                if ("Later".equals(filter) && (entry.due.isEmpty() || entry.due.compareTo(today) <= 0)) continue;
                matches.add(entry);
            }
            Collections.sort(matches,(a,b)->a.id==b.id?0:a.id==pinned?-1:b.id==pinned?1:PlannerStore.compareTasks(a,b));
            java.util.Set<String> groups=new java.util.HashSet<>();for(PlannerStore.Entry entry:matches)groups.add(taskGroup(entry,pinned,today));
            String lastGroup = "";
            TextView taskHeading = content.findViewWithTag("today_tasks_heading");
            taskHeading.setText("tasks · " + matches.size() + " " + filter.toLowerCase(Locale.getDefault()));
            for (PlannerStore.Entry entry : matches) {
                String group=taskGroup(entry,pinned,today);
                if (groups.size()>1&&!group.equals(lastGroup)) {
                    TextView label = section(tasks, group, true); if (group.equals("Overdue")) label.setTextColor(AMBER);
                    label.setPadding(0, dp(lastGroup.isEmpty()?8:16), 0, dp(4)); lastGroup = group;
                }
                LinearLayout line = new LinearLayout(this); line.setGravity(Gravity.CENTER_VERTICAL);
                android.widget.CheckBox check = taskCheckbox(entry.done, "task_check_" + entry.id, (entry.done ? "Reopen " : "Complete ") + entry.text,
                        () -> plannerAction(() -> { TaskReminders.toggle(this,entry.id); render(); }));
                check.setContentDescription((entry.done ? "Reopen " : "Complete ") + entry.text);
                line.addView(check, new LinearLayout.LayoutParams(dp(48), -2));
                boolean isNext=entry.id==pinned&&!entry.done;
                String details = (isNext?"Next · ":"")+(entry.important ? "Important · " : "") + taskDateLabel(entry.due);
                if (!entry.steps.isEmpty()) details += " · " + entry.completedSteps() + "/" + entry.steps.size() + " steps";
                int metadataColor=!entry.due.isEmpty()&&entry.due.compareTo(today)<0&&!entry.done?AMBER:isNext?accent():SECONDARY;
                LinearLayout item=ReadableRows.item(this,entry.text,details,metadataColor,"task_open_"+entry.id,()->openTask(entry.id));
                TextView title=(TextView)item.getChildAt(0);
                if(entry.done){title.setTextColor(SECONDARY);title.setPaintFlags(title.getPaintFlags()|android.graphics.Paint.STRIKE_THRU_TEXT_FLAG);}
                item.setPadding(dp(4),dp(8),0,dp(8));
                item.setOnLongClickListener(v -> { taskQuickActions(entry.id); return true; });line.addView(item,new LinearLayout.LayoutParams(0,-2,1));
                TextView more=text("⋮",24,SECONDARY);PocketDesign.control(more);more.setTag("task_more_"+entry.id);
                more.setContentDescription("Actions for "+entry.text);more.setOnClickListener(v->taskQuickActions(entry.id));
                line.addView(more,new LinearLayout.LayoutParams(dp(48),-2));tasks.addView(line);
            }
            if (matches.isEmpty()) tasks.addView(todayText(query.isEmpty()?"No "+filter.toLowerCase(Locale.US)+" tasks":"No matching tasks",14,SECONDARY,false));
            if(noteCount==0){section(notes,"notes",false);notes.addView(todayText(query.isEmpty()?"No notes":"No matching notes",14,SECONDARY,false));}

        } catch (IllegalStateException | IllegalArgumentException error) { tasks.addView(text(error.getMessage(), 16, AMBER)); }
    }

    private String taskGroup(PlannerStore.Entry entry,long pinned,String today){return entry.done?"Completed":entry.id==pinned?"Next":entry.due.isEmpty()?"Anytime":entry.due.compareTo(today)<0?"Overdue":entry.due.equals(today)?"Today":"Upcoming";}

    private String taskDateLabel(String due) {
        if (due.isEmpty()) return "No date";
        String today=PlannerDates.today();if(due.equals(today))return "Today";
        Calendar tomorrow=Calendar.getInstance();tomorrow.add(Calendar.DAY_OF_MONTH,1);
        if(due.equals(PlannerDates.day(tomorrow.get(Calendar.YEAR),tomorrow.get(Calendar.MONTH),tomorrow.get(Calendar.DAY_OF_MONTH))))return "Tomorrow";
        String date=new SimpleDateFormat("d MMM",Locale.getDefault()).format(PlannerDates.parse(due));
        if(!due.substring(0,4).equals(today.substring(0,4)))date+=" "+due.substring(0,4);
        return due.compareTo(today)<0?"Overdue · "+date:date;
    }
    private android.widget.CheckBox taskCheckbox(boolean done,String tag,String description,Runnable toggle) {
        android.widget.CheckBox check=new android.widget.CheckBox(this);check.setChecked(done);check.setText("");
        check.setButtonTintList(android.content.res.ColorStateList.valueOf(done?SECONDARY:accent()));
        check.setMinHeight(dp(56));check.setMinWidth(dp(48));check.setGravity(Gravity.CENTER);check.setPadding(dp(8),0,0,0);
        check.setTag(tag);check.setContentDescription(description);check.setOnClickListener(v->toggle.run());return check;
    }
    private void taskQuickActions(long id) {
        PlannerStore.Entry task=planner.find(id);if(task==null){showFeedback("This task was removed.");return;}
        boolean chosen=planner.preferences().getLong("next_task",0)==id;
        List<String> choices=new ArrayList<>();choices.add("Edit task");
        if(!task.done){choices.add("Due today");choices.add("Due tomorrow");choices.add("Choose due date");choices.add(chosen?"Remove from next":"Make next");choices.add("Schedule reminder");}
        choices.add(task.important?"Remove important":"Mark important");choices.add(task.done?"Reopen task":"Complete task");choices.add("Delete task");
        new AlertDialog.Builder(this).setTitle(task.text).setItems(choices.toArray(new String[0]),(dialog,index)->{
            String choice=choices.get(index);
            if(choice.equals("Edit task")){PlannerStore.Entry fresh=planner.find(id);if(fresh!=null)openCapture("task",id,fresh.text);}
            else if(choice.equals("Due today"))plannerAction(()->{planner.setDue(id,PlannerDates.today());render();});
            else if(choice.equals("Due tomorrow")){Calendar day=Calendar.getInstance();day.add(Calendar.DAY_OF_MONTH,1);plannerAction(()->{planner.setDue(id,PlannerDates.day(day.get(Calendar.YEAR),day.get(Calendar.MONTH),day.get(Calendar.DAY_OF_MONTH)));render();});}
            else if(choice.equals("Choose due date"))chooseTaskDate(task.due,value->plannerAction(()->{planner.setDue(id,value);render();}));
            else if(choice.equals("Make next")||choice.equals("Remove from next"))plannerAction(()->{planner.makeNext(choice.equals("Make next")?id:0);render();});
            else if(choice.equals("Schedule reminder"))startActivity(new Intent(this,TaskReminderActivity.class).putExtra("task",id));
            else if(choice.equals("Mark important")||choice.equals("Remove important"))plannerAction(()->{planner.toggleImportant(id);render();});
            else if(choice.equals("Complete task")||choice.equals("Reopen task"))plannerAction(()->{TaskReminders.toggle(this,id);render();});
            else deleteTask(id);
        }).show();
    }
    private void deleteTask(long id) {
        new AlertDialog.Builder(this).setTitle("Delete task?").setNegativeButton("Cancel",null).setPositiveButton("Delete",(dialog,button)->plannerAction(()->{
            TaskReminders.delete(this,id);planner.clearDraft("task",id);if("task_detail".equals(screen))leave("today");else render();
        })).show();
    }
    private void addTaskStep(long id) {
        EditText input=new EditText(this);PocketDesign.input(input);input.setSingleLine(true);input.setHint("Step");input.setTag("task_add_step_editor");
        input.setFilters(new InputFilter[]{new InputFilter.LengthFilter(160)});
        android.widget.FrameLayout field=new android.widget.FrameLayout(this);field.setPadding(dp(16),dp(8),dp(16),dp(8));field.addView(input);
        AlertDialog dialog=new AlertDialog.Builder(this).setTitle("Add step").setView(field).setNegativeButton("Cancel",null).setPositiveButton("Add",null).create();
        dialog.setOnShowListener(ignored->{input.requestFocus();dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{
            try {planner.addStep(id,input.getText().toString());CloudSync.changed(this);hideKeyboard(input);dialog.dismiss();render();}
            catch(IllegalArgumentException|IllegalStateException error){input.setError(error.getMessage());}
        });});dialog.getWindow().setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE);dialog.show();
    }

    private void openTask(long id) {
        persistDraft(); captureEditor = null; captureStepsEditor = null; captureId = id; navigate("task_detail");
    }

    private void renderTaskDetail() {
        heading("task", "today");
        PlannerStore.Entry entry;
        try { entry = planner.find(captureId); }
        catch (IllegalStateException error) { content.addView(text(error.getMessage(), 16, AMBER)); return; }
        if (entry == null) { content.addView(text("This task was removed.", 16, SECONDARY)); return; }
        TextView title=text(entry.text,20,entry.done?SECONDARY:PRIMARY);title.setTypeface(Typeface.MONOSPACE,Typeface.BOLD);
        title.setPadding(0,dp(8),0,dp(4));title.setTag("task_detail_title");content.addView(title);
        boolean chosen=planner.preferences().getLong("next_task",0)==entry.id;
        String status=(entry.done?"Done":chosen?"Next":"Open")+(entry.important?" · Important":"")+" · "+taskDateLabel(entry.due);
        TextView meta=text(status,14,!entry.due.isEmpty()&&entry.due.compareTo(PlannerDates.today())<0&&!entry.done?AMBER:SECONDARY);meta.setPadding(0,0,0,dp(4));content.addView(meta);
        commands(content,"task_detail_commands",new String[]{entry.done?"reopen task":"complete task","edit task","focus"},new String[]{"task_complete","task_edit","task_focus"},0,
                ()->plannerAction(()->{TaskReminders.toggle(this,entry.id);render();}),()->openCapture("task",entry.id,entry.text),()->navigate("focus"));
        section(content,"steps · " + entry.completedSteps() + "/" + entry.steps.size(),false);
        for (int i = 0; i < entry.steps.size(); i++) {
            int index = i; PlannerStore.Step step = entry.steps.get(i);
            Runnable toggle=()->plannerAction(()->{planner.toggleStep(entry.id,index);render();});
            LinearLayout row=new LinearLayout(this);row.setGravity(Gravity.CENTER_VERTICAL);row.setTag("task_step_"+i);PocketDesign.list(row);row.setFocusable(true);
            row.setContentDescription((step.done?"Completed step, ":"Step, ")+step.text);row.setOnClickListener(v->toggle.run());
            android.widget.CheckBox check=taskCheckbox(step.done,"task_step_check_"+i,(step.done?"Reopen ":"Complete ")+step.text,toggle);
            check.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);row.addView(check,new LinearLayout.LayoutParams(dp(48),-2));
            TextView name=text(step.text,16,step.done?SECONDARY:PRIMARY);name.setPadding(dp(4),dp(12),0,dp(12));
            if(step.done)name.setPaintFlags(name.getPaintFlags()|android.graphics.Paint.STRIKE_THRU_TEXT_FLAG);
            name.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);row.addView(name,new LinearLayout.LayoutParams(0,-2,1));content.addView(row);
        }
        commands(content,"task_step_commands",new String[]{"+ add step"},new String[]{"task_add_step"},0,()->addTaskStep(entry.id));
        section(content,"details",false);
        valueAction("due",taskDateLabel(entry.due).toLowerCase(Locale.getDefault()),()->chooseTaskDate(entry.due,value->plannerAction(()->{planner.setDue(entry.id,value);render();})))
                .setTag("task_detail_due");
        valueAction("important",entry.important?"on":"off",()->plannerAction(()->{planner.toggleImportant(entry.id);render();})).setTag("task_detail_important");
        if (!entry.done) {
            valueAction("next task",chosen?"yes":"no",()->plannerAction(()->{planner.makeNext(chosen?0:entry.id);render();})).setTag("task_detail_next");
            valueAction("reminder",TaskReminders.find(this,entry.id)==null?"none":TaskReminders.label(this,entry.id).replaceFirst("^Reminder[^·]*· ",""),
                    ()->startActivity(new Intent(this,TaskReminderActivity.class).putExtra("task",entry.id))).setTag("task_detail_reminder");
            action("focus · 25 min", 18, PRIMARY, () -> startActivity(new Intent(this, ClockActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    .putExtra("seconds", 1500).putExtra("title", "Focus: " + entry.text.substring(0, Math.min(60, entry.text.length())))));
        }
        if(entry.source!=null)action("source · "+entry.source.name,14,SECONDARY,()->openTaskSource(entry.source)).setTag("task_source");
        section(content,"time",false);
        for(AgendaStore.Event event:AgendaStore.list(this))if(event.task==entry.id)action(event.title+" · "+java.text.DateFormat.getDateTimeInstance().format(new Date(event.when)),14,SECONDARY,()->startActivity(new Intent(this,AgendaActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("appointment_id",event.id)));
        if(!entry.done)action("plan time",14,accent(),()->startActivity(new Intent(this,AgendaActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("title",entry.text).putExtra("task",entry.id))).setTag("task_plan_time");
        if (!planner.draft("task", entry.id).isEmpty()) content.addView(text("Unsaved edit", 14, SECONDARY));
        action("delete task",14,SECONDARY,()->deleteTask(entry.id));
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
                            plannerAction(() -> { TaskReminders.delete(this,entry.id); planner.clearDraft(entry.kind, entry.id); if("note_preview".equals(screen)){trail.take(pageKey("capture"));leave("today");}else render(); })).show();
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
        if ("thought".equals(captureKind)) { renderThoughtCapture(); return; }
        boolean task = "task".equals(captureKind);
        captureEditor = task ? new EditText(this) : new MarkdownEditor(this);
        EditText editorForPage = captureEditor;
        Runnable saveCapture = () -> saveCapture(editorForPage, task);
        String title = captureId == 0 ? (task ? "new task" : "note") : "edit";
        if (task) heading(title, captureId != 0 ? "task_detail" : "today", "save", saveCapture, true);
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
            TextView due = action(dueLabel(captureDue), 16, PRIMARY, () -> {});
            due.setTag("task_due"); due.setOnClickListener(v -> chooseTaskDate(captureDue, value -> {
                captureDue = value; due.setText(dueLabel(value)); persistDraft();
            }));
            TextView important = action(importantLabel(captureImportant), 16, PRIMARY, () -> {});
            important.setTag("task_important"); important.setOnClickListener(v -> {
                captureImportant = !captureImportant; important.setText(importantLabel(captureImportant)); persistDraft();
            });
            section(content, "steps", false);
            captureStepsEditor = new EditText(this); captureStepsEditor.setTag("task_steps_editor");
            captureStepsEditor.setTextColor(PRIMARY); captureStepsEditor.setHintTextColor(SECONDARY);
            captureStepsEditor.setTypeface(Typeface.MONOSPACE); captureStepsEditor.setTextSize(16);
            captureStepsEditor.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
            PocketDesign.input(captureStepsEditor); captureStepsEditor.setGravity(Gravity.TOP);
            captureStepsEditor.setFilters(new InputFilter[]{new InputFilter.LengthFilter(PlannerStore.STEPS_TEXT_LIMIT)});
            captureStepsEditor.setHint("One step per line"); captureStepsEditor.setMinLines(3); captureStepsEditor.setMaxLines(8);
            captureStepsEditor.setText(captureSteps); content.addView(captureStepsEditor, new LinearLayout.LayoutParams(-1, -2));
        } else {
            gap(16);
            MarkdownEditor note = (MarkdownEditor) captureEditor;
            note.configureWheel(this::noteFormatMenu);
            LinearLayout tools = softKeys("note_actions", new String[]{"preview", "task"}, new String[]{"note_preview", "note_task"}, 0,
                    () -> { persistDraft(); hideKeyboard(captureEditor); navigate("note_preview"); }, this::captureNoteTask);
            NoteFormatControl format = new NoteFormatControl(this, note);
            format.setTag("note_format_control"); PocketDesign.softKey(format, 0, 3, false); format.setTextColor(PocketDesign.colors(this, SECONDARY));
            tools.addView(format, 0, PocketDesign.softKeyCell(this, 0, 3));
            PocketDesign.softKey((TextView) tools.getChildAt(1), 1, 3, true); tools.getChildAt(1).setLayoutParams(PocketDesign.softKeyCell(this, 1, 3));
            PocketDesign.softKey((TextView) tools.getChildAt(2), 2, 3, false); tools.getChildAt(2).setLayoutParams(PocketDesign.softKeyCell(this, 2, 3));
            content.addView(tools);
        }
        if (task) {
            action("clear draft", 14, SECONDARY, () -> clearCaptureDraft(editorForPage));
        }
        watchDraft(captureEditor); if (captureStepsEditor != null) watchDraft(captureStepsEditor);
        addFeedback();
    }
    private static String dueLabel(String due) { return "due · " + PlannerDates.label(due).toLowerCase(Locale.getDefault()); }
    private static String importantLabel(boolean on) { return on ? "important · on" : "important · off"; }

    /** Opens a note's preview, for example from a thought in the Parking Lot. */
    private void openNote(long id) {
        PlannerStore.Entry note = planner.find(id);
        if (note == null || !"note".equals(note.kind)) { showFeedback("This note was removed."); return; }
        persistDraft(); captureKind = "note"; captureId = id;
        captureText = planner.hasDraft("note", id) ? planner.draft("note", id) : note.text;
        navigate("note_preview");
    }

    private void saveCapture(EditText editorForPage, boolean task) {
        if (captureEditor != editorForPage || !"capture".equals(screen)) return;
        plannerAction(() -> {
            long saved; boolean created = captureId == 0; String notice = created ? (task ? "Task added." : "Note saved.") : "";
            if (task) {saved = planner.saveTask(captureId, captureEditor.getText().toString(), captureDue, captureImportant, captureStepsEditor.getText().toString());if(captureId!=0)TaskReminders.rename(this,saved,captureEditor.getText().toString().trim());}
            else { PlannerStore.Entry before = captureId == 0 ? null : planner.find(captureId); String text = captureEditor.getText().toString();
                saved = planner.save(captureId, captureKind, text);
                if ("note".equals(captureKind)) { int added = NoteThoughts.parkNew(this, planner, saved, before == null ? "" : before.text, text); if (added > 0) notice = added == 1 ? "1 thought saved from this note." : added + " thoughts saved from this note."; } }
            planner.clearDraft(captureKind, captureId);
            hideKeyboard(captureEditor); captureEditor = null; captureStepsEditor = null; captureText = "";
            captureId = saved; captureSelectionStart = captureSelectionEnd = -1;
            // A saved action opens its next decisions: plan time, start Focus, or complete it.
            if (task) finishPage("task_detail");
            else leave(workspace() ? "today" : "home");
            if (!notice.isEmpty()) showFeedback(notice);
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
        heading("preview", "capture");
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
                .build().setMarkdown(preview, "note".equals(captureKind) ? NoteThoughts.annotate(this, planner, captureId, captureText) : captureText);
        content.addView(preview, new LinearLayout.LayoutParams(-1, -2, 1)); gap(16);
        Runnable share = () -> launch("Share", Intent.createChooser(new Intent(Intent.ACTION_SEND)
                .setType("text/plain").putExtra(Intent.EXTRA_TEXT, captureText), "Share note"));
        Runnable more = () -> { if (captureId == 0) showFeedback("Save this note to pin it."); else { PlannerStore.Entry note = planner.find(captureId); if (note != null) entryMenu(note); else showFeedback("This note was removed."); } };
        // A note read from a journal page shows the handwriting behind it.
        String noteUid = captureId == 0 ? null : NoteSync.existingUid(planner, captureId);
        org.json.JSONObject page = JournalStore.forNote(this, noteUid);
        LinearLayout tools;
        if (page == null) tools = softKeys("preview_actions", new String[]{"edit", "share", "task", "more"}, null, 0, () -> navigate("capture"), share, this::captureNoteTask, more);
        else { String pageUid = page.optString("uid");
            tools = softKeys("preview_actions", new String[]{"edit", "share", "task", "paper", "more"}, new String[]{"note_edit", "note_share", "note_task", "note_paper", "note_more"}, 0,
                    () -> navigate("capture"), share, this::captureNoteTask, () -> openPocket(JournalPageActivity.class, pageUid), more); }
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
        heading("focus", "today");
        PlannerStore.Entry next;
        try { next = planner.nextTask(); }
        catch (IllegalStateException error) { next = null; }
        if(!focusTitle.isEmpty())content.addView(text(focusTitle,18,PRIMARY));else if (next != null) content.addView(text(next.text, 16, PRIMARY));
        section(content, "timers", false);
        action("focus · 25 min", 18, accent(), () -> startFocusTimer(25, "Focus"));
        action("focus · 50 min", 18, PRIMARY, () -> startFocusTimer(50, "Focus"));
        action("break · 5 min", 18, PRIMARY, () -> startFocusTimer(5, "Break"));
        action("timer controls", 14, SECONDARY, () -> openPocket(ClockActivity.class));
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
        heading("notifications", "home","settings",()->startActivity(new Intent(this,NotificationSetupActivity.class)),false);
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
        String state = HomeChoice.active(this) ? "active" : "choose pocket";
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
        torchValue.setText(torchOn ? "on" : "off");
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
