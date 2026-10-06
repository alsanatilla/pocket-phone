package org.textphone.launcher;

/**
 * Independent approximations of 2003–2006 consumer CCD compacts, not manufacturer firmware.
 * Each profile describes the whole camera: lens, sensor colour, tone curve, sharpening, noise and JPEG.
 */
enum CameraProfile {
    // Punchy and cool: cyan-blue skies, hard highlights, crunchy sharpening and purple fringes on bright edges.
    CYBER("Cyber '06", "Sony Cyber-shot", 2048, 1536, 82,
            tone(.045f, .860f, .97f, .32f),
            color(1.02f, 1.00f, .99f, 1.03f, .22f, 1.15f, -.10f, -.05f, -.05f, 1.09f, -.04f, -.03f, -.11f, 1.14f),
            optics(.72f, .38f, .0020f, .70f, .32f), detail(1.00f, 1, .50f), noise(2.6f, 1.6f), .26f),
    // Warm and forgiving: richer reds, gentler contrast and sharpening, the cleanest low-ISO files.
    POWER("Power '05", "Canon PowerShot", 2592, 1944, 87,
            tone(.032f, .885f, 1.00f, .24f),
            color(1.00f, 1.03f, 1.01f, .96f, .26f, 1.11f, -.07f, -.04f, -.04f, 1.06f, -.02f, -.02f, -.07f, 1.09f),
            optics(.76f, .30f, .0013f, .40f, .22f), detail(.70f, 1, .45f), noise(2.0f, 1.1f), .20f),
    // Cool and deep: cyan cast, darker shadows, the noisiest shadows of the set.
    COOL("Cool '04", "Nikon Coolpix", 2048, 1536, 81,
            tone(.055f, .870f, 1.00f, .30f),
            color(1.00f, .98f, 1.015f, 1.05f, .24f, 1.06f, -.04f, -.02f, -.05f, 1.09f, -.04f, -.04f, -.06f, 1.10f),
            optics(.70f, .42f, .0018f, .50f, .25f), detail(.85f, 2, .50f), noise(3.0f, 1.9f), .30f),
    // Rich greens and blues, the gentlest highlight roll-off and smooth, smeared noise.
    FINE("Fine '05", "Fujifilm FinePix", 2848, 2136, 90,
            tone(.028f, .910f, .96f, .22f),
            color(1.02f, 1.00f, 1.02f, .99f, .18f, 1.09f, -.05f, -.04f, -.08f, 1.16f, -.08f, -.02f, -.09f, 1.11f),
            optics(.76f, .28f, .0011f, .35f, .18f), detail(.65f, 1, .70f), noise(1.8f, .9f), .18f),
    // A small 2003 zoom: soft corners, strong vignetting, cool-magenta cast and visible compression.
    STYLUS("Stylus '03", "Olympus µ / Stylus", 1600, 1200, 79,
            tone(.050f, .865f, 1.02f, .30f),
            color(1.00f, 1.015f, .975f, 1.035f, .28f, 1.08f, -.02f, -.06f, -.04f, 1.04f, .00f, .00f, -.06f, 1.06f),
            optics(.64f, .50f, .0026f, .65f, .32f), detail(.80f, 2, .40f), noise(3.2f, 2.0f), .28f),
    // Brisk and saturated with the strongest sharpening and a short tonal range.
    EXILIM("Exilim '06", "Casio Exilim", 2304, 1728, 80,
            tone(.040f, .870f, 1.00f, .34f),
            color(1.05f, 1.025f, 1.00f, .985f, .20f, 1.18f, -.11f, -.07f, -.07f, 1.14f, -.07f, -.04f, -.11f, 1.15f),
            optics(.74f, .34f, .0016f, .50f, .26f), detail(1.10f, 1, .50f), noise(2.5f, 1.5f), .26f);

    final String label, family;
    final int width, height, jpegQuality;
    /** Tone: black and white points (0–1 input), gamma and S-curve strength. */
    final float black, white, gamma, contrast;
    /** Colour: saturation, channel gains, how much of the light's colour survives auto white balance, CCD matrix. */
    final float saturation, red, green, blue, whiteBalanceLeak;
    final float[] matrix;
    /** Lens: resolved detail (share of output resolution), corner fall-off, lateral colour, purple fringing, bloom. */
    final float optics, vignette, aberration, fringe, bloom;
    /** Processing: sharpening amount, chroma blur radius, in-camera noise reduction at higher ISO. */
    final float sharpening, noiseReduction; final int chromaBlur;
    /** Sensor: luminance and chroma noise at base ISO, in 8-bit steps. */
    final float readNoise, chromaNoise;
    /** Large-area contrast a global tone curve keeps and a phone's local tone mapping flattens. */
    final float depth;

    CameraProfile(String label, String family, int width, int height, int jpegQuality,
                  float[] tone, float[] color, float[] optics, float[] detail, float[] noise, float depth) {
        this.label = label; this.family = family; this.width = width; this.height = height; this.jpegQuality = jpegQuality;
        black = tone[0]; white = tone[1]; gamma = tone[2]; contrast = tone[3];
        saturation = color[0]; red = color[1]; green = color[2]; blue = color[3]; whiteBalanceLeak = color[4];
        matrix = new float[9]; System.arraycopy(color, 5, matrix, 0, 9);
        this.optics = optics[0]; vignette = optics[1]; aberration = optics[2]; fringe = optics[3]; bloom = optics[4];
        sharpening = detail[0]; chromaBlur = Math.round(detail[1]); noiseReduction = detail[2];
        readNoise = noise[0]; chromaNoise = noise[1]; this.depth = depth;
    }
    private static float[] tone(float black, float white, float gamma, float contrast) { return new float[]{black, white, gamma, contrast}; }
    private static float[] color(float... values) { return values; }
    private static float[] optics(float resolution, float vignette, float aberration, float fringe, float bloom) { return new float[]{resolution, vignette, aberration, fringe, bloom}; }
    private static float[] detail(float sharpening, int chromaBlur, float noiseReduction) { return new float[]{sharpening, chromaBlur, noiseReduction}; }
    private static float[] noise(float read, float chroma) { return new float[]{read, chroma}; }

    static CameraProfile fromName(String name) {
        try { return valueOf(name); }
        catch (IllegalArgumentException | NullPointerException ignored) { return CYBER; }
    }
}
