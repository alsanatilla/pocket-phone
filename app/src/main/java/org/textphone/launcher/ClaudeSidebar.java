package org.textphone.launcher;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.graphics.Rect;
import android.graphics.Typeface;
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
import java.util.Set;
import java.util.function.BooleanSupplier;

import io.noties.markwon.AbstractMarkwonPlugin;
import io.noties.markwon.Markwon;
import io.noties.markwon.core.MarkwonTheme;

/** An activity-local drawer; conversation and requests belong to the application repository. */
final class ClaudeSidebar extends FrameLayout {
    private static final String OPEN_STATE = "pocket_claude_sidebar_open";
    private static final long MOTION_MS = 180, RENDER_MS = 60;
    private final Activity activity;
    private final View pageHost, dimmer;
    private final Runnable navigationChanged;
    private final BooleanSupplier swipeAllowed;
    private final ClaudeChatRepository repository;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final LinearLayout panel, log, errorRow, loadingRow;
    private final ScrollView scroll;
    private final EditText composer;
    private final Button back, settings, setup, send, retry;
    private final TextView error, cacheStatus, loadingLabel, accessStatus;
    private final PixelLoadingView loading;
    private boolean opened, observing, destroyed, applyingDraft, renderQueued, swipeCandidate, capturedSwipe;
    private float startX, startY;
    private long lastSubmitAt;
    private String assistantLabel = "assistant";
    private int originalAccessibility, insetLeft, insetTop, insetRight, insetBottom, keyboardBottom, themedAccent;
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

