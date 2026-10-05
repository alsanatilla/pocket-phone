package org.textphone.launcher;

import android.app.AlertDialog;
import android.content.Intent;
import android.os.Bundle;
import android.text.InputFilter;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.HapticFeedbackConstants;
import android.view.View;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.util.ArrayList;
import java.util.List;

/** One dashboard tile's group: up to nine apps in the same three-by-three grid as Home. */
public final class TileGroupActivity extends PocketActivity {
    private DashboardTiles tiles;
    private String slot;

    @Override protected void onCreate(Bundle state) { super.onCreate(state); tiles = new DashboardTiles(getSharedPreferences("text_phone", 0)); slot = getIntent().getStringExtra("slot"); render(); }
    @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); slot = intent.getStringExtra("slot"); render(); }
    @Override protected void onResume() { super.onResume(); render(); }

    private void render() {
        if (slot == null || !tiles.group(slot)) { screen("group"); body.addView(label("This group was removed from Home.", PocketDesign.BODY, GRAY)); return; }
        screen(tiles.label(slot), "group:" + slot); headerAction("rename", this::rename, false).setTag("group_rename");
        List<DashboardTiles.Member> members = tiles.members(slot);
        int cells = Math.min(DashboardTiles.GROUP_LIMIT, members.size() + 1);
        for (int start = 0; start < cells; start += 3) {
            LinearLayout row = row(); row.setMinimumHeight(dp(80));
            for (int index = start; index < start + 3; index++) {
                LinearLayout.LayoutParams cell = new LinearLayout.LayoutParams(0, -2, 1); cell.setMargins(dp(4), dp(4), dp(4), dp(4));
                if (index < members.size()) row.addView(tile(members.get(index), index), cell);
                else if (index == members.size() && members.size() < DashboardTiles.GROUP_LIMIT) row.addView(addTile(), cell);
                else row.addView(new View(this), cell);
            }
            body.addView(row, new LinearLayout.LayoutParams(-1, -2));
        }
        body.addView(label(members.size() + " of " + DashboardTiles.GROUP_LIMIT + " · hold an app to move or remove it", PocketDesign.META, GRAY));
    }
    private LinearLayout cell(int icon, String name, String tag) {
        LinearLayout tile = new LinearLayout(this); tile.setOrientation(LinearLayout.VERTICAL); tile.setGravity(Gravity.CENTER);
        tile.setMinimumHeight(dp(72)); tile.setPadding(dp(8), dp(8), dp(8), dp(8)); tile.setFocusable(true); tile.setClickable(true);
        tile.setBackground(PocketDesign.tile(this, false)); tile.setTag(tag); tile.setContentDescription(name);
        PhoneIcon glyph = new PhoneIcon(this, icon); glyph.setTint(WHITE, PocketDesign.BLACK); glyph.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        tile.addView(glyph, new LinearLayout.LayoutParams(dp(26), dp(26)));
        TextView label = label(name, PocketDesign.META, WHITE); label.setGravity(Gravity.CENTER); label.setMaxLines(2); label.setEllipsize(TextUtils.TruncateAt.END);
        label.setPadding(0, dp(6), 0, 0); label.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO); tile.addView(label);
        return tile;
    }
    private View tile(DashboardTiles.Member member, int index) {
        LinearLayout tile = cell(member.icon(), member.label, "group_tile_" + index);
        tile.setOnClickListener(v -> { v.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY); open(member); });
        tile.setOnLongClickListener(v -> { edit(member, index); return true; });
        return tile;
    }
    private View addTile() {
        LinearLayout tile = cell(PocketApps.APP_ICON, "+ add", "group_add");
        tile.setOnClickListener(v -> add());
        return tile;
    }

    private void open(DashboardTiles.Member member) {
        try {
            if (member.app != null) {
                Intent app = getPackageManager().getLaunchIntentForPackage(member.app);
                if (app == null) { message("This app was removed. Hold it to take it out of the group."); return; }
                startActivity(app); return;
            }
            if ("settings".equals(member.pocket)) { startActivity(new Intent(this, MainActivity.class).putExtra("pocket_screen", "settings").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); return; }
            Class<? extends android.app.Activity> page = PocketApps.activity(member.pocket);
            if (page != null) startActivity(new Intent(this, page).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (SecurityException error) { message("Android blocked opening this app."); }
    }
    private void edit(DashboardTiles.Member member, int index) {
        List<DashboardTiles.Member> members = tiles.members(slot);
        new AlertDialog.Builder(this).setTitle(member.label).setItems(new String[]{"Move earlier", "Move later", "Remove from group"}, (d, which) -> {
            if (closed || !tiles.group(slot) || index >= members.size()) return;
            if (which == 2) members.remove(index);
            else { int other = which == 0 ? index - 1 : index + 1; if (other < 0 || other >= members.size()) return;
                members.set(index, members.get(other)); members.set(other, member); }
            tiles.saveMembers(slot, members); render();
        }).show();
    }
    private void add() {
        new AlertDialog.Builder(this).setTitle("Add to " + tiles.label(slot)).setItems(new String[]{"Pocket app", "Installed app"}, (d, which) -> {
            if (closed) return; if (which == 0) addPocket(); else addInstalled();
        }).show();
    }
    private void addPocket() {
        List<String> ids = new ArrayList<>();
        for (String id : PocketApps.IDS) { boolean present = false; for (DashboardTiles.Member m : tiles.members(slot)) present |= id.equals(m.pocket); if (!present) ids.add(id); }
        if (ids.isEmpty()) { message("Every Pocket app is already in this group."); return; }
        String[] names = ids.toArray(new String[0]);
        new AlertDialog.Builder(this).setTitle("Pocket app").setItems(names, (d, which) -> {
            if (closed) return;
            try { tiles.addMember(slot, DashboardTiles.Member.pocket(names[which])); render(); } catch (IllegalArgumentException full) { message(full.getMessage()); }
        }).show();
    }
    private void addInstalled() {
        message("Loading apps…");
        loadPage(() -> InstalledApps.read(getApplicationContext()), apps -> {
            message("");
            if (apps.isEmpty()) { message("No other apps found."); return; }
            String[] names = new String[apps.size()]; for (int i = 0; i < names.length; i++) names[i] = apps.get(i).label;
            new AlertDialog.Builder(this).setTitle("Installed app").setItems(names, (d, which) -> {
                if (closed) return; InstalledApps.Entry app = apps.get(which);
                try { tiles.addMember(slot, DashboardTiles.Member.app(app.packageName, app.label)); render(); } catch (IllegalArgumentException full) { message(full.getMessage()); }
            }).setNegativeButton("Cancel", null).show();
        });
    }
    private void rename() {
        EditText name = new EditText(this); name.setTag("group_name_editor"); name.setSingleLine(true); PocketDesign.input(name);
        name.setText(tiles.label(slot)); name.selectAll(); name.setFilters(new InputFilter[]{new InputFilter.LengthFilter(40)});
        new AlertDialog.Builder(this).setTitle("Group name").setView(name).setNegativeButton("Cancel", null)
                .setPositiveButton("Save", (d, w) -> { if (!closed && tiles.group(slot)) { tiles.rename(slot, name.getText().toString()); render(); } }).show();
    }
}
