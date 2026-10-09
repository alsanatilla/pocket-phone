package org.textphone.launcher;

import static org.junit.Assert.*;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class MovementFitTest {
    @Test public void bothByteOrdersDecodeGpsAscentAndRunningChannels() throws Exception {
        for (boolean little : new boolean[]{true, false}) {
            JSONObject fit = MovementFit.parse(file(little, 1000, false, true, false), true), series = fit.getJSONObject("series");
            assertEquals(102, fit.getDouble("climb"), 0); assertNotNull(fit.optJSONObject("path")); assertEquals("km", series.getString("unit")); assertTrue(series.getJSONArray("x").length() <= 200);
            assertEquals(333, series.getJSONArray("pace").getDouble(0), 0); assertEquals(170, series.getJSONArray("cadence").getDouble(0), 0); assertEquals(250, series.getJSONArray("contact").getDouble(0), 0);
            assertEquals(85, series.getJSONArray("oscillation").getDouble(0), 0); assertEquals(7.2, series.getJSONArray("ratio").getDouble(0), .001); assertEquals(1180, series.getJSONArray("step").getDouble(0), 0); assertEquals(100, series.getJSONArray("altitude").getDouble(0), 0);
            assertEquals(140, series.getJSONArray("hrBands").getJSONObject(0).getInt("from")); assertEquals(1, series.getJSONArray("hrBands").getJSONObject(0).getDouble("share"), 0);
            assertEquals(85, MovementFit.parse(file(little, 10, false, true, false), false).getJSONObject("series").getJSONArray("cadence").getDouble(0), 0);
        }
    }
    @Test public void enhancedMetricsOverrideStandardAndCompressedTimeRollsForward() throws Exception {
        JSONObject series = MovementFit.parse(file(true, 10, true, false, true), true).getJSONObject("series");
        assertEquals("min", series.getString("unit")); assertTrue(series.getJSONArray("x").getDouble(0) < series.getJSONArray("x").getDouble(series.getJSONArray("x").length() - 1));
        assertEquals(286, series.getJSONArray("pace").getDouble(0), 0); assertEquals(200, series.getJSONArray("altitude").getDouble(0), 0);
    }
    @Test public void corruptAndUndefinedMessagesFailInsteadOfReturningMadeUpReadings() throws Exception {
        byte[] full = file(true, 5, false, true, false);
        for (byte[] invalid : new byte[][]{new byte[20], Arrays.copyOf(full, 18), Arrays.copyOf(full, full.length - 1)}) {
            try { MovementFit.parse(invalid, true); fail("Expected incomplete FIT error"); } catch (IOException expected) { }
        }
        byte[] undefined = header(new byte[]{0}); try { MovementFit.parse(undefined, true); fail("Expected undefined record error"); } catch (IOException expected) { }
    }
    @Test public void absentSentinelsAreGapsAndGpsCanBeMissingEntirely() throws Exception {
        byte[] source = file(true, 4, false, true, false);
        int firstRecord = 14 + 6 + 15 * 3;
        // timestamp, lat, lon are followed by HR; missing GPS and HR sentinels cannot turn into routes or spikes.
        for (int i = 0; i < 4; i++) { int at = firstRecord + i * 41; Arrays.fill(source, at + 5, at + 13, (byte) 0xFF); source[at + 8] = 0x7F; source[at + 12] = 0x7F; source[at + 13] = (byte) 0xFF; }
        JSONObject fit = MovementFit.parse(source, true); assertNull(fit.optJSONObject("path")); assertFalse(fit.getJSONObject("series").has("hr")); assertEquals(0, fit.getJSONObject("series").getJSONArray("hrBands").length());
    }
    @Test public void routeBoundsHandleLongTracksStraightLinesAndDateLine() throws Exception {
        List<double[]> track = new ArrayList<>(); for (int i = 0; i < 2000; i++) track.add(new double[]{48 + Math.sin(i / 300.0) / 100, 11 + i / 50000.0});
        checkRoute(MovementFit.route(track));
        checkRoute(MovementFit.route(Arrays.asList(new double[]{48,11}, new double[]{48,11.01})));
        checkRoute(MovementFit.route(Arrays.asList(new double[]{48,11}, new double[]{48.01,11})));
        checkRoute(MovementFit.route(Arrays.asList(new double[]{48,179.99}, new double[]{48.01,-179.99})));
        assertNull(MovementFit.route(Arrays.asList(new double[]{48,11}, new double[]{48,11})));
    }
    private void checkRoute(JSONObject route) throws Exception {
        assertNotNull(route); String[] points = route.getString("d").replaceAll("[ML]", " ").trim().split("\\s+"); assertTrue(points.length <= 1002);
        for (int i = 0; i < points.length; i++) { double n = Double.parseDouble(points[i]); assertTrue(n >= 0 && n <= (i % 2 == 0 ? 320 : 190)); }
        JSONArray start = route.getJSONArray("start"); assertEquals(Double.parseDouble(points[0]), start.getDouble(0), .01);
    }
    static byte[] file(boolean little, int count, boolean compressed, boolean distance, boolean enhanced) {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        int[][] fields = {{253,4,134},{0,4,133},{1,4,133},{3,1,2},{5,4,134},{78,4,134},{2,2,132},{73,4,134},{6,2,132},{4,1,2},{7,2,132},{41,2,132},{39,2,132},{83,2,132},{85,2,132}};
        b.write(0x40); b.write(0); b.write(little ? 0 : 1); number(b,20,2,little); b.write(fields.length);
        for (int[] f : fields) for (int v : f) b.write(v);
        for (int i = 0; i < count; i++) {
            boolean shortTime = compressed && i > 0; int timestamp = 1000 + i * 10; b.write(shortTime ? 0x80 | timestamp & 31 : 0);
            for (int[] f : fields) {
                if (shortTime && f[0] == 253) continue;
                long value;
                switch(f[0]) { case 253: value=timestamp;break; case 0: value=Math.round((50+i*.00001)*2147483648.0/180);break; case 1: value=Math.round((10+i*.00002)*2147483648.0/180);break; case 3:value=140+i%2;break; case 5:value=distance?i*300:0xFFFFFFFFL;break;
                    case 78:value=enhanced?3500:0xFFFFFFFFL;break;case 2:value=3000;break;case 73:value=enhanced?3500:0xFFFFFFFFL;break;case 6:value=3000;break;case 4:value=85;break;case 7:value=200;break;case 41:value=2500;break;case 39:value=850;break;case 83:value=720;break;case 85:value=11800;break;default:value=0; }
                number(b,value,f[1],little);
            }
        }
        b.write(0x61);b.write(0);b.write(little?0:1);number(b,18,2,little);b.write(1);b.write(22);b.write(2);b.write(132);b.write(1);b.write(0);b.write(2);b.write(0);
        b.write(1);number(b,102,2,little);b.write(9);b.write(9); return header(b.toByteArray());
    }
    private static void number(ByteArrayOutputStream b,long value,int size,boolean little) { for(int i=0;i<size;i++) b.write((int)(value >> (little?i:size-1-i)*8)&255); }
    private static byte[] header(byte[] body) { ByteArrayOutputStream b=new ByteArrayOutputStream();b.write(14);b.write(0x20);b.write(0);b.write(0);number(b,body.length,4,true);for(byte c:new byte[]{'.','F','I','T',0,0})b.write(c);b.write(body,0,body.length);return b.toByteArray(); }
}
