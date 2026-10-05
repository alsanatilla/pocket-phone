package org.textphone.launcher;

import android.Manifest;
import android.app.ActivityManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.ImageFormat;
import android.graphics.Rect;
import android.graphics.SurfaceTexture;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCaptureSession;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraDevice;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CaptureFailure;
import android.hardware.camera2.CaptureRequest;
import android.hardware.camera2.CaptureResult;
import android.hardware.camera2.TotalCaptureResult;
import android.hardware.camera2.params.MeteringRectangle;
import android.hardware.camera2.params.RggbChannelVector;
import android.hardware.camera2.params.StreamConfigurationMap;
import android.media.Image;
import android.media.ImageReader;
import android.net.Uri;
import android.os.Handler;
import android.os.Build;
import android.os.HandlerThread;
import android.os.Looper;
import android.util.Range;
import android.util.Rational;
import android.util.Size;
import android.view.Surface;
import java.util.Arrays;
import java.util.List;

/** Plain Camera2 capture. No extensions, night stack, scene HDR, beauty or intermediate JPEG. */
final class CameraEngine {
    enum Flash { AUTO, ON, OFF }
    interface Listener {
        void ready(Info info);
        void status(String message);
        void iso(Integer value);
        void focused(boolean success);
        void captured();
        void saved(Uri uri, Bitmap thumbnail);
        void failed(String message);
    }
    static final class Info {
        final boolean front, flash, autoFlash, switchable;
        final int sensor;
        final Size preview, capture;
        final Range<Integer> evRange;
        final Rational evStep;
        Info(boolean front, boolean flash, boolean autoFlash, boolean switchable, int sensor,
             Size preview, Size capture, Range<Integer> evRange, Rational evStep) {
            this.front = front; this.flash = flash; this.autoFlash = autoFlash; this.switchable = switchable;
            this.sensor = sensor; this.preview = preview; this.capture = capture;
            this.evRange = evRange; this.evStep = evStep;
        }
    }
    private static final int LIVE = 0, WAIT_FOCUS = 1, WAIT_PRE = 2, WAIT_EXPOSURE = 3, CAPTURING = 4;
    private final Context context;
    private final CameraPreview preview;
    private final Listener listener;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final HandlerThread thread = new HandlerThread("Pocket camera");
    private final Handler handler;
    private volatile boolean running, ready, busy, writing, released;
    private boolean opening;
    private volatile int generation;
    private boolean requestedFront;
    private volatile int evSteps;
    private volatile Flash flash = Flash.AUTO;
    private CameraDevice device;
    private CameraCaptureSession session;
    private CaptureRequest.Builder repeating;
    private ImageReader reader;
    private Surface surface;
    private CameraCharacteristics characteristics;
    private Info info;
    private Rect activeArray;
    private Rect latestCrop;
    private int phase;
    private Job job;
    private boolean tapPending;
    private int focusGeneration;
    private long lastIsoUpdate;

    private static final class Job {
        final CameraProfile profile;
        final int orientation;
        long taken = System.currentTimeMillis();
        long timestamp;
        YuvFrame frame;
        CompactProcessor.Conditions conditions;
        Job(CameraProfile profile, int orientation) { this.profile = profile; this.orientation = orientation; }
    }

    CameraEngine(Context context, CameraPreview preview, Listener listener) {
        this.context = context.getApplicationContext(); this.preview = preview; this.listener = listener;
        thread.start(); handler = new Handler(thread.getLooper());
    }
    boolean ready() { return ready && running; }
    boolean busy() { return busy; }
    int exposure() { return evSteps; }
    Flash flash() { return flash; }
    void setFlash(Flash value) { flash = value; updateControls(); }
    void setExposure(int value) { evSteps = value; updateControls(); }

