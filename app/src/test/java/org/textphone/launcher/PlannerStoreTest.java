package org.textphone.launcher;

import static org.junit.Assert.*;
import android.content.SharedPreferences;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35)
public class PlannerStoreTest {
    private SharedPreferences prefs;
    private PlannerStore store;
    @Before public void start() {
        prefs = RuntimeEnvironment.getApplication().getSharedPreferences("planner_test", 0);
        prefs.edit().clear().commit(); store = new PlannerStore(prefs);
    }
    @Test public void notesAndTaskOrderSurviveReloadAndCompletion() {
        long first = store.save(0, "task", "Send invoice");
        long second = store.save(0, "task", "Book train");
        store.save(0, "note", "  reference\nhttps://example.org  ");
        store.makeNext(second);
        PlannerStore reloaded = new PlannerStore(prefs);
        assertEquals(second, reloaded.nextTask().id);
        assertEquals(2, reloaded.openTasks());
        reloaded.toggle(second);
        assertEquals(first, store.nextTask().id);
        assertEquals(1, store.openTasks());
        assertTrue(reloaded.exportText().contains("  reference\nhttps://example.org  "));
        assertTrue(reloaded.exportText().contains("[x] Book train"));
    }
    @Test public void editingRetainsIdentityCreationAndCompletion() {
        long id = store.save(0, "task", "Draft");
        long created = store.entries().get(0).created;
        store.toggle(id); store.save(id, "task", "Final draft");
        assertEquals(1, store.entries().size());
        PlannerStore.Entry entry = store.entries().get(0);
        assertEquals(id, entry.id); assertEquals(created, entry.created); assertTrue(entry.done);
    }
    @Test public void deletedIdsAreNotReused() {
        long deleted = store.save(0, "note", "Old");
        store.delete(deleted);
        assertTrue(store.save(0, "note", "New") > deleted);
    }
    @Test public void draftsStaySeparateFromSavedEntriesAndEachOther() {
        long id = store.save(0, "note", "Saved");
        store.draft("note", id, "Edited draft");
        store.draft("note", 0, "New draft"); store.draft("task", 0, "Task draft");
        PlannerStore fresh = new PlannerStore(prefs);
        assertEquals("Edited draft", fresh.draft("note", id));
        assertEquals("New draft", fresh.draft("note", 0));
        assertEquals("Task draft", fresh.draft("task", 0));
        fresh.clearDraft("note", 0);
        assertEquals("Saved", fresh.entries().get(0).text);
        assertEquals("Edited draft", fresh.draft("note", id));
    }
    @Test public void invalidTextDoesNotOverwriteAnEntry() {
        long id = store.save(0, "note", "Keep me");
        assertThrows(IllegalArgumentException.class, () -> store.save(id, "note", "   "));
        assertThrows(IllegalArgumentException.class, () -> store.save(id, "note", "x".repeat(8001)));
        assertEquals("Keep me", store.entries().get(0).text);
    }
    @Test public void unreadableDataIsNotSilentlyErased() {
        prefs.edit().putString("entries", "{broken").commit();
        assertThrows(IllegalStateException.class, () -> store.save(0, "note", "Replacement"));
        assertEquals("{broken", prefs.getString("entries", ""));
    }

    @Test public void legacyEntriesKeepTheirIdentityAndTextWhenTaskMetadataIsAdded() {
        prefs.edit().putString("entries", "[{\"id\":7,\"kind\":\"task\",\"text\":\"Old task\",\"done\":true,\"created\":42},{\"id\":8,\"kind\":\"note\",\"text\":\"# Original note\",\"created\":43}]").commit();
        store.saveTask(7, "Old task edited", "2026-10-05", true, "- [x] Done step\nNew step");
        PlannerStore fresh = new PlannerStore(prefs); PlannerStore.Entry entry = fresh.find(7);
        assertTrue(entry.done); assertEquals(42, entry.created); assertTrue(entry.important);
        assertEquals("2026-10-05", entry.due); assertEquals(2, entry.steps.size()); assertEquals(1, entry.completedSteps());
        assertEquals("# Original note", fresh.find(8).text);
        fresh.toggle(7); fresh.toggleStep(7, 1); fresh.save(7, "task", "Renamed");
        entry = fresh.find(7); assertFalse(entry.done); assertTrue(entry.important); assertEquals(2, entry.completedSteps());
        assertEquals("2026-10-05", entry.due); assertTrue(fresh.exportText().contains("  - [x] New step"));
    }
    @Test public void deadlinesAndImportanceDetermineNextTaskUnlessTheUserMakesAnotherNext() {
        long anytime = store.save(0, "task", "Anytime");
        long later = store.saveTask(0, "Later", "2026-10-10", true, "");
        long due = store.saveTask(0, "Due", "2026-10-04", false, "");
        long important = store.saveTask(0, "Important and due", "2026-10-04", true, "");
        assertEquals(important, store.nextTask().id);
        store.makeNext(anytime); assertEquals(anytime, new PlannerStore(prefs).nextTask().id);
        store.toggle(anytime); assertEquals(important, store.nextTask().id);
        store.toggle(important); assertEquals(due, store.nextTask().id);
        store.delete(due); assertEquals(later, store.nextTask().id);
    }
    @Test public void invalidDeadlinesAndOversizedChecklistsCannotReplaceSavedTasks() {
        long id = store.saveTask(0, "Keep", "2026-10-04", true, "Step");
        assertThrows(IllegalArgumentException.class, () -> store.saveTask(id, "Replace", "2026-02-30", false, ""));
        assertThrows(IllegalArgumentException.class, () -> store.saveTask(id, "Replace", "", false, "step\n".repeat(33)));
        assertEquals("Keep", store.find(id).text); assertEquals(1, store.find(id).steps.size()); assertTrue(store.find(id).important);
    }
    @Test public void taskDraftMetadataStaysSeparateFromNotesAndSavedTasks() {
        long id = store.saveTask(0, "Saved", "2026-10-04", false, "Saved step");
        store.draftTask(id, "2026-10-05", true, "Unsaved step");
        store.draftTask(0, "2026-10-06", true, "New draft step"); store.draft("note", 0, "New note"); store.clearDraft("note", 0);
        PlannerStore fresh = new PlannerStore(prefs);
        assertEquals("2026-10-06", fresh.taskDraft(0, null).due);
        assertEquals("Unsaved step", fresh.taskDraft(id, fresh.find(id)).steps);
        assertEquals("2026-10-04", fresh.find(id).due);
        fresh.clearDraft("task", id); assertEquals("2026-10-04", fresh.taskDraft(id, fresh.find(id)).due);
    }
}
