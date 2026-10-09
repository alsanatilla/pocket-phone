package org.textphone.launcher;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.TreeMap;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Bounded FIT decoder. Its output is the same route/series cache the browser stores. */
final class MovementFit {
    private static final String[] NAMES = {"distance", "altitude", "hr", "cadence", "speed", "power", "contact", "oscillation", "ratio", "step", "timestamp"};
    private static final String[] CHANNELS = {"pace", "hr", "altitude", "cadence", "power", "contact", "oscillation", "ratio", "step"};
    private static final int[] INDEX = {4, 2, 1, 3, 5, 6, 7, 8, 9};
    private static final int LIMIT = 200000;
    private static final class Definition { int global, developerBytes; boolean little; int[][] fields; }
    private final byte[] bytes; private int at, end; private long timestamp = -1;
    private final Definition[] definitions = new Definition[16];
    private final List<double[]> points = new ArrayList<>(), samples = new ArrayList<>();
    private Double ascent;
    private MovementFit(byte[] bytes) { this.bytes = bytes; }
    static JSONObject parse(byte[] bytes, boolean steps) throws IOException {
        if (bytes == null || bytes.length < 12 || bytes.length > 16 * 1024 * 1024 || bytes[8] != '.' || bytes[9] != 'F' || bytes[10] != 'I' || bytes[11] != 'T') throw new IOException("The activity file is not a FIT file.");
        MovementFit fit = new MovementFit(bytes); fit.at = bytes[0] & 255;
        long size = ByteBuffer.wrap(bytes, 4, 4).order(ByteOrder.LITTLE_ENDIAN).getInt() & 0xffffffffL;
        if (fit.at < 12 || fit.at > bytes.length || size > bytes.length - fit.at) throw new IOException("The activity file is incomplete.");
        fit.end = fit.at + (int) size;
        while (fit.at < fit.end) fit.message();
        try { return new JSONObject().put("path", route(fit.points)).put("climb", fit.ascent == null ? JSONObject.NULL : fit.ascent).put("series", series(fit.samples, steps)); }
        catch (JSONException error) { throw new IOException("The activity file could not be read.", error); }
    }
    private void require(int size) throws IOException { if (size < 0 || at + (long) size > end) throw new IOException("The activity file is incomplete."); }
    private int next() throws IOException { require(1); return bytes[at++] & 255; }
    private void message() throws IOException {
        int header = next();
        if ((header & 0x80) != 0) { data(definitions[(header >> 5) & 3], header & 31); return; }
        int local = header & 15;
        if ((header & 0x40) == 0) { data(definitions[local], -1); return; }
        require(5); Definition d = new Definition(); at++; d.little = next() == 0;
        d.global = ByteBuffer.wrap(bytes, at, 2).order(d.little ? ByteOrder.LITTLE_ENDIAN : ByteOrder.BIG_ENDIAN).getShort() & 65535; at += 2;
        int count = next(); d.fields = new int[count][3]; require(count * 3);
        for (int i = 0; i < count; i++) { d.fields[i][0] = next(); d.fields[i][1] = next(); d.fields[i][2] = next() & 31; }
        if ((header & 0x20) != 0) { int developer = next(); require(developer * 3); for (int i = 0; i < developer; i++) { next(); d.developerBytes += next(); next(); } }
        definitions[local] = d;
    }
    private double number(int size, int type, boolean little) throws IOException {
        require(size); ByteBuffer view = ByteBuffer.wrap(bytes, at, size).order(little ? ByteOrder.LITTLE_ENDIAN : ByteOrder.BIG_ENDIAN);
        long n;
        if (size == 1) { n = type == 1 ? bytes[at] : bytes[at] & 255; if (n == (type == 1 ? 127 : 255) || type == 10 && n == 0) return Double.NaN; }
        else if (size == 2) { n = type == 3 ? view.getShort() : view.getShort() & 65535; if (n == (type == 3 ? 32767 : 65535) || type == 11 && n == 0) return Double.NaN; }
        else if (size == 4) {
            if (type == 8) { float f = view.getFloat(); return Float.isFinite(f) ? f : Double.NaN; }
            n = type == 5 ? view.getInt() : view.getInt() & 0xffffffffL; if (n == (type == 5 ? 2147483647L : 4294967295L) || type == 12 && n == 0) return Double.NaN;
        } else return Double.NaN;
        return n;
    }
    private void data(Definition d, int compressed) throws IOException {
        if (d == null) throw new IOException("The activity file has an undefined record.");
        double[] sample = new double[NAMES.length]; Arrays.fill(sample, Double.NaN);
        double lat = Double.NaN, lng = Double.NaN; boolean enhancedAltitude = false, enhancedSpeed = false;
        if (compressed >= 0 && timestamp >= 0) { long t = (timestamp & ~31L) | compressed; if (t < timestamp) t += 32; timestamp = t; sample[10] = t; }
        for (int[] field : d.fields) {
            int id = field[0], size = field[1];
            // Compressed headers replace the timestamp bytes, including in their local definition.
            if (compressed >= 0 && id == 253 && size == 4) continue;
            double value = number(size, field[2], d.little);
            if (id == 253 && Double.isFinite(value)) { timestamp = (long) value; sample[10] = value; }
            if (d.global == 20 && Double.isFinite(value)) {
                switch (id) {
                    case 0: lat = value * 180 / 2147483648.0; break;
                    case 1: lng = value * 180 / 2147483648.0; break;
                    case 5: sample[0] = value / 100; break;
                    case 2: if (!enhancedAltitude) sample[1] = value / 5 - 500; break;
                    case 78: sample[1] = value / 5 - 500; enhancedAltitude = true; break;
                    case 3: sample[2] = value; break;
                    case 4: sample[3] = value; break;
                    case 6: if (!enhancedSpeed) sample[4] = value / 1000; break;
                    case 73: sample[4] = value / 1000; enhancedSpeed = true; break;
                    case 7: sample[5] = value; break;
                    case 41: sample[6] = value / 10; break;
                    case 39: sample[7] = value / 10; break;
                    case 83: sample[8] = value / 100; break;
                    case 85: sample[9] = value / 10; break;
                    default: break;
                }
            } else if (d.global == 18 && id == 22 && size == 2 && Double.isFinite(value)) ascent = (ascent == null ? 0 : ascent) + value;
            at += size;
        }
        require(d.developerBytes); at += d.developerBytes;
        if (d.global == 20) {
            if (samples.size() >= LIMIT) throw new IOException("The activity file is too large."); samples.add(sample);
            if (Double.isFinite(lat) && Double.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat != 0 || lng != 0)) points.add(new double[]{lat, lng});
        }
    }
    static JSONObject route(List<double[]> points) throws JSONException {
        if (points.size() < 2) return null;
        List<double[]> kept = new ArrayList<>(); int every = Math.max(1, (int) Math.ceil(points.size() / 500.0));
        for (int i = 0; i < points.size(); i++) if (i % every == 0 || i == points.size() - 1) kept.add(points.get(i));
        double latMean = 0; for (double[] p : kept) latMean += p[0]; double squeeze = Math.cos(latMean / kept.size() * Math.PI / 180);
        double minX = Double.POSITIVE_INFINITY, minY = minX, maxX = Double.NEGATIVE_INFINITY, maxY = maxX, previous = kept.get(0)[1];
        List<double[]> flat = new ArrayList<>();
        for (double[] p : kept) { double lng = previous + ((p[1] - previous + 540) % 360 - 180); previous = lng; double x = lng * squeeze, y = -p[0]; flat.add(new double[]{x, y}); minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
        double spanX = maxX - minX, spanY = maxY - minY; if (spanX == 0 && spanY == 0) return null;
        double scale = Math.min(spanX > 0 ? 292 / spanX : Double.POSITIVE_INFINITY, spanY > 0 ? 162 / spanY : Double.POSITIVE_INFINITY);
        double offsetX = (320 - spanX * scale) / 2, offsetY = (190 - spanY * scale) / 2; StringBuilder path = new StringBuilder(); JSONArray start = null;
        for (double[] p : flat) { double x = (p[0] - minX) * scale + offsetX, y = (p[1] - minY) * scale + offsetY; if (start == null) start = new JSONArray().put(round(x, 1)).put(round(y, 1)); path.append(path.length() == 0 ? 'M' : 'L').append(String.format(Locale.ROOT, "%.1f %.1f ", x, y)); }
        return new JSONObject().put("d", path.toString().trim()).put("start", start);
    }
    private static double round(double value, int digits) { double factor = Math.pow(10, digits); return Math.round(value * factor) / factor; }
    private static JSONObject series(List<double[]> samples, boolean steps) throws JSONException {
        if (samples.size() < 2) return null;
        boolean distance = false; for (double[] s : samples) if (s[0] > 0) distance = true;
        final int buckets = 200, channels = 9; double[][] sums = new double[buckets][channels]; int[][] counts = new int[buckets][channels]; double[] positions = new double[buckets]; int[] sizes = new int[buckets];
        double end = 0, firstTime = samples.get(0)[10];
        for (int i = 0; i < samples.size(); i++) { double at = distance ? samples.get(i)[0] : Double.isFinite(firstTime) && Double.isFinite(samples.get(i)[10]) ? samples.get(i)[10] - firstTime : i; if (Double.isFinite(at)) end = Math.max(end, at); }
        if (end <= 0) end = 1;
        TreeMap<Integer, Integer> beats = new TreeMap<>(); int heartSamples = 0;
        for (int i = 0; i < samples.size(); i++) {
            double[] sample = samples.get(i); if (sample[2] > 0) { int band = (int) (sample[2] / 10) * 10; beats.put(band, beats.getOrDefault(band, 0) + 1); heartSamples++; }
            double at = distance ? sample[0] : Double.isFinite(firstTime) && Double.isFinite(sample[10]) ? sample[10] - firstTime : i;
            if (!Double.isFinite(at) || at < 0) continue; int bucket = Math.max(0, Math.min(buckets - 1, (int) (at / end * buckets))); positions[bucket] += at; sizes[bucket]++;
            for (int c = 0; c < channels; c++) { double value = sample[INDEX[c]]; if (!Double.isFinite(value) || c != 2 && value <= 0) continue; sums[bucket][c] += value; counts[bucket][c]++; }
        }
        List<Integer> filled = new ArrayList<>(); JSONArray x = new JSONArray(); for (int i = 0; i < buckets; i++) if (sizes[i] > 0) { filled.add(i); x.put(round(positions[i] / sizes[i] / (distance ? 1000 : 60), 1)); }
        if (filled.size() < 2) return null;
        JSONObject out = new JSONObject().put("x", x).put("unit", distance ? "km" : "min");
        for (int c = 0; c < channels; c++) {
            double[] values = new double[filled.size()]; boolean any = false;
            for (int i = 0; i < filled.size(); i++) { int b = filled.get(i); double mean = counts[b][c] == 0 ? Double.NaN : sums[b][c] / counts[b][c];
                values[i] = c == 0 ? mean > .3 ? Math.round(1000 / mean) : Double.NaN : c == 3 && steps ? Math.round(mean * 2) : round(mean, 1);
                if (!Double.isFinite(mean)) values[i] = Double.NaN; any |= Double.isFinite(values[i]); }
            if (!any) continue; JSONArray data = new JSONArray();
            for (int i = 0; i < values.length; i++) { double value = values[i]; if (c != 2 && Double.isFinite(value)) { double sum = 0; int count = 0; for (int j = Math.max(0, i - 3); j <= Math.min(values.length - 1, i + 3); j++) if (Double.isFinite(values[j])) { sum += values[j]; count++; } value = round(sum / count, c == 0 ? 0 : 1); } data.put(Double.isFinite(value) ? value : JSONObject.NULL); }
            out.put(CHANNELS[c], data);
        }
        JSONArray bands = new JSONArray(); for (java.util.Map.Entry<Integer, Integer> e : beats.entrySet()) bands.put(new JSONObject().put("from", e.getKey()).put("share", e.getValue() / (double) heartSamples));
        out.put("hrBands", bands); return out;
    }
}
