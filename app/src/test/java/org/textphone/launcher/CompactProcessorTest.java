package org.textphone.launcher;

import static org.junit.Assert.*;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.media.ExifInterface;
import java.io.File;
import java.io.FileOutputStream;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35)
public class CompactProcessorTest {
    private final CompactProcessor.Conditions daylight = new CompactProcessor.Conditions(100, false, 5_000_000, 0);
    @Test public void curvesHaveHardHighlightsAndShortShadowsWithoutReversingTones() {
        for (CameraProfile p : CameraProfile.values()) {
            int[] curve = CompactProcessor.toneCurve(p, false);
            assertEquals(0, curve[0]); assertEquals(0, curve[3]); assertEquals(255, curve[250]);
            for (int i = 1; i < curve.length; i++) assertTrue(p.label, curve[i] >= curve[i - 1]);
            int[] flash = CompactProcessor.toneCurve(p, true);
            for (int i = 1; i < flash.length; i++) assertTrue(flash[i] >= curve[i]);
        }
    }
    @Test public void profilesProduceDistinctRenderingAndRepeatableSeededNoise() {
        int[] source = new int[128 * 64];
        for (int i = 0; i < source.length; i++) source[i] = Color.rgb(40 + i % 160, 30 + i % 180, 20 + i % 210);
        Set<Integer> signatures = new HashSet<>();
        for (CameraProfile p : CameraProfile.values()) {
            int[] one = CompactProcessor.render(source, 128, 64, p, daylight, 42);
            assertArrayEquals(one, CompactProcessor.render(source, 128, 64, p, daylight, 42));
            assertFalse(Arrays.equals(one, CompactProcessor.render(source, 128, 64, p, daylight, 43)));
            signatures.add(Arrays.hashCode(one));
            for (int pixel : one) assertEquals(255, pixel >>> 24);
        }
        assertEquals(6, signatures.size());
    }
    private double variance(int[] pixels) {
        double total = 0, squared = 0;
        for (int pixel : pixels) { int g = (pixel >>> 8) & 255; total += g; squared += g * g; }
        return squared / pixels.length - Math.pow(total / pixels.length, 2);
    }
    @Test public void noiseIncreasesWithSensitivityAndDarknessAndWhiteBalanceDependsOnLighting() {
        int[] dark = new int[128 * 64], bright = new int[dark.length];
        Arrays.fill(dark, Color.rgb(40, 40, 40)); Arrays.fill(bright, Color.rgb(180, 180, 180));
        CompactProcessor.Conditions night = new CompactProcessor.Conditions(1600, false, 40_000_000, .8f);
        double dayNoise = variance(CompactProcessor.render(dark, 128, 64, CameraProfile.CYBER, daylight, 1));
        double nightNoise = variance(CompactProcessor.render(dark, 128, 64, CameraProfile.CYBER, night, 1));
        assertTrue(nightNoise > dayNoise * 3);
        assertTrue(nightNoise > variance(CompactProcessor.render(bright, 128, 64, CameraProfile.CYBER, night, 1)));
        int warm = CompactProcessor.render(bright, 128, 64, CameraProfile.POWER, night, 1)[0];
        int cool = CompactProcessor.render(bright, 128, 64, CameraProfile.POWER,
                new CompactProcessor.Conditions(1600, false, 40_000_000, -.8f), 1)[0];
        assertTrue(Color.red(warm) > Color.red(cool)); assertTrue(Color.blue(warm) < Color.blue(cool));
    }
    @Test
    @Config(sdk = 28)
    @GraphicsMode(GraphicsMode.Mode.NATIVE)
    public void nativeSamplingRotationJpegAndMetadataAreConsistent() throws Exception {
        Bitmap raw = Bitmap.createBitmap(400, 300, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(raw); Paint paint = new Paint();
        paint.setColor(Color.RED); canvas.drawRect(0, 0, 200, 150, paint);
        paint.setColor(Color.GREEN); canvas.drawRect(200, 0, 400, 150, paint);
        paint.setColor(Color.BLUE); canvas.drawRect(0, 150, 200, 300, paint);
        paint.setColor(Color.WHITE); canvas.drawRect(200, 150, 400, 300, paint);
        Bitmap portrait = CompactProcessor.process(raw, CameraProfile.CYBER, 90, daylight, 1);
        assertEquals(300, portrait.getWidth()); assertEquals(400, portrait.getHeight());
        assertTrue(Color.blue(portrait.getPixel(50, 50)) > 220);
        assertTrue(Color.red(portrait.getPixel(250, 50)) > 220);
        File output = File.createTempFile("pocket-native-jpeg", ".jpg");
        try {
            try (FileOutputStream stream = new FileOutputStream(output)) {
                assertTrue(portrait.compress(Bitmap.CompressFormat.JPEG, CameraProfile.CYBER.jpegQuality, stream));
            }
            PhotoWriter.addMetadata(output, 300, 400, CameraProfile.CYBER, daylight, 1_760_000_000_000L);
            ExifInterface exif = new ExifInterface(output.getAbsolutePath());
            assertEquals(ExifInterface.ORIENTATION_NORMAL, exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, -1));
            assertEquals("Pocket", exif.getAttribute(ExifInterface.TAG_MAKE));
            assertEquals(CameraProfile.CYBER.label, exif.getAttribute(ExifInterface.TAG_MODEL));
            Bitmap decoded = BitmapFactory.decodeFile(output.getAbsolutePath());
            assertEquals(300, decoded.getWidth()); assertEquals(400, decoded.getHeight()); decoded.recycle();
        } finally { portrait.recycle(); output.delete(); }
    }
    @Test
    @Config(sdk = 28)
    @GraphicsMode(GraphicsMode.Mode.NATIVE)
    public void yuvConversionHonorsPlanePaddingChromaStrideAndRange() {
        YuvFrame.Plane y = new YuvFrame.Plane(new byte[]{16, 16, 99, 99, (byte)235, (byte)235}, 4, 1);
        YuvFrame.Plane u = new YuvFrame.Plane(new byte[]{(byte)128, 88}, 2, 2);
        YuvFrame.Plane v = new YuvFrame.Plane(new byte[]{(byte)128, 99}, 2, 2);
        Bitmap image = new YuvFrame(2, 2, 0, y, u, v, false, false).bitmap();
        assertEquals(Color.BLACK, image.getPixel(0, 0)); assertEquals(Color.WHITE, image.getPixel(1, 1)); image.recycle();
        YuvFrame.Plane full = new YuvFrame.Plane(new byte[]{0, 0, (byte)255, (byte)255}, 2, 1);
        image = new YuvFrame(2, 2, 0, full, u, v, true, true).bitmap();
        assertEquals(Color.BLACK, image.getPixel(1, 0)); assertEquals(Color.WHITE, image.getPixel(0, 1)); image.recycle();
    }
}
