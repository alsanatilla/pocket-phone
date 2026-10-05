# Built-in compact camera

Open Pocket → **camera** → choose a profile → **shoot**. The default is **Cyber '06**. The camera is part of `org.textphone.launcher`; there is no separate camera app to install. Holding a remapped camera tile and choosing **Use default** restores this camera.

| Control | Behavior |
| --- | --- |
| Profile name | Native single-choice dialog for six camera families; selection persists. |
| rear / front | Switch native cameras when both are available. |
| Tap viewfinder | Meter the tapped area and autofocus when supported. Accessibility click meters/focuses the center. |
| FLASH AUTO / ON / OFF | Native auto flash or actual LED flash. A camera without a flash displays FLASH —. There is no simulated front-camera flash. |
| − / + | Adjust the camera's native exposure compensation by one supported step. |
| shoot / volume key | Capture one photo. Further capture is held until processing/saving finishes. |
| Photo icon | Open the last photo in the built-in Pocket Files image viewer. |
| back / bottom-edge Home gesture | Use Android's normal navigation to return Home. |

The controls use a fixed portrait layout. An orientation sensor rotates the saved pixel data correctly for portrait, landscape and upside-down shots. Front preview is mirrored; saved front photos use the camera's normal, unmirrored orientation. Files carry normal EXIF orientation, capture date, actual available ISO/exposure/flash metadata and Pocket/profile identification. They do not falsely identify the phone as a Sony or other manufacturer camera.

## Capture and rendering

Camera2 supplies native YUV_420_888 still frames directly. There is no intermediate smartphone JPEG and no photo-import/editor flow. The app uses ordinary camera sessions rather than extensions, scene HDR, night stacks or beauty modes. Zero-shutter-lag and extended scene processing are disabled when the device advertises those controls. ISP noise reduction and edge enhancement are disabled when supported, and fast tonemapping is requested when available. The device's remaining ISP processing cannot be universally bypassed through Camera2.

The pipeline respects YUV plane padding, chroma pixel stride, crop rectangles and available BT.601/BT.709/full/limited data-space information. On older or unspecified streams it uses BT.601 limited-range YUV, which still needs checking against the phone's HAL. A central 4:3 crop and filtered sampling impose the profile's resolution ceiling without upscaling. Real capture ISO/exposure affects shadow and chroma noise; available white-balance gains retain a small illuminant cast. Short contrast curves clip strong highlights and dark shadows. Small detail enhancement, spatially correlated chroma errors and one native JPEG encode supply the remaining early-digital character. Direct-flash falloff and subject shadows come from the physical flash and scene.

| Profile | Family inspiration | Maximum dimensions | JPEG quality | Character |
| --- | --- | --- | --- | --- |
| Cyber '06 | Sony Cyber-shot | 2048 × 1536 | 82 | Vivid color, cool bias, clipped highlights, grainier dark areas. |
| Power '05 | Canon PowerShot | 2592 × 1944 | 87 | Warm reds, gentler color/contrast, lower chroma noise. |
| Cool '04 | Nikon Coolpix | 2048 × 1536 | 81 | Cooler cyan/blue, deeper shadows, stronger shadow noise. |
| Fine '05 | Fujifilm FinePix | 2848 × 2136 | 90 | Rich greens, gentler clipping and smoother noise. |
| Stylus '03 | Olympus µ / Stylus | 1600 × 1200 | 79 | Small output, cool/magenta bias and visible compression. |
| Exilim '06 | Casio Exilim | 2304 × 1728 | 80 | Brisk saturated color and slightly stronger detail. |

Actual resolution is bounded by available camera sizes and memory. Nothing is upscaled. Noise is capture-dependent and subtle at low ISO; no film-grain texture, date overlay, face retouching, AI enhancement or cloud processing is used. Profiles are independent photographic approximations, not calibrated replicas of a particular camera model.

## Storage and lifecycle

Image conversion, rendering, JPEG encoding and metadata writing run off the UI thread. A completed capture can finish saving after the user returns to Home. The original frame is not stored as an extra modern-looking photo. On Android 10+ MediaStore holds the image pending until the complete JPEG has been copied; failed writes/publishing remove the pending entry. Temporary cache JPEGs are removed. Saved photos appear in **DCIM/Pocket**, with unique DSC filenames. They remain regular user-owned JPEGs if Pocket is uninstalled. Creating and viewing the app's own photos does not request broad photo-library access.

## Validation still needed

Automated checks exercise rotation, supported-size selection, metering bounds, profile curves, sensitivity-dependent noise, YUV strides/ranges, actual native JPEG/EXIF round trips, native permissions, profile persistence, gallery delegation and MediaStore failure cleanup. Launcher/organizer regressions also run.

No Nothing Phone (3a) is attached to this build machine. Camera session creation, front preview mirroring, tap-focus alignment, flash exposure, actual YUV data-space behavior, processing speed and saved-photo appearance have **not** been tested on the handset. The main authenticity criterion needs photographs from that device, ideally daylight, indoor tungsten/LED and a direct-flash night portrait. These profiles have not been measured against real 2000s reference cameras. The APK implements the experience and processing; handset verification and photographic tuning remain outstanding.
