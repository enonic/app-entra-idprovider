package com.enonic.app.oidcidprovider;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;
import java.util.Map;
import java.util.Objects;
import java.util.function.Supplier;

import com.auth0.jwt.JWT;
import com.auth0.jwt.JWTVerifier;
import com.auth0.jwt.algorithms.Algorithm;
import com.auth0.jwt.interfaces.DecodedJWT;

import com.enonic.app.oidcidprovider.handler.IdProviderConfigService;
import com.enonic.app.oidcidprovider.jwt.JwtUtil;
import com.enonic.app.oidcidprovider.jwt.RSAAlgorithmProvider;
import com.enonic.app.oidcidprovider.mapper.MapMapper;
import com.enonic.xp.script.bean.BeanContext;
import com.enonic.xp.script.bean.ScriptBean;
import com.enonic.xp.script.serializer.MapSerializable;

public class OIDCUtils
    implements ScriptBean
{
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    private static final Base64.Encoder B64URL_NOPAD = Base64.getUrlEncoder().withoutPadding();

    private static final String TENANT_ID_PLACEHOLDER = "{tenantid}";

    private Supplier<IdProviderConfigService> idProviderConfigServiceSupplier;

    public String generateToken()
    {
        return new BigInteger( 130, SECURE_RANDOM ).toString( 32 );
    }

    public String generateVerifier()
    {
        final byte[] bytes = new byte[32];
        SECURE_RANDOM.nextBytes( bytes );
        return B64URL_NOPAD.encodeToString( bytes );
    }

    public String generateChallenge( String verifier )
    {
        return B64URL_NOPAD.encodeToString( sha256().digest( verifier.getBytes( StandardCharsets.ISO_8859_1 ) ) );
    }

    public MessageDigest sha256()
    {
        try
        {
            return MessageDigest.getInstance( "SHA-256" );
        }
        catch ( NoSuchAlgorithmException e )
        {
            throw new AssertionError( e );
        }
    }

    public MapSerializable parseClaims( final String idToken, final String issuer, final String clientID, final String nonce,
                                       final String idProviderName, final String[] allowedTenants, final Long acceptLeeway )
        throws Exception
    {
        final DecodedJWT decodedJWT = JWT.decode( idToken );

        final RSAAlgorithmProvider rsaAlgorithmProvider = idProviderConfigServiceSupplier.get().getAlgorithmProvider( idProviderName );

        final Algorithm algorithm;
        if ( rsaAlgorithmProvider != null )
        {
            // We only support RS256, RS384 and RS512 algorithms
            algorithm = rsaAlgorithmProvider.getAlgorithm( decodedJWT.getAlgorithm() );
        }
        else
        {
            // We don't have access to Public Key, so we can't verify the signature
            // But, according to OIDC Specification https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation
            // TLS server validation MAY be used to validate the issuer in place of checking the token signature
            // auth0.jwt library requires algorithm to be set, so we use none() algorithm as a workaround - to verify claims only
            algorithm = Algorithm.none();
        }

        String resolvedIssuer;
        if ( issuer.contains( TENANT_ID_PLACEHOLDER ) )
        {
            final String tid = decodedJWT.getClaim( "tid" ).asString();
            if ( allowedTenants == null || Arrays.stream( allowedTenants ).noneMatch( p -> "*".equals( p ) || Objects.equals( p, tid ) ) )
            {
                throw new IllegalStateException( "Invalid TenantId: " + tid );
            }
            resolvedIssuer = issuer.replace( TENANT_ID_PLACEHOLDER, tid );
        }
        else
        {
            resolvedIssuer = issuer;
        }

        final JWTVerifier verifier = JWT.require( algorithm )
            .withIssuer( resolvedIssuer )
            .withAudience( clientID )
            .withClaim( "nonce", nonce )
            .acceptLeeway( acceptLeeway )
            .build();

        final Map<String, Object> decodedPayload = JwtUtil.parsePayload( decodedJWT.getPayload() );

        if ( rsaAlgorithmProvider != null )
        {
            verifier.verify( decodedJWT );
        }
        else
        {
            verifier.verify( JWT.create().withPayload( decodedPayload ).sign( Algorithm.none() ) );
        }

        return new MapMapper( decodedPayload );
    }

    public String generateJwt( final Map<String, Object> message, final String clientSecret )
    {
        return JWT.create().withPayload( message ).sign( Algorithm.HMAC256( clientSecret ) );
    }

    @Override
    public void initialize( final BeanContext beanContext )
    {
        this.idProviderConfigServiceSupplier = beanContext.getService( IdProviderConfigService.class );
    }
}
