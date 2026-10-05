package org.textphone.launcher;

import static org.junit.Assert.*;
import org.junit.Test;

public class NoteMarkdownTest {
    @Test public void selectedLinesFormatTogetherWithoutIncludingTheFollowingLine() {
        NoteMarkdown.Change result = NoteMarkdown.format("one\ntwo\nthree", 0, 8, NoteMarkdown.Style.BULLET);
        assertEquals("- one\n- two\nthree", result.text); assertEquals(2, result.start); assertEquals(12, result.end);
        result = NoteMarkdown.format(result.text, 2, 11, NoteMarkdown.Style.CHECKBOX);
        assertEquals("- [ ] one\n- [ ] two\nthree", result.text);
    }
    @Test public void headingCyclingReplacesThePrefixAndKeepsTheCaretWithItsText() {
        NoteMarkdown.Change result = NoteMarkdown.format("Heading\nBody", 7, 7, NoteMarkdown.Style.HEADING);
        assertEquals("# Heading\nBody", result.text); assertEquals(9, result.start);
        result = NoteMarkdown.format(result.text, result.start, result.end, NoteMarkdown.Style.HEADING);
        assertEquals("## Heading\nBody", result.text); assertEquals(10, result.start);
        result = NoteMarkdown.format(result.text, result.start, result.end, NoteMarkdown.Style.PLAIN);
        assertEquals("Heading\nBody", result.text); assertEquals(7, result.start);
    }
    @Test public void listsContinueAsUncheckedOrNextNumberAndBlankItemsEndTheList() {
        assertEquals("- [x] Sent\n- [ ] ", NoteMarkdown.continueLine("- [x] Sent\n", 11).text);
        assertEquals("9. Nine\n10. ", NoteMarkdown.continueLine("9. Nine\n", 8).text);
        assertEquals("- First\n\n", NoteMarkdown.continueLine("- First\n- \n", 11).text);
        assertNull(NoteMarkdown.continueLine("```\n- literal\n", 14));
    }
    @Test public void boldWrapsOnlyTheSelectionAndCanBeRemovedWithoutLosingText() {
        NoteMarkdown.Change value = NoteMarkdown.format("Read this", 5, 9, NoteMarkdown.Style.BOLD);
        assertEquals("Read **this**", value.text); assertEquals(7, value.start); assertEquals(11, value.end);
        value = NoteMarkdown.format(value.text, value.start, value.end, NoteMarkdown.Style.BOLD);
        assertEquals("Read this", value.text); assertEquals(5, value.start); assertEquals(9, value.end);
    }
}
