package org.textphone.launcher;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Explicit chat provider settings. Other providers never receive Journal's Anthropic key. */
final class ChatProvider {
    private static final String PREFS = "pocket_chat_provider", ALIAS = "pocket_chat_provider_key";
    private static final String ANTHROPIC_URL = "https://api.anthropic.com/v1";

    static final class Config {
        final String provider, model, baseUrl, identity;
        final int maxTokens;
        final boolean promptCaching;

        Config(String provider, String model, String baseUrl, int maxTokens, boolean promptCaching) {
            if (!("anthropic".equals(provider) || "compatible".equals(provider)))
                throw new IllegalArgumentException("Choose a supported provider.");
            this.provider = provider;
            this.model = model == null ? "" : model.trim();
            this.baseUrl = "anthropic".equals(provider) ? ANTHROPIC_URL : normalize(baseUrl);
            this.maxTokens = maxTokens;
            this.promptCaching = promptCaching;
            identity = provider + "|" + this.baseUrl + "|" + this.model;
        }

        String name() { return "anthropic".equals(provider) ? "Claude" : "Assistant"; }

        void validate() {
            if (model.isEmpty() || model.length() > 120 || !model.matches("[A-Za-z0-9][A-Za-z0-9._/:@-]*"))
                throw new IllegalArgumentException("Enter the provider's model ID.");
            if (baseUrl.isEmpty()) throw new IllegalArgumentException("Enter the provider's HTTPS API base URL.");
            if (maxTokens < 64 || maxTokens > 8192)
                throw new IllegalArgumentException("Choose a reply limit from 64 to 8,192 tokens.");
        }
    }

    static Config defaults(String provider) {
        return new Config(provider, "anthropic".equals(provider) ? JournalReader.MODEL : "", "", 2048, true);
    }

    static Config get(Context context) {
        SharedPreferences values = prefs(context);
        String provider = values.getString("provider", "anthropic");
        try {
            Config fallback = defaults(provider);
            return new Config(provider, values.getString("model", fallback.model),
                    values.getString("base_url", fallback.baseUrl), values.getInt("max_tokens", 2048),
                    values.getBoolean("prompt_caching", true));
        } catch (RuntimeException damaged) { return defaults("anthropic"); }
    }

    static boolean present(Context context, Config config) {
        if ("anthropic".equals(config.provider)) return ClaudeKey.present(context);
        SharedPreferences values = prefs(context);
        return !config.baseUrl.isEmpty() && config.baseUrl.equals(values.getString("key_endpoint", ""))
                && values.contains("key_value");
    }

    static String hint(Context context, Config config) {
        if ("anthropic".equals(config.provider)) return ClaudeKey.hint(context);
        return present(context, config) ? "…" + prefs(context).getString("key_last4", "") : "";
    }

    static String key(Context context, Config config) {
        if ("anthropic".equals(config.provider)) return ClaudeKey.read(context);
        if (!present(context, config)) return null;
        try {
            String[] sealed = prefs(context).getString("key_value", "").split(":", 2);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, secret(), new GCMParameterSpec(128, Base64.decode(sealed[0], Base64.NO_WRAP)));
            cipher.updateAAD(config.baseUrl.getBytes(StandardCharsets.UTF_8));
            return new String(cipher.doFinal(Base64.decode(sealed[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
        } catch (java.security.GeneralSecurityException | java.io.IOException | RuntimeException unavailable) { return null; }
    }

    /** A blank key keeps only a key already assigned to this exact API endpoint. */
    static void save(Context context, Config config, String newKey) {
        config.validate();
        Config previous = get(context);
        String value = newKey == null ? "" : newKey.trim();
        SharedPreferences.Editor edit = prefs(context).edit();
        if ("anthropic".equals(config.provider)) {
            if (!value.isEmpty()) ClaudeKey.save(context, value);
        } else if (!value.isEmpty()) {
            if (!value.matches("[\\x21-\\x7E]{8,512}"))
                throw new IllegalArgumentException("Enter a valid provider API key.");
            try {
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.ENCRYPT_MODE, secret());
                cipher.updateAAD(config.baseUrl.getBytes(StandardCharsets.UTF_8));
                String sealed = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":"
                        + Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
                edit.putString("key_value", sealed).putString("key_endpoint", config.baseUrl)
                        .putString("key_last4", value.substring(value.length() - 4));
            } catch (java.security.GeneralSecurityException | java.io.IOException unavailable) {
                throw new IllegalStateException("This phone could not encrypt the API key.");
            }
        } else if (!present(context, config)) {
            Config current = get(context);
            if (!"compatible".equals(current.provider) || !current.baseUrl.equals(config.baseUrl))
                throw new IllegalArgumentException("Add an API key for this endpoint before saving.");
        }
        edit.putString("provider", config.provider).putString("model", config.model)
                .putString("base_url", config.baseUrl).putInt("max_tokens", config.maxTokens)
                .putBoolean("prompt_caching", config.promptCaching);
        if (!previous.provider.equals(config.provider) || !previous.baseUrl.equals(config.baseUrl))
            PocketChatTools.reset(context);
        if (!edit.commit()) throw new IllegalStateException("Could not save the chat settings.");
    }

    static void clearKey(Context context, Config config) {
        if ("anthropic".equals(config.provider)) { ClaudeKey.clear(context); return; }
        if (!present(context, config)) return;
        if (!prefs(context).edit().remove("key_value").remove("key_endpoint").remove("key_last4").commit())
            throw new IllegalStateException("Could not remove the API key.");
    }

    private static String normalize(String input) {
        String value = input == null ? "" : input.trim();
        while (value.endsWith("/")) value = value.substring(0, value.length() - 1);
        if (value.isEmpty()) return "";
        if (value.endsWith("/chat/completions")) value = value.substring(0, value.length() - "/chat/completions".length());
        while (value.endsWith("/")) value = value.substring(0, value.length() - 1);
        try {
            URI uri = new URI(value);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getHost().isEmpty()
                    || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null
                    || uri.getPort() == 0 || uri.getPort() > 65535 || value.length() > 600)
                throw new IllegalArgumentException();
            String authority = uri.getRawAuthority().toLowerCase(java.util.Locale.ROOT);
            String path = uri.getRawPath() == null ? "" : uri.getRawPath();
            URI normalized = new URI("https://" + authority + path).normalize();
            String result = normalized.toASCIIString();
            while (result.endsWith("/")) result = result.substring(0, result.length() - 1);
            return result;
        } catch (java.net.URISyntaxException | IllegalArgumentException invalid) {
            throw new IllegalArgumentException("Use an HTTPS API base URL without credentials, query or fragment.");
        }
    }

    private static SharedPreferences prefs(Context context) { return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    private static SecretKey secret() throws java.security.GeneralSecurityException, java.io.IOException {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (store.containsAlias(ALIAS)) return (SecretKey) store.getKey(ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build());
        return generator.generateKey();
    }

    private ChatProvider() { }
}
