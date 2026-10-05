package org.textphone.launcher;

import java.text.Normalizer;
import java.util.Locale;

/** Name search with the old phone number-to-letter mapping. */
final class AppSearch {
    private AppSearch() { }
    static boolean matches(String label, String query) {
        String text = normalize(label);
        String wanted = normalize(query.trim());
        if (wanted.isEmpty() || text.contains(wanted)) return true;
        if (!wanted.matches("[2-9]+")) return false;
        StringBuilder digits = new StringBuilder();
        for (char letter : text.toCharArray()) {
            if (letter >= 'a' && letter <= 'c') digits.append('2');
            else if (letter >= 'd' && letter <= 'f') digits.append('3');
            else if (letter >= 'g' && letter <= 'i') digits.append('4');
            else if (letter >= 'j' && letter <= 'l') digits.append('5');
            else if (letter >= 'm' && letter <= 'o') digits.append('6');
            else if (letter >= 'p' && letter <= 's') digits.append('7');
            else if (letter >= 't' && letter <= 'v') digits.append('8');
            else if (letter >= 'w' && letter <= 'z') digits.append('9');
        }
        return digits.toString().contains(wanted);
    }
    private static String normalize(String value) {
        return Normalizer.normalize(value, Normalizer.Form.NFD)
                .replaceAll("\\p{M}", "").toLowerCase(Locale.ROOT).replace("ß", "ss");
    }
}
