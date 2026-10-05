package org.textphone.launcher;

import static org.junit.Assert.*;
import java.nio.charset.StandardCharsets;
import java.io.ByteArrayOutputStream;
import org.junit.Test;

public class MmsCodecTest {
    private static byte[] concat(byte[] a, byte[] b) { ByteArrayOutputStream out = new ByteArrayOutputStream(); out.write(a,0,a.length); out.write(b,0,b.length); return out.toByteArray(); }
    @Test public void carrierNotificationReadsOnlyABoundedContentLocation() {
        byte[] data = concat(new byte[]{(byte)0x8c,(byte)0x82,(byte)0x98,'a',0,(byte)0x8d,(byte)0x91,(byte)0x83}, "https://carrier.test/mms/42\0".getBytes(StandardCharsets.US_ASCII));
        MmsCodec.Pdu pdu = MmsCodec.decode(data); assertEquals(130, pdu.type); assertEquals("https://carrier.test/mms/42", pdu.location);
    }
    @Test public void retrievedTextAndImageKeepTheirExactPayload() {
        byte[] data = concat(new byte[]{(byte)0x8c,(byte)0x84,(byte)0x84,(byte)0xb3,2,1,5,(byte)0x83}, "hello".getBytes(StandardCharsets.UTF_8));
        data = concat(data, new byte[]{1,4,(byte)0x9e,1,2,3,4}); MmsCodec.Pdu pdu = MmsCodec.decode(data);
        assertEquals(132, pdu.type); assertEquals("hello", pdu.text); assertEquals("image/jpeg", pdu.parts.get(1).mime); assertArrayEquals(new byte[]{1,2,3,4}, pdu.parts.get(1).data);
    }
    @Test public void malformedAndOversizedCarrierDataIsRejected() {
        for (byte[] data : new byte[][]{new byte[]{(byte)0x83,'h'}, new byte[]{(byte)0x84,(byte)0xb3,1,127,1}, new byte[MmsCodec.LIMIT+1]}) {
            try { MmsCodec.decode(data); fail(); } catch (IllegalArgumentException expected) { assertNotNull(expected.getMessage()); }
        }
    }
}
