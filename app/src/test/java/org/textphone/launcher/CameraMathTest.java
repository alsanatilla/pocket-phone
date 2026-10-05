package org.textphone.launcher;

import static org.junit.Assert.*;
import android.graphics.Rect;
import android.util.Size;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = {24, 35})
public class CameraMathTest {
    @Test public void outputRotationTracksSensorAndDeviceForBothLenses() {
        assertEquals(90, CameraMath.orientation(90, 0, false));
        assertEquals(180, CameraMath.orientation(90, 90, false));
        assertEquals(270, CameraMath.orientation(90, 180, false));
        assertEquals(0, CameraMath.orientation(90, 270, false));
        assertEquals(0, CameraMath.orientation(90, 90, true));
        assertEquals(180, CameraMath.orientation(90, 270, true));
        assertEquals(270, CameraMath.orientation(270, -1, true));
        assertEquals(90, CameraMath.orientation(90, 44, false));
        assertEquals(180, CameraMath.orientation(90, 46, false));
    }
    @Test public void resolutionChoosesASupportedBoundedSizeAndDoesNotUpscale() {
        Size[] sizes = {new Size(4000, 3000), new Size(1920, 1080), new Size(2048, 1536), new Size(640, 480)};
        assertEquals(new Size(2048, 1536), CameraMath.chooseSize(sizes, 3_200_000, 4.0 / 3, false));
        assertEquals(new Size(640, 480), CameraMath.outputSize(640, 480, CameraProfile.FINE, 0));
        assertEquals(new Size(1536, 2048), CameraMath.outputSize(4000, 3000, CameraProfile.CYBER, 90));
        Rect crop = CameraMath.cropFourThree(1920, 1080);
        assertEquals(new Rect(240, 0, 1680, 1080), crop);
    }
    @Test public void focusMapsRotatedAndMirroredTouchPointsInsideTheSensorCrop() {
        Rect crop = new Rect(100, 200, 4100, 3200);
        Rect rear = CameraMath.metering(.25f, .75f, crop, 90, false);
        assertEquals(3100, rear.centerX()); assertEquals(2450, rear.centerY());
        Rect front = CameraMath.metering(.25f, .75f, crop, 90, true);
        assertEquals(3100, front.centerX()); assertEquals(950, front.centerY());
        for (int angle : new int[]{0, 90, 180, 270}) for (boolean mirror : new boolean[]{true, false}) {
            Rect edge = CameraMath.metering(-1, 2, crop, angle, mirror);
            assertTrue(crop.contains(edge)); assertTrue(edge.width() > 0 && edge.height() > 0);
        }
    }
}
