package org.textphone.launcher;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.SurfaceTexture;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.RippleDrawable;
import android.content.res.ColorStateList;
import android.hardware.SensorManager;
import android.media.MediaActionSound;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.view.HapticFeedbackConstants;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.OrientationEventListener;
import android.view.TextureView;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.util.Size;
import java.util.Locale;

/** The launcher's built-in camera; no additional app, editor or account. */
public final class CompactCameraActivity extends Activity implements CameraEngine.Listener {
    private static final int CAMERA_PERMISSION = 81, STORAGE_PERMISSION = 82;
    private static final int PRIMARY = PocketDesign.WHITE, SECONDARY = PocketDesign.MUTED;
    private int ACCENT;
    private CameraPreview preview;
    private FocusOverlay focus;
    private CameraEngine engine;
    private CameraEngine.Info info;
    private CameraProfile profile;private LinearLayout cameraOptions;private AlertDialog cameraSettingsDialog;
    private SharedPreferences preferences;
    private TextView quality, iso, status, message, ev;
    private Button profileButton, switchButton, flashButton, minus, plus, shutter, allow, settings;
    private ImageButton gallery;
    private Bitmap thumbnail;
    private Uri lastPhoto;
    private OrientationEventListener orientation;
    private MediaActionSound sound;
    private int deviceOrientation;
    private float tapX = -1, tapY = -1;
    private boolean resumed, awaitingStorageShot;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        ACCENT = PocketDesign.accent(this);
        preferences = getSharedPreferences("pocket_camera", MODE_PRIVATE);
        profile = CameraProfile.fromName(preferences.getString("profile", CameraProfile.CYBER.name()));
        String last = preferences.getString("last_photo", null);
        if (last != null) lastPhoto = Uri.parse(last);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setNavigationBarColor(Color.BLACK);
        if (Build.VERSION.SDK_INT >= 29) getWindow().setNavigationBarContrastEnforced(false);
        buildScreen();
        engine = new CameraEngine(this, preview, this);
        engine.setFlash(flashPreference());
        engine.setExposure(preferences.getInt("ev", 0));
        sound = new MediaActionSound();
        orientation = new OrientationEventListener(this, SensorManager.SENSOR_DELAY_NORMAL) {
            @Override public void onOrientationChanged(int angle) {
                if (angle != ORIENTATION_UNKNOWN) deviceOrientation = angle;
            }
        };
        preview.setSurfaceTextureListener(new TextureView.SurfaceTextureListener() {
            @Override public void onSurfaceTextureAvailable(SurfaceTexture surface, int width, int height) { openCamera(); }
            @Override public void onSurfaceTextureSizeChanged(SurfaceTexture surface, int width, int height) { configurePreview(); }
            @Override public boolean onSurfaceTextureDestroyed(SurfaceTexture surface) { engine.stop(); return true; }
            @Override public void onSurfaceTextureUpdated(SurfaceTexture surface) {}
        });
        refreshControls();
    }

    @Override protected void onResume() {
        super.onResume(); resumed = true;
        if (orientation.canDetectOrientation()) orientation.enable();
        String latest = preferences.getString("last_photo", null);
        if (latest != null) lastPhoto = Uri.parse(latest);
        gallery.setEnabled(lastPhoto != null);
        if (hasCameraPermission()) openCamera();
        else {
            showPermission();
        }
    }
    @Override protected void onPause() {
        resumed = false; orientation.disable(); engine.stop();
        if(cameraSettingsDialog!=null)cameraSettingsDialog.dismiss();super.onPause();
    }
    @Override protected void onDestroy() {
        engine.release(); sound.release();
        if (thumbnail != null) thumbnail.recycle();
        super.onDestroy();
    }
    private boolean hasCameraPermission() { return checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED; }
    private CameraEngine.Flash flashPreference() {
        try { return CameraEngine.Flash.valueOf(preferences.getString("flash", "AUTO")); }
        catch (IllegalArgumentException ignored) { return CameraEngine.Flash.AUTO; }
    }
    private int dp(float value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    private TextView text(String value, int sp, int color) {
        TextView view = new TextView(this); view.setText(value); PocketDesign.text(view, sp, color);
        return view;
    }
    private Button button(String value, int sp, Runnable callback) {
        Button button = new Button(this);
        button.setText(value); PocketDesign.text(button, sp, PRIMARY); PocketDesign.control(button);
        button.setOnClickListener(view -> callback.run());
        return button;
    }
    private void buildScreen() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL); root.setBackgroundColor(Color.BLACK);
        root.setPadding(dp(PocketDesign.INSET), dp(4), dp(PocketDesign.INSET), dp(4));
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            int left, top, right, bottom;
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets safe = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                left = safe.left; top = safe.top; right = safe.right; bottom = safe.bottom;
            } else {
                left = insets.getSystemWindowInsetLeft(); top = insets.getSystemWindowInsetTop();
                right = insets.getSystemWindowInsetRight(); bottom = insets.getSystemWindowInsetBottom();
            }
            view.setPadding(dp(PocketDesign.INSET) + left, dp(4) + top, dp(PocketDesign.INSET) + right, dp(4) + bottom);
            return insets.consumeSystemWindowInsets();
        });
        setContentView(root); root.requestApplyInsets();
        LinearLayout header = new LinearLayout(this);
        header.setGravity(Gravity.CENTER_VERTICAL);
        Button back = button("back", 14, this::finish); PocketDesign.quiet(back, SECONDARY);
        header.setTag("page_header");PocketDesign.headerControl(back,SECONDARY);header.addView(back, new LinearLayout.LayoutParams(dp(64), PocketDesign.headerHeight(this)));
        TextView title = text("camera", 24, PRIMARY);
        title.setTypeface(PocketFonts.pixel(this));
        title.setGravity(Gravity.CENTER);
        header.addView(title, new LinearLayout.LayoutParams(0, PocketDesign.headerHeight(this), 1));
        switchButton = button("rear", 14, () -> {
            if (engine != null && !engine.busy()) { engine.switchCamera(); setBusy(true); }
        });
        switchButton.setTag("camera_switch"); switchButton.setContentDescription("Switch front and rear cameras");
        PocketDesign.quiet(switchButton, SECONDARY); PocketDesign.header(header);
        PocketDesign.headerControl(switchButton,SECONDARY);header.addView(switchButton, new LinearLayout.LayoutParams(dp(64), PocketDesign.headerHeight(this)));
        root.addView(header);

        cameraOptions=new LinearLayout(this);cameraOptions.setOrientation(LinearLayout.VERTICAL);cameraOptions.setPadding(dp(16),dp(8),dp(16),dp(8));
        LinearLayout selector = new LinearLayout(this); selector.setGravity(Gravity.CENTER_VERTICAL);
        profileButton = button(profile.label + "  v", 16, this::chooseProfile);
        profileButton.setTag("camera_profile"); profileButton.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
        PocketDesign.quiet(profileButton, ACCENT);
        selector.addView(profileButton, new LinearLayout.LayoutParams(0, dp(56), 1));
        quality = text("JPEG", 11, SECONDARY); quality.setGravity(Gravity.END | Gravity.CENTER_VERTICAL);
        selector.addView(quality, new LinearLayout.LayoutParams(-2, dp(48))); cameraOptions.addView(selector);

        FrameLayout finder = new FrameLayout(this); finder.setTag("camera_finder"); finder.setBackgroundColor(0xFF080808);
        preview = new CameraPreview(this); preview.setTag("camera_preview");
        preview.setContentDescription("Camera viewfinder. Tap to focus and meter exposure.");
        finder.addView(preview, new FrameLayout.LayoutParams(-1, -1, Gravity.CENTER));
        focus = new FocusOverlay(this);
        finder.addView(focus, new FrameLayout.LayoutParams(-1, -1, Gravity.CENTER));
        preview.addOnLayoutChangeListener((view, l, t, r, b, oldL, oldT, oldR, oldB) -> {
            FrameLayout.LayoutParams layout = (FrameLayout.LayoutParams) focus.getLayoutParams();
            if (layout.width != r - l || layout.height != b - t) {
                layout.width = r - l; layout.height = b - t; focus.setLayoutParams(layout);
            }
        });
        preview.setOnTouchListener((view, event) -> {
            if (event.getAction() != MotionEvent.ACTION_UP) return true;
            tapX = event.getX(); tapY = event.getY();
            view.performClick();
            tapX = tapY = -1;
            return true;
        });
        preview.setOnClickListener(view -> {
            if (engine != null && engine.ready() && !engine.busy()) {
                float x = tapX < 0 ? preview.getWidth() / 2f : tapX;
                float y = tapY < 0 ? preview.getHeight() / 2f : tapY;
                focus.focus(x, y);
                engine.focus(x / preview.getWidth(), y / preview.getHeight(), displayRotation() * 90);
            }
        });
        LinearLayout prompt = new LinearLayout(this); prompt.setOrientation(LinearLayout.VERTICAL); prompt.setGravity(Gravity.CENTER);
        message = text("", 14, PRIMARY); message.setGravity(Gravity.CENTER); prompt.addView(message);
        allow = button("Allow camera", 15, () -> {
            if (hasCameraPermission()) { engine.stop(); openCamera(); }
            else askPermission();
        });
        allow.setTag("camera_allow"); PocketDesign.primary(allow); prompt.addView(allow, new LinearLayout.LayoutParams(dp(200), dp(56)));
        settings = button("Open settings", 14, () -> startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:" + getPackageName()))));
        LinearLayout.LayoutParams settingLayout = new LinearLayout.LayoutParams(dp(200), dp(52)); settingLayout.topMargin = dp(8); prompt.addView(settings, settingLayout);
        finder.addView(prompt, new FrameLayout.LayoutParams(-1, -2, Gravity.CENTER));
        root.addView(finder, new LinearLayout.LayoutParams(-1, 0, 1));

        LinearLayout metadata = new LinearLayout(this); metadata.setGravity(Gravity.CENTER_VERTICAL);
        iso = text("ISO —", 11, SECONDARY);
        metadata.addView(iso, new LinearLayout.LayoutParams(dp(70), dp(28)));
        status = text("", 12, SECONDARY); status.setGravity(Gravity.END | Gravity.CENTER_VERTICAL);
        status.setMinHeight(dp(28)); status.setMaxLines(2);
        status.setEllipsize(android.text.TextUtils.TruncateAt.END);
        status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        metadata.addView(status, new LinearLayout.LayoutParams(0, -2, 1)); root.addView(metadata);

        LinearLayout exposure = new LinearLayout(this); exposure.setGravity(Gravity.CENTER_VERTICAL);
        flashButton = button("FLASH AUTO", 13, this::cycleFlash); flashButton.setTag("camera_flash");
        exposure.addView(flashButton, new LinearLayout.LayoutParams(0, dp(48), 1));
        minus = button("−", 22, () -> changeExposure(-1)); minus.setContentDescription("Reduce exposure");
        exposure.addView(minus, new LinearLayout.LayoutParams(dp(48), dp(48)));
        ev = text("EV 0.0", 13, PRIMARY); ev.setGravity(Gravity.CENTER);
        exposure.addView(ev, new LinearLayout.LayoutParams(dp(80), dp(48)));
        plus = button("+", 22, () -> changeExposure(1)); plus.setContentDescription("Increase exposure");
        exposure.addView(plus, new LinearLayout.LayoutParams(dp(48), dp(48))); cameraOptions.addView(exposure);

        LinearLayout actions = new LinearLayout(this); actions.setGravity(Gravity.CENTER_VERTICAL);
        gallery = new ImageButton(this); gallery.setTag("camera_gallery");
        gallery.setBackgroundColor(Color.BLACK); gallery.setScaleType(android.widget.ImageView.ScaleType.CENTER_INSIDE);
        gallery.setImageResource(R.drawable.ic_camera_photo); gallery.setPadding(dp(10), dp(8), dp(10), dp(8));
        gallery.setContentDescription("Open last photo"); gallery.setOnClickListener(view -> openPhoto());
        actions.addView(gallery, new LinearLayout.LayoutParams(dp(64), dp(64)));
        LinearLayout center = new LinearLayout(this); center.setGravity(Gravity.CENTER);
        shutter = button("shoot", 26, this::shoot); shutter.setTag("camera_shutter");
        shutter.setContentDescription("Take photo");
        shutter.setTypeface(PocketFonts.pixel(this));
        PocketDesign.primary(shutter);
        shutter.setTextSize(PocketDesign.typeSize(this, PocketDesign.TITLE));
        center.addView(shutter, new LinearLayout.LayoutParams(dp(112), dp(56)));
        actions.addView(center, new LinearLayout.LayoutParams(0, dp(64), 1));
        Button settings=button("Settings",14,this::cameraSettings);settings.setTag("app_settings");PocketDesign.quiet(settings,SECONDARY);actions.addView(settings,new LinearLayout.LayoutParams(dp(96),dp(56))); root.addView(actions);
    }
    private void cameraSettings(){if(cameraOptions.getParent() instanceof android.view.ViewGroup)((android.view.ViewGroup)cameraOptions.getParent()).removeView(cameraOptions);cameraSettingsDialog=new AlertDialog.Builder(this).setTitle("Camera settings").setView(cameraOptions).setPositiveButton("Close",null).create();cameraSettingsDialog.show();}

    private void askPermission() {
        preferences.edit().putBoolean("permission_asked", true).apply();
        requestPermissions(new String[]{Manifest.permission.CAMERA}, CAMERA_PERMISSION);
    }
    private void showPermission() {
        message.setText(R.string.camera_permission_needed); message.setVisibility(View.VISIBLE);
        allow.setText(R.string.camera_allow); allow.setVisibility(View.VISIBLE); settings.setVisibility(View.VISIBLE);
        status.setText(""); setBusy(true);
    }
    private void openCamera() {
        if (!resumed || engine == null || !hasCameraPermission() || !preview.isAvailable()) return;
        message.setVisibility(View.GONE); allow.setVisibility(View.GONE); settings.setVisibility(View.GONE);
        status.setText(R.string.camera_opening); engine.start();
    }
    private int displayRotation() { return getWindowManager().getDefaultDisplay().getRotation(); }
    private void configurePreview() {
        if (info != null) preview.configure(info.preview, info.sensor, displayRotation(), info.front);
    }

    private void chooseProfile() {
        if (engine != null && engine.busy()) return;
        CameraProfile[] profiles = CameraProfile.values();
        String[] labels = new String[profiles.length];
        for (int i = 0; i < profiles.length; i++) labels[i] = profiles[i].label + " · " + profiles[i].family;
        new AlertDialog.Builder(this).setTitle("Camera profile")
                .setSingleChoiceItems(labels, profile.ordinal(), (dialog, which) -> {
                    profile = profiles[which]; preferences.edit().putString("profile", profile.name()).apply();
                    refreshControls(); dialog.dismiss();
                }).setNegativeButton("Cancel", null).show();
    }
    private void refreshControls() {
        profileButton.setText(getString(R.string.camera_profile_label, profile.label));
        Size output = info == null ? new Size(profile.width, profile.height)
                : CameraMath.outputSize(info.capture.getWidth(), info.capture.getHeight(), profile, 0);
        quality.setText(String.format(Locale.getDefault(), "%.1fM JPEG", output.getWidth() * output.getHeight() / 1_000_000f));
        CameraEngine.Flash mode = engine == null ? flashPreference() : engine.flash();
        flashButton.setText(info != null && !info.flash ? "FLASH —" : "FLASH " + mode.name());
        flashButton.setContentDescription(info != null && !info.flash ? "Flash unavailable on this camera"
                : "Flash " + mode.name().toLowerCase(Locale.ROOT));
        float step = info == null ? 1f / 3 : info.evStep.floatValue();
        ev.setText(String.format(Locale.getDefault(), "EV %+.1f", (engine == null ? 0 : engine.exposure()) * step));
        boolean active = engine != null && engine.ready() && !engine.busy();
        minus.setEnabled(active && info != null && engine.exposure() > info.evRange.getLower());
        plus.setEnabled(active && info != null && engine.exposure() < info.evRange.getUpper());
        flashButton.setEnabled(active && info != null && info.flash);
        switchButton.setEnabled(active && info != null && info.switchable);
        shutter.setEnabled(active); profileButton.setEnabled(engine == null || !engine.busy());
        gallery.setEnabled(lastPhoto != null);
    }
    private void cycleFlash() {
        if (info == null || !info.flash || engine.busy()) return;
        CameraEngine.Flash current = engine.flash();
        CameraEngine.Flash next = current == CameraEngine.Flash.AUTO ? CameraEngine.Flash.ON
                : current == CameraEngine.Flash.ON ? CameraEngine.Flash.OFF
                : info.autoFlash ? CameraEngine.Flash.AUTO : CameraEngine.Flash.ON;
        engine.setFlash(next); preferences.edit().putString("flash", next.name()).apply(); refreshControls();
    }
    private void changeExposure(int delta) {
        if (info == null || engine.busy()) return;
        int next = info.evRange.clamp(engine.exposure() + delta);
        engine.setExposure(next); preferences.edit().putInt("ev", next).apply(); refreshControls();
    }
    private void shoot() {
        if (engine == null || !engine.ready() || engine.busy()) return;
        if (Build.VERSION.SDK_INT <= 28 && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            awaitingStorageShot = true;
            requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, STORAGE_PERMISSION); return;
        }
        shutter.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY);
        engine.capture(profile, deviceOrientation); setBusy(true);
    }
    private void setBusy(boolean busy) {
        shutter.setEnabled(!busy); profileButton.setEnabled(!busy);
        switchButton.setEnabled(!busy && info != null && info.switchable);
        flashButton.setEnabled(!busy && info != null && info.flash);
        minus.setEnabled(!busy && info != null && engine.exposure() > info.evRange.getLower());
        plus.setEnabled(!busy && info != null && engine.exposure() < info.evRange.getUpper());
    }
    private void openPhoto() {
        if (lastPhoto == null) return;
        try { startActivity(new Intent(this, FilesActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).setAction(Intent.ACTION_VIEW).setDataAndType(lastPhoto, "image/jpeg")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)); }
        catch (ActivityNotFoundException | SecurityException error) { status.setText(R.string.camera_no_viewer); }
    }
    @Override public void startActivity(Intent intent) { PocketLaunch.open(this, intent, intent.getComponent() != null && FilesActivity.class.getName().equals(intent.getComponent().getClassName()) ? gallery : null); }

    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request, permissions, results);
        boolean granted = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
        if (request == CAMERA_PERMISSION) { if (granted) openCamera(); else showPermission(); }
        if (request == STORAGE_PERMISSION) {
            if (granted && awaitingStorageShot && engine.ready()) { awaitingStorageShot = false; shoot(); }
            else if (!granted) { awaitingStorageShot = false; status.setText(R.string.camera_storage_needed); }
        }
    }
    @Override public boolean onKeyDown(int key, KeyEvent event) {
        if (key == KeyEvent.KEYCODE_VOLUME_UP || key == KeyEvent.KEYCODE_VOLUME_DOWN || key == KeyEvent.KEYCODE_CAMERA) return true;
        return super.onKeyDown(key, event);
    }
    @Override public boolean onKeyUp(int key, KeyEvent event) {
        if (key == KeyEvent.KEYCODE_VOLUME_UP || key == KeyEvent.KEYCODE_VOLUME_DOWN || key == KeyEvent.KEYCODE_CAMERA) {
            if (!event.isCanceled()) shoot(); return true;
        }
        return super.onKeyUp(key, event);
    }

    @Override public void ready(CameraEngine.Info info) {
        if (!resumed) return;
        this.info = info;
        if (info.flash && engine.flash() == CameraEngine.Flash.AUTO && !info.autoFlash) engine.setFlash(CameraEngine.Flash.OFF);
        switchButton.setText(info.front ? "front" : "rear");
        configurePreview(); message.setVisibility(View.GONE); allow.setVisibility(View.GONE); settings.setVisibility(View.GONE);
        status.setText(R.string.camera_ready); refreshControls();
        if (awaitingStorageShot) { awaitingStorageShot = false; shoot(); }
    }
    @Override public void status(String value) { if (resumed) { status.setText(value); refreshControls(); } }
    @Override public void iso(Integer value) { if (resumed) iso.setText(value == null ? "ISO —" : "ISO " + value); }
    @Override public void focused(boolean success) { if (resumed) focus.result(success); }
    @Override public void captured() { if (resumed) sound.play(MediaActionSound.SHUTTER_CLICK); }
    @Override public void saved(Uri uri, Bitmap thumb) {
        lastPhoto = uri; if (thumbnail != null) thumbnail.recycle(); thumbnail = thumb;
        if (thumb == null) gallery.setImageResource(R.drawable.ic_camera_photo); else gallery.setImageBitmap(thumb);
        status.setText(R.string.camera_saved); refreshControls();
    }
    @Override public void failed(String value) {
        if (!resumed) return;
        status.setText(value); refreshControls();
        if (!engine.ready()) {
            message.setText(value); message.setVisibility(View.VISIBLE);
            allow.setText(R.string.camera_retry); allow.setVisibility(View.VISIBLE);
            settings.setVisibility(hasCameraPermission() ? View.GONE : View.VISIBLE);
        }
    }
}
