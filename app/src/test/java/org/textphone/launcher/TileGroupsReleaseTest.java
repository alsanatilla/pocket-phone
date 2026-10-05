package org.textphone.launcher;

import static org.junit.Assert.*;
import android.content.Context;
import android.content.Intent;
import android.view.View;
import java.util.ArrayList;
import java.util.List;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;
import org.robolectric.util.ReflectionHelpers;

@RunWith(RobolectricTestRunner.class)
@Config(sdk=28, qualifiers="w360dp-h800dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class TileGroupsReleaseTest {
    private DashboardTiles tiles;

    @Before public void clear() {
        Context c = RuntimeEnvironment.getApplication();
        c.getSharedPreferences("text_phone", 0).edit().clear().putBoolean("reduce_motion", true).commit();
        c.getSharedPreferences("pocket_cloud", 0).edit().clear().commit();
        tiles = new DashboardTiles(c.getSharedPreferences("text_phone", 0));
    }

    @Test public void partialRowsStayCompactAndLeaveRoomForTheFooter() {
        for (int count : new int[]{1, 4, 7, 9}) {
            tiles.makeGroup("calculator", "tools");
            List<DashboardTiles.Member> members = new ArrayList<>();
            for (int i=0; i<count; i++) members.add(DashboardTiles.Member.pocket(PocketApps.IDS[i]));
            tiles.saveMembers("calculator", members);
            ActivityController<TileGroupActivity> controller = Robolectric.buildActivity(TileGroupActivity.class,
                    new Intent().putExtra("slot", "calculator")).setup();
            try {
                TileGroupActivity a = controller.get();
                ReflectionHelpers.<PageMotion>getField(a, "motion").settle();
                View root = a.findViewById(android.R.id.content);
                root.measure(View.MeasureSpec.makeMeasureSpec(360, View.MeasureSpec.EXACTLY),
                        View.MeasureSpec.makeMeasureSpec(800, View.MeasureSpec.EXACTLY));
                root.layout(0, 0, 360, 800);
                for (int i=0; i<count; i++) {
                    View tile = root.findViewWithTag("group_tile_" + i);
                    assertNotNull(tile);
                    assertTrue("A blank column stretched row " + i/3, tile.getParent() instanceof android.view.ViewGroup
                            && ((View)tile.getParent()).getHeight() <= 100);
                    assertTrue(tile.getHeight() >= 72);
                }
                View hint = PocketAppsTest.find(root, count + " of 9 · hold an app to move or remove it");
                assertNotNull(hint);
                int[] position = new int[2]; hint.getLocationOnScreen(position);
                assertTrue("Group hint should fit without scrolling", position[1] + hint.getHeight() < 420);
                assertEquals(count < 9, root.findViewWithTag("group_add") != null);
            } finally { controller.pause().stop().destroy(); }
        }
    }

    @Test public void movingAGroupKeepsItsNameAndMembersAndOpensTheChosenApp() {
        tiles.makeGroup("calculator", "tools");
        tiles.addMember("calculator", DashboardTiles.Member.pocket("dice"));
        tiles.addMember("calculator", DashboardTiles.Member.app("com.example.editor", "Editor"));
        tiles.swap("calculator", "files");
        assertTrue(tiles.group("files"));
        assertEquals("tools", tiles.label("files"));
        assertEquals("com.example.editor", tiles.members("files").get(2).app);
        assertFalse(tiles.group("calculator"));
        ActivityController<TileGroupActivity> controller = Robolectric.buildActivity(TileGroupActivity.class,
                new Intent().putExtra("slot", "files")).setup();
        try {
            assertTrue(controller.get().root.findViewWithTag("group_tile_1").performClick());
            assertEquals(DiceActivity.class.getName(), Shadows.shadowOf(controller.get())
                    .getNextStartedActivity().getComponent().getClassName());
        } finally { controller.pause().stop().destroy(); }
    }
}
