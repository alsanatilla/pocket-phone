package org.textphone.launcher;

/** The organizer has its own task so Home/Recents do not replace an open editor. */
public final class OrganizerActivity extends MainActivity {
    @Override protected boolean workspace() { return true; }
}
