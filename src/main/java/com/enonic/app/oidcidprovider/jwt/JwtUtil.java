package com.enonic.app.oidcidprovider.jwt;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.Base64;
import java.util.Map;

import com.fasterxml.jackson.databind.ObjectMapper;

public final class JwtUtil
{
    private static final ObjectMapper MAPPER = new ObjectMapper();

    public static Map<String, Object> parsePayload( String base64Payload )
    {
        try
        {
            return MAPPER.readValue( Base64.getUrlDecoder().decode( base64Payload ), Map.class );
        }
        catch ( IOException e )
        {
            throw new UncheckedIOException( e );
        }
    }
}