        LinearLayout header = horizontal();
        header.setPadding(dp(8), dp(4), dp(8), dp(4));
        back = control("Back", () -> close());
        back.setContentDescription("Close chat");
        back.setFocusableInTouchMode(true);
        header.addView(back, new LinearLayout.LayoutParams(dp(64), LayoutParams.WRAP_CONTENT));
        TextView title = label("chat", 24, PocketDesign.WHITE);
        title.setTypeface(PocketFonts.pixel(activity));
        title.setGravity(Gravity.CENTER_VERTICAL | Gravity.CENTER_HORIZONTAL);
        if (Build.VERSION.SDK_INT >= 28) title.setAccessibilityHeading(true);
        header.addView(title, new LinearLayout.LayoutParams(0, LayoutParams.MATCH_PARENT, 1));
        settings = control("⋮", this::showSettings);
        settings.setTextSize(PocketDesign.typeSize(activity, 24));
        settings.setContentDescription("Chat settings");
        header.addView(settings, new LinearLayout.LayoutParams(dp(52), LayoutParams.WRAP_CONTENT));
        panel.addView(header, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));

        setup = control("Add API key", this::showKey);
        setup.setTag("claude_add_api_key");
        panel.addView(setup, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        scroll = new ScrollView(activity);
        scroll.setTag("claude_chat_scroll");
        scroll.setFillViewport(true);
        scroll.setClipToPadding(false);
        scroll.setVerticalScrollBarEnabled(true);
        log = new LinearLayout(activity);
        log.setOrientation(LinearLayout.VERTICAL);
        log.setPadding(dp(16), dp(8), dp(16), dp(12));
        scroll.addView(log, new ScrollView.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        panel.addView(scroll, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, 0, 1));

        loadingRow = horizontal();
        loadingRow.setGravity(Gravity.CENTER_VERTICAL);
        loadingRow.setPadding(dp(12), 0, dp(16), 0);
        loading = new PixelLoadingView(activity);
        loadingRow.addView(loading, new LinearLayout.LayoutParams(dp(48), dp(48)));
        loadingLabel = label("thinking", 14, PocketDesign.MUTED);
        loadingLabel.setPadding(dp(8), 0, 0, 0);
        loadingLabel.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        loadingRow.addView(loadingLabel, new LinearLayout.LayoutParams(0, LayoutParams.WRAP_CONTENT, 1));
        loadingRow.setVisibility(View.GONE);
        panel.addView(loadingRow, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));

        errorRow = horizontal();
        errorRow.setGravity(Gravity.CENTER_VERTICAL);
        errorRow.setPadding(dp(16), dp(4), dp(8), dp(4));
        error = label("", 16, PocketDesign.WARNING);
        error.setTypeface(Typeface.create("sans-serif", Typeface.NORMAL));
        error.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        errorRow.addView(error, new LinearLayout.LayoutParams(0, LayoutParams.WRAP_CONTENT, 1));
        retry = control("Retry", this::retry);
        errorRow.addView(retry, new LinearLayout.LayoutParams(dp(80), LayoutParams.WRAP_CONTENT));
        errorRow.setVisibility(View.GONE);
        panel.addView(errorRow, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));

        cacheStatus = label("", 12, PocketDesign.MUTED);
        cacheStatus.setPadding(dp(16), dp(4), dp(16), dp(4));
        cacheStatus.setVisibility(View.GONE);
        panel.addView(cacheStatus, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));

        accessStatus = label("", 14, PocketDesign.MUTED);
        accessStatus.setTag("claude_pocket_access");
        accessStatus.setPadding(dp(16), 0, dp(16), 0);
        accessStatus.setMinHeight(dp(44));
        accessStatus.setGravity(Gravity.CENTER_VERTICAL);
        accessStatus.setFocusable(true);
        accessStatus.setOnClickListener(view -> { if (!destroyed) showPocketAccess(); });
        panel.addView(accessStatus, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));

        LinearLayout inputRow = horizontal();
        inputRow.setGravity(Gravity.BOTTOM);
        inputRow.setPadding(dp(16), dp(4), dp(8), dp(8));
        composer = new EditText(activity);
        composer.setTag("claude_chat_composer");
        PocketDesign.input(composer);
        composer.setTypeface(Typeface.create("sans-serif", Typeface.NORMAL));
        composer.setGravity(Gravity.TOP | Gravity.START);
        composer.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        composer.setImeOptions(EditorInfo.IME_ACTION_SEND | EditorInfo.IME_FLAG_NO_EXTRACT_UI);
        composer.setMinLines(2);
        composer.setMaxLines(5);
        composer.setFilters(new InputFilter[]{new InputFilter.LengthFilter(ClaudeChatRepository.MAX_INPUT_CHARS)});
        composer.setHint("Message");
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
        send = control("Send", this::submit);
        send.setTag("claude_chat_send");
        PocketDesign.primary(send);
        inputRow.addView(send, new LinearLayout.LayoutParams(dp(80), LayoutParams.WRAP_CONTENT));
        panel.addView(inputRow, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));

        // Read the incoming insets here, before a page consumes them during child dispatch.
        setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets safe = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                insetLeft = safe.left; insetTop = safe.top; insetRight = safe.right; insetBottom = safe.bottom;
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
        panel.animate().translationX(0).setDuration(duration).start();
        dimmer.animate().alpha(1).setDuration(duration).start();
        back.requestFocus();
        requestApplyInsets();
        navigationChanged.run();
    }

    void close() {
        if (destroyed || !opened) return;
        opened = false;
        loading.setPaused(true);
        capturedSwipe = false;
        swipeCandidate = false;
        hideKeyboard();
        pageHost.setImportantForAccessibility(originalAccessibility);
        stopAnimations();
        long duration = PageMotion.enabled(activity) ? MOTION_MS : 0;
        panel.animate().translationX(panelWidth()).setDuration(duration).setListener(new AnimatorListenerAdapter() {
            @Override public void onAnimationEnd(Animator animation) {
                if (!opened && !destroyed) {
                    panel.setVisibility(View.GONE);
                    View focus = previousFocus.get();
                    if (focus != null && focus.isAttachedToWindow()) focus.requestFocus();
                }
            }
        }).start();
        dimmer.animate().alpha(0).setDuration(duration).setListener(new AnimatorListenerAdapter() {
            @Override public void onAnimationEnd(Animator animation) { if (!opened && !destroyed) dimmer.setVisibility(View.GONE); }
        }).start();
        navigationChanged.run();
    }

    void closeImmediately() {
        if (destroyed) return;
        opened = false;
        capturedSwipe = false;
        swipeCandidate = false;
        loading.setPaused(true);
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
        loading.refresh();
        if (!observing) { observing = true; repository.observe(observer); }
        if (opened) render();
    }

    void pause() {
        loading.setPaused(true);
        if (observing) { repository.removeObserver(observer); observing = false; }
        main.removeCallbacks(renderTask);
        renderQueued = false;
    }

    void destroy() {
        if (destroyed) return;
        destroyed = true;
        pause();
        loading.destroy();
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
        if (snapshot.running || snapshot.turns.isEmpty()) return false;
        ClaudeChatRepository.Turn answer = snapshot.turns.get(snapshot.turns.size() - 1);
        return "assistant".equals(answer.role) && ("failed".equals(answer.state) || "stopped".equals(answer.state));
    }

    private void scheduleRender() {
        if (!destroyed && opened && !renderQueued) { renderQueued = true; main.postDelayed(renderTask, RENDER_MS); }
    }

    private void render() {
        if (destroyed) return;
        ClaudeChatRepository.Snapshot snapshot = repository.snapshot();
        assistantLabel = "anthropic".equals(snapshot.provider) ? "claude" : "assistant";
        boolean follow = log.getChildCount() == 0 || log.getHeight() - scroll.getScrollY() - scroll.getHeight() <= dp(96);
        ChatProvider.Config provider = ChatProvider.get(activity);
        setup.setVisibility(ChatProvider.present(activity, provider) ? View.GONE : View.VISIBLE);
        StringBuilder access = new StringBuilder();
        String[] categories = {PocketChatTools.NOTES, PocketChatTools.THOUGHTS, PocketChatTools.COROS};
        String[] names = {"Notes", "Thoughts", "COROS"};
        for (int category = 0; category < categories.length; category++) {
            if (!PocketChatTools.enabled(activity, categories[category])) continue;
            if (access.length() > 0) access.append(" · ");
            access.append(names[category]);
        }
        accessStatus.setText(access.length() == 0 ? "Pocket access · off" : "Pocket access · " + access);
        loadingRow.setVisibility(snapshot.running ? View.VISIBLE : View.GONE);
        String status = snapshot.status == null || snapshot.status.isEmpty() ? "thinking" : snapshot.status;
        if (!loadingLabel.getText().toString().equals(status)) loadingLabel.setText(status);
        loading.setRunning(snapshot.running);
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
            log.removeView(removed.root);
        }
        String failure = snapshot.error == null ? "" : snapshot.error;
        error.setText(failure);
        error.setVisibility(failure.isEmpty() ? View.GONE : View.VISIBLE);
        boolean retryAvailable = canRetry(snapshot);
        errorRow.setVisibility(failure.isEmpty() && !retryAvailable ? View.GONE : View.VISIBLE);
        retry.setVisibility(retryAvailable ? View.VISIBLE : View.GONE);
        boolean hit = !snapshot.running && snapshot.cacheReadTokens > 0;
        cacheStatus.setText(hit ? "Cached · " + NumberFormat.getIntegerInstance().format(snapshot.cacheReadTokens) + " input tokens" : "");
        cacheStatus.setVisibility(hit ? View.VISIBLE : View.GONE);
        String draft = repository.draft();
        if (!composer.getText().toString().equals(draft)) {
            applyingDraft = true;
            composer.setText(draft);
            composer.setSelection(composer.length());
            applyingDraft = false;
        }
        updateSend(snapshot.running);
        if (follow) scroll.post(() -> { if (!destroyed && opened) scroll.scrollTo(0, Math.max(0, log.getHeight() - scroll.getHeight())); });
    }

    private void updateSend(boolean running) {
        if (send == null) return;
        send.setText(running ? "Stop" : "Send");
        send.setContentDescription(running ? "Stop response" : "Send message");
        send.setEnabled(running || !composer.getText().toString().trim().isEmpty());
    }

    private void showSettings() {
        if (destroyed) return;
        ChatProvider.Config provider = ChatProvider.get(activity);
        String keyLabel = ChatProvider.present(activity, provider) ? "API key · " + ChatProvider.hint(activity, provider) : "Add API key";
        boolean anthropic = "anthropic".equals(provider.provider);
        String[] options = anthropic ? new String[]{"Provider & model", keyLabel,
                "Reply limit · " + NumberFormat.getIntegerInstance().format(provider.maxTokens) + " tokens",
                "Prompt caching · " + (provider.promptCaching ? "on" : "off"), "Pocket access", "New chat"}
                : new String[]{"Provider & model", keyLabel,
                "Reply limit · " + NumberFormat.getIntegerInstance().format(provider.maxTokens) + " tokens", "Pocket access", "New chat"};
        showDialog(new AlertDialog.Builder(activity, AlertDialog.THEME_DEVICE_DEFAULT_DARK).setTitle("Chat settings")
                .setItems(options, (choice, index) -> {
                    if (destroyed) return;
                    if (index == 0) showProvider();
                    else if (index == 1) showKey();
                    else if (index == 2) showReplyLimit();
                    else if (anthropic && index == 3) showCaching();
                    else if (index == (anthropic ? 4 : 3)) showPocketAccess();
                    else confirmNewChat();
                }).setNegativeButton("Close", null).create());
    }

    private void showPocketAccess() {
        if (destroyed) return;
        ChatProvider.Config provider = ChatProvider.get(activity);
        String recipient = "anthropic".equals(provider.provider) ? "Claude" : android.net.Uri.parse(provider.baseUrl).getHost();
        if (recipient == null || recipient.isEmpty()) recipient = provider.name();
        LinearLayout fields = new LinearLayout(activity);
        fields.setOrientation(LinearLayout.VERTICAL);
        fields.setPadding(dp(20), dp(8), dp(20), dp(8));
        TextView description = label("Selected passages and summaries are sent to " + recipient
                + " when requested in chat. Read only.", 14, PocketDesign.MUTED);
        description.setPadding(0, 0, 0, dp(8));
        fields.addView(description, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        String[] categories = {"thoughts", "notes", "coros"}, names = {"Thoughts", "Notes", "COROS"};
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
        showDialog(new AlertDialog.Builder(activity, AlertDialog.THEME_DEVICE_DEFAULT_DARK).setTitle("Pocket access")
                .setView(form).setNegativeButton("Cancel", null).setPositiveButton("Save", (dialog, which) -> {
                    if (destroyed) return;
                    for (int index = 0; index < categories.length; index++)
                        if (PocketChatTools.enabled(activity, categories[index]) && !choices[index].isChecked()) { repository.stop(); break; }
                    try {
                        for (int index = 0; index < categories.length; index++)
                            PocketChatTools.enabled(activity, categories[index], choices[index].isChecked());
                        render();
                    } catch (IllegalStateException failure) { showSettingsError(failure.getMessage()); }
                }).create());
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
        TextView validation = label("", 14, PocketDesign.WARNING);
        validation.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        fields.addView(validation);
        int initial = "anthropic".equals(current.provider) ? 0 : 1;
        int[] selected = {initial};
        picker.setSelection(initial);
        boolean initialCustom = initial == 1;
        urlLabel.setVisibility(initialCustom ? View.VISIBLE : View.GONE);
        url.setVisibility(initialCustom ? View.VISIBLE : View.GONE);
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
                key.setHint(custom ? "New endpoint needs its own key" : "sk-ant-… or leave blank to keep");
            }
            @Override public void onNothingSelected(AdapterView<?> parent) { }
        });
        ScrollView form = new ScrollView(activity);
        form.addView(fields);
        AlertDialog providerDialog = new AlertDialog.Builder(activity, AlertDialog.THEME_DEVICE_DEFAULT_DARK)
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
                        current.maxTokens, "anthropic".equals(kind) && ("anthropic".equals(current.provider) ? current.promptCaching : true));
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
                        if (changed || !replacement.isEmpty()) repository.stop();
                        ChatProvider.save(activity, next, replacement);
                        if (changed) repository.clear();
                        key.setText("");
                        providerDialog.dismiss();
                        render();
                    } catch (IllegalArgumentException | IllegalStateException failure) {
                        validation.setText(failure.getMessage());
                        if (!providerDialog.isShowing()) showDialog(providerDialog);
                    }
                };
                if (!current.identity.equals(next.identity) && !repository.snapshot().turns.isEmpty()) {
                    AlertDialog confirm = new AlertDialog.Builder(activity, AlertDialog.THEME_DEVICE_DEFAULT_DARK)
                            .setTitle("Start a new chat with " + next.name() + "?").setMessage("The current chat will be cleared.")
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
        showDialog(new AlertDialog.Builder(activity, AlertDialog.THEME_DEVICE_DEFAULT_DARK).setTitle("Reply limit")
                .setSingleChoiceItems(names, selected, (choice, index) -> {
                    if (destroyed) return;
                    try {
                        ChatProvider.save(activity, new ChatProvider.Config(current.provider, current.model, current.baseUrl,
                                limits[index], current.promptCaching), "");
                        choice.dismiss();
                    } catch (IllegalArgumentException | IllegalStateException failure) { showSettingsError(failure.getMessage()); }
                }).setNegativeButton("Cancel", null).create());
    }

    private void showCaching() {
        ChatProvider.Config current = ChatProvider.get(activity);
        showDialog(new AlertDialog.Builder(activity, AlertDialog.THEME_DEVICE_DEFAULT_DARK).setTitle("Prompt caching")
                .setMessage("Reuses recent prompt prefixes. Cache writes cost extra; repeated reads cost less.")
                .setNegativeButton("Cancel", null).setPositiveButton(current.promptCaching ? "Turn off" : "Turn on", (choice, which) -> {
                    if (destroyed) return;
                    try {
                        ChatProvider.save(activity, new ChatProvider.Config(current.provider, current.model, current.baseUrl,
                                current.maxTokens, !current.promptCaching), "");
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
                throw new IllegalArgumentException("Enter a Claude API key beginning with sk-ant-.");
        } else if (!value.matches("[\\x21-\\x7E]{8,512}")) {
            throw new IllegalArgumentException("Enter a valid provider API key.");
        }
    }

    private void showSettingsError(String message) {
        showDialog(new AlertDialog.Builder(activity, AlertDialog.THEME_DEVICE_DEFAULT_DARK).setTitle("Chat settings")
                .setMessage(message == null ? "Could not save the settings." : message).setPositiveButton("Close", null).create());
    }

    private void confirmNewChat() {
        showDialog(new AlertDialog.Builder(activity, AlertDialog.THEME_DEVICE_DEFAULT_DARK).setTitle("Clear this chat?")
                .setNegativeButton("Keep", null).setPositiveButton("Clear", (choice, which) -> {
                    if (!destroyed) { repository.clear(); render(); }
                }).create());
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
        AlertDialog.Builder builder = new AlertDialog.Builder(activity, AlertDialog.THEME_DEVICE_DEFAULT_DARK)
                .setTitle(provider.name() + " API key").setView(fields).setNegativeButton("Cancel", null).setPositiveButton("Save", null);
        if (ChatProvider.present(activity, provider)) builder.setNeutralButton("Remove key", (choice, which) -> {
            if (!destroyed) {
                try { repository.stop(); ChatProvider.clearKey(activity, provider); render(); }
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
                repository.stop();
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
        PocketDesign.control(back); PocketDesign.control(settings); PocketDesign.control(setup); PocketDesign.control(retry); PocketDesign.primary(send);
        setup.setTextColor(PocketDesign.colors(activity, accent));
        if (markdown == null || accent != themedAccent) {
            themedAccent = accent;
            markdown = Markwon.builder(activity).usePlugin(new AbstractMarkwonPlugin() {
                @Override public void configureTheme(MarkwonTheme.Builder theme) {
                    theme.headingBreakHeight(0).headingTextSizeMultipliers(new float[]{1.4f, 1.25f, 1.125f, 1f, 1f, 1f})
                            .linkColor(themedAccent).thematicBreakColor(PocketDesign.LINE);
                }
            }).build();
            for (TurnView row : rows.values()) row.lastText = null;
        }
    }

    private final class TurnView {
        final LinearLayout root = new LinearLayout(activity);
        final TextView role = label("", 12, PocketDesign.MUTED);
        final TextView body = label("", 18, PocketDesign.WHITE);
        final TextView state = label("", 12, PocketDesign.MUTED);
        String lastText, lastState;
        TurnView() {
            root.setOrientation(LinearLayout.VERTICAL);
            root.setPadding(0, dp(8), 0, dp(16));
            role.setPadding(0, 0, 0, dp(8));
            body.setTypeface(Typeface.create("sans-serif", Typeface.NORMAL));
            body.setGravity(Gravity.TOP | Gravity.START);
            body.setLineSpacing(dp(4), 1.05f);
            body.setTextIsSelectable(true);
            state.setPadding(0, dp(8), 0, 0);
            root.addView(role, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
            root.addView(body, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
            root.addView(state, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        }
        void update(ClaudeChatRepository.Turn turn) {
            boolean assistant = "assistant".equals(turn.role);
            role.setText(assistant ? assistantLabel : "you");
            role.setTextColor(assistant ? PocketDesign.MUTED : themedAccent);
            root.setTag("claude_turn_" + turn.id);
            if (!turn.text.equals(lastText) || !turn.state.equals(lastState)) {
                if (assistant && "complete".equals(turn.state) && !turn.text.isEmpty()) markdown.setMarkdown(body, turn.text);
                else body.setText(turn.text);
                lastText = turn.text; lastState = turn.state;
            }
            body.setVisibility(body.length() == 0 ? View.GONE : View.VISIBLE);
            String status = "stopped".equals(turn.state) ? "Stopped" : "failed".equals(turn.state) && !turn.text.isEmpty() ? "Incomplete" : "";
            state.setText(status);
            state.setVisibility(status.isEmpty() ? View.GONE : View.VISIBLE);
        }
    }

    private void updatePanelSize() {
        int width = getWidth() > 0 ? getWidth() : getResources().getDisplayMetrics().widthPixels;
        int desired = Math.min(dp(520), Math.max(dp(1), width - dp(24)));
        LayoutParams params = (LayoutParams) panel.getLayoutParams();
        if (params.width != desired) { params.width = desired; panel.setLayoutParams(params); }
    }

    private int panelWidth() { return panel.getLayoutParams().width; }

    private void applyPanelPadding() {
        if (panel == null) return;
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
        if (next != keyboardBottom) { keyboardBottom = next; applyPanelPadding(); }
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
    private LinearLayout horizontal() { LinearLayout row = new LinearLayout(activity); row.setOrientation(LinearLayout.HORIZONTAL); return row; }
    private TextView label(String value, int size, int color) { TextView view = new TextView(activity); PocketDesign.text(view, size, color); view.setText(value); return view; }
    private Button control(String value, Runnable action) {
        Button view = new Button(activity); PocketDesign.text(view, 14, PocketDesign.WHITE); PocketDesign.control(view);
        view.setText(value); view.setOnClickListener(ignored -> { if (!destroyed) action.run(); }); return view;
    }
}
