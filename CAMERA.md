# Built-in compact camera

Open Pocket → **camera**, choose a profile, size, aspect and quality in the menu under the viewfinder, then **shoot**. The default is **Cyber '06 · 3M · 4:3 · fine**. The camera is part of `org.textphone.launcher`; there is no separate camera app to install. Holding a remapped camera tile and choosing **Use default** restores this camera.

| Control | Behavior |
| --- | --- |
| Profile (first menu item) | Single-choice dialog for six camera families; selection persists. |
| Size | The profile's largest size, then 3M, 2M, 1.2M and VGA classes below it. Labels show the actual pixels for the chosen aspect. Nothing is upscaled. |
| Aspect | 4:3 (the full sensor frame), 3:2, 16:9 or 1:1. Other aspects crop the 4:3 frame the way those cameras did; a square photo from a 3M camera is 1536 × 1536. The viewfinder masks everything outside the crop. |
| Quality | fine, normal or basic: the profile's JPEG quality, 10 lower or 22 lower. Basic shows block artifacts in smooth areas. |
| rear / front | Switch native cameras when both are available. |
| Tap viewfinder | Meter the tapped area and autofocus when supported. Accessibility click meters/focuses the center. |
| settings → flash auto / on / off | Native auto flash or actual LED flash. A camera without a flash displays flash —. There is no simulated front-camera flash. |
| settings → − / + | Adjust the camera's native exposure compensation by one supported step. Settings also shows the exact output pixels and JPEG quality. |
| shoot / volume key | Capture one photo. Further capture is held until processing/saving finishes. |
| Photo icon | Open the last photo in Pocket Files. Back returns to the camera. |
| back / bottom-edge Home gesture | Use Android's normal navigation to return Home. |

The controls use a fixed portrait layout. An orientation sensor rotates the saved pixel data correctly for portrait, landscape and upside-down shots. Front preview is mirrored; saved front photos use the camera's normal, unmirrored orientation. Files carry normal EXIF orientation, capture date, actual available ISO/exposure/flash metadata and Pocket/profile identification. They do not falsely identify the phone as a Sony or other manufacturer camera.

## Capture and rendering

Camera2 supplies native YUV_420_888 still frames directly. There is no intermediate smartphone JPEG and no photo-import/editor flow. The app uses ordinary camera sessions rather than extensions, scene HDR, night stacks or beauty modes. Zero-shutter-lag and extended scene processing are disabled when the device advertises those controls. ISP noise reduction and edge enhancement are disabled when supported, and fast tonemapping is requested when available. The device's remaining ISP processing cannot be universally bypassed through Camera2.

The pipeline respects YUV plane padding, chroma pixel stride, crop rectangles and available BT.601/BT.709/full/limited data-space information. On older or unspecified streams it uses BT.601 limited-range YUV, which still needs checking against the phone's HAL.

A phone frame is clean, evenly lit by local tone mapping and crisp to the last pixel. Since 0.5.21 each rendering stage takes one of those qualities away, the way a 2003–2006 CCD compact did:

1. **Lens resolution.** The aspect crop is reduced by filtered halving, sampled to 64–78% of the output size (the profile's resolved detail), then enlarged to the output size. Fine detail is lost the way an anti-aliasing filter, Bayer demosaic and a small zoom lens lost it.
2. **Lateral colour.** Red is drawn slightly larger and blue slightly smaller toward the corners, giving colour fringes on edges away from the centre.
3. **Global tone.** About eight brightness areas across the frame restore the large-area contrast that local tone mapping flattened; then one short S-curve with hard black and white points clips skies and crushes shadows. Highlights clip per channel, so bright colours shift hue as they did.
4. **CCD colour.** A 3×3 colour matrix per family (cyan-blue Sony skies, warm Canon reds, cool Nikon, rich Fujifilm greens, cool-magenta Olympus, brisk Casio), channel gains and a share of the light's colour left in by auto white balance (18–28%).
5. **Vignetting.** 0.3–0.5 stop darker corners, more on the small 2003 zoom.
6. **Sharpening halos.** A one-to-two-pixel unsharp mask on the softened image gives the crunchy-but-soft edges of the period.
7. **Bloom and purple fringing.** Clipped highlights spread a few pixels; darker pixels next to them take a purple fringe.
8. **Sensor noise and in-camera smoothing.** Grainy luminance noise even at base ISO (strongest in shadows), blotchy low-frequency chroma noise, and above ISO 200 the smeared shadow texture of the cameras' noise reduction.
9. **ISO ceiling.** Those cameras topped out near ISO 400. When the phone needed more, the photo is recorded up to 1.2 stops darker instead of looking like a night mode.
10. **Colour bleed and JPEG.** Chroma is blurred horizontally across one or two pixels, then one native JPEG encode at the chosen quality.

| Profile | Family inspiration | Largest size | JPEG (fine) | Character |
| --- | --- | --- | --- | --- |
| Cyber '06 | Sony Cyber-shot | 2048 × 1536 | 82 | Punchy, cool, cyan-blue skies, hard highlights, crunchy sharpening, purple fringes. |
| Power '05 | Canon PowerShot | 2592 × 1944 | 87 | Warm reds, gentler contrast and sharpening, cleanest low-ISO files. |
| Cool '04 | Nikon Coolpix | 2048 × 1536 | 81 | Cyan cast, deeper shadows, the noisiest shadows. |
| Fine '05 | Fujifilm FinePix | 2848 × 2136 | 90 | Rich greens/blues, gentlest highlight roll-off, smooth smeared noise. |
| Stylus '03 | Olympus µ / Stylus | 1600 × 1200 | 79 | Soft corners, strongest vignetting, cool-magenta cast, visible compression. |
| Exilim '06 | Casio Exilim | 2304 × 1728 | 80 | Brisk saturated colour, strongest sharpening, short tonal range. |

Rendering was checked on public Pixel 7 photographs (daylight with HDR, and a Night Sight street scene) through a desktop harness that runs the same `CompactProcessor.render`; the look, not exact numbers, was tuned. Profiles are independent photographic approximations, not calibrated replicas of a particular camera model. No film-grain overlay, date stamp, face retouching, AI enhancement or cloud processing is used.

## Storage and lifecycle

Image conversion, rendering, JPEG encoding and metadata writing run off the UI thread. A completed capture can finish saving after the user returns to Home. The original frame is not stored as an extra modern-looking photo. On Android 10+ MediaStore holds the image pending until the complete JPEG has been copied; failed writes/publishing remove the pending entry. Temporary cache JPEGs are removed. Saved photos appear in **DCIM/Pocket**, with unique DSC filenames. They remain regular user-owned JPEGs if Pocket is uninstalled. Creating and viewing the app's own photos does not request broad photo-library access.

## Validation still needed

Automated checks exercise rotation, supported-size selection, metering bounds, profile curves, sensitivity-dependent noise, YUV strides/ranges, actual native JPEG/EXIF round trips, native permissions, profile persistence, gallery delegation and MediaStore failure cleanup. Launcher/organizer regressions also run.

No Nothing Phone (3a) is attached to this build machine. Camera session creation, front preview mirroring, tap-focus alignment, flash exposure, actual YUV data-space behavior, processing speed and saved-photo appearance have **not** been tested on the handset. The main authenticity criterion needs photographs from that device, ideally daylight, indoor tungsten/LED and a direct-flash night portrait. These profiles have not been measured against real 2000s reference cameras. The APK implements the experience and processing; handset verification and photographic tuning remain outstanding.
