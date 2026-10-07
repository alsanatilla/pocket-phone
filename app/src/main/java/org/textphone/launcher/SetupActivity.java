package org.textphone.launcher;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * One path through Pocket's connections on the phone: the account (which also links this phone), COROS, then Pip.
 * Every step can be skipped and picked up later; the page always opens at the first open step. The web has the same
 * page at #/setup, with an extra phone step because a browser links the phone by typing its code.
 */
public final class SetupActivity extends PocketActivity {
    private static final String[] IDS = {"account", "coros", "pip"}, NAMES = {"account", "COROS", "pip"};
    private static final String[] WHY = {
            "One Pocket account keeps notes, tasks, chats and COROS the same on this phone and the web. Signing in links this phone.",
            "Recovery, sleep and training for Home and Movement. A connection made on the web works here too.",
            "Pip needs an AI provider. OpenRouter's free models cost nothing; a Claude key gives the best answers and also reads Paper."};
    static final String OPENROUTER = "https://openrouter.ai/api/v1", FREE_MODEL = "openrouter/free";
    private CorosRepository coros;
    private String expanded = "";
    private boolean busy, visible, checkedCoros;
    private int provider;
    private final Runnable claim = this::completeCoros;

    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences("pocket_setup", Context.MODE_PRIVATE); }
    private static boolean skipped(Context c, String id) { return prefs(c).getBoolean("skipped_" + id, false); }
    private static void skip(Context c, String id, boolean on) { prefs(c).edit().putBoolean("skipped_" + id, on).apply(); }
    static boolean done(Context c, String id) {
        if ("account".equals(id)) return PocketCloud.saved(c);
        if ("coros".equals(id)) return CorosRepository.get(c).connected();
        return ChatProvider.present(c, ChatProvider.get(c));
    }
    static int doneCount(Context c) { int count = 0; for (String id : IDS) if (done(c, id)) count++; return count; }
    /** Steps neither done nor skipped. Home shows a reminder until this reaches zero or is hidden. */
    static int open(Context c) { int count = 0; for (String id : IDS) if (!done(c, id) && !skipped(c, id)) count++; return count; }
    static String next(Context c) { for (int i = 0; i < IDS.length; i++) if (!done(c, IDS[i]) && !skipped(c, IDS[i])) return NAMES[i]; return ""; }
    static boolean hidden(Context c) { return prefs(c).getBoolean("hidden", false); }
    static void hide(Context c) { prefs(c).edit().putBoolean("hidden", true).apply(); }
    static int total() { return IDS.length; }

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state); coros = CorosRepository.get(this);
        if (state != null) { expanded = state.getString("expanded", ""); provider = state.getInt("provider"); }
        else provider = "anthropic".equals(ChatProvider.get(this).provider) && ChatProvider.present(this, ChatProvider.get(this)) ? 1 : 0;
        render();
    }
    @Override protected void onResume() {
        super.onResume(); visible = true; render();
        if (coros.pending()) completeCoros();
        else if (!checkedCoros && PocketCloud.saved(this) && !coros.connected()) {
            // A COROS connection made in the browser belongs to the account; ask once so this step shows it.
            checkedCoros = true; load(() -> coros.refresh(false), value -> render(), error -> { });
        }
    }
    @Override protected void onPause() { visible = false; ui.removeCallbacks(claim); super.onPause(); }
    @Override protected void onSaveInstanceState(Bundle state) { state.putString("expanded", expanded); state.putInt("provider", provider); super.onSaveInstanceState(state); }
    @Override protected void onCloudSynced() { render(); }
    @Override protected String scene() { return PixelBackdrop.STARS; }

    private String current() {
        if (!expanded.isEmpty()) return expanded;
        for (String id : IDS) if (!done(this, id) && !skipped(this, id)) return id;
        return "";
    }

    private void render() {
        if (closed) return;
        screen("set up");
        int done = doneCount(this); String current = current();
        body.addView(label(done == IDS.length ? "all connected" : done + " of " + IDS.length + " connected", PocketDesign.SMALL, GRAY));
        divider();
        for (int i = 0; i < IDS.length; i++) {
            String id = IDS[i]; boolean active = id.equals(current), complete = done(this, id), skip = !complete && skipped(this, id);
            step(i, active, complete, skip);
            if (active) {
                TextView why = label(WHY[i], PocketDesign.SMALL, GRAY); body.addView(why);
                if (i == 0) account(complete, skip); else if (i == 1) coros(complete, skip); else pip(complete, skip);
            }
            divider();
        }
        if (current.isEmpty()) {
            body.addView(label(done == IDS.length ? "Pocket is set up. Change any connection above at any time." : "Setup is finished. Skipped steps wait here until you want them.", PocketDesign.BODY, WHITE));
            primary("home", this::finish);
        }
    }

    /** A numbered save-file row: filled when connected, outlined while it is the current step. */
    private void step(int index, boolean active, boolean complete, boolean skip) {
        int accent = PocketDesign.accent(this);
        LinearLayout line = row(); line.setMinimumHeight(dp(64)); line.setFocusable(true); line.setClickable(true);
        PocketDesign.list(line);
        TextView mark = new TextView(this); mark.setText(complete ? "✓" : skip ? "–" : String.valueOf(index + 1));
        mark.setTypeface(PocketFonts.pixel(this)); mark.setTextSize(PocketDesign.typeSize(this, 22)); mark.setGravity(Gravity.CENTER);
        GradientDrawable box = new GradientDrawable(); box.setColor(complete ? accent : PocketDesign.BLACK);
        box.setStroke(dp(active ? 2 : 1), complete ? accent : active ? accent : PocketDesign.LINE); mark.setBackground(box);
        mark.setTextColor(complete ? PocketDesign.BLACK : active ? accent : GRAY);
        line.addView(mark, new LinearLayout.LayoutParams(dp(40), dp(40)));
        TextView name = new TextView(this); name.setText(NAMES[index]); name.setTypeface(PocketFonts.pixel(this));
        name.setTextSize(PocketDesign.typeSize(this, 24)); name.setTextColor(active ? accent : skip ? GRAY : WHITE); name.setPadding(dp(12), 0, dp(8), 0);
        line.addView(name, new LinearLayout.LayoutParams(0, -2, 1));
        String detail = complete ? detail(IDS[index]) : skip ? "skipped" : active ? "now" : "";
        TextView note = label(detail, PocketDesign.META, active ? accent : GRAY); note.setSingleLine(true); note.setEllipsize(android.text.TextUtils.TruncateAt.END);
        note.setMaxWidth(dp(180)); line.addView(note);
        line.setContentDescription(NAMES[index] + ", " + (detail.isEmpty() ? "not connected" : detail));
        String id = IDS[index];
        line.setOnClickListener(v -> { expanded = active ? "" : id; render(); });
        body.addView(line, new LinearLayout.LayoutParams(-1, -2));
    }
    private String detail(String id) {
        if ("account".equals(id)) return PocketCloud.email(this);
        if ("coros".equals(id)) return "connected";
        ChatProvider.Config config = ChatProvider.get(this);
        return "anthropic".equals(config.provider) ? "Claude" : Uri.parse(config.baseUrl).getHost();
    }
    private void divider() { View line = new View(this); line.setBackgroundColor(PocketDesign.LINE); body.addView(line, new LinearLayout.LayoutParams(-1, Math.max(1, dp(1) / 2))); }
    private Button primary(String text, Runnable action) {
        Button view = action(text, action); view.setTypeface(PocketFonts.pixel(this)); view.setTextSize(PocketDesign.typeSize(this, 26)); view.setTextColor(PocketDesign.accent(this));
        return view;
    }
    private void later(String id, boolean skip, String text) {
        Button view = action(skip ? "ask again" : text, () -> { skip(this, id, !skip); expanded = ""; render(); });
        view.setTextColor(GRAY);
    }

    private void account(boolean complete, boolean skip) {
        if (complete) { action("devices & sign out", () -> startActivity(new Intent(this, CloudActivity.class))); return; }
        // Account screens finish themselves once this phone is signed in, which brings the person back here.
        primary("link this phone", () -> startActivity(new Intent(this, CloudActivity.class).putExtra("setup", "link"))).setTag("setup_link_phone");
        body.addView(label("Shows a code. Type it on pocket-phone.vercel.app where you're signed in, or create the account there first.", PocketDesign.META, GRAY));
        action("sign in or create with email", () -> startActivity(new Intent(this, CloudActivity.class).putExtra("setup", "password")));
        later("account", skip, "use pocket without an account");
    }

    private void coros(boolean complete, boolean skip) {
        if (complete) { action("open movement", () -> startActivity(new Intent(this, MovementActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))); return; }
        if (coros.pending()) {
            body.addView(label(busy ? "Checking COROS sign-in…" : "Waiting for COROS sign-in", PocketDesign.BODY, WHITE));
            action("check sign-in", this::completeCoros).setEnabled(!busy);
            action("start again", this::connectCoros).setEnabled(!busy);
            return;
        }
        primary(busy ? "opening COROS…" : "connect COROS", this::connectCoros).setEnabled(!busy);
        later("coros", skip, "no COROS watch");
    }
    private void connectCoros() {
        if (busy) return; busy = true; render(); message("Opening COROS…");
        load(coros::begin, url -> { busy = false; render(); startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); },
                error -> { busy = false; render(); message(error.getMessage()); });
    }
    private void completeCoros() {
        if (busy || !visible || !coros.pending()) return; busy = true; render();
        load(coros::finish, complete -> {
            busy = false;
            if (complete) { expanded = ""; render(); message("COROS connected."); load(() -> coros.refresh(true), value -> { }, error -> { }); }
            else { render(); if (visible && coros.pending()) ui.postDelayed(claim, 3_000); }
        }, error -> { busy = false; render(); message(error.getMessage()); });
    }

    /** Two presets cover nearly everyone; every other provider stays in Pip's own settings. */
    private void pip(boolean complete, boolean skip) {
        LinearLayout choices = row(); Button[] tabs = new Button[2];
        EditText key = new EditText(this); key.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        PocketDesign.input(key); key.setSingleLine(true); key.setSaveEnabled(false);
        Button source = item("", () -> startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(provider == 1 ? "https://console.anthropic.com/settings/keys" : "https://openrouter.ai/settings/keys"))));
        source.setTextColor(GRAY);
        Runnable choose = () -> {
            for (int i = 0; i < 2; i++) PocketDesign.tab(tabs[i], i == provider);
            key.setHint(provider == 1 ? "sk-ant-…" : "sk-or-…");
            source.setText(provider == 1 ? "get a Claude key ↗" : "get a free OpenRouter key ↗");
        };
        String[] titles = {"OpenRouter free", "Claude"};
        for (int i = 0; i < 2; i++) {
            int index = i; tabs[i] = button(titles[i], () -> { provider = index; choose.run(); });
            LinearLayout.LayoutParams cell = new LinearLayout.LayoutParams(0, -2, 1); if (i > 0) cell.leftMargin = dp(4);
            choices.addView(tabs[i], cell);
        }
        LinearLayout.LayoutParams spacing = new LinearLayout.LayoutParams(-1, -2); spacing.bottomMargin = dp(8);
        body.addView(choices, spacing); body.addView(key, spacing); body.addView(source, new LinearLayout.LayoutParams(-1, -2));
        choose.run();
        body.addView(label("The key is encrypted on this phone and goes only to the provider. The web asks for it once per browser tab.", PocketDesign.META, GRAY));
        primary(complete ? "replace key" : "save key", () -> {
            String value = key.getText().toString().trim();
            if (value.isEmpty()) { message("Paste your API key."); return; }
            ChatProvider.Config config = provider == 1 ? ChatProvider.defaults("anthropic")
                    : new ChatProvider.Config("compatible", FREE_MODEL, OPENROUTER, 2048, false);
            // Like Pip's own settings: a reply in progress stops, and a chat started with another provider stays as it was.
            ClaudeChatRepository chats = ClaudeChatRepository.get(this); chats.stopAll();
            ChatProvider.save(this, config, value);
            if (!chats.acceptsProvider(config)) chats.newChat();
            key.setText(""); skip(this, "pip", false); expanded = ""; render(); message("Pip is ready.");
        });
        action("another provider", () -> startActivity(new Intent(this, MainActivity.class).putExtra("pocket_open_pip", true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)));
        if (!complete) later("pip", skip, "later");
    }
}
