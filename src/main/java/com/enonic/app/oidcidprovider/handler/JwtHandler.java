package com.enonic.app.oidcidprovider.handler;

import java.util.List;
import java.util.Set;
import java.util.function.Supplier;
import java.util.stream.Collectors;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.auth0.jwt.JWT;
import com.auth0.jwt.interfaces.DecodedJWT;

import com.enonic.app.oidcidprovider.jwt.JwtUtil;
import com.enonic.app.oidcidprovider.jwt.RSAAlgorithmProvider;
import com.enonic.app.oidcidprovider.mapper.MapMapper;
import com.enonic.xp.script.bean.BeanContext;
import com.enonic.xp.script.bean.ScriptBean;
import com.enonic.xp.script.serializer.MapSerializable;

public class JwtHandler
    implements ScriptBean
{
    private final Logger LOG = LoggerFactory.getLogger( JwtHandler.class );

    private Supplier<IdProviderConfigService> idProviderConfigServiceSupplier;

    @Override
    public void initialize( final BeanContext context )
    {
        this.idProviderConfigServiceSupplier = context.getService( IdProviderConfigService.class );
    }

    public MapSerializable validateTokenAndGetPayload( final String jwtToken, final String idProviderName, final List<String> allowedAudience )
    {
        if ( jwtToken == null )
        {
            return null;
        }

        try
        {
            DecodedJWT decodedJwt = JWT.decode( jwtToken );

            if ( !allowedAudience.isEmpty() && decodedJwt.getAudience() != null )
            {
                Set<String> intersection =
                    decodedJwt.getAudience().stream().distinct().filter( allowedAudience::contains ).collect( Collectors.toSet() );
                if ( intersection.isEmpty() )
                {
                    LOG.debug( "Invalid audience: {}", decodedJwt.getAudience() );
                    return null;
                }
            }

            RSAAlgorithmProvider rsaAlgorithmProvider = idProviderConfigServiceSupplier.get().getAlgorithmProvider( idProviderName );

            JWT.require( rsaAlgorithmProvider.getAlgorithm( decodedJwt.getAlgorithm() ) ).acceptLeeway( 1 ).   // 1 sec for nbf and iat
                build().verify( decodedJwt );

            return new MapMapper( JwtUtil.parsePayload( decodedJwt.getPayload() ) );
        }
        catch ( Exception e )
        {
            LOG.debug( "Failed to validate token: {}", e.getMessage() );
            return null;
        }
    }
}
