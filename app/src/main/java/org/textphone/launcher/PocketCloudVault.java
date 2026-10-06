package org.textphone.launcher;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Pocket sessions and pending phone grants are encrypted with the phone's Keystore. */
final class PocketCloudVault {
    private static final String ALIAS = "pocket_cloud_session_key";
    private final android.content.SharedPreferences prefs;
    PocketCloudVault(Context context) { prefs = context.getSharedPreferences("pocket_cloud_session", 0); }
    String get() throws IOException { return get("session"); }
    String get(String field) throws IOException {
        String value = prefs.getString(field, null);
        if (value == null) return null;
        try {
            String[] parts = value.split(":", 2);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
            return new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
        } catch (java.security.GeneralSecurityException | RuntimeException error) { throw new IOException("Sign in to Pocket again.", error); }
    }
    void put(String value) throws IOException { put("session", value); }
    void put(String field, String value, String... remove) throws IOException {
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key());
            String sealed = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
            android.content.SharedPreferences.Editor edit = prefs.edit().putString(field, sealed);
            for (String removed : remove) edit.remove(removed);
            if (!edit.commit()) throw new IOException("Could not save Pocket sign-in.");
        } catch (java.security.GeneralSecurityException error) { throw new IOException("This phone could not protect Pocket sign-in.", error); }
    }
    void clear(String field) { prefs.edit().remove(field).commit(); }
    boolean present() { return prefs.contains("session"); }
    private static synchronized SecretKey key() throws java.security.GeneralSecurityException, IOException {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (store.containsAlias(ALIAS)) return (SecretKey) store.getKey(ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build());
        return generator.generateKey();
    }
}
