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

/** COROS tokens and pending login are sealed on this phone; neither is part of cloud sync. */
final class CorosVault implements CorosAuth.Store {
    private static final String ALIAS = "pocket_coros_key";
    private final android.content.SharedPreferences prefs;
    CorosVault(Context context) { prefs = context.getSharedPreferences("pocket_coros_auth", 0); }
    @Override public String get(String name) throws IOException {
        String value = prefs.getString(name, null);
        if (value == null) return null;
        try {
            String[] parts = value.split(":", 2);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
            return new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
        } catch (java.security.GeneralSecurityException | RuntimeException error) {
            throw new IOException("COROS sign-in could not be read. Disconnect and connect again.", error);
        }
    }
    @Override public void put(String name, String value) throws IOException {
        try {
            android.content.SharedPreferences.Editor edit = prefs.edit();
            if (value == null) edit.remove(name);
            else {
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key());
                edit.putString(name, Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":"
                        + Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP));
            }
            if (!edit.commit()) throw new IOException("Could not save COROS sign-in.");
        } catch (java.security.GeneralSecurityException error) { throw new IOException("This phone could not protect COROS sign-in.", error); }
    }
    boolean present(String name) { return prefs.contains(name); }
    void clear() { prefs.edit().clear().commit(); }
    private static SecretKey key() throws java.security.GeneralSecurityException, IOException {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (store.containsAlias(ALIAS)) return (SecretKey) store.getKey(ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build());
        return generator.generateKey();
    }
}
