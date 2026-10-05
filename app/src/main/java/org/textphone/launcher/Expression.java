package org.textphone.launcher;

import java.math.BigDecimal;
import java.math.MathContext;

/** Bounded decimal expression parser. No executable input or floating-point infinities. */
final class Expression {
    private final String value;
    private int at, depth;
    private static final MathContext MC = MathContext.DECIMAL64;
    private Expression(String value) { this.value = value.replace('×', '*').replace('÷', '/').replace('−', '-').replace(',', '.'); }
    static String calculate(String value) {
        if (value == null || value.length() > 512) throw new IllegalArgumentException("Expression too long.");
        Expression parser = new Expression(value); BigDecimal result = parser.sum(); parser.space();
        if (parser.at != parser.value.length()) throw new IllegalArgumentException("Check the expression.");
        String text = result.stripTrailingZeros().toPlainString();
        if (text.length() > 256) throw new IllegalArgumentException("Result too large."); return text;
    }
    private void space() { while (at < value.length() && Character.isWhitespace(value.charAt(at))) at++; }
    private boolean take(char c) { space(); if (at < value.length() && value.charAt(at) == c) { at++; return true; } return false; }
    private BigDecimal sum() { BigDecimal result = product(); while (true) {
        if (take('+')) result = result.add(product(), MC); else if (take('-')) result = result.subtract(product(), MC); else return result; } }
    private BigDecimal product() { BigDecimal result = unary(); while (true) {
        if (take('*')) result = result.multiply(unary(), MC); else if (take('/')) {
            BigDecimal divisor = unary(); if (divisor.signum() == 0) throw new IllegalArgumentException("Cannot divide by zero.");
            result = result.divide(divisor, MC);
        } else return result; } }
    private BigDecimal unary() {
        if (++depth > 48) throw new IllegalArgumentException("Expression too deep.");
        BigDecimal number;
        if (take('-')) number = unary().negate(); else if (take('+')) number = unary();
        else if (take('(')) { number = sum(); if (!take(')')) throw new IllegalArgumentException("Missing closing bracket."); }
        else { space(); int start = at; while (at < value.length() && ((value.charAt(at) >= '0' && value.charAt(at) <= '9') || value.charAt(at) == '.')) at++;
            if (at == start || at - start > 64) throw new IllegalArgumentException("Enter a number.");
            try { number = new BigDecimal(value.substring(start, at), MC); } catch (NumberFormatException e) { throw new IllegalArgumentException("Check the number."); } }
        while (take('%')) number = number.divide(BigDecimal.valueOf(100), MC);
        depth--; return number;
    }
}
