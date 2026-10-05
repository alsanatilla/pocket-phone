package org.textphone.launcher;

import static org.junit.Assert.*;
import org.junit.Test;

public class StatusTextTest {
    @Test public void unavailableBatteryDoesNotInventAPercentage() {
        assertEquals("Battery unavailable", StatusText.battery(-1, 100, false));
        assertEquals("Battery unavailable", StatusText.battery(82, 0, false));
    }

    @Test public void batteryUsesTheReportedScaleAndChargingState() {
        assertEquals("Battery 82% · Charging", StatusText.battery(164, 200, true));
        assertEquals("Battery 15%", StatusText.battery(15, 100, false));
    }
}
