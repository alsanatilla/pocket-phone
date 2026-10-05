package org.textphone.launcher;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Small Markdown block editor. Operates on the current line or selected whole lines. */
final class NoteMarkdown {
    enum Style { HEADING, H1, H2, H3, BULLET, NUMBERED, CHECKBOX, QUOTE, PLAIN, BOLD }
    static final class Change {
        final String text;
        final int start, end;
        Change(String text, int start, int end) { this.text = text; this.start = start; this.end = end; }
    }
    private static final Pattern PREFIX = Pattern.compile("^( {0,32})(?:#{1,6} +|[-*+] +(?:\\[[ xX]\\] *)?|\\d{1,6}[.)] +|> ?)");
    private static final Pattern LIST = Pattern.compile("^( {0,32})([-*+] +(?:\\[[ xX]\\] *)?|\\d{1,6}[.)] +|> ?)(.*)$");

    static Change format(String source, int a, int b, Style style) {
        int start = Math.max(0, Math.min(source.length(), Math.min(a, b)));
        int end = Math.max(start, Math.min(source.length(), Math.max(a, b)));
        if (style == Style.BOLD) {
            String selection = source.substring(start, end);
            if (start >= 2 && end + 2 <= source.length() && source.substring(start - 2, start).equals("**")
                    && source.substring(end, end + 2).equals("**"))
                return new Change(source.substring(0, start - 2) + selection + source.substring(end + 2), start - 2, end - 2);
            return new Change(source.substring(0, start) + "**" + selection + "**" + source.substring(end), start + 2, end + 2);
        }
        int first = source.lastIndexOf('\n', Math.max(-1, start - 1)) + 1;
        int last = source.indexOf('\n', end > start && source.charAt(end - 1) == '\n' ? end - 1 : end);
        if (last < 0) last = source.length();
        String[] lines = source.substring(first, last).split("\n", -1);
        StringBuilder block = new StringBuilder();
        int oldOffset = first, mappedStart = start, mappedEnd = end;
        int heading = 1;
        if (style == Style.HEADING) {
            Matcher level = Pattern.compile("^ *([#]{1,6}) +").matcher(lines[0]);
            if (level.find()) heading = level.group(1).length() % 3 + 1;
        }
        for (int i = 0; i < lines.length; i++) {
            String line = lines[i]; Matcher previous = PREFIX.matcher(line);
            String indent = "", body = line; int removed = 0;
            if (previous.find()) { indent = previous.group(1); removed = previous.end(); body = line.substring(removed); }
            else { while (indent.length() < line.length() && indent.length() < 32 && line.charAt(indent.length()) == ' ') indent += " "; removed = indent.length(); body = line.substring(removed); }
            String prefix;
            switch (style) {
                case HEADING: prefix = repeat('#', heading) + " "; break;
                case H1: prefix = "# "; break;
                case H2: prefix = "## "; break;
                case H3: prefix = "### "; break;
                case BULLET: prefix = "- "; break;
                case NUMBERED: prefix = (i + 1) + ". "; break;
                case CHECKBOX: prefix = "- [ ] "; break;
                case QUOTE: prefix = "> "; break;
                default: prefix = "";
            }
            int newOffset = first + block.length(), added = indent.length() + prefix.length();
            if (start >= oldOffset && start <= oldOffset + line.length()) mappedStart = newOffset + added + Math.max(0, start - oldOffset - removed);
            if (end >= oldOffset && end <= oldOffset + line.length()) mappedEnd = newOffset + added + Math.max(0, end - oldOffset - removed);
            block.append(indent).append(prefix).append(body);
            oldOffset += line.length() + 1;
            if (i < lines.length - 1) block.append('\n');
        }
        String text = source.substring(0, first) + block + source.substring(last);
        if (end > last) mappedEnd = end + block.length() - (last - first);
        return new Change(text, Math.min(mappedStart, text.length()), Math.min(mappedEnd, text.length()));
    }

    static Change continueLine(String source, int cursor) {
        if (cursor < 1 || cursor > source.length() || source.charAt(cursor - 1) != '\n') return null;
        int first = source.lastIndexOf('\n', cursor - 2) + 1;
        boolean code = false;
        for (String line : source.substring(0, first).split("\n")) if (line.trim().startsWith("```")) code = !code;
        if (code) return null;
        Matcher list = LIST.matcher(source.substring(first, cursor - 1));
        if (!list.matches()) return null;
        if (list.group(3).trim().isEmpty()) {
            String result = source.substring(0, first) + source.substring(cursor - 1);
            return new Change(result, first + 1, first + 1);
        }
        String prefix = list.group(2);
        if (prefix.contains("[")) prefix = prefix.replaceAll("\\[[xX]\\]", "[ ]");
        else if (Character.isDigit(prefix.charAt(0))) {
            Matcher number = Pattern.compile("^(\\d+)([.)]) +").matcher(prefix); number.find();
            int next = Integer.parseInt(number.group(1)) + 1; prefix = (next > 999999 ? 1 : next) + number.group(2) + " ";
        }
        prefix = list.group(1) + prefix;
        return new Change(source.substring(0, cursor) + prefix + source.substring(cursor), cursor + prefix.length(), cursor + prefix.length());
    }
    private static String repeat(char value, int count) { StringBuilder result = new StringBuilder(); for (int i = 0; i < count; i++) result.append(value); return result.toString(); }
}
