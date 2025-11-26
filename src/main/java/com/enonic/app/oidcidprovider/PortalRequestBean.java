package com.enonic.app.oidcidprovider;

import java.util.Collections;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.locks.Lock;
import java.util.concurrent.locks.ReentrantLock;

import com.enonic.app.oidcidprovider.mapper.ContextMapper;
import com.enonic.xp.portal.PortalRequest;
import com.enonic.xp.script.bean.BeanContext;
import com.enonic.xp.script.bean.ScriptBean;
import com.enonic.xp.web.HttpStatus;
import com.enonic.xp.web.WebException;
import com.enonic.xp.web.servlet.ServletRequestUrlHelper;
import com.enonic.xp.web.servlet.UriRewritingResult;
import com.enonic.xp.web.vhost.VirtualHost;
import com.enonic.xp.web.vhost.VirtualHostHelper;

public class PortalRequestBean
    implements ScriptBean
{
    private static final Lock LOCK = new ReentrantLock();

    private String contextSessionKey;

    private String idTokenSessionKey;

    private String autoLoginAttr;

    private PortalRequest portalRequest;

    public String getRequestUrl()
    {
        return ServletRequestUrlHelper.getFullUrl( this.portalRequest.getRawRequest() );
    }

    public void storeContext( final String state, final String nonce, final String originalUrl, final String redirectUri, final String codeVerifier )
    {
        LOCK.lock();
        try
        {
            final var contextMap = new ConcurrentHashMap<String, Map<String, String>>();

            final var session = portalRequest.getRawRequest().getSession( true );
            Map<String, Map<String, String>> existingContextMap = (Map) session.getAttribute( contextSessionKey );

            if ( existingContextMap != null )
            {
                contextMap.putAll( existingContextMap );
            }

            final Context context =
                Context.create().state( state ).nonce( nonce ).originalUrl( originalUrl ).redirectUri( redirectUri ).codeVerifier( codeVerifier ).build();

            contextMap.put( state, context.asMap() );

            session.setAttribute( contextSessionKey, Collections.unmodifiableMap( contextMap ) );
        }
        finally
        {
            LOCK.unlock();
        }

    }

    public ContextMapper removeContext( final String state )
    {
        LOCK.lock();
        try
        {
            final var session = portalRequest.getRawRequest().getSession( false );

            if ( session == null )
            {
                throw new WebException( HttpStatus.UNAUTHORIZED, "No session" );
            }

            final Map<String, Map<String, String>> contextMap = (Map) session.getAttribute( contextSessionKey );
            session.removeAttribute( contextSessionKey );

            if ( contextMap == null )
            {
                throw new WebException( HttpStatus.CONFLICT, "Invalid authentication flow" );
            }

            final Map<String, String> context = contextMap.get( state );

            if ( context == null )
            {
                throw new WebException( HttpStatus.CONFLICT, "Invalid state parameter" );
            }

            if ( !state.equals( context.get( "state" ) ) )
            {
                throw new IllegalStateException( "Session state mismatch" );
            }

            return ContextMapper.from( Context.fromMap( context ) );
        }
        finally
        {
            LOCK.unlock();
        }

    }

    public void storeIdToken( final String idToken )
    {
        final var session = portalRequest.getRawRequest().getSession( true );
        session.setAttribute( idTokenSessionKey, idToken );
    }

    public String getIdToken()
    {
        final var session = portalRequest.getRawRequest().getSession( false );
        return session != null ? (String) session.getAttribute( idTokenSessionKey ) : null;
    }

    public void autoLoginFailed()
    {
        this.portalRequest.getRawRequest().setAttribute( autoLoginAttr, Boolean.TRUE );
    }

    public boolean isAutoLoginFailed()
    {
        return Boolean.TRUE.equals( this.portalRequest.getRawRequest().getAttribute( autoLoginAttr ) );
    }

    public String getRedirectUri()
    {
        final VirtualHost virtualHost = VirtualHostHelper.getVirtualHost( portalRequest.getRawRequest() );

        final UriRewritingResult rewritingResult =
            ServletRequestUrlHelper.rewriteUri( portalRequest.getRawRequest(), virtualHost.getTarget() );

        if ( rewritingResult.isOutOfScope() )
        {
            throw new IllegalStateException( "URI out of scope on vhost target " + virtualHost.getTarget() );
        }

        final String rewrittenUri = rewritingResult.getRewrittenUri();

        final String path = rewrittenUri.endsWith( "/" ) ? rewrittenUri.substring( 0, rewrittenUri.length() - 1 ) : rewrittenUri;

        return ServletRequestUrlHelper.getServerUrl( portalRequest.getRawRequest() ) + path + "/_/idprovider/" +
            virtualHost.getDefaultIdProviderKey().toString();
    }

    @Override
    public void initialize( final BeanContext context )
    {
        this.contextSessionKey = context.getApplicationKey() + ".context";
        this.idTokenSessionKey = context.getApplicationKey() + ".idtoken";
        this.autoLoginAttr = context.getApplicationKey() + ".autoLoginFailed";
        this.portalRequest = context.getBinding( PortalRequest.class ).get();
    }
}
