package org.textphone.launcher;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.graphics.Rect;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.text.Editable;
import android.text.InputFilter;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.ViewGroup;
import android.view.ViewTreeObserver;
import android.view.WindowInsets;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.ArrayAdapter;
import android.widget.AdapterView;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;

import java.lang.ref.WeakReference;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.text.NumberFormat;
import java.text.DateFormat;
import java.util.Date;
import java.util.List;
import java.util.Set;
import java.util.function.BooleanSupplier;

import io.noties.markwon.AbstractMarkwonPlugin;
import io.noties.markwon.Markwon;
import io.noties.markwon.MarkwonSpansFactory;
import io.noties.markwon.core.MarkwonTheme;
import org.commonmark.node.Heading;
import org.commonmark.node.StrongEmphasis;

/** An activity-local drawer; conversation and requests belong to the application repository. */
final class ClaudeSidebar extends FrameLayout {
    private static final String OPEN_STATE = "pocket_claude_sidebar_open";
    private static final long MOTION_MS = 240, CLOSE_MS = 180, RENDER_MS = 60;
    private static final android.view.animation.Interpolator ENTER = new android.view.animation.PathInterpolator(.05f, .7f, .1f, 1),
            EXIT = new android.view.animation.PathInterpolator(.3f, 0, .8f, .15f);
    private final Activity activity;
    private final View pageHost, dimmer;
    private final Runnable navigationChanged;
    private final BooleanSupplier swipeAllowed;
    private final ClaudeChatRepository repository;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final LinearLayout panel, log, errorRow, loadingRow, empty, contextRow;
    private final ScrollView scroll;
    private final EditText composer;
    private final Button back, settings, setup, send, retry, chats, newChat, openReply, modelPicker, toolsPicker, webPicker;
    private String shownContext="";
    private final TextView error, cacheStatus, loadingLabel, accessStatus, emptyText, conversationTitle;
    private final PixelLoadingView loading, emptyAvatar;
    private final LinearLayout chatHeader;
    private WrapRow chatActions;
    private boolean opened, observing, destroyed, applyingDraft, renderQueued, swipeCandidate, capturedSwipe;
    private float startX, startY;
    private long lastSubmitAt;
    private String displayedChat = "";
    private int originalAccessibility, insetLeft, insetTop, insetRight, insetBottom, keyboardBottom, themedAccent;
    private boolean keyboardVisible;
    private final LinkedHashMap<String, TurnView> rows = new LinkedHashMap<>();
    private final ClaudeChatRepository.Observer observer = this::scheduleRender;
    private final Runnable renderTask = () -> { renderQueued = false; if (!destroyed && opened) render(); };
    private final ViewTreeObserver.OnGlobalLayoutListener legacyKeyboard = this::updateLegacyKeyboard;
    private final int touchSlop;
    private Markwon markdown;
    private AlertDialog dialog;
    private WeakReference<View> previousFocus = new WeakReference<>(null);

    ClaudeSidebar(Activity activity, View pageHost, Runnable navigationChanged, BooleanSupplier swipeAllowed) {
        super(activity);
        this.activity = activity;
        this.pageHost = pageHost;
        this.navigationChanged = navigationChanged;
        this.swipeAllowed = swipeAllowed;
        originalAccessibility = pageHost.getImportantForAccessibility();
        repository = ClaudeChatRepository.get(activity.getApplicationContext());
        touchSlop = ViewConfiguration.get(activity).getScaledTouchSlop();
        setTag("claude_sidebar_host");
        addView(pageHost, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));