    void start() {
        if (released) return;
        running = true;
        handler.post(() -> {
            if (!running || released || device != null || opening) return;
            open();
        });
    }
    void stop() { running = false; ready = false; handler.post(this::closeCamera); }
    void release() {
        running = false; ready = false; released = true;
        handler.post(() -> { closeCamera(); thread.quitSafely(); });
    }
    void switchCamera() {
        if (busy || info == null || !info.switchable) return;
        ready = false;
        handler.post(() -> {
            requestedFront = !info.front;
            closeCamera(); if (running) open();
        });
    }

    private void post(Runnable action) {
        int current = generation;
        ui.post(() -> { if (!released && running && current == generation) action.run(); });
    }
    private void failure(String message) {
        ready = false; busy = writing;
        post(() -> listener.failed(message));
    }

    private void open() {
        if (!running || released || opening || device != null || !preview.isAvailable()) return;
        if (context.checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            failure("Camera permission needed"); return;
        }
        try {
            CameraManager manager = (CameraManager) context.getSystemService(Context.CAMERA_SERVICE);
            if (manager == null) { failure("Camera unavailable"); return; }
            String rear = null, front = null;
            for (String id : manager.getCameraIdList()) {
                CameraCharacteristics c = manager.getCameraCharacteristics(id);
                Integer facing = c.get(CameraCharacteristics.LENS_FACING);
                if (facing != null && facing == CameraCharacteristics.LENS_FACING_BACK && rear == null) rear = id;
                if (facing != null && facing == CameraCharacteristics.LENS_FACING_FRONT && front == null) front = id;
            }
            String id = requestedFront ? front : rear;
            if (id == null) id = requestedFront ? rear : front;
            if (id == null) { failure("No camera available"); return; }
            characteristics = manager.getCameraCharacteristics(id);
            Integer facing = characteristics.get(CameraCharacteristics.LENS_FACING);
            boolean isFront = facing != null && facing == CameraCharacteristics.LENS_FACING_FRONT;
            StreamConfigurationMap map = characteristics.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP);
            if (map == null) { failure("Camera output unavailable"); return; }
            ActivityManager memory = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
            long maximum = memory != null && memory.getMemoryClass() >= 256 ? 6_200_000 : 3_200_000;
            Size capture = CameraMath.chooseSize(map.getOutputSizes(ImageFormat.YUV_420_888), maximum, 4.0 / 3, false);
            Size live = CameraMath.chooseSize(map.getOutputSizes(SurfaceTexture.class), 1_000_000,
                    (double) capture.getWidth() / capture.getHeight(), true);
            Integer sensor = characteristics.get(CameraCharacteristics.SENSOR_ORIENTATION);
            Boolean hasFlash = characteristics.get(CameraCharacteristics.FLASH_INFO_AVAILABLE);
            Range<Integer> range = characteristics.get(CameraCharacteristics.CONTROL_AE_COMPENSATION_RANGE);
            Rational step = characteristics.get(CameraCharacteristics.CONTROL_AE_COMPENSATION_STEP);
            info = new Info(isFront, Boolean.TRUE.equals(hasFlash),
                    supports(characteristics.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_MODES), CaptureRequest.CONTROL_AE_MODE_ON_AUTO_FLASH),
                    rear != null && front != null, sensor == null ? 90 : sensor, live, capture,
                    range == null ? new Range<>(0, 0) : range, step == null ? new Rational(0, 1) : step);
            evSteps = info.evRange.clamp(evSteps);
            activeArray = characteristics.get(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE);
            if (activeArray == null) activeArray = new Rect(0, 0, capture.getWidth(), capture.getHeight());
            latestCrop = null;
            int current = ++generation;
            opening = true;
            post(() -> listener.status("Opening camera"));
            manager.openCamera(id, new CameraDevice.StateCallback() {
                @Override public void onOpened(CameraDevice camera) {
                    if (!running || released || current != generation) { camera.close(); return; }
                    opening = false;
                    device = camera;
                    createSession(current);
                }
                @Override public void onDisconnected(CameraDevice camera) {
                    camera.close();
                    if (current == generation) { device = null; closeCamera(); failure("Camera disconnected. Retry camera."); }
                }
                @Override public void onError(CameraDevice camera, int error) {
                    camera.close();
                    if (current == generation) { device = null; closeCamera(); failure("Camera is busy or unavailable. Retry camera."); }
                }
            }, handler);
            handler.postDelayed(() -> { if (running && current == generation && opening) { closeCamera(); failure("Camera did not open. Retry camera."); } }, 5000);
        } catch (CameraAccessException | SecurityException | IllegalArgumentException error) {
            closeCamera(); failure("Camera unavailable. Retry camera.");
        }
    }

    private void createSession(int current) {
        try {
            SurfaceTexture texture = preview.getSurfaceTexture();
            if (texture == null) { closeCamera(); return; }
            texture.setDefaultBufferSize(info.preview.getWidth(), info.preview.getHeight());
            surface = new Surface(texture);
            reader = ImageReader.newInstance(info.capture.getWidth(), info.capture.getHeight(), ImageFormat.YUV_420_888, 2);
            reader.setOnImageAvailableListener(this::imageAvailable, handler);
            repeating = device.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);
            repeating.addTarget(surface); applyControls(repeating);
            device.createCaptureSession(Arrays.asList(surface, reader.getSurface()), new CameraCaptureSession.StateCallback() {
                @Override public void onConfigured(CameraCaptureSession configured) {
                    if (!running || current != generation || device == null) { configured.close(); return; }
                    session = configured;
                    try {
                        session.setRepeatingRequest(repeating.build(), results, handler);
                        ready = true; phase = LIVE;
                        Info active = info;
                        post(() -> listener.ready(active));
                    } catch (CameraAccessException | IllegalStateException error) {
                        closeCamera(); failure("Preview could not start. Retry camera.");
                    }
                }
                @Override public void onConfigureFailed(CameraCaptureSession configured) {
                    configured.close();
                    if (current == generation) { closeCamera(); failure("Camera stream unavailable. Retry camera."); }
                }
            }, handler);
            handler.postDelayed(() -> { if (running && current == generation && !ready) { closeCamera(); failure("Preview did not start. Retry camera."); } }, 5000);
        } catch (CameraAccessException | IllegalStateException | IllegalArgumentException error) {
            closeCamera(); failure("Camera stream unavailable. Retry camera.");
        }
    }

    private static boolean supports(int[] values, int value) {
        if (values == null) return false;
        for (int current : values) if (current == value) return true;
        return false;
    }
    private boolean canRequest(CaptureRequest.Key<?> key) {
        List<CaptureRequest.Key<?>> keys = characteristics.getAvailableCaptureRequestKeys();
        return keys != null && keys.contains(key);
    }
    private void applyControls(CaptureRequest.Builder request) {
        request.set(CaptureRequest.CONTROL_MODE, CaptureRequest.CONTROL_MODE_AUTO);
        request.set(CaptureRequest.CONTROL_SCENE_MODE, CaptureRequest.CONTROL_SCENE_MODE_DISABLED);
        request.set(CaptureRequest.CONTROL_EFFECT_MODE, CaptureRequest.CONTROL_EFFECT_MODE_OFF);
        if (Build.VERSION.SDK_INT >= 26 && canRequest(CaptureRequest.CONTROL_ENABLE_ZSL))
            request.set(CaptureRequest.CONTROL_ENABLE_ZSL, false);
        if (Build.VERSION.SDK_INT >= 30 && canRequest(CaptureRequest.CONTROL_EXTENDED_SCENE_MODE))
            request.set(CaptureRequest.CONTROL_EXTENDED_SCENE_MODE, CaptureRequest.CONTROL_EXTENDED_SCENE_MODE_DISABLED);
        request.set(CaptureRequest.CONTROL_AWB_MODE, CaptureRequest.CONTROL_AWB_MODE_AUTO);
        int[] af = characteristics.get(CameraCharacteristics.CONTROL_AF_AVAILABLE_MODES);
        int afMode = supports(af, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE)
                ? CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE
                : supports(af, CaptureRequest.CONTROL_AF_MODE_AUTO) ? CaptureRequest.CONTROL_AF_MODE_AUTO : CaptureRequest.CONTROL_AF_MODE_OFF;
        request.set(CaptureRequest.CONTROL_AF_MODE, afMode);
        int[] ae = characteristics.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_MODES);
        int aeMode = CaptureRequest.CONTROL_AE_MODE_ON;
        if (info.flash && flash == Flash.AUTO && info.autoFlash) aeMode = CaptureRequest.CONTROL_AE_MODE_ON_AUTO_FLASH;
        if (info.flash && flash == Flash.ON && supports(ae, CaptureRequest.CONTROL_AE_MODE_ON_ALWAYS_FLASH))
            aeMode = CaptureRequest.CONTROL_AE_MODE_ON_ALWAYS_FLASH;
        request.set(CaptureRequest.CONTROL_AE_MODE, aeMode);
        request.set(CaptureRequest.FLASH_MODE, CaptureRequest.FLASH_MODE_OFF);
        request.set(CaptureRequest.CONTROL_AE_EXPOSURE_COMPENSATION, info.evRange.clamp(evSteps));
        // Setting only advertised modes avoids demanding unsupported ISP controls on legacy cameras.
        if (canRequest(CaptureRequest.NOISE_REDUCTION_MODE)
                && supports(characteristics.get(CameraCharacteristics.NOISE_REDUCTION_AVAILABLE_NOISE_REDUCTION_MODES), CaptureRequest.NOISE_REDUCTION_MODE_OFF))
            request.set(CaptureRequest.NOISE_REDUCTION_MODE, CaptureRequest.NOISE_REDUCTION_MODE_OFF);
        if (canRequest(CaptureRequest.EDGE_MODE)
                && supports(characteristics.get(CameraCharacteristics.EDGE_AVAILABLE_EDGE_MODES), CaptureRequest.EDGE_MODE_OFF))
            request.set(CaptureRequest.EDGE_MODE, CaptureRequest.EDGE_MODE_OFF);
        if (canRequest(CaptureRequest.TONEMAP_MODE)
                && supports(characteristics.get(CameraCharacteristics.TONEMAP_AVAILABLE_TONE_MAP_MODES), CaptureRequest.TONEMAP_MODE_FAST))
            request.set(CaptureRequest.TONEMAP_MODE, CaptureRequest.TONEMAP_MODE_FAST);
        if (canRequest(CaptureRequest.STATISTICS_FACE_DETECT_MODE))
            request.set(CaptureRequest.STATISTICS_FACE_DETECT_MODE, CaptureRequest.STATISTICS_FACE_DETECT_MODE_OFF);
    }

    private void updateControls() {
        handler.post(() -> {
            if (!ready || busy || repeating == null || session == null) return;
            try { evSteps = info.evRange.clamp(evSteps); applyControls(repeating); session.setRepeatingRequest(repeating.build(), results, handler); }
            catch (CameraAccessException | IllegalStateException error) { closeCamera(); failure("Camera controls unavailable. Retry camera."); }
        });
    }

    void focus(float x, float y, int displayDegrees) {
        if (!ready || busy) return;
        handler.post(() -> {
            if (session == null || repeating == null || !ready || busy) return;
            try {
                Rect crop = latestCrop == null ? activeArray : latestCrop;
                Rect area = CameraMath.metering(x, y, crop,
                        CameraMath.previewRotation(info.sensor, displayDegrees, info.front), info.front);
                MeteringRectangle[] regions = {new MeteringRectangle(area, MeteringRectangle.METERING_WEIGHT_MAX)};
                Integer afRegions = characteristics.get(CameraCharacteristics.CONTROL_MAX_REGIONS_AF);
                Integer aeRegions = characteristics.get(CameraCharacteristics.CONTROL_MAX_REGIONS_AE);
                if (afRegions != null && afRegions > 0) repeating.set(CaptureRequest.CONTROL_AF_REGIONS, regions);
                if (aeRegions != null && aeRegions > 0) repeating.set(CaptureRequest.CONTROL_AE_REGIONS, regions);
                int[] modes = characteristics.get(CameraCharacteristics.CONTROL_AF_AVAILABLE_MODES);
                boolean auto = supports(modes, CaptureRequest.CONTROL_AF_MODE_AUTO);
                if (auto) repeating.set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_AUTO);
                if (auto || supports(modes, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE)) {
                    repeating.set(CaptureRequest.CONTROL_AF_TRIGGER, CaptureRequest.CONTROL_AF_TRIGGER_START);
                    session.capture(repeating.build(), results, handler);
                    repeating.set(CaptureRequest.CONTROL_AF_TRIGGER, CaptureRequest.CONTROL_AF_TRIGGER_IDLE);
                    tapPending = true; int focusRequest = ++focusGeneration;
                    handler.postDelayed(() -> { if (tapPending && focusRequest == focusGeneration) { tapPending = false; post(() -> listener.focused(false)); } }, 1600);
                }
                session.setRepeatingRequest(repeating.build(), results, handler);
            } catch (CameraAccessException | IllegalStateException error) { post(() -> listener.focused(false)); }
        });
    }

    void capture(CameraProfile profile, int deviceOrientation) {
        if (!ready || busy) return;
        busy = true;
        handler.post(() -> {
            if (!running || !ready || session == null) { busy = false; return; }
            job = new Job(profile, CameraMath.orientation(info.sensor, deviceOrientation, info.front));
            Job current = job;
            post(() -> listener.status("Focusing"));
            try {
                int[] modes = characteristics.get(CameraCharacteristics.CONTROL_AF_AVAILABLE_MODES);
                if (supports(modes, CaptureRequest.CONTROL_AF_MODE_AUTO)
                        || supports(modes, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE)) {
                    phase = WAIT_FOCUS;
                    repeating.set(CaptureRequest.CONTROL_AF_TRIGGER, CaptureRequest.CONTROL_AF_TRIGGER_START);
                    session.capture(repeating.build(), results, handler);
                    repeating.set(CaptureRequest.CONTROL_AF_TRIGGER, CaptureRequest.CONTROL_AF_TRIGGER_IDLE);
                    handler.postDelayed(() -> { if (job == current && phase == WAIT_FOCUS) preExposure(null); }, 950);
                } else preExposure(null);
                handler.postDelayed(() -> { if (job == current) captureFailed("Capture timed out. Try again."); }, 6500);
            } catch (CameraAccessException | IllegalStateException error) { captureFailed("Photo could not be captured"); }
        });
    }

    private final CameraCaptureSession.CaptureCallback results = new CameraCaptureSession.CaptureCallback() {
        @Override public void onCaptureProgressed(CameraCaptureSession session, CaptureRequest request, CaptureResult result) {
            if (session == CameraEngine.this.session && running) result(result);
        }
        @Override public void onCaptureCompleted(CameraCaptureSession session, CaptureRequest request, TotalCaptureResult result) {
            if (session == CameraEngine.this.session && running) result(result);
        }
        private void result(CaptureResult result) {
            Rect crop = result.get(CaptureResult.SCALER_CROP_REGION); if (crop != null) latestCrop = crop;
            if (System.currentTimeMillis() - lastIsoUpdate > 600) {
                lastIsoUpdate = System.currentTimeMillis(); Integer iso = result.get(CaptureResult.SENSOR_SENSITIVITY);
                post(() -> listener.iso(iso));
            }
            Integer focus = result.get(CaptureResult.CONTROL_AF_STATE);
            boolean locked = focus != null && (focus == CaptureResult.CONTROL_AF_STATE_FOCUSED_LOCKED
                    || focus == CaptureResult.CONTROL_AF_STATE_PASSIVE_FOCUSED);
            boolean failed = focus != null && focus == CaptureResult.CONTROL_AF_STATE_NOT_FOCUSED_LOCKED;
            if (tapPending && (locked || failed)) { tapPending = false; post(() -> listener.focused(locked)); }
            if (job == null) return;
            if (phase == WAIT_FOCUS && (focus == null || focus == CaptureResult.CONTROL_AF_STATE_FOCUSED_LOCKED || failed)) preExposure(result);
            else if (phase == WAIT_PRE) {
                Integer ae = result.get(CaptureResult.CONTROL_AE_STATE);
                if (ae == null || ae == CaptureResult.CONTROL_AE_STATE_PRECAPTURE || ae == CaptureResult.CONTROL_AE_STATE_FLASH_REQUIRED)
                    phase = WAIT_EXPOSURE;
            } else if (phase == WAIT_EXPOSURE) {
                Integer ae = result.get(CaptureResult.CONTROL_AE_STATE);
                if (ae == null || ae != CaptureResult.CONTROL_AE_STATE_PRECAPTURE) still();
            }
        }
    };

    private void preExposure(CaptureResult result) {
        if (job == null || session == null) return;
        Integer ae = result == null ? null : result.get(CaptureResult.CONTROL_AE_STATE);
        boolean needsFlash = info.flash && (flash == Flash.ON || (flash == Flash.AUTO
                && info.autoFlash && (ae == null || ae == CaptureResult.CONTROL_AE_STATE_FLASH_REQUIRED)));
        if (!needsFlash && (ae == null || ae == CaptureResult.CONTROL_AE_STATE_CONVERGED || ae == CaptureResult.CONTROL_AE_STATE_LOCKED)) { still(); return; }
        try {
            phase = WAIT_PRE;
            post(() -> listener.status("Metering"));
            repeating.set(CaptureRequest.CONTROL_AE_PRECAPTURE_TRIGGER, CaptureRequest.CONTROL_AE_PRECAPTURE_TRIGGER_START);
            session.capture(repeating.build(), results, handler);
            repeating.set(CaptureRequest.CONTROL_AE_PRECAPTURE_TRIGGER, CaptureRequest.CONTROL_AE_PRECAPTURE_TRIGGER_IDLE);
            Job current = job;
            handler.postDelayed(() -> { if (job == current && (phase == WAIT_PRE || phase == WAIT_EXPOSURE)) still(); }, 1400);
        } catch (CameraAccessException | IllegalStateException error) { captureFailed("Exposure metering failed"); }
    }

    private void still() {
        if (job == null || phase == CAPTURING || session == null || device == null) return;
        phase = CAPTURING;
        Job current = job;
        try {
            CaptureRequest.Builder photo = device.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE);
            applyControls(photo); photo.addTarget(reader.getSurface()); photo.addTarget(surface);
            if (info.flash && flash == Flash.ON
                    && !supports(characteristics.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_MODES), CaptureRequest.CONTROL_AE_MODE_ON_ALWAYS_FLASH))
                photo.set(CaptureRequest.FLASH_MODE, CaptureRequest.FLASH_MODE_SINGLE);
            session.capture(photo.build(), new CameraCaptureSession.CaptureCallback() {
                @Override public void onCaptureStarted(CameraCaptureSession session, CaptureRequest request, long timestamp, long number) {
                    if (job != current) return;
                    current.timestamp = timestamp;
                    current.taken = System.currentTimeMillis();
                    if (current.frame != null && current.frame.timestamp != timestamp) current.frame = null;
                    post(listener::captured);
                }
                @Override public void onCaptureCompleted(CameraCaptureSession session, CaptureRequest request, TotalCaptureResult result) {
                    if (job != current) return;
                    Integer iso = result.get(CaptureResult.SENSOR_SENSITIVITY);
                    Long exposure = result.get(CaptureResult.SENSOR_EXPOSURE_TIME);
                    Integer fired = result.get(CaptureResult.FLASH_STATE);
                    RggbChannelVector gains = result.get(CaptureResult.COLOR_CORRECTION_GAINS);
                    float cast = 0;
                    if (gains != null && gains.getRed() > 0 && gains.getBlue() > 0)
                        cast = (float) Math.log(gains.getBlue() / gains.getRed());
                    current.conditions = new CompactProcessor.Conditions(iso == null ? 0 : iso,
                            fired != null && fired == CaptureResult.FLASH_STATE_FIRED, exposure == null ? 0 : exposure, cast);
                    processIfReady();
                }
                @Override public void onCaptureFailed(CameraCaptureSession session, CaptureRequest request, CaptureFailure failure) {
                    if (job == current) captureFailed("Photo could not be captured");
                }
            }, handler);
        } catch (CameraAccessException | IllegalStateException error) { captureFailed("Photo could not be captured"); }
    }

    private void imageAvailable(ImageReader available) {
        if (available != reader || !running || released) return;
        try (Image image = available.acquireNextImage()) {
            if (image == null || job == null || phase != CAPTURING) return;
            if (job.timestamp != 0 && image.getTimestamp() != job.timestamp) return;
            job.frame = YuvFrame.copy(image);
            processIfReady();
        } catch (RuntimeException | OutOfMemoryError error) { captureFailed("Camera frame unavailable. Try again."); }
    }

    private void processIfReady() {
        if (job == null || job.frame == null || job.conditions == null) return;
        Job shot = job;
        if (shot.timestamp != 0 && shot.frame.timestamp != shot.timestamp) { shot.frame = null; return; }
        job = null; writing = true; resetPreview();
        post(() -> listener.status("Saving"));
        PhotoWriter.save(context, shot.frame, shot.profile, shot.orientation, shot.conditions, shot.taken, new PhotoWriter.Callback() {
            @Override public void saved(Uri uri, Bitmap thumbnail) {
                writing = false; busy = false;
                if (!released && running) { listener.saved(uri, thumbnail); updateControls(); }
                else if (thumbnail != null) thumbnail.recycle();
            }
            @Override public void failed(String message) {
                writing = false; busy = false;
                if (!released && running) { listener.failed(message); updateControls(); }
            }
        });
    }

    private void captureFailed(String message) {
        job = null; busy = false; resetPreview(); post(() -> listener.failed(message));
    }
    private void resetPreview() {
        phase = LIVE;
        if (session == null || repeating == null) return;
        try {
            repeating.set(CaptureRequest.CONTROL_AF_TRIGGER, CaptureRequest.CONTROL_AF_TRIGGER_CANCEL);
            session.capture(repeating.build(), null, handler);
            repeating.set(CaptureRequest.CONTROL_AF_TRIGGER, CaptureRequest.CONTROL_AF_TRIGGER_IDLE);
            repeating.set(CaptureRequest.CONTROL_AE_PRECAPTURE_TRIGGER, CaptureRequest.CONTROL_AE_PRECAPTURE_TRIGGER_IDLE);
            repeating.set(CaptureRequest.CONTROL_AF_REGIONS, null);
            repeating.set(CaptureRequest.CONTROL_AE_REGIONS, null);
            applyControls(repeating);
            session.setRepeatingRequest(repeating.build(), results, handler);
        } catch (CameraAccessException | IllegalStateException error) {
            closeCamera(); failure("Preview interrupted. Retry camera.");
        }
    }

    private void closeCamera() {
        generation++; ready = false; opening = false; tapPending = false; phase = LIVE;
        if (job != null) { job = null; busy = false; }
        if (session != null) { session.close(); session = null; }
        if (device != null) { device.close(); device = null; }
        if (reader != null) { reader.close(); reader = null; }
        if (surface != null) { surface.release(); surface = null; }
        repeating = null;
    }
}
