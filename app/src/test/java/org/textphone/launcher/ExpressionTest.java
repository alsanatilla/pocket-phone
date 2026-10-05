package org.textphone.launcher;

import static org.junit.Assert.*;
import org.junit.Test;

public class ExpressionTest {
    @Test public void decimalArithmeticPrecedenceAndPercentAreStable() {
        assertEquals("0.3", Expression.calculate("0.1+0.2")); assertEquals("14", Expression.calculate("2+3×4"));
        assertEquals("20", Expression.calculate("(2+3)×4")); assertEquals("-2.5", Expression.calculate("−5÷2"));
        assertEquals("20", Expression.calculate("200×10%")); assertEquals("1.25", Expression.calculate("1,5-0,25"));
    }
    @Test public void invalidAndUnboundedInputsCannotBecomeExecutableOrInfinite() {
        for (String value : new String[]{"1/0", "1..2", "(2+3", "2+", "Runtime.getRuntime()", "(".repeat(60)+"1"+")".repeat(60), "9".repeat(600)}) {
            try { Expression.calculate(value); fail(value); } catch (IllegalArgumentException expected) { assertNotNull(expected.getMessage()); }
        }
    }
}
