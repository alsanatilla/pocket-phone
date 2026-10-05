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
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.lang.ref.WeakReference;
import java.util.HashSet;
import java.util.LinkedHashMap;
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
    private final LinearLayout panel, log, errorRow;
    private final ScrollView scroll;
    private final EditText composer;
    private final Button back, settings, setup, send, retry;
    private final TextView error;
    private boolean opened, observing, destroyed, applyingDraft, renderQueued, swipeCandidate, capturedSwipe;
    private float startX, startY;
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
        back.setContentDescription("Close Claude chat");
        back.setFocusableInTouchMode(true);
        header.addView(back, new LinearLayout.LayoutParams(dp(64), LayoutParams.WRAP_CONTENT));
        TextView title = label("claude", 24, PocketDesign.WHITE);
        title.setTypeface(PocketFonts.pixel(activity));
        title.setGravity(Gravity.CENTER_VERTICAL | Gravity.CENTER_HORIZONTAL);
        if (Build.VERSION.SDK_INT >= 28) title.setAccessibilityHeading(true);
        header.addView(title, new LinearLayout.LayoutParams(0, LayoutParams.MATCH_PARENT, 1));
        settings = control("⋮", this::showSettings);
        settings.setTextSize(PocketDesign.typeSize(activity, 24));
        settings.setContentDescription("Claude settings");
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
        composer.setContentDescription("Message Claude");
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
        panel.animate().translationX(0).setDuration(MOTION_MS).start();
        dimmer.animate().alpha(1).setDuration(MOTION_MS).start();
        back.requestFocus();
        requestApplyInsets();
        navigationChanged.run();
    }

    void close() {
        if (destroyed || !opened) return;
        opened = false;
        capturedSwipe = false;
        swipeCandidate = false;
        hideKeyboard();
        pageHost.setImportantForAccessibility(originalAccessibility);
        stopAnimations();
        panel.animate().translationX(panelWidth()).setDuration(MOTION_MS).setListener(new AnimatorListenerAdapter() {
            @Override public void onAnimationEnd(Animator animation) {
                if (!opened && !destroyed) {
                    panel.setVisibility(View.GONE);
                    View focus = previousFocus.get();
                    if (focus != null && focus.isAttachedToWindow()) focus.requestFocus();
                }
            }
        }).start();
        dimmer.animate().alpha(0).setDuration(MOTION_MS).setListener(new AnimatorListenerAdapter() {
            @Override public void onAnimationEnd(Animator animation) { if (!opened && !destroyed) dimmer.setVisibility(View.GONE); }
        }).start();
        navigationChanged.run();
    }

    void resume() {
        if (destroyed) return;
        refreshTheme();
        if (!observing) { observing = true; repository.observe(observer); }
        if (opened) render();
    }

    void pause() {
        if (observing) { repository.removeObserver(observer); observing = false; }
        main.removeCallbacks(renderTask);
        renderQueued = false;
    }

    void destroy() {
        if (destroyed) return;
        destroyed = true;
        pause();
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

    @Override public boolean onInterceptTouchEvent(MotionEvent event) {
        if (destroyed) return false;
        int action = event.getActionMasked();
        if (capturedSwipe) return true;
        if (opened) return false;
        if (action == MotionEvent.ACTION_DOWN) {
            startX = event.getX(); startY = event.getY();
            swipeCandidate = swipeAllowed.getAsBoolean() && event.getPointerCount() == 1
                    && startX >= getWidth() / 2f && startX < getWidth() - dp(40)
                    && startY < getHeight() - dp(64) && !hitsEditor(pageHost, (int) event.getRawX(), (int) event.getRawY());
        } else if (action == MotionEvent.ACTION_POINTER_DOWN || action == MotionEvent.ACTION_CANCEL || action == MotionEvent.ACTION_UP) {
            swipeCandidate = false;
        } else if (action == MotionEvent.ACTION_MOVE && swipeCandidate) {
            float dx = event.getX() - startX, dy = event.getY() - startY;
            if (Math.abs(dy) > touchSlop && Math.abs(dy) >= Math.abs(dx)) swipeCandidate = false;
            else if (dx <= -dp(56) && -dx > Math.abs(dy) * 1.4f) {
                capturedSwipe = true;
                swipeCandidate = false;
                open();
                return true; // ViewGroup sends ACTION_CANCEL to the original page control.
            }
        }
        return false;
    }

    @Override public boolean onTouchEvent(MotionEvent event) {
        if (!capturedSwipe) return super.onTouchEvent(event);
        if (event.getActionMasked() == MotionEvent.ACTION_UP || event.getActionMasked() == MotionEvent.ACTION_CANCEL) capturedSwipe = false;
        return true;
    }

    private void submit() {
        if (destroyed) return;
        ClaudeChatRepository.Snapshot snapshot = repository.snapshot();
        if (snapshot.running) { repository.stop(); return; }
        String value = composer.getText().toString();
        if (value.trim().isEmpty()) return;
        if (!ClaudeKey.present(activity) || ClaudeKey.read(activity) == null) { showKey(); return; }
        if (canRetry(snapshot) && snapshot.turns.size() >= 2
                && value.equals(snapshot.turns.get(snapshot.turns.size() - 2).text)) repository.retry();
        else repository.send(value);
        render();
    }

    private void retry() {
        if (destroyed) return;
        if (!ClaudeKey.present(activity) || ClaudeKey.read(activity) == null) { showKey(); return; }
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
        boolean follow = log.getChildCount() == 0 || log.getHeight() - scroll.getScrollY() - scroll.getHeight() <= dp(96);
        setup.setVisibility(ClaudeKey.present(activity) ? View.GONE : View.VISIBLE);
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
        send.setContentDescription(running ? "Stop Claude response" : "Send message to Claude");
        send.setEnabled(running || !composer.getText().toString().trim().isEmpty());
    }

    private void showSettings() {
        if (destroyed) return;
        String keyLabel = ClaudeKey.present(activity) ? "API key · " + ClaudeKey.hint(activity) : "Add API key";
        showDialog(new AlertDialog.Builder(activity, AlertDialog.THEME_DEVICE_DEFAULT_DARK).setTitle("claude")
                .setItems(new String[]{keyLabel, "New chat"}, (choice, index) -> {
                    if (destroyed) return;
                    if (index == 0) showKey(); else confirmNewChat();
                }).setNegativeButton("Close", null).create());
    }

    private void confirmNewChat() {
        showDialog(new AlertDialog.Builder(activity, AlertDialog.THEME_DEVICE_DEFAULT_DARK).setTitle("Clear this chat?")
                .setNegativeButton("Keep", null).setPositiveButton("Clear", (choice, which) -> {
                    if (!destroyed) { repository.clear(); render(); }
                }).create());
    }

    private void showKey() {
        if (destroyed) return;
        LinearLayout fields = new LinearLayout(activity);
        fields.setOrientation(LinearLayout.VERTICAL);
        fields.setPadding(dp(20), dp(8), dp(20), dp(8));
        TextView billing = label("Used for chat and Journal. API usage is billed separately.", 14, PocketDesign.MUTED);
        fields.addView(billing, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        if (ClaudeKey.present(activity)) {
            TextView hint = label("Saved key " + ClaudeKey.hint(activity), 14, PocketDesign.MUTED);
            hint.setPadding(0, dp(12), 0, 0);
            fields.addView(hint, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        }
        EditText field = new EditText(activity);
        PocketDesign.input(field);
        field.setTag("claude_chat_api_key");
        field.setSingleLine(true);
        field.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        field.setFilters(new InputFilter[]{new InputFilter.LengthFilter(512)});
        field.setHint("sk-ant-…");
        fields.addView(field, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        TextView validation = label("", 14, PocketDesign.WARNING);
        validation.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        fields.addView(validation, new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        AlertDialog.Builder builder = new AlertDialog.Builder(activity, AlertDialog.THEME_DEVICE_DEFAULT_DARK)
                .setTitle("Claude API key").setView(fields).setNegativeButton("Cancel", null).setPositiveButton("Save", null);
        if (ClaudeKey.present(activity)) builder.setNeutralButton("Remove key", (choice, which) -> {
            if (!destroyed) { repository.stop(); ClaudeKey.clear(activity); render(); }
        });
        AlertDialog keyDialog = builder.create();
        keyDialog.setOnShowListener(ignored -> keyDialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
            if (destroyed) return;
            try {
                ClaudeKey.save(activity, field.getText().toString());
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
            role.setText(assistant ? "claude" : "you");
            role.setTextColor(assistant ? PocketDesign.MUTED : themedAccent);
            root.setTag("claude_turn_" + turn.id);
            if (!turn.text.equals(lastText) || !turn.state.equals(lastState)) {
                if (assistant && "complete".equals(turn.state) && !turn.text.isEmpty()) markdown.setMarkdown(body, turn.text);
                else body.setText(turn.text.isEmpty() && "pending".equals(turn.state) ? "…" : turn.text);
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
