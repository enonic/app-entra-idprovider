package com.enonic.app.oidcidprovider.jwt;


import java.util.Map;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class JwtUtilTest
{
    @Test
    void base64UrlSupported()
    {
        // this payload contains underscore and won't be accepted by non-url safe base64 decoder
        assertEquals( Map.of( "sub", "Åoå" ), JwtUtil.parsePayload( "eyJzdWIiOiLDhW_DpSJ9" ) );
    }
}
