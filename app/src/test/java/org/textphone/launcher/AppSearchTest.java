package org.textphone.launcher;

import static org.junit.Assert.*;
import org.junit.Test;

public class AppSearchTest {
    @Test public void namesAndPartialT9NumbersMatch() {
        assertTrue(AppSearch.matches("Calculator", "CALC"));
        assertTrue(AppSearch.matches("Calculator", "2252"));
        assertTrue(AppSearch.matches("Calendar", "2253"));
        assertFalse(AppSearch.matches("Calendar", "2252"));
        assertFalse(AppSearch.matches("Contacts", "9428"));
    }
    @Test public void germanLabelsAndEmptySearchAreHandled() {
        assertTrue(AppSearch.matches("Über", "8237"));
        assertTrue(AppSearch.matches("Straße", "7872773"));
        assertTrue(AppSearch.matches("Files", "  "));
        assertTrue(AppSearch.matches("2048", "2048"));
    }
}
