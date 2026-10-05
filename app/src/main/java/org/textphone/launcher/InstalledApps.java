package org.textphone.launcher;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import java.text.Collator;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

final class InstalledApps {
    static final class Entry {
        final String label, packageName, activityName;
        Entry(String label, String packageName, String activityName) { this.label = label; this.packageName = packageName; this.activityName = activityName; }
    }
    /** Binder/resource work and sorting run in the launcher's worker, once per index. */
    static List<Entry> read(Context context) {
        PackageManager manager = context.getPackageManager(); List<Entry> entries = new ArrayList<>(); Set<String> seen = new HashSet<>();
        for (ResolveInfo info : manager.queryIntentActivities(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0)) {
            if (Thread.currentThread().isInterrupted()) return entries;
            if (info.activityInfo == null) continue; String name = info.activityInfo.packageName;
            if (context.getPackageName().equals(name) || !seen.add(name)) continue;
            entries.add(new Entry(info.loadLabel(manager).toString(), name, info.activityInfo.name));
        }
        Collator collator = Collator.getInstance(); java.util.Collections.sort(entries, (a, b) -> collator.compare(a.label, b.label)); return entries;
    }
    private InstalledApps() { }
}
