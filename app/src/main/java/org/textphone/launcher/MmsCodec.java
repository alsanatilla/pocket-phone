package org.textphone.launcher;

import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** Bounded WSP/MMS decoder for carrier notification and retrieve PDUs. */
final class MmsCodec {
    static final int LIMIT = 8 * 1024 * 1024;
    static final class Part { String mime; byte[] data; }
    static final class Pdu { String location, from = "", subject = "", text = ""; int type; final List<Part> parts = new ArrayList<>(); }
    private final byte[] bytes; private int pos, limit;
    private MmsCodec(byte[] bytes) { if (bytes == null || bytes.length > LIMIT) throw new IllegalArgumentException("MMS too large."); this.bytes = bytes; limit = bytes.length; }
    private int peek() { if (pos >= limit) throw new IllegalArgumentException("Truncated MMS."); return bytes[pos] & 255; }
    private int octet() { int result = peek(); pos++; return result; }
    private int uint() { long result = 0; for (int i = 0; i < 5; i++) { int value = octet(); result = (result << 7) | (value & 127); if (result > LIMIT) throw new IllegalArgumentException("Invalid MMS length."); if ((value & 128) == 0) return (int) result; } throw new IllegalArgumentException("Invalid MMS integer."); }
    private int length() { int value = octet(); if (value == 31) return uint(); if (value > 30) throw new IllegalArgumentException("Invalid MMS value."); return value; }
    private int end(int count) { if (count < 0 || count > limit - pos) throw new IllegalArgumentException("Truncated MMS."); return pos + count; }
    private String text(Charset charset) { if (peek() == 127) pos++; int start = pos; while (octet() != 0) {} return new String(bytes, start, pos - start - 1, charset); }
    private int integer() { int first = octet(); if (first >= 128) return first & 127; if (first > 4) throw new IllegalArgumentException("Invalid MMS charset."); int result = 0; for (int i = 0; i < first; i++) result = (result << 8) | octet(); return result; }
    private String encoded() { if (peek() > 31) return text(StandardCharsets.UTF_8); int count = length(), boundary = end(count); int old = limit; limit = boundary;
        int charset = integer(); String value = text(charset == 4 ? StandardCharsets.ISO_8859_1 : charset == 3 ? StandardCharsets.US_ASCII : StandardCharsets.UTF_8);
        limit = old; pos = boundary; return value; }
    private void skip() { int first = peek(); if (first <= 31) { int count = length(); pos = end(count); } else if (first >= 128) pos++; else text(StandardCharsets.ISO_8859_1); }
    private String type() { int old = limit, boundary = -1; if (peek() <= 31) { int count = length(); boundary = end(count); limit = boundary; }
        String result; if (peek() >= 128) { int type = octet() & 127; switch (type) {
            case 3: result = "text/plain"; break; case 0x1d: result = "image/gif"; break; case 0x1e: result = "image/jpeg"; break; case 0x20: result = "image/png"; break;
            case 0x23: result = "application/vnd.wap.multipart.mixed"; break; case 0x26: result = "application/vnd.wap.multipart.alternative"; break; case 0x33: result = "application/vnd.wap.multipart.related"; break;
            default: result = "application/octet-stream";
        } } else result = text(StandardCharsets.US_ASCII);
        if (boundary >= 0) pos = boundary; limit = old; return result;
    }
    static Pdu decode(byte[] data) {
        MmsCodec r = new MmsCodec(data); Pdu pdu = new Pdu(); String contentType = null;
        while (r.pos < r.limit) { int key = r.octet(); switch (key) {
            case 0x8c: pdu.type = r.octet(); break;
            case 0x83: pdu.location = r.text(StandardCharsets.ISO_8859_1); break;
            case 0x89: { int n = r.length(), boundary = r.end(n), old = r.limit; r.limit = boundary;
                if (r.octet() == 0x80) pdu.from = r.encoded().replaceFirst("/TYPE=.*$", ""); r.limit = old; r.pos = boundary; break; }
            case 0x96: pdu.subject = r.encoded(); break;
            case 0x84: contentType = r.type(); break;
            default: if (key < 128) throw new IllegalArgumentException("Unknown MMS header."); r.skip();
        } if (contentType != null) break; }
        if (contentType == null) return pdu;
        if (contentType.contains("multipart")) {
            int count = r.uint(); if (count > 64) throw new IllegalArgumentException("Too many MMS attachments.");
            for (int i = 0; i < count; i++) {
                int headers = r.uint(), payload = r.uint(), boundary = r.end(headers); int old = r.limit; r.limit = boundary;
                Part part = new Part(); part.mime = r.type(); r.limit = old; r.pos = boundary; boundary = r.end(payload);
                part.data = Arrays.copyOfRange(data, r.pos, boundary); r.pos = boundary; pdu.parts.add(part);
            }
        } else { Part part = new Part(); part.mime = contentType; part.data = Arrays.copyOfRange(data, r.pos, r.limit); pdu.parts.add(part); }
        StringBuilder text = new StringBuilder(); if (!pdu.subject.isEmpty()) text.append(pdu.subject).append('\n');
        for (Part part : pdu.parts) if ("text/plain".equals(part.mime)) text.append(new String(part.data, StandardCharsets.UTF_8)).append('\n');
        pdu.text = text.toString().trim(); return pdu;
    }
}
