package org.textphone.launcher;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * The user's own Claude API key for reading journal pages. It is stored only encrypted, with a key that lives in the
 * Android Keystore and never leaves this phone. Never logged, synced or shown again after saving.
 */
final class ClaudeKey {
    private static final String ALIAS = "pocket_claude_key", PREFS = "pocket_journal_key";
    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, 0); }
    static boolean present(Context c) { return prefs(c).contains("value"); }
    /** Only the last four characters, so Settings can show which key is set. */
    static String hint(Context c) { return present(c) ? "…" + prefs(c).getString("last4", "") : ""; }

    static void save(Context c, String key) {
        String value = key == null ? "" : key.trim();
        if (!value.startsWith("sk-ant-") || value.length() < 30) throw new IllegalArgumentException("That doesn't look like a Claude API key (sk-ant-…).");
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, secret());
            String sealed = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
            if (!prefs(c).edit().putString("value", sealed).putString("last4", value.substring(value.length() - 4)).commit()) throw new IllegalStateException("Could not save the key.");
        } catch (java.security.GeneralSecurityException | java.io.IOException error) { throw new IllegalStateException("This phone could not encrypt the key.", error); }
    }
    /** Null when no key is set or it can no longer be decrypted (for example after a factory reset of the Keystore). */
    static String read(Context c) {
        String sealed = prefs(c).getString("value", null); if (sealed == null) return null;
        try {
            String[] parts = sealed.split(":", 2);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, secret(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
            return new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
        } catch (java.security.GeneralSecurityException | java.io.IOException | RuntimeException error) { return null; }
    }
    static void clear(Context c) {
        prefs(c).edit().clear().commit();
        try { KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null); store.deleteEntry(ALIAS); }
        catch (java.security.GeneralSecurityException | java.io.IOException ignored) { /* The ciphertext is gone already. */ }
    }
    private static SecretKey secret() throws java.security.GeneralSecurityException, java.io.IOException {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (store.containsAlias(ALIAS)) return (SecretKey) store.getKey(ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build());
        return generator.generateKey();
    }
    private ClaudeKey() { }
}
