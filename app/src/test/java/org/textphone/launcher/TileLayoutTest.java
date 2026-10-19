package org.textphone.launcher;

import static org.junit.Assert.*;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

/** The browser's tile-layout.test.mjs runs the same cases, so both boards place, move and resize tiles alike. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35)
public class TileLayoutTest {
    private static JSONObject cases() throws Exception {
        return new JSONObject(new String(Files.readAllBytes(Paths.get("..", "tools", "fixtures", "tile-layout-cases.json")), StandardCharsets.UTF_8));
    }
    private static List<String> strings(JSONArray array) throws Exception {
        List<String> out = new ArrayList<>(); for (int i = 0; i < array.length(); i++) out.add(array.getString(i)); return out;
    }

    @Test public void packsLikeTheBrowser() throws Exception {
        JSONArray all = cases().getJSONArray("pack");
        for (int i = 0; i < all.length(); i++) {
            JSONObject item = all.getJSONObject(i); JSONArray expected = item.getJSONArray("cells");
            int[][] cells = TileLayout.pack(strings(item.getJSONArray("sizes")), item.getInt("columns"));
            assertEquals(item.getString("name"), expected.length(), cells.length);
            for (int c = 0; c < cells.length; c++) {
                assertEquals(item.getString("name") + " column of tile " + c, expected.getJSONArray(c).getInt(0), cells[c][0]);
                assertEquals(item.getString("name") + " row of tile " + c, expected.getJSONArray(c).getInt(1), cells[c][1]);
            }
        }
    }

    @Test public void dropsWhereTheBrowserDrops() throws Exception {
        JSONObject root = cases(), metrics = root.getJSONObject("dropMetrics"); JSONArray all = root.getJSONArray("drop");
        TileLayout.Metrics m = new TileLayout.Metrics((float)metrics.getDouble("unit"), (float)metrics.getDouble("rowUnit"), (float)metrics.getDouble("gap"));
        for (int i = 0; i < all.length(); i++) {
            JSONObject item = all.getJSONObject(i); JSONArray center = item.getJSONArray("center");
            assertEquals(item.getString("name"), item.getInt("index"), TileLayout.dropIndex(strings(item.getJSONArray("others")), item.getString("size"),
                    (float)center.getDouble(0), (float)center.getDouble(1), metrics.getInt("columns"), m, item.getInt("current")));
        }
    }

    @Test public void snapsResizesLikeTheBrowser() throws Exception {
        JSONArray all = cases().getJSONArray("snap");
        for (int i = 0; i < all.length(); i++) {
            JSONObject item = all.getJSONObject(i);
            assertEquals(item.getDouble("cols") + "×" + item.getDouble("rows"), item.getString("size"), TileLayout.snap((float)item.getDouble("cols"), (float)item.getDouble("rows")));
        }
    }

    @Test public void aWideTileNeverOverflowsANarrowBoard() {
        int[][] cells = TileLayout.pack(java.util.Arrays.asList("wide", "small"), 2);
        assertArrayEquals(new int[]{0, 0, 2, 2}, cells[0]); assertArrayEquals(new int[]{0, 2, 1, 1}, cells[1]);
    }
}
