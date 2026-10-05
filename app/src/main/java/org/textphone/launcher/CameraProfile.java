package org.textphone.launcher;

/** Independent approximations of consumer JPEG rendering, not manufacturer firmware. */
enum CameraProfile {
    CYBER("Cyber '06", "Sony Cyber-shot", 2048, 1536, 82,
            .032f, .890f, .98f, .14f, 1.14f, 1.00f, .99f, 1.025f, .14f, .65f, .62f, .10f),
    POWER("Power '05", "Canon PowerShot", 2592, 1944, 87,
            .024f, .920f, 1.02f, .10f, 1.07f, 1.03f, 1.01f, .96f, .10f, .45f, .48f, .12f),
    COOL("Cool '04", "Nikon Coolpix", 2048, 1536, 81,
            .045f, .875f, 1.00f, .16f, 1.10f, .98f, 1.015f, 1.05f, .12f, .80f, .78f, .12f),
    FINE("Fine '05", "Fujifilm FinePix", 2848, 2136, 90,
            .022f, .935f, .95f, .09f, 1.07f, 1.00f, 1.02f, .99f, .08f, .32f, .35f, .08f),
    STYLUS("Stylus '03", "Olympus µ / Stylus", 1600, 1200, 79,
            .038f, .885f, 1.02f, .14f, 1.12f, 1.015f, .975f, 1.035f, .09f, .82f, .80f, .15f),
    EXILIM("Exilim '06", "Casio Exilim", 2304, 1728, 80,
            .030f, .900f, 1.00f, .13f, 1.18f, 1.025f, 1.00f, .985f, .18f, .68f, .65f, .09f);

    final String label, family;
    final int width, height, jpegQuality;
    final float black, white, gamma, contrast, saturation, red, green, blue;
    final float sharpening, readNoise, chromaNoise, whiteBalanceLeak;

    CameraProfile(String label, String family, int width, int height, int jpegQuality,
                  float black, float white, float gamma, float contrast, float saturation,
                  float red, float green, float blue, float sharpening, float readNoise,
                  float chromaNoise, float whiteBalanceLeak) {
        this.label = label; this.family = family; this.width = width; this.height = height;
        this.jpegQuality = jpegQuality; this.black = black; this.white = white;
        this.gamma = gamma; this.contrast = contrast; this.saturation = saturation;
        this.red = red; this.green = green; this.blue = blue; this.sharpening = sharpening;
        this.readNoise = readNoise; this.chromaNoise = chromaNoise;
        this.whiteBalanceLeak = whiteBalanceLeak;
    }

    static CameraProfile fromName(String name) {
        try { return valueOf(name); }
        catch (IllegalArgumentException | NullPointerException ignored) { return CYBER; }
    }
}