        dimmer = new View(activity);
        dimmer.setBackgroundColor(0xB3000000);
        dimmer.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        dimmer.setOnClickListener(view -> close());
        dimmer.setVisibility(View.GONE);
        addView(dimmer, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));

        panel = new LinearLayout(activity);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setBackgroundColor(PocketDesign.BLACK);
        panel.setClickable(true);
        panel.setTag("claude_sidebar");
        panel.setVisibility(View.GONE);
        LayoutParams panelSize = new LayoutParams(dp(520), LayoutParams.MATCH_PARENT, Gravity.RIGHT);
        addView(panel, panelSize);

        // Mirror the browser's mobile chat: navigation, title/actions, thread, context and composer.
        LinearLayout navigation=horizontal();navigation.setPadding(dp(16),0,dp(16),0);
        back=control("back",this::close);PocketDesign.headerControl(back,PocketDesign.MUTED);
        navigation.addView(back,new LinearLayout.LayoutParams(dp(64),dp(48)));
        chats=control("chats",this::showChats);chats.setTag("pip_chats");PocketDesign.headerControl(chats,PocketDesign.accent(activity));
        navigation.addView(chats,new LinearLayout.LayoutParams(0,dp(48),1));
        newChat=control("+ new",()->{repository.newChat();render();});newChat.setTag("pip_new_chat");PocketDesign.headerControl(newChat,PocketDesign.accent(activity));
        navigation.addView(newChat,new LinearLayout.LayoutParams(dp(64),dp(48)));
        panel.addView(navigation);
        LinearLayout header = horizontal(); chatHeader = header;
        header.setGravity(Gravity.TOP);
        header.setPadding(dp(PocketDesign.INSET), dp(4), dp(PocketDesign.INSET), dp(4));
        LinearLayout identityColumn=new LinearLayout(activity);identityColumn.setOrientation(LinearLayout.VERTICAL);
        TextView title = label(ClaudeChatRepository.NAME, 34, PocketDesign.WHITE);
        title.setTag("pip_title");
        title.setTypeface(PocketFonts.pixel(activity));identityColumn.addView(title);
        conversationTitle=label("new chat",12,PocketDesign.MUTED);conversationTitle.setTag("pip_conversation_title");conversationTitle.setMaxLines(2);conversationTitle.setEllipsize(android.text.TextUtils.TruncateAt.END);identityColumn.addView(conversationTitle);
        header.addView(identityColumn,new LinearLayout.LayoutParams(0,-2,1));
        WrapRow chatCommands=new WrapRow(activity);chatCommands.setPadding(dp(PocketDesign.INSET),0,dp(PocketDesign.INSET),0);chatActions=chatCommands;
        Button rename=control("rename",()->renameChat(new ChatStore.Summary(repository.currentId(),repository.snapshot().title,System.currentTimeMillis(),0)));
        Button remove=control("delete",()->showDialog(new AlertDialog.Builder(activity).setTitle("Delete chat?").setNegativeButton("cancel",null).setPositiveButton("delete",(d,w)->{repository.delete(repository.currentId());render();}).create()));
        settings = control("API settings", this::showSettings);
        settings.setContentDescription("Chat settings");
        for(Button action:new Button[]{rename,remove,settings}){PocketDesign.command(action,false);action.setTextSize(PocketDesign.typeSize(activity, PocketDesign.META));chatCommands.addView(action,PocketDesign.commandCell(activity,action==rename));}
        panel.addView(header, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        panel.addView(chatCommands, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));

        scroll = new ScrollView(activity);
        scroll.setTag("claude_chat_scroll");
        scroll.setFillViewport(true);
        scroll.setClipToPadding(false);
        scroll.setVerticalScrollBarEnabled(false);
        LinearLayout page = new LinearLayout(activity);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setPadding(dp(PocketDesign.INSET), dp(4), dp(PocketDesign.INSET), dp(12));
        empty = new LinearLayout(activity);
        empty.setOrientation(LinearLayout.VERTICAL);
        empty.setTag("claude_chat_empty");
        empty.setGravity(Gravity.CENTER_VERTICAL);empty.setMinimumHeight(dp(260));
        emptyAvatar=new PixelLoadingView(activity);emptyAvatar.setRunning(true);empty.addView(emptyAvatar,new LinearLayout.LayoutParams(dp(96),dp(96)));
        TextView greeting = label("new chat", 40, PocketDesign.WHITE);
        greeting.setTypeface(PocketFonts.pixel(activity));
        greeting.setPadding(0, dp(32), 0, dp(12));
        empty.addView(greeting, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        emptyText = label("", 14, PocketDesign.MUTED);
        emptyText.setPadding(0, dp(8), 0, dp(8));
        empty.addView(emptyText, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        setup = control("add api key", this::showKey);
        setup.setTag("claude_add_api_key");
        PocketDesign.command(setup, true);
        empty.addView(setup, PocketDesign.commandCell(activity, true));
        page.addView(empty, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        log = new LinearLayout(activity);
        log.setOrientation(LinearLayout.VERTICAL);
        page.addView(log, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        scroll.addView(page, new ScrollView.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        panel.addView(scroll, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, 0, 1));

        loadingRow = horizontal();
        loadingRow.setGravity(Gravity.CENTER_VERTICAL);
        loadingRow.setPadding(dp(PocketDesign.INSET), 0, dp(PocketDesign.INSET), 0);
        loading = new PixelLoadingView(activity);
        loading.setTag("pip_loading");
        loadingRow.addView(loading, new LinearLayout.LayoutParams(dp(48), dp(48)));
        loadingLabel = label("thinking", 14, PocketDesign.MUTED);
        loadingLabel.setPadding(dp(4), 0, 0, 0);
        loadingLabel.setMaxLines(2);
        loadingLabel.setEllipsize(android.text.TextUtils.TruncateAt.END);
        loadingLabel.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        loadingRow.addView(loadingLabel, new LinearLayout.LayoutParams(0, LayoutParams.WRAP_CONTENT, 1));
        openReply = control("open", () -> { repository.openReplyingChat(); render(); });
        openReply.setTag("pip_open_reply");
        PocketDesign.command(openReply, true);
        loadingRow.addView(openReply, new LinearLayout.LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT));
        loadingRow.setVisibility(View.GONE);
        panel.addView(loadingRow, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));

        errorRow = horizontal();
        errorRow.setGravity(Gravity.CENTER_VERTICAL);
        errorRow.setPadding(dp(PocketDesign.INSET), dp(4), dp(PocketDesign.INSET), dp(4));
        error = label("", 14, PocketDesign.WARNING);
        error.setMaxLines(2);
        error.setEllipsize(android.text.TextUtils.TruncateAt.END);
        error.setMinHeight(dp(48));
        error.setFocusable(true);
        error.setOnClickListener(view -> showDialog(new AlertDialog.Builder(activity).setTitle("Response error")
                .setMessage(error.getText()).setPositiveButton("close", null).create()));
        error.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        errorRow.addView(error, new LinearLayout.LayoutParams(0, LayoutParams.WRAP_CONTENT, 1));
        retry = control("retry", this::retry);
        PocketDesign.command(retry, true);
        errorRow.addView(retry, new LinearLayout.LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT));
        errorRow.setVisibility(View.GONE);
        panel.addView(errorRow, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));

        // One quiet status line: what chat may read, and whether the last reply reused cached input.
        LinearLayout statusRow = horizontal();
        statusRow.setGravity(Gravity.CENTER_VERTICAL);
        statusRow.setPadding(dp(PocketDesign.INSET), 0, dp(PocketDesign.INSET), 0);
        accessStatus = label("", 12, PocketDesign.MUTED);
        accessStatus.setTag("claude_pocket_access");
        accessStatus.setMinHeight(dp(PocketDesign.HEADER));
        accessStatus.setGravity(Gravity.CENTER_VERTICAL);
        accessStatus.setFocusable(true);
        accessStatus.setSingleLine(true);
        accessStatus.setEllipsize(android.text.TextUtils.TruncateAt.END);
        PocketDesign.quiet(accessStatus, PocketDesign.MUTED);
        accessStatus.setOnClickListener(view -> { if (!destroyed) showPocketAccess(); });
        statusRow.addView(accessStatus, new LinearLayout.LayoutParams(0, LayoutParams.WRAP_CONTENT, 1));
        cacheStatus = label("", 12, PocketDesign.MUTED);
        cacheStatus.setGravity(Gravity.END | Gravity.CENTER_VERTICAL);
        cacheStatus.setPadding(dp(8), 0, 0, 0);
        cacheStatus.setVisibility(View.GONE);
        statusRow.addView(cacheStatus, new LinearLayout.LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT));
        statusRow.setVisibility(View.GONE);
        panel.addView(statusRow, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        // Draft attachments belong to the scrollable thread so long context titles cannot push the composer below the keyboard.
        contextRow=new LinearLayout(activity);contextRow.setOrientation(LinearLayout.VERTICAL);contextRow.setPadding(0,dp(8),0,0);contextRow.setTag("pip_context");page.addView(contextRow);
        LinearLayout capabilities = horizontal(); capabilities.setPadding(dp(16), 0, dp(16), 0);
        capabilities.setBackground(new android.graphics.drawable.Drawable() {
            final android.graphics.Paint line = new android.graphics.Paint();
            @Override public void draw(android.graphics.Canvas canvas) {
                android.graphics.Rect bounds = getBounds(); line.setColor(PocketDesign.LINE); line.setStrokeWidth(dp(1));
                canvas.drawLine(dp(16), bounds.top, bounds.right - dp(16), bounds.top, line);
                line.setColor(PocketDesign.LINE); line.setAlpha(255);
                canvas.drawLine(dp(16), bounds.top, dp(20), bounds.top, line); canvas.drawLine(dp(16), bounds.top, dp(16), bounds.top + dp(4), line);
                canvas.drawLine(bounds.right - dp(20), bounds.top, bounds.right - dp(16), bounds.top, line); canvas.drawLine(bounds.right - dp(16), bounds.top, bounds.right - dp(16), bounds.top + dp(4), line);
            }
            @Override public void setAlpha(int alpha) { }
            @Override public void setColorFilter(android.graphics.ColorFilter filter) { }
            @Override public int getOpacity() { return android.graphics.PixelFormat.TRANSLUCENT; }
        });
        toolsPicker = control("tools [0]", this::showPocketAccess); toolsPicker.setTag("pip_tools");
        webPicker = control("web · off", this::toggleWebSearch); webPicker.setTag("pip_web_search");
        for (Button command : new Button[]{toolsPicker, webPicker}) {
            PocketDesign.command(command, false); command.setTextSize(PocketDesign.typeSize(activity, PocketDesign.META));
            capabilities.addView(command, PocketDesign.commandCell(activity, command == toolsPicker));
        }
        panel.addView(capabilities);

        LinearLayout inputRow = horizontal();
        inputRow.setGravity(Gravity.BOTTOM);
        inputRow.setPadding(dp(PocketDesign.INSET), 0, dp(PocketDesign.INSET - 8), dp(4));
        composer = new EditText(activity);
        composer.setTag("claude_chat_composer");
        PocketDesign.input(composer);
        composer.setTextSize(PocketDesign.typeSize(activity, PocketDesign.BODY));
        composer.setGravity(Gravity.TOP | Gravity.START);
        composer.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        composer.setImeOptions(EditorInfo.IME_ACTION_SEND | EditorInfo.IME_FLAG_NO_EXTRACT_UI);
        composer.setMinLines(2);
        composer.setMaxLines(5);
        composer.setFilters(new InputFilter[]{new InputFilter.LengthFilter(ClaudeChatRepository.MAX_INPUT_CHARS)});
        composer.setHint("think it through…");
        composer.setContentDescription("Chat message");
        composer.setText(repository.draft());
        composer.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence value, int start, int count, int after) { }
            @Override public void onTextChanged(CharSequence value, int start, int before, int count) {
                if (!applyingDraft && !destroyed) repository.draft(value.toString());
                updateSend(repository.snapshot().running);
            }
            @Override public void afterTextChanged(Editable value) { }
        });
        composer.setOnEditorActionListener((view, action, event) -> {
            if (action == EditorInfo.IME_ACTION_SEND) {
                if (!repository.snapshot().running) submit();
                return true;
            }
            return false;
        });
        composer.setOnKeyListener((view, key, event) -> {
            if (key == KeyEvent.KEYCODE_ENTER && event.isCtrlPressed()) {
                if (event.getAction() == KeyEvent.ACTION_UP && !repository.snapshot().running) submit();
                return true;
            }
            return false;
        });
        inputRow.addView(composer, new LinearLayout.LayoutParams(0, LayoutParams.WRAP_CONTENT, 1));
        send = control("send", this::submit);
        send.setTag("claude_chat_send");
        PocketDesign.softKey(send, 1, 2, true);
        send.setMinWidth(dp(64));
        panel.addView(inputRow, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        LinearLayout composerActions=horizontal();composerActions.setPadding(dp(16),0,dp(16),dp(8));
        Button attach=control("+ context",this::attachContext);attach.setTag("pip_attach_context");PocketDesign.command(attach,false);attach.setTextSize(PocketDesign.typeSize(activity, PocketDesign.META));composerActions.addView(attach,PocketDesign.commandCell(activity,true));
        modelPicker=control(ChatProvider.get(activity).model,this::showProvider);PocketDesign.command(modelPicker,false);modelPicker.setTextSize(PocketDesign.typeSize(activity, PocketDesign.META));modelPicker.setMaxLines(1);modelPicker.setEllipsize(android.text.TextUtils.TruncateAt.MIDDLE);modelPicker.setGravity(Gravity.CENTER_VERTICAL|Gravity.END);composerActions.addView(modelPicker,new LinearLayout.LayoutParams(0,dp(48),1));
        composerActions.addView(send,new LinearLayout.LayoutParams(dp(64),dp(48)));panel.addView(composerActions);

        // Read the incoming insets here, before a page consumes them during child dispatch.
        setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets safe = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                insetLeft = safe.left; insetTop = safe.top; insetRight = safe.right; insetBottom = safe.bottom;
                keyboardVisible = insets.isVisible(WindowInsets.Type.ime());
            } else {
                insetLeft = insets.getSystemWindowInsetLeft(); insetTop = insets.getSystemWindowInsetTop();
                insetRight = insets.getSystemWindowInsetRight(); insetBottom = insets.getSystemWindowInsetBottom();
            }
            applyPanelPadding();
            return insets;
        });
        if (Build.VERSION.SDK_INT < 30) getViewTreeObserver().addOnGlobalLayoutListener(legacyKeyboard);
        refreshTheme();
        updateSend(repository.snapshot().running);
    }

    boolean isOpen() { return opened; }

    void open() {
        if (destroyed || opened) return;
        opened = true;
        if (pageHost.getImportantForAccessibility() != View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS)
            originalAccessibility = pageHost.getImportantForAccessibility();
        previousFocus = new WeakReference<>(activity.getCurrentFocus());
        pageHost.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
        stopAnimations();
        updatePanelSize();
        dimmer.setAlpha(0);
        dimmer.setVisibility(View.VISIBLE);
        panel.setTranslationX(panelWidth());
        panel.setVisibility(View.VISIBLE);
        render();
        long duration = PageMotion.enabled(activity) ? MOTION_MS : 0;
        panel.animate().translationX(0).setDuration(duration).setInterpolator(ENTER).withLayer().start();
        dimmer.animate().alpha(1).setDuration(duration).setInterpolator(ENTER).start();
        // Keys and screen readers start at Back; touch users see no selection box.
        back.requestFocus();
        back.post(() -> { if (opened && !destroyed) back.performAccessibilityAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_ACCESSIBILITY_FOCUS, null); });
        requestApplyInsets();
        navigationChanged.run();
    }

    void close() {
        if (destroyed || !opened) return;
        opened = false;
        loading.setPaused(true); emptyAvatar.setPaused(true);
        capturedSwipe = false;
        swipeCandidate = false;
        hideKeyboard();
        pageHost.setImportantForAccessibility(originalAccessibility);
        stopAnimations();
        long duration = PageMotion.enabled(activity) ? CLOSE_MS : 0;
        panel.animate().translationX(panelWidth()).setDuration(duration).setInterpolator(EXIT).withLayer().setListener(new AnimatorListenerAdapter() {
            @Override public void onAnimationEnd(Animator animation) {
                if (!opened && !destroyed) {
                    panel.setVisibility(View.GONE);
                    View focus = previousFocus.get();
                    if (focus != null && focus.isAttachedToWindow()) focus.requestFocus();
                }
            }
        }).start();
        dimmer.animate().alpha(0).setDuration(duration).setInterpolator(EXIT).setListener(new AnimatorListenerAdapter() {
            @Override public void onAnimationEnd(Animator animation) { if (!opened && !destroyed) dimmer.setVisibility(View.GONE); }
        }).start();
        navigationChanged.run();
    }

    void closeImmediately() {
        if (destroyed) return;
        opened = false;
        capturedSwipe = false;
        swipeCandidate = false;
        loading.setPaused(true); emptyAvatar.setPaused(true);
        stopAnimations();
        main.removeCallbacks(renderTask);
        renderQueued = false;
        View focus = activity.getCurrentFocus();
        InputMethodManager keyboard = (InputMethodManager) activity.getSystemService(Context.INPUT_METHOD_SERVICE);
        android.os.IBinder token = focus == null ? getWindowToken() : focus.getWindowToken();
        if (keyboard != null && token != null) keyboard.hideSoftInputFromWindow(token, 0);
        if (focus != null) focus.clearFocus();
        if (dialog != null) { dialog.dismiss(); dialog = null; }
        pageHost.setImportantForAccessibility(originalAccessibility);
        panel.setTranslationX(0);
        panel.setVisibility(View.GONE);
        dimmer.setAlpha(0);
        dimmer.setVisibility(View.GONE);
        previousFocus = new WeakReference<>(null);
        navigationChanged.run();
    }

    void resume() {
        if (destroyed) return;
        refreshTheme();
        loading.refresh(); emptyAvatar.refresh();
        if (!observing) { observing = true; repository.observe(observer); }
        if (opened) render();
    }

    void pause() {
        loading.setPaused(true); emptyAvatar.setPaused(true);
        if (observing) { repository.removeObserver(observer); observing = false; }
        main.removeCallbacks(renderTask);
        renderQueued = false;
    }

    void destroy() {
        if (destroyed) return;
        destroyed = true;
        pause();
        loading.destroy(); emptyAvatar.destroy();
        for (TurnView row : rows.values()) row.avatar.destroy();
        stopAnimations();
        if (dialog != null) { dialog.dismiss(); dialog = null; }
        if (getViewTreeObserver().isAlive()) getViewTreeObserver().removeOnGlobalLayoutListener(legacyKeyboard);
        pageHost.setImportantForAccessibility(originalAccessibility);
    }

    void save(Bundle state) { state.putBoolean(OPEN_STATE, opened); }

    void restore(Bundle state) {
        if (state != null && state.getBoolean(OPEN_STATE, false)) post(() -> { if (!destroyed) open(); });
    }

    @Override protected void onSizeChanged(int width, int height, int oldWidth, int oldHeight) {
        super.onSizeChanged(width, height, oldWidth, oldHeight);
        if (panel != null) { updatePanelSize(); applyPanelPadding(); }
    }

    @Override public boolean dispatchTouchEvent(MotionEvent event) {
        if (destroyed) return super.dispatchTouchEvent(event);
        int action = event.getActionMasked();
        if (action == MotionEvent.ACTION_DOWN) {
            capturedSwipe = false;
            startX = event.getX(); startY = event.getY();
            swipeCandidate = !opened && swipeAllowed.getAsBoolean() && event.getPointerCount() == 1
                    && startX >= Math.max(insetLeft, dp(24)) && startX < getWidth() - Math.max(insetRight, dp(24))
                    && startY >= insetTop && startY < getHeight() - Math.max(insetBottom, dp(24))
                    && !hitsEditor(pageHost, (int) event.getRawX(), (int) event.getRawY());
        } else if (action == MotionEvent.ACTION_POINTER_DOWN) {
            swipeCandidate = false;
        } else if (action == MotionEvent.ACTION_MOVE && swipeCandidate) {
            float dx = event.getX() - startX, dy = event.getY() - startY;
            if (!swipeAllowed.getAsBoolean() || (Math.abs(dy) > touchSlop && Math.abs(dy) >= Math.abs(dx))) swipeCandidate = false;
            else if (dx <= -Math.max(dp(24), touchSlop * 2) && -dx > Math.abs(dy) * 1.4f) {
                capturedSwipe = true;
                swipeCandidate = false;
                // ScrollView may already have disabled parent interception. Only reclaim a clear
                // horizontal swipe; the normal dispatch then cancels its original child target.
                super.requestDisallowInterceptTouchEvent(false);
            }
        }
        boolean handled = super.dispatchTouchEvent(event);
        if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) {
            capturedSwipe = false;
            swipeCandidate = false;
        }
        return handled;
    }

    @Override public boolean onInterceptTouchEvent(MotionEvent event) {
        if (!destroyed && capturedSwipe) { if (!opened) open(); return true; }
        return super.onInterceptTouchEvent(event);
    }

    @Override public boolean onTouchEvent(MotionEvent event) {
        if (capturedSwipe) { if (!opened) open(); return true; }
        // Keep the sequence when a swipe starts on blank Home space rather than a control.
        return swipeCandidate || super.onTouchEvent(event);
    }

    private void submit() {
        if (destroyed) return;
        ClaudeChatRepository.Snapshot snapshot = repository.snapshot();
        if (snapshot.running) {
            if (SystemClock.elapsedRealtime() - lastSubmitAt >= 350) repository.stop();
            return;
        }
        String value = composer.getText().toString();
        if (value.trim().isEmpty()) return;
        ChatProvider.Config provider = ChatProvider.get(activity);
        if (!ChatProvider.present(activity, provider) || ChatProvider.key(activity, provider) == null) { showKey(); return; }
        lastSubmitAt = SystemClock.elapsedRealtime();
        if (canRetry(snapshot) && snapshot.turns.size() >= 2
                && value.equals(snapshot.turns.get(snapshot.turns.size() - 2).text)) repository.retry();
        else repository.send(value);
        render();
    }

    private void retry() {
        if (destroyed) return;
        ChatProvider.Config provider = ChatProvider.get(activity);
        if (!ChatProvider.present(activity, provider) || ChatProvider.key(activity, provider) == null) { showKey(); return; }
        lastSubmitAt = SystemClock.elapsedRealtime();
        repository.retry();
        render();
    }

    private boolean canRetry(ClaudeChatRepository.Snapshot snapshot) {
        if (snapshot.running || snapshot.busyElsewhere || snapshot.turns.isEmpty()) return false;
        ClaudeChatRepository.Turn answer = snapshot.turns.get(snapshot.turns.size() - 1);
        return "assistant".equals(answer.role) && ("failed".equals(answer.state) || "stopped".equals(answer.state));
    }

    private void scheduleRender() {
        if (!destroyed && opened && !renderQueued) { renderQueued = true; main.postDelayed(renderTask, RENDER_MS); }
    }

    private void render() {
        if (destroyed) return;
        ClaudeChatRepository.Snapshot snapshot = repository.snapshot();
        boolean switched = !displayedChat.equals(snapshot.chatId);
        boolean follow = switched || log.getChildCount() == 0 || scroll.getChildAt(0).getHeight() - scroll.getScrollY() - scroll.getHeight() <= dp(96);
        displayedChat = snapshot.chatId;
        conversationTitle.setText(snapshot.title.isEmpty() ? "new chat" : snapshot.title);
        conversationTitle.setContentDescription("Current chat: " + conversationTitle.getText());
        ChatProvider.Config provider = ChatProvider.get(activity);
        boolean keyed = ChatProvider.present(activity, provider);
        setup.setVisibility(View.GONE);
        emptyText.setVisibility(View.GONE);
        chats.setText("chats ["+repository.chats().size()+"]");modelPicker.setText(provider.model);
        toolsPicker.setText("tools [" + PocketChatTools.definitions(activity).size() + "]");
        webPicker.setText("web · " + (provider.webSearch ? "on" : "off"));
        webPicker.setEnabled(true); webPicker.setTextColor(provider.webSearch ? PocketDesign.accent(activity) : PocketDesign.MUTED);
        String context=ChatContext.write(repository.context());if(!context.equals(shownContext)){shownContext=context;contextRow.removeAllViews();addContextRows(contextRow,repository.context(),true);}
        StringBuilder access = new StringBuilder();
        String[] categories = {PocketChatTools.NOTES, PocketChatTools.COROS};
        String[] names = {"notes", "COROS"};
        for (int category = 0; category < categories.length; category++) {
            if (!PocketChatTools.enabled(activity, categories[category])) continue;
            if (access.length() > 0) access.append(" · ");
            access.append(names[category]);
        }
        accessStatus.setText(access.length() == 0 ? "pocket access · off" : "reads " + access);
        accessStatus.setContentDescription(access.length() == 0 ? "Pocket access off. Change access." : "Chat may read " + access + ". Change access.");
        empty.setVisibility(snapshot.turns.isEmpty() ? View.VISIBLE : View.GONE);
        emptyAvatar.setPaused(!opened || !observing || !snapshot.turns.isEmpty());
        emptyText.setText(" ");
        loadingRow.setVisibility(snapshot.running || snapshot.busyElsewhere ? View.VISIBLE : View.GONE);
        String status = snapshot.status == null || snapshot.status.isEmpty() ? "requesting" : snapshot.status;
        String progress = snapshot.busyElsewhere ? "replying in another chat" : status;
        if (!loadingLabel.getText().toString().equals(progress)) loadingLabel.setText(progress);
        openReply.setVisibility(snapshot.busyElsewhere ? View.VISIBLE : View.GONE);
        loading.setPhase(status);
        loading.setRunning(snapshot.running || snapshot.busyElsewhere);
        loading.setPaused(!opened || !observing);
        Set<String> retained = new HashSet<>();
        int index = 0;
        for (ClaudeChatRepository.Turn turn : snapshot.turns) {
            retained.add(turn.id);
            TurnView row = rows.get(turn.id);
            if (row == null) { row = new TurnView(); rows.put(turn.id, row); }
            row.update(turn);
            if (log.indexOfChild(row.root) != index) {
                if (row.root.getParent() == log) log.removeView(row.root);
                log.addView(row.root, Math.min(index, log.getChildCount()), new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
            }
            index++;
        }
        for (String id : new HashSet<>(rows.keySet())) if (!retained.contains(id)) {
            TurnView removed = rows.remove(id);
            removed.avatar.destroy();
            log.removeView(removed.root);
        }
        String failure = snapshot.error == null ? "" : snapshot.error;
        error.setText(failure);
        error.setContentDescription(failure.isEmpty() ? null : failure + ". Open full error.");
        error.setVisibility(failure.isEmpty() ? View.GONE : View.VISIBLE);
        boolean retryAvailable = canRetry(snapshot);
        errorRow.setVisibility(failure.isEmpty() && !retryAvailable ? View.GONE : View.VISIBLE);
        retry.setVisibility(retryAvailable ? View.VISIBLE : View.GONE);
        boolean hit = !snapshot.running && snapshot.cacheReadTokens > 0;
        cacheStatus.setText(hit ? "input reused" : "");
        cacheStatus.setContentDescription(hit ? NumberFormat.getIntegerInstance().format(snapshot.cacheReadTokens) + " input tokens read from the prompt cache" : null);
        cacheStatus.setVisibility(hit ? View.VISIBLE : View.GONE);
        String draft = repository.draft();
        if (!composer.getText().toString().equals(draft)) {
            applyingDraft = true;
            composer.setText(draft);
            composer.setSelection(composer.length());
            applyingDraft = false;
        }
        updateSend(snapshot.running);
        if (follow) scroll.post(() -> { if (!destroyed && opened && displayedChat.equals(snapshot.chatId))
            scroll.scrollTo(0, Math.max(0, scroll.getChildAt(0).getHeight() - scroll.getHeight())); });
    }

    private void updateSend(boolean running) {
        if (send == null) return;
        send.setText(running ? "stop" : "send");
        send.setContentDescription(running ? "Stop response" : "Send message");
        send.setEnabled(running || (!repository.snapshot().busyElsewhere && !composer.getText().toString().trim().isEmpty()));
    }

    private void showChats() {
        if (destroyed) return;
        hideKeyboard();
        List<ChatStore.Summary> saved = repository.chats();
        LinearLayout content = new LinearLayout(activity);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(20), 0, dp(12), dp(12));
        Button create = control("+ new chat", () -> {
            if (dialog != null) dialog.dismiss();
            repository.newChat(); render();
        });
        create.setTag("pip_create_chat");
        PocketDesign.command(create, true);
        content.addView(create, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, dp(56)));
        if (saved.isEmpty()) content.addView(label("No chats yet.", 14, PocketDesign.MUTED));
        for (ChatStore.Summary summary : saved) {
            LinearLayout line = horizontal(); line.setGravity(Gravity.CENTER_VERTICAL);
            LinearLayout entry = new LinearLayout(activity); entry.setOrientation(LinearLayout.VERTICAL);
            entry.setPadding(0, dp(12), dp(8), dp(12)); entry.setMinimumHeight(dp(56));
            entry.setTag("pip_chat_" + summary.id); entry.setFocusable(true);
            PocketDesign.list(entry);
            TextView title = label(summary.title, 16, summary.id.equals(repository.currentId()) ? PocketDesign.accent(activity) : PocketDesign.WHITE);
            title.setMaxLines(2); title.setEllipsize(android.text.TextUtils.TruncateAt.END);
            entry.addView(title);
            String detail = summary.replies == 0 ? "draft" : summary.replies + (summary.replies == 1 ? " reply" : " replies");
            detail += " · " + DateFormat.getDateInstance(DateFormat.SHORT).format(new Date(summary.updated));
            entry.addView(label(detail, 12, PocketDesign.MUTED));
            entry.setContentDescription(summary.title + ", " + detail + (summary.id.equals(repository.currentId()) ? ", current chat" : ""));
            entry.setOnClickListener(view -> { if (dialog != null) dialog.dismiss(); repository.open(summary.id); render(); });
            entry.setOnLongClickListener(view -> { showChatActions(summary); return true; });
            line.addView(entry, new LinearLayout.LayoutParams(0, LayoutParams.WRAP_CONTENT, 1));
            Button more = control("···", () -> showChatActions(summary));
            more.setTag("pip_chat_more_" + summary.id);
            more.setContentDescription("Options for " + summary.title);
            PocketDesign.headerControl(more, PocketDesign.MUTED);
            line.addView(more, new LinearLayout.LayoutParams(dp(48), dp(56)));
            content.addView(line);
        }
        ScrollView list = new ScrollView(activity); list.addView(content);
        showDialog(new AlertDialog.Builder(activity).setTitle("chats").setView(list).setNegativeButton("close", null).create());
    }

    private void showChatActions(ChatStore.Summary summary) {
        showDialog(new AlertDialog.Builder(activity).setTitle(summary.title)
                .setItems(new String[]{"open", "rename", "delete"}, (choice, index) -> {
                    if (destroyed) return;
                    if (index == 0) { repository.open(summary.id); render(); }
                    else if (index == 1) renameChat(summary);
                    else showDialog(new AlertDialog.Builder(activity).setTitle("Delete this chat?")
                            .setMessage("This removes the conversation, draft and reasoning from this phone.")
                            .setNegativeButton("keep", null).setPositiveButton("delete", (confirmation, which) -> {
                                if (!destroyed) { repository.delete(summary.id); render(); }
                            }).create());
                }).setNegativeButton("close", null).create());
    }

    private void renameChat(ChatStore.Summary summary) {
        LinearLayout form = new LinearLayout(activity); form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(dp(20), dp(8), dp(20), dp(8));
        EditText title = settingsField(form, "chat name", summary.title, "A name for this chat", false);
        title.setTag("pip_chat_name"); title.setFilters(new InputFilter[]{new InputFilter.LengthFilter(80)});
        TextView validation = label("", 14, PocketDesign.WARNING); form.addView(validation);
        AlertDialog rename = new AlertDialog.Builder(activity).setTitle("rename chat").setView(form)
                .setNegativeButton("cancel", null).setPositiveButton("save", null).create();
        rename.setOnShowListener(ignored -> rename.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
            if (destroyed) return;
            try { repository.rename(summary.id, title.getText().toString()); rename.dismiss(); render(); }
            catch (IllegalArgumentException invalid) { validation.setText(invalid.getMessage()); }
        }));
        showDialog(rename);
    }

    private void showStorage() {
        ClaudeChatRepository.Snapshot snapshot = repository.snapshot();
        String details = "Chats, drafts and reasoning stay on this phone. Drive sync continues to handle Pocket's existing shared data; it doesn't upload chats.\n\n"
                + "Pip sees only this conversation's completed answers on the next message. Reasoning summaries and lookup remarks stay separate.\n\n"
                + "Your provider receives each message and any passages you allow pip to look up. Clearing app data or uninstalling removes saved chats.";
        if (snapshot.inputTokens > 0 || snapshot.outputTokens > 0)
            details += "\n\nLast reply: " + NumberFormat.getIntegerInstance().format(snapshot.inputTokens) + " input tokens · "
                    + NumberFormat.getIntegerInstance().format(snapshot.outputTokens) + " output tokens\nCache: "
                    + NumberFormat.getIntegerInstance().format(snapshot.cacheReadTokens) + " read · "
                    + NumberFormat.getIntegerInstance().format(snapshot.cacheWriteTokens) + " written";
        showDialog(new AlertDialog.Builder(activity).setTitle("storage & usage").setMessage(details).setPositiveButton("close", null).create());
    }

    private void showSettings() {
        if (destroyed) return;
        ChatProvider.Config provider = ChatProvider.get(activity);
        String keyLabel = ChatProvider.present(activity, provider) ? "API key · " + ChatProvider.hint(activity, provider) : "Add API key";
        boolean anthropic = "anthropic".equals(provider.provider);
        String[] options = anthropic ? new String[]{"Provider & model", keyLabel,
                "Reply limit · " + NumberFormat.getIntegerInstance().format(provider.maxTokens) + " tokens",
                "Prompt caching · " + (provider.promptCaching ? "on" : "off"), "Pocket access", "Storage & usage", "New chat"}
                : new String[]{"Provider & model", keyLabel,
                "Reply limit · " + NumberFormat.getIntegerInstance().format(provider.maxTokens) + " tokens", "Pocket access", "Storage & usage", "New chat"};
        showDialog(new AlertDialog.Builder(activity).setTitle("Chat settings")
                .setItems(options, (choice, index) -> {
                    if (destroyed) return;
                    if (index == 0) showProvider();
                    else if (index == 1) showKey();
                    else if (index == 2) showReplyLimit();
                    else if (anthropic && index == 3) showCaching();
                    else if (index == (anthropic ? 4 : 3)) showPocketAccess();
                    else if (index == (anthropic ? 5 : 4)) showStorage();
                    else confirmNewChat();
                }).setNegativeButton("Close", null).create());
    }

    private void showPocketAccess() {
        if (destroyed) return;
        ChatProvider.Config provider = ChatProvider.get(activity);
        String recipient = "anthropic".equals(provider.provider) ? "Anthropic" : android.net.Uri.parse(provider.baseUrl).getHost();
        if (recipient == null || recipient.isEmpty()) recipient = provider.name();
        LinearLayout fields = new LinearLayout(activity);
        fields.setOrientation(LinearLayout.VERTICAL);
        fields.setPadding(dp(20), dp(8), dp(20), dp(8));
        TextView description = label(recipient, 14, PocketDesign.MUTED);
        description.setPadding(0, 0, 0, dp(8));
        fields.addView(description, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        String[] categories = {"notes", "thoughts", "tasks", "gym", "coros"}, names = {"Notes", "Thoughts", "Tasks", "Gym", "Movement · COROS cache"};
        CheckBox[] choices = new CheckBox[categories.length];
        for (int index = 0; index < categories.length; index++) {
            CheckBox choice = new CheckBox(activity);
            PocketDesign.text(choice, 16, PocketDesign.WHITE);
            choice.setText(names[index]);
            choice.setMinHeight(dp(52));
            choice.setButtonTintList(PocketDesign.colors(activity, PocketDesign.accent(activity)));
            choice.setChecked(PocketChatTools.enabled(activity, categories[index]));
            choices[index] = choice;
            fields.addView(choice, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        }
        ScrollView form = new ScrollView(activity);
        form.addView(fields);
        showDialog(new AlertDialog.Builder(activity).setTitle("Pocket tools · read only")
                .setView(form).setNegativeButton("Cancel", null).setPositiveButton("Save", (dialog, which) -> {
                    if (destroyed) return;
                    repository.stopAll();
                    try {
                        for (int index = 0; index < categories.length; index++)
                            PocketChatTools.enabled(activity, categories[index], choices[index].isChecked());
                        render();
                    } catch (IllegalStateException failure) { showSettingsError(failure.getMessage()); }
                }).create());
    }

    private void toggleWebSearch() {
        ChatProvider.Config current = ChatProvider.get(activity);
        try {
            repository.stopAll();
            ChatProvider.save(activity, new ChatProvider.Config(current.provider, current.model, current.baseUrl,
                    current.maxTokens, current.promptCaching, !current.webSearch), ""); render();
        } catch (IllegalArgumentException | IllegalStateException failure) { showSettingsError(failure.getMessage()); }
    }

    private void showProvider() {
        if (destroyed) return;
        ChatProvider.Config current = ChatProvider.get(activity);
        LinearLayout fields = new LinearLayout(activity);
        fields.setOrientation(LinearLayout.VERTICAL);
        fields.setPadding(dp(20), dp(8), dp(20), dp(8));
        fields.addView(label("Provider", 12, PocketDesign.MUTED));
        Spinner picker = new Spinner(activity);
        ArrayAdapter<String> choices = new ArrayAdapter<>(activity, android.R.layout.simple_spinner_item,
                new String[]{"Anthropic", "OpenAI-compatible"});
        choices.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        picker.setAdapter(choices);
        picker.setMinimumHeight(dp(52));
        picker.setContentDescription("Chat provider");
        fields.addView(picker, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        EditText model = settingsField(fields, "Model", current.model, "Model ID", false);
        TextView urlLabel = label("API base URL", 12, PocketDesign.MUTED);
        urlLabel.setPadding(0, dp(16), 0, 0);
        fields.addView(urlLabel);
        EditText url = new EditText(activity);
        PocketDesign.input(url);
        url.setSingleLine(true);
        url.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        url.setHint("https://api.example.com/v1");
        url.setText(current.baseUrl);
        url.setContentDescription("HTTPS API base URL");
        fields.addView(url, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        EditText key = settingsField(fields, "API key", "", "Leave blank to keep this endpoint’s key", true);
        LinearLayout crawlBox = new LinearLayout(activity);
        crawlBox.setOrientation(LinearLayout.VERTICAL);
        EditText crawl = settingsField(crawlBox, "Firecrawl key · web search", "",
                ChatProvider.firecrawlPresent(activity) ? "Saved · leave blank to keep" : "Optional · fc-…", true);
        fields.addView(crawlBox);
        TextView validation = label("", 14, PocketDesign.WARNING);
        validation.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        fields.addView(validation);
        int initial = "anthropic".equals(current.provider) ? 0 : 1;
        int[] selected = {initial};
        picker.setSelection(initial);
        boolean initialCustom = initial == 1;
        urlLabel.setVisibility(initialCustom ? View.VISIBLE : View.GONE);
        url.setVisibility(initialCustom ? View.VISIBLE : View.GONE);
        crawlBox.setVisibility(initialCustom ? View.VISIBLE : View.GONE);
        picker.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                if (position != selected[0]) {
                    String kind = position == 0 ? "anthropic" : "compatible";
                    ChatProvider.Config candidate = current.provider.equals(kind) ? current : ChatProvider.defaults(kind);
                    model.setText(candidate.model);
                    url.setText(candidate.baseUrl);
                    key.setText("");
                    selected[0] = position;
                }
                boolean custom = position == 1;
                urlLabel.setVisibility(custom ? View.VISIBLE : View.GONE);
                url.setVisibility(custom ? View.VISIBLE : View.GONE);
                crawlBox.setVisibility(custom ? View.VISIBLE : View.GONE);
                key.setHint(custom ? "New endpoint needs its own key" : "sk-ant-… or leave blank to keep");
            }
            @Override public void onNothingSelected(AdapterView<?> parent) { }
        });
        ScrollView form = new ScrollView(activity);
        form.addView(fields);
        AlertDialog providerDialog = new AlertDialog.Builder(activity)
                .setTitle("Provider & model").setView(form).setNegativeButton("Cancel", null).setPositiveButton("Save", null).create();
        providerDialog.setOnShowListener(ignored -> providerDialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
            if (destroyed) return;
            String kind = picker.getSelectedItemPosition() == 0 ? "anthropic" : "compatible";
            String modelId = model.getText().toString().trim(), endpoint = url.getText().toString().trim();
            if (modelId.isEmpty()) { validation.setText("Enter a model ID."); return; }
            if ("compatible".equals(kind) && !endpoint.startsWith("https://")) { validation.setText("Use an HTTPS API base URL."); return; }
            try {
                ChatProvider.Config next = new ChatProvider.Config(kind, modelId,
                        "anthropic".equals(kind) ? ChatProvider.defaults(kind).baseUrl : endpoint,
                        current.maxTokens, "anthropic".equals(kind) && ("anthropic".equals(current.provider) ? current.promptCaching : true),
                        kind.equals(current.provider) && current.webSearch);
                next.validate();
                String replacement = key.getText().toString().trim();
                validateReplacementKey(next, replacement);
                if ("compatible".equals(kind) && replacement.isEmpty() && !ChatProvider.present(activity, next)) {
                    validation.setText("Add an API key for this endpoint.");
                    return;
                }
                Runnable apply = () -> {
                    if (destroyed) return;
                    try {
                        boolean changed = !ChatProvider.get(activity).identity.equals(next.identity);
                        if (changed || !replacement.isEmpty()) repository.stopAll();
                        if ("compatible".equals(kind)) ChatProvider.saveFirecrawlKey(activity, crawl.getText().toString());
                        ChatProvider.save(activity, next, replacement);
                        if (changed && !repository.acceptsProvider(next)) repository.newChat();
                        key.setText(""); crawl.setText("");
                        providerDialog.dismiss();
                        render();
                    } catch (IllegalArgumentException | IllegalStateException failure) {
                        validation.setText(failure.getMessage());
                        if (!providerDialog.isShowing()) showDialog(providerDialog);
                    }
                };
                if (!repository.acceptsProvider(next) && !repository.snapshot().turns.isEmpty()) {
                    AlertDialog confirm = new AlertDialog.Builder(activity)
                            .setTitle("Use " + next.name() + " for a new chat?").setMessage("This conversation stays in chats. New messages use the new provider settings.")
                            .setNegativeButton("Keep", (choice, which) -> showDialog(providerDialog))
                            .setPositiveButton("Start new chat", (choice, which) -> apply.run()).create();
                    confirm.setOnCancelListener(choice -> { if (!destroyed) showDialog(providerDialog); });
                    showDialog(confirm);
                } else apply.run();
            } catch (IllegalArgumentException | IllegalStateException failure) { validation.setText(failure.getMessage()); }
        }));
        showDialog(providerDialog);
    }

    private void showReplyLimit() {
        ChatProvider.Config current = ChatProvider.get(activity);
        int[] limits = {512, 1024, 2048, 4096};
        String[] names = {"512 tokens", "1,024 tokens", "2,048 tokens", "4,096 tokens"};
        int selected = -1;
        for (int index = 0; index < limits.length; index++) if (limits[index] == current.maxTokens) selected = index;
        showDialog(new AlertDialog.Builder(activity).setTitle("Reply limit")
                .setSingleChoiceItems(names, selected, (choice, index) -> {
                    if (destroyed) return;
                    try {
                        ChatProvider.save(activity, new ChatProvider.Config(current.provider, current.model, current.baseUrl,
                                limits[index], current.promptCaching, current.webSearch), "");
                        choice.dismiss();
                    } catch (IllegalArgumentException | IllegalStateException failure) { showSettingsError(failure.getMessage()); }
                }).setNegativeButton("Cancel", null).create());
    }

    private void showCaching() {
        ChatProvider.Config current = ChatProvider.get(activity);
        showDialog(new AlertDialog.Builder(activity).setTitle("Prompt caching")
                .setMessage("Reuses input from recent messages to reduce cost and waiting. Every reply is generated afresh; answers are never replayed. Cache writes cost extra; repeated reads cost less.")
                .setNegativeButton("Cancel", null).setPositiveButton(current.promptCaching ? "Turn off" : "Turn on", (choice, which) -> {
                    if (destroyed) return;
                    try {
                        ChatProvider.save(activity, new ChatProvider.Config(current.provider, current.model, current.baseUrl,
                                current.maxTokens, !current.promptCaching, current.webSearch), "");
                    } catch (IllegalArgumentException | IllegalStateException failure) { showSettingsError(failure.getMessage()); }
                }).create());
    }

    private EditText settingsField(LinearLayout fields, String name, String value, String hint, boolean secret) {
        TextView heading = label(name, 12, PocketDesign.MUTED);
        heading.setPadding(0, dp(16), 0, 0);
        fields.addView(heading);
        EditText field = new EditText(activity);
        PocketDesign.input(field);
        field.setSingleLine(true);
        field.setInputType(InputType.TYPE_CLASS_TEXT | (secret ? InputType.TYPE_TEXT_VARIATION_PASSWORD : InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS));
        field.setHint(hint);
        field.setText(value);
        field.setContentDescription(name);
        if (secret) field.setFilters(new InputFilter[]{new InputFilter.LengthFilter(512)});
        fields.addView(field, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        return field;
    }

    private void validateReplacementKey(ChatProvider.Config provider, String value) {
        if (value.isEmpty()) return;
        if ("anthropic".equals(provider.provider)) {
            if (!value.startsWith("sk-ant-") || value.length() < 30)
                throw new IllegalArgumentException("Enter an Anthropic API key beginning with sk-ant-.");
        } else if (!value.matches("[\\x21-\\x7E]{8,512}")) {
            throw new IllegalArgumentException("Enter a valid provider API key.");
        }
    }

    private void showSettingsError(String message) {
        showDialog(new AlertDialog.Builder(activity).setTitle("Chat settings")
                .setMessage(message == null ? "Could not save the settings." : message).setPositiveButton("Close", null).create());
    }

    private void confirmNewChat() {
        repository.newChat(); render();
    }

    private void showKey() {
        if (destroyed) return;
        ChatProvider.Config provider = ChatProvider.get(activity);
        LinearLayout fields = new LinearLayout(activity);
        fields.setOrientation(LinearLayout.VERTICAL);
        fields.setPadding(dp(20), dp(8), dp(20), dp(8));
        TextView billing = label("anthropic".equals(provider.provider)
                ? "Used for chat and Journal. API usage is billed separately."
                : "API usage is billed by your provider.", 14, PocketDesign.MUTED);
        fields.addView(billing, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        if (ChatProvider.present(activity, provider)) {
            TextView hint = label("Saved key " + ChatProvider.hint(activity, provider), 14, PocketDesign.MUTED);
            hint.setPadding(0, dp(12), 0, 0);
            fields.addView(hint, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        }
        EditText field = new EditText(activity);
        PocketDesign.input(field);
        field.setTag("claude_chat_api_key");
        field.setSingleLine(true);
        field.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        field.setFilters(new InputFilter[]{new InputFilter.LengthFilter(512)});
        field.setHint("anthropic".equals(provider.provider) ? "sk-ant-…" : "API key");
        fields.addView(field, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        TextView validation = label("", 14, PocketDesign.WARNING);
        validation.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        fields.addView(validation, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        AlertDialog.Builder builder = new AlertDialog.Builder(activity)
                .setTitle(provider.name() + " API key").setView(fields).setNegativeButton("Cancel", null).setPositiveButton("Save", null);
        if (ChatProvider.present(activity, provider)) builder.setNeutralButton("Remove key", (choice, which) -> {
            if (!destroyed) {
                try { repository.stopAll(); ChatProvider.clearKey(activity, provider); render(); }
                catch (IllegalStateException failure) { showSettingsError(failure.getMessage()); }
            }
        });
        AlertDialog keyDialog = builder.create();
        keyDialog.setOnShowListener(ignored -> keyDialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
            if (destroyed) return;
            try {
                String replacement = field.getText().toString().trim();
                if (replacement.isEmpty()) { validation.setText("Enter an API key."); return; }
                validateReplacementKey(provider, replacement);
                repository.stopAll();
                ChatProvider.save(activity, provider, replacement);
                field.setText("");
                keyDialog.dismiss();
                render();
            } catch (IllegalArgumentException | IllegalStateException failure) { validation.setText(failure.getMessage()); }
        }));
        showDialog(keyDialog);
    }

    private void showDialog(AlertDialog next) {
        if (destroyed) return;
        if (dialog != null && dialog.isShowing()) dialog.dismiss();
        dialog = next;
        next.setOnDismissListener(ignored -> { if (dialog == next) dialog = null; });
        next.show();
    }

    private void refreshTheme() {
        int accent = PocketDesign.accent(activity);
        PocketDesign.headerControl(back, PocketDesign.MUTED); PocketDesign.headerControl(settings, PocketDesign.MUTED);
        PocketDesign.headerControl(chats, accent); PocketDesign.headerControl(newChat, accent);
        settings.setTextSize(PocketDesign.typeSize(activity, PocketDesign.META));
        PocketDesign.command(setup, true); PocketDesign.command(retry, true); PocketDesign.softKey(send, 1, 2, true); send.setMinWidth(dp(64));
        PocketDesign.input(composer, android.graphics.Color.TRANSPARENT); composer.setTextSize(PocketDesign.typeSize(activity, PocketDesign.BODY)); composer.setGravity(Gravity.TOP | Gravity.START);
        composer.setShadowLayer(0, 0, 0, 0);
        glowControls(panel);
        if (markdown == null || accent != themedAccent) {
            themedAccent = accent;
            panel.setBackgroundColor(PocketDesign.INK);
            chatHeader.setBackground(new PixelBackdrop(activity, accent, 96, PixelBackdrop.SKY));
            markdown = Markwon.builder(activity).usePlugin(new AbstractMarkwonPlugin() {
                @Override public void configureTheme(MarkwonTheme.Builder theme) {
                    theme.headingBreakHeight(0).headingTextSizeMultipliers(new float[]{1.4f, 1.25f, 1.125f, 1f, 1f, 1f})
                            .linkColor(themedAccent).thematicBreakColor(PocketDesign.LINE)
                            .blockQuoteColor(PocketDesign.LINE).codeBackgroundColor(PocketDesign.PLANE).codeBlockBackgroundColor(PocketDesign.PLANE);
                }
                @Override public void configureSpansFactory(MarkwonSpansFactory.Builder spans) {
                    spans.appendFactory(Heading.class, (configuration, props) -> new PixelHeadingSpan());
                    spans.appendFactory(StrongEmphasis.class, (configuration, props) -> new MediumSpan());
                }
            }).build();
            for (TurnView row : rows.values()) { row.lastText = null; row.lastReasoning = null; }
        }
    }

    private final class MediumSpan extends android.text.style.MetricAffectingSpan {
        @Override public void updateDrawState(android.text.TextPaint paint) { paint.setTypeface(PocketFonts.medium(activity)); }
        @Override public void updateMeasureState(android.text.TextPaint paint) { updateDrawState(paint); }
    }

    private final class PixelHeadingSpan extends android.text.style.MetricAffectingSpan {
        @Override public void updateDrawState(android.text.TextPaint paint) { paint.setTypeface(PocketFonts.pixel(activity)); }
        @Override public void updateMeasureState(android.text.TextPaint paint) { updateDrawState(paint); }
    }

    /** Prompt lines, pixel headings and a separate, expandable reasoning summary. */
    private final class TurnView {
        final LinearLayout root = new LinearLayout(activity);
        final TextView name = label("pip", 24, PocketDesign.WHITE);
        final LinearLayout speaker = horizontal();
        final PixelLoadingView avatar = new PixelLoadingView(activity);
        final LinearLayout toolRows = new LinearLayout(activity);
        final Button activityToggle = control("activity", this::toggleActivity);
        final Button reasoningToggle = control("reasoning", this::toggleReasoning);
        final TextView reasoning = label("", 14, PocketDesign.MUTED);
        final TextView body = label("", 16, PocketDesign.WHITE);
        final TextView state = label("", 12, PocketDesign.MUTED);
        final LinearLayout sources = new LinearLayout(activity), actions = new LinearLayout(activity);
        final Button sourcesToggle = control("sources", this::toggleSources);
        boolean sourcesExpanded; String lastSourceActivity;
        final Button keepNote = control("keep note", () -> keepReply(0));
        final Button parkThought = control("park thought", () -> keepReply(1));
        final Button makeTask = control("make task", () -> keepReply(2));
        final Button copy = control("copy", () -> keepReply(3));
        String lastText, lastState, lastReasoning, lastContext, lastActivity; boolean lastAssistant, expanded, chosen, activityExpanded, activityChosen;
        long styledAt; int lookups;
        ClaudeChatRepository.Turn turn;
        TurnView() {
            root.setOrientation(LinearLayout.VERTICAL);
            name.setTypeface(PocketFonts.pixel(activity));
            name.setPadding(0, 0, 0, dp(6));
            speaker.setGravity(Gravity.CENTER_VERTICAL);
            speaker.addView(avatar, new LinearLayout.LayoutParams(dp(36), dp(36)));
            speaker.addView(name, new LinearLayout.LayoutParams(0, -2, 1));
            avatar.setPaused(true);
            PocketDesign.command(sourcesToggle, false);
            sourcesToggle.setTextSize(PocketDesign.typeSize(activity, PocketDesign.META));
            sourcesToggle.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
            PocketDesign.command(reasoningToggle, false);
            reasoningToggle.setTextSize(PocketDesign.typeSize(activity, PocketDesign.META));
            reasoning.setTextIsSelectable(true);
            reasoning.setLineSpacing(dp(3), 1f);
            reasoning.setPadding(dp(12), 0, 0, dp(12));
            body.setGravity(Gravity.TOP | Gravity.START);
            PocketDesign.reading(body);
            body.setTextIsSelectable(true);
            state.setPadding(0, dp(4), 0, 0);
            sources.setOrientation(LinearLayout.VERTICAL);
            actions.setOrientation(LinearLayout.VERTICAL);
            WrapRow replyActions = new WrapRow(activity);
            for (Button action : new Button[]{keepNote, parkThought, makeTask, copy}) {
                PocketDesign.command(action, false); action.setTextSize(PocketDesign.typeSize(activity, PocketDesign.META));
                replyActions.addView(action, PocketDesign.commandCell(activity, action == keepNote));
            }
            actions.addView(replyActions);
            root.addView(speaker, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
            toolRows.setOrientation(LinearLayout.VERTICAL);
            PocketDesign.command(activityToggle, false); activityToggle.setTextSize(PocketDesign.typeSize(activity, PocketDesign.META)); activityToggle.setMinHeight(dp(48)); activityToggle.setMaxLines(3);
            root.addView(activityToggle, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
            root.addView(toolRows, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
            root.addView(reasoningToggle, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
            root.addView(reasoning, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
            root.addView(body, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
            root.addView(sourcesToggle, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
            root.addView(sources, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
            root.addView(state, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
            root.addView(actions, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
            glowControls(root);
        }
        void update(ClaudeChatRepository.Turn turn) {
            this.turn = turn;
            boolean assistant = "assistant".equals(turn.role);
            speaker.setVisibility(View.VISIBLE);
            avatar.setVisibility(assistant ? View.VISIBLE : View.GONE);
            name.setText(assistant ? "pip" : "you");
            name.setTypeface(assistant ? PocketFonts.pixel(activity) : PocketFonts.medium(activity));
            name.setTextSize(PocketDesign.typeSize(activity, assistant ? 24 : PocketDesign.META));
            name.setTextColor(assistant ? PocketDesign.CREAM : PocketDesign.MUTED);
            if (!chosen) expanded = false;
            root.setTag("claude_turn_" + turn.id);
            root.setPadding(0, dp(24), 0, dp(16));
            if (!turn.text.equals(lastText) || !turn.state.equals(lastState) || assistant != lastAssistant) {
                long now = SystemClock.elapsedRealtime();
                long interval = Math.min(300, Math.max(100, turn.text.length() / 120));
                // Parse long streamed Markdown less often, so the character and scrolling keep their frames.
                if (assistant && "pending".equals(turn.state) && lastText != null && now - styledAt < interval) scheduleRender();
                else {
                    if (assistant && !turn.text.isEmpty()) markdown.setMarkdown(body, turn.text);
                    else body.setText(turn.text);
                    body.setTextColor(PocketDesign.CREAM);
                    body.setContentDescription(assistant ? null : "You: " + turn.text);
                    lastText = turn.text; lastState = turn.state; lastAssistant = assistant; styledAt = now;
                }
            }
            body.setVisibility(body.length() == 0 ? View.GONE : View.VISIBLE);
            updateSources();
            updateActivity();
            updateReasoning();
            String status = "stopped".equals(turn.state) ? "stopped" : "failed".equals(turn.state) && !turn.text.isEmpty() ? "incomplete" : "";
            state.setText(status);
            state.setVisibility(status.isEmpty() ? View.GONE : View.VISIBLE);
            keepNote.setTag("pip_keep_" + turn.id);
            parkThought.setTag("pip_park_" + turn.id);
            makeTask.setTag("pip_task_" + turn.id);
            copy.setTag("pip_copy_" + turn.id);
            actions.setVisibility(assistant && !turn.text.isEmpty() && !"pending".equals(turn.state) ? View.VISIBLE : View.GONE);
        }
        void toggleActivity() { activityChosen = true; activityExpanded = !activityExpanded; updateActivity(); }
        void updateActivity() {
            org.json.JSONArray events = ChatActivity.read(turn.activity);
            boolean visible = "assistant".equals(turn.role) && events.length() > 0;
            if (!activityChosen) activityExpanded = false;
            activityToggle.setVisibility(visible ? View.VISIBLE : View.GONE);
            activityToggle.setText(activitySummary(events) + (activityExpanded ? " −" : " +"));
            activityToggle.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
            activityToggle.setContentDescription((activityExpanded ? "Hide" : "Show") + " execution details: " + activitySummary(events));
            activityToggle.setTag("pip_activity_" + turn.id);
            toolRows.setVisibility(visible && activityExpanded ? View.VISIBLE : View.GONE);
            if (!turn.activity.equals(lastActivity)) {
                toolRows.removeAllViews();
                for (int i = 0; i < events.length(); i++) {
                    org.json.JSONObject event = events.optJSONObject(i); if (event == null) continue;
                    String status = event.optString("state"); long duration = event.optLong("ended") - event.optLong("started");
                    Button row = control(ChatActivity.mark(status) + " " + event.optString("title") + "\n" + status
                            + (duration > 0 ? " · " + durationLabel(duration) : "")
                            + (event.optString("summary").isEmpty() ? "" : "\n" + event.optString("summary"))
                            + sourceCountLabel(event), () -> showToolDetails(event));
                    PocketDesign.command(row, false); glowControl(row); row.setTextSize(PocketDesign.typeSize(activity, PocketDesign.META)); row.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
                    row.setTextColor("failed".equals(status) ? PocketDesign.WARNING : PocketDesign.MUTED); row.setMinHeight(dp(48));
                    row.setBackground(PocketDesign.separator(activity)); row.setPadding(dp(12), dp(8), 0, dp(8)); row.setMaxLines(5); toolRows.addView(row, new LinearLayout.LayoutParams(-1, -2));
                }
                lastActivity = turn.activity;
            }
        }
        void toggleSources() { sourcesExpanded = !sourcesExpanded; updateSources(); }
        void updateSources() {
            boolean assistant = "assistant".equals(turn.role);
            if (!turn.context.equals(lastContext) || !turn.activity.equals(lastSourceActivity)) {
                sources.removeAllViews();
                if (!assistant) addContextRows(sources, ChatContext.read(turn.context), false);
                else {
                    java.util.Set<String> seen = new java.util.LinkedHashSet<>();
                    org.json.JSONArray events = ChatActivity.read(turn.activity);
                    for (int i = 0; i < events.length(); i++) {
                        org.json.JSONObject event = events.optJSONObject(i); if (event == null) continue;
                        org.json.JSONArray links = event.optJSONArray("sources"); if (links == null) continue;
                        for (int n = 0; n < links.length(); n++) {
                            org.json.JSONObject link = links.optJSONObject(n); if (link == null || !seen.add(link.optString("href"))) continue;
                            Button source = control(link.optString("title"), () -> openToolSource(link.optString("href")));
                            PocketDesign.row(source, PocketDesign.MUTED); source.setTextSize(PocketDesign.typeSize(activity, PocketDesign.META));
                            source.setMaxLines(3); sources.addView(source, new LinearLayout.LayoutParams(-1, -2));
                        }
                    }
                }
                lastContext = turn.context; lastSourceActivity = turn.activity;
            }
            int count = sources.getChildCount();
            sourcesToggle.setTag("pip_sources_" + turn.id);
            sourcesToggle.setText(count + (count == 1 ? " source" : " sources") + (sourcesExpanded ? " −" : " +"));
            sourcesToggle.setContentDescription((sourcesExpanded ? "Hide " : "Show ") + count + " sources");
            sourcesToggle.setVisibility(assistant && count > 0 ? View.VISIBLE : View.GONE);
            sources.setVisibility(count > 0 && (!assistant || sourcesExpanded) ? View.VISIBLE : View.GONE);
        }
        void keepReply(int which) {
            if (destroyed) return;
            int start = body.getSelectionStart(), end = body.getSelectionEnd();
            String text = start >= 0 && end > start ? body.getText().subSequence(start, end).toString() : turn.text;
            if (which == 2) activity.startActivity(TaskCaptureActivity.intent(activity, TaskSource.shared("pip", text)));
            else if (which == 1) keepThought(text);
            else if (which == 3) {
                android.content.ClipboardManager clipboard = (android.content.ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE);
                clipboard.setPrimaryClip(android.content.ClipData.newPlainText("pip", text));
                android.widget.Toast.makeText(activity, "Copied.", android.widget.Toast.LENGTH_SHORT).show();
            } else {
                try {
                    PlannerStore planner = new PlannerStore(activity.getSharedPreferences("pocket_planner", 0));
                    String noteText = "# " + repository.snapshot().title + "\n\n" + text;
                    long note = planner.save(0, "note", noteText);
                    NoteThoughts.parkNew(activity, planner, note, "", noteText);
                    CloudSync.changed(activity);
                    activity.startActivity(new Intent(activity, OrganizerActivity.class).putExtra("pocket_note", note));
                } catch (IllegalArgumentException | IllegalStateException failure) { keepFailure(failure.getMessage()); }
            }
        }
        void toggleReasoning() { chosen = true; expanded = !expanded; updateReasoning(); }
        void updateReasoning() {
            String display = "[]".equals(turn.activity) ? turn.reasoning : turn.reasoning.replaceAll("(?m)^› .*\\n?", "").trim();
            boolean shown = "assistant".equals(turn.role) && !display.isEmpty();
            reasoningToggle.setTag("pip_reasoning_" + turn.id);
            reasoningToggle.setVisibility(shown ? View.VISIBLE : View.GONE);
            if (!turn.reasoning.equals(lastReasoning)) lookups = turn.lookups();
            reasoningToggle.setText((expanded ? "− " : "+ ") + "reasoning summary" + (!"[]".equals(turn.activity) || lookups == 0 ? "" : " · " + lookups + (lookups == 1 ? " lookup" : " lookups")));
            reasoningToggle.setContentDescription((expanded ? "Hide" : "Show") + " reasoning summary and lookup steps");
            reasoning.setTag("pip_reasoning_text_" + turn.id);
            reasoning.setVisibility(shown && expanded ? View.VISIBLE : View.GONE);
            if (!turn.reasoning.equals(lastReasoning)) {
                android.text.SpannableString text = new android.text.SpannableString(display.trim());
                int start = 0;
                for (String line : text.toString().split("\n", -1)) {
                    if (line.startsWith(ClaudeChatRepository.STEP)) text.setSpan(new android.text.style.ForegroundColorSpan(themedAccent),
                            start, start + line.length(), android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                    start += line.length() + 1;
                }
                reasoning.setText(text); lastReasoning = turn.reasoning;
            }
        }
    }

    private String activitySummary(org.json.JSONArray events) {
        int reads = 0, searches = 0, pages = 0; boolean failed = false, stopped = false;
        for (int i = 0; i < events.length(); i++) {
            org.json.JSONObject event = events.optJSONObject(i); if (event == null) continue;
            String state = event.optString("state"), name = event.optString("name");
            if ("running".equals(state) || "queued".equals(state)) return event.optString("title") + " · " + state;
            if ("web_search".equals(name) || "search_web".equals(name)) searches++;
            else if ("read_web_page".equals(name)) pages++;
            else reads++;
            failed |= "failed".equals(state); stopped |= "stopped".equals(state);
        }
        java.util.List<String> labels = new java.util.ArrayList<>();
        if (reads > 0) labels.add(reads + (reads == 1 ? " Pocket read" : " Pocket reads"));
        if (searches > 0) labels.add(searches + (searches == 1 ? " web search" : " web searches"));
        if (pages > 0) labels.add(pages + (pages == 1 ? " page read" : " page reads"));
        return String.join(" · ", labels) + (failed ? " · failed" : stopped ? " · stopped" : "");
    }
    private String durationLabel(long elapsed) {
        return elapsed < 1000 ? elapsed + "ms" : String.format(java.util.Locale.ROOT, "%.1fs", elapsed / 1000.0);
    }
    private String sourceCountLabel(org.json.JSONObject event) {
        org.json.JSONArray links = event.optJSONArray("sources"); int count = links == null ? 0 : links.length();
        return count == 0 ? "" : " · " + count + (count == 1 ? " source" : " sources");
    }
    private String toolInput(org.json.JSONObject event) {
        try {
            org.json.JSONObject input = new org.json.JSONObject(event.optString("input", "{}"));
            String query = input.optString("query"), url = input.optString("url");
            if (!query.isEmpty()) return "query · " + query;
            if (!url.isEmpty()) return url;
            if (input.has("days")) return "range · " + input.optInt("days") + " days";
            if (input.has("id")) return "item · " + input.optString("id");
        } catch (org.json.JSONException ignored) { }
        return "";
    }

    private void showToolDetails(org.json.JSONObject event) {
        LinearLayout fields = new LinearLayout(activity); fields.setOrientation(LinearLayout.VERTICAL); fields.setPadding(dp(20), dp(8), dp(20), dp(8));
        TextView summary = label(event.optString("summary", event.optString("state")), 14, PocketDesign.WHITE);
        summary.setTextIsSelectable(true); fields.addView(summary);
        long elapsed = event.optLong("ended") - event.optLong("started");
        TextView execution = label(event.optString("state") + (elapsed > 0 ? " · " + durationLabel(elapsed) : ""), PocketDesign.META, PocketDesign.MUTED);
        fields.addView(execution);
        String input = toolInput(event);
        if (!input.isEmpty()) { TextView query = label(input, PocketDesign.BODY, PocketDesign.CREAM); query.setTextIsSelectable(true); fields.addView(query); }
        org.json.JSONArray links = event.optJSONArray("sources");
        if (links != null) for (int i = 0; i < links.length(); i++) {
            org.json.JSONObject link = links.optJSONObject(i); if (link == null) continue;
            Button source = control(link.optString("title"), () -> openToolSource(link.optString("href")));
            PocketDesign.command(source, false); glowControl(source); source.setTextSize(PocketDesign.typeSize(activity, PocketDesign.META)); source.setMinHeight(dp(48));
            source.setMaxLines(3); fields.addView(source, new LinearLayout.LayoutParams(-1, -2));
        }
        TextView parameters = label(event.optString("name") + "\n" + event.optString("input"), 12, PocketDesign.MUTED);
        parameters.setTextIsSelectable(true); parameters.setVisibility(View.GONE); parameters.setPadding(0, dp(8), 0, dp(8));
        Button expand = control("execution parameters", () -> parameters.setVisibility(parameters.getVisibility() == View.GONE ? View.VISIBLE : View.GONE));
        PocketDesign.command(expand, false); glowControl(expand); expand.setTextSize(PocketDesign.typeSize(activity, PocketDesign.META)); fields.addView(expand); fields.addView(parameters);
        ScrollView scroll = new ScrollView(activity); scroll.addView(fields);
        showDialog(new AlertDialog.Builder(activity).setTitle(event.optString("title")).setView(scroll).setPositiveButton("close", null).create());
    }

    private void openToolSource(String href) {
        if (ChatActivity.source(href, "") == null) return;
        try {
            Intent intent;
            if (href.startsWith("/movement")) intent = new Intent(activity, MovementActivity.class);
            else if (href.startsWith("/gym/")) intent = new Intent(activity, GymActivity.class).putExtra("pocket_workout", href.substring(5));
            else if (href.startsWith("/notes/") || href.startsWith("/tasks/") || href.startsWith("/thoughts/")) {
                String[] parts = href.split("/"); if (parts.length != 3) return;
                String kind = "notes".equals(parts[1]) ? "note" : "tasks".equals(parts[1]) ? "task" : "thought";
                intent = new Intent(activity, OrganizerActivity.class).putExtra("pocket_" + kind, Long.parseLong(parts[2]));
            } else intent = new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(href));
            activity.startActivity(intent);
        } catch (android.content.ActivityNotFoundException | IllegalArgumentException unavailable) { keepFailure("This source could not be opened."); }
    }

    private void keepFailure(String text) {
        showDialog(new AlertDialog.Builder(activity).setTitle(text).setPositiveButton("close", null).create());
    }

    private void keepThought(String text) {
        EditText field = new EditText(activity); PocketDesign.input(field); field.setMinLines(2);
        field.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
        field.setFilters(new InputFilter[]{new InputFilter.LengthFilter(500)}); field.setText(text.substring(0, Math.min(500, text.length())));
        field.setTag("pip_keep_thought_text");
        AlertDialog thought = new AlertDialog.Builder(activity).setTitle("thought").setView(field)
                .setNegativeButton("cancel", null).setPositiveButton("keep", null).create();
        thought.setOnShowListener(ignored -> thought.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
            try {
                ParkingStore.Item saved = ParkingStore.park(activity, field.getText().toString(), 0);
                ReceiptTape.log(activity, ReceiptTape.PARK, saved.text); CloudSync.changed(activity); thought.dismiss();
                activity.startActivity(new Intent(activity, OrganizerActivity.class).putExtra("pocket_thought", saved.id));
            } catch (IllegalArgumentException | IllegalStateException failure) { field.setError(failure.getMessage()); }
        }));
        showDialog(thought);
    }

    private void attachContext() {
        showDialog(new AlertDialog.Builder(activity).setTitle("context").setItems(new String[]{"thought", "task", "note"},(choice,which)->{
            java.util.List<ChatContext> sources=new java.util.ArrayList<>();
            if(which==0)for(ParkingStore.Item thought:ParkingStore.open(activity))sources.add(new ChatContext("thought",thought.id,thought.text,thought.text));
            else {PlannerStore planner=new PlannerStore(activity.getSharedPreferences("pocket_planner",0));String kind=which==1?"task":"note";
                for(PlannerStore.Entry item:planner.entries())if(kind.equals(item.kind)){
                    String title="note".equals(kind)?ReadableRows.excerpt(item.text)[0]:item.text;
                    StringBuilder text=new StringBuilder(item.text);if("task".equals(kind))for(PlannerStore.Step step:item.steps)text.append('\n').append(step.done?"[x] ":"[ ] ").append(step.text);
                    sources.add(new ChatContext(kind,item.id,title,text.toString()));
                }
            }
            if(sources.isEmpty()){keepFailure("No sources yet.");return;}
            String[] names=new String[sources.size()];for(int i=0;i<names.length;i++)names[i]=sources.get(i).title;
            showDialog(new AlertDialog.Builder(activity).setTitle("context").setItems(names,(d,index)->{try{repository.attach(sources.get(index));render();}catch(IllegalArgumentException failure){keepFailure(failure.getMessage());}}).setNegativeButton("cancel",null).create());
        }).setNegativeButton("cancel",null).create());
    }

    private void addContextRows(LinearLayout target,List<ChatContext> sources,boolean removable) {
        for(int i=0;i<sources.size();i++){
            int index=i;ChatContext source=sources.get(i);LinearLayout row=horizontal();
            Button card=control(source.kind+" · "+source.title,()->showDialog(new AlertDialog.Builder(activity).setTitle(source.title).setMessage(source.text).setPositiveButton("close",null).create()));
            PocketDesign.command(card,false);glowControl(card);card.setTextColor(PocketDesign.NOTES);card.setTextSize(PocketDesign.typeSize(activity, PocketDesign.META));card.setMaxLines(2);card.setEllipsize(android.text.TextUtils.TruncateAt.END);row.addView(card,new LinearLayout.LayoutParams(0,-2,1));
            if(removable){Button remove=control("×",()->{repository.removeContext(index);render();});remove.setContentDescription("Remove "+source.title);row.addView(remove,new LinearLayout.LayoutParams(dp(48),dp(48)));}
            target.addView(row,new LinearLayout.LayoutParams(-1,-2));
        }
    }

    private void updatePanelSize() {
        int width = getWidth() > 0 ? getWidth() : getResources().getDisplayMetrics().widthPixels;
        // On a phone chat is a full Pocket page; on a wide screen it stays a side panel over the dimmed page.
        int desired = width < dp(600) ? Math.max(dp(1), width) : Math.min(dp(520), width - dp(24));
        LayoutParams params = (LayoutParams) panel.getLayoutParams();
        if (params.width != desired) { params.width = desired; panel.setLayoutParams(params); }
    }

    private int panelWidth() { return panel.getLayoutParams().width; }

    private void applyPanelPadding() {
        if (panel == null) return;
        int headerVisibility = keyboardVisible ? View.GONE : View.VISIBLE;
        if (chatHeader != null && chatHeader.getVisibility() != headerVisibility) chatHeader.setVisibility(headerVisibility);
        if (chatActions != null && chatActions.getVisibility() != headerVisibility) chatActions.setVisibility(headerVisibility);
        int left = Math.max(0, insetLeft - Math.max(0, getWidth() - panelWidth()));
        int bottom = Math.max(insetBottom, keyboardBottom);
        if (panel.getPaddingLeft() != left || panel.getPaddingTop() != insetTop || panel.getPaddingRight() != insetRight || panel.getPaddingBottom() != bottom)
            panel.setPadding(left, insetTop, insetRight, bottom);
    }

    private void updateLegacyKeyboard() {
        if (destroyed || getHeight() == 0) return;
        Rect visible = new Rect();
        getWindowVisibleDisplayFrame(visible);
        if (visible.isEmpty()) return;
        int[] location = new int[2]; getLocationOnScreen(location);
        int overlap = Math.max(0, location[1] + getHeight() - visible.bottom);
        int next = overlap > dp(120) ? overlap : 0;
        if (next != keyboardBottom || keyboardVisible != (next > 0)) { keyboardBottom = next; keyboardVisible = next > 0; applyPanelPadding(); }
    }

    private void stopAnimations() {
        panel.animate().setListener(null); panel.animate().cancel();
        dimmer.animate().setListener(null); dimmer.animate().cancel();
    }

    private void hideKeyboard() {
        View focus = activity.getCurrentFocus();
        if (focus != null && isWithin(focus, panel)) {
            InputMethodManager keyboard = (InputMethodManager) activity.getSystemService(Context.INPUT_METHOD_SERVICE);
            if (keyboard != null) keyboard.hideSoftInputFromWindow(focus.getWindowToken(), 0);
            focus.clearFocus();
        }
    }

    private static boolean isWithin(View child, View parent) {
        for (View current = child; current != null; current = current.getParent() instanceof View ? (View) current.getParent() : null)
            if (current == parent) return true;
        return false;
    }

    private static boolean hitsEditor(View view, int x, int y) {
        if (view.getVisibility() != View.VISIBLE) return false;
        Rect bounds = new Rect();
        if (!view.getGlobalVisibleRect(bounds)) return false;
        int[] rootLocation = new int[2]; view.getRootView().getLocationOnScreen(rootLocation);
        bounds.offset(rootLocation[0], rootLocation[1]);
        if (!bounds.contains(x, y)) return false;
        if (view instanceof EditText) return true;
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = group.getChildCount() - 1; i >= 0; i--) if (hitsEditor(group.getChildAt(i), x, y)) return true;
        }
        return false;
    }

    private int dp(int value) { return PocketDesign.dp(activity, value); }
    private void glowControl(TextView view) { view.setBackground(PocketDesign.interaction(activity, android.graphics.Color.TRANSPARENT)); }
    private void glowControls(ViewGroup group) {
        for (int i=0;i<group.getChildCount();i++) {
            View child=group.getChildAt(i);
            if (child instanceof Button) glowControl((Button)child);
            else if (child instanceof ViewGroup) glowControls((ViewGroup)child);
        }
    }
    private LinearLayout horizontal() { LinearLayout row = new LinearLayout(activity); row.setOrientation(LinearLayout.HORIZONTAL); return row; }
    private TextView label(String value, int size, int color) { TextView view = new TextView(activity); PocketDesign.text(view, size, color); view.setShadowLayer(0, 0, 0, 0); view.setText(value); return view; }
    private Button control(String value, Runnable action) {
        Button view = new Button(activity); PocketDesign.text(view, 14, PocketDesign.WHITE); PocketDesign.control(view);
        view.setShadowLayer(0, 0, 0, 0);
        glowControl(view); view.setText(value); view.setOnClickListener(ignored -> { if (!destroyed) action.run(); }); return view;
    }
}
