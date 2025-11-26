const configLib = require('/lib/config');
const oidcLib = require('/lib/oidc');
const loginLib = require('/lib/login');
const requestLib = require('/lib/request');
const preconditions = require('/lib/preconditions');
const authLib = require('/lib/xp/auth');
const portalLib = require('/lib/xp/portal');
const jwtLib = require('/lib/jwt');

function redirectToAuthorizationEndpoint() {
    const idProviderConfig = configLib.getIdProviderConfig();

    if (idProviderConfig.clientId == null) {
        return {
            status: 401,
            headers: {
                'WWW-Authenticate': 'Bearer',
            }
        }
    }

    log.debug('Handling 401 error...');

    const usePkce = idProviderConfig.usePkce;
    const redirectUri = requestLib.getRedirectUri();

    const state = oidcLib.generateToken();
    const nonce = oidcLib.generateToken();
    const codeVerifier = usePkce ? oidcLib.generateVerifier() : undefined
    const codeChallenge = usePkce ? oidcLib.generateChallenge(codeVerifier) : undefined;

    const originalUrl = requestLib.getRequestUrl();
    const context = {
        state: state,
        nonce: nonce,
        codeVerifier: codeVerifier,
        originalUrl: originalUrl,
        redirectUri: redirectUri
    };
    log.debug('Storing context: ' + JSON.stringify(context));
    requestLib.storeContext(context);

    const authorizationUrl = oidcLib.generateAuthorizationUrl({
        authorizationUrl: idProviderConfig.authorizationUrl,
        clientId: idProviderConfig.clientId,
        redirectUri: redirectUri,
        scopes: 'openid' + (idProviderConfig.scopes ? ' ' + idProviderConfig.scopes : ''),
        state: state,
        nonce: nonce,
        codeChallenge: codeChallenge,
    });
    log.debug('Generated authorization URL: ' + authorizationUrl);

    return {
        redirect: authorizationUrl
    };
}

function handleAuthenticationResponse(req) {
    const params = getRequestParams(req);

    const context = requestLib.removeContext(params.state);

    if (params.error) {
        throw 'Authentication error [' + params.error + ']' + (params.error_description ? ': ' + params.error_description : '');
    }

    const idProviderConfig = configLib.getIdProviderConfig();
    if (!idProviderConfig.clientSecret) {
        throw `Missing clientSecret configuration for ${idProviderConfig._idProviderName} ID Provider`;
    }

    const code = params.code;

    const tokenResponse = requestTokenWithFallback(idProviderConfig, context, code);

    checkClaimUsername(tokenResponse.claims, idProviderConfig.claimUsername);

    loginLib.login(tokenResponse.accessToken, tokenResponse.claims, false);

    if (idProviderConfig.endSession && idProviderConfig.endSession.idTokenHintKey) {
        requestLib.storeIdToken(tokenResponse.idToken);
    }

    return {
        redirect: context.originalUrl
    };
}

function requestTokenWithFallback(idProviderConfig, context, code) {
    const secrets = idProviderConfig.clientSecret;

    let lastError;

    const idProviderName = idProviderConfig._idProviderName;

    for (const secret of secrets) {
        try {
            //https://tools.ietf.org/html/rfc6749#section-2.3.1
            const response = oidcLib.requestIDToken({
                idProviderName: idProviderName,
                issuer: idProviderConfig.issuer,
                tokenUrl: idProviderConfig.tokenUrl,
                method: idProviderConfig.method,
                clientId: idProviderConfig.clientId,
                clientSecret: secret,
                redirectUri: context.redirectUri,
                nonce: context.nonce,
                codeVerifier: context.codeVerifier,
                code: code,
                allowedTenants: idProviderConfig.allowedTenants,
                acceptLeeway: idProviderConfig.acceptLeeway,
            });

            if (!response.retry) {
                return response;
            }

            if (secrets.length > 1) {
                log.warning(
                    `Token request returned status '${response.status}' for ID Provider '${idProviderName}'. Trying fallback clientSecret...`);
            }

            lastError = new Error(`Token request returned status '${response.status}' for ID Provider '${idProviderName}'`);
        } catch (err) {
            lastError = err;
            log.error(`Token request failed for ID Provider '${idProviderName}': ${lastError}`);
        }
    }

    throw lastError;
}

function getRequestParams(req) {
    const params = req.params;
    log.debug('Checking response params: ' + JSON.stringify(params));

    preconditions.checkParameter(params, 'state');

    if (!params.error) {
        preconditions.checkParameter(params, 'code');
    }

    return params;
}

function logout(req) {
    const idToken = requestLib.getIdToken();

    authLib.logout();

    const finalRedirectUrl = (req.validTicket && req.params.redirect);

    let redirectUrl;
    const config = configLib.getIdProviderConfig();
    if (config.endSession) {
        redirectUrl = config.endSession.url;
        if ((config.endSession.idTokenHintKey && idToken) || (finalRedirectUrl && config.endSession.postLogoutRedirectUriKey) ||
            (Object.keys(config.endSession.additionalParameters).length > 0)) {
            redirectUrl += '?';

            if (config.endSession.idTokenHintKey && idToken) {
                redirectUrl += config.endSession.idTokenHintKey + '=' + idToken;
            }

            if (finalRedirectUrl && config.endSession.postLogoutRedirectUriKey) {
                if (!redirectUrl.endsWith("?")) {
                    redirectUrl += '&';
                }
                redirectUrl += config.endSession.postLogoutRedirectUriKey + '=' + encodeURIComponent(finalRedirectUrl)
            }

            config.endSession.additionalParameters.forEach(additionalParameter => {
                if (additionalParameter.key != null && additionalParameter.value != null) {
                    if (!redirectUrl.endsWith("?")) {
                        redirectUrl += '&';
                    }
                    redirectUrl += additionalParameter.key + '=' + additionalParameter.value;
                }
            });
        }
    } else {
        redirectUrl = finalRedirectUrl || generateRedirectUrl();
    }

    return {
        redirect: redirectUrl
    };
}


function generateRedirectUrl() {
    var site = portalLib.getSite();
    if (site) {
        return portalLib.pageUrl({
            id: site._id
        });
    }
    return '/';
}


exports.handle401 = redirectToAuthorizationEndpoint;
exports.get = handleAuthenticationResponse;
exports.logout = logout;

exports.autoLogin = function (req) {
    const idProviderConfig = configLib.getIdProviderConfig();
    if (!idProviderConfig.jwksUri) {
        return;
    }

    const jwtToken = extractJwtToken(req, idProviderConfig);
    log.debug(`AutoLogin: JWT Token: ${jwtToken}`);

    if (!jwtToken) {
        requestLib.autoLoginFailed();
        return;
    }

    const payload = jwtLib.validateTokenAndGetPayload(jwtToken, idProviderConfig);

    if (payload) {
        try {
            checkClaimUsername(payload, idProviderConfig.claimUsername);
            loginLib.login(jwtToken, payload, true);
        } catch (error) {
            if (error.name === 'AutoLoginFailedError') {
                log.debug(`AutoLogin failed: ${error.message}`, error);
                requestLib.autoLoginFailed();
                return;
            }
            throw error;
        }
    } else {
        requestLib.autoLoginFailed();
    }
};

function extractJwtToken(req, config) {
    const authHeader = req.headers['Authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        return authHeader.replace('Bearer ', '');
    }

    if (config.autoLogin.wsHeader) {
        const secWebSocketHeader = req.headers['Sec-WebSocket-Protocol'];
        if (secWebSocketHeader) {
            const matches = secWebSocketHeader.match(/\S+\.\S+\.\S+/g);
            if (matches && matches.length === 1) {
                return matches[0];
            }
        }
    }

    return null;
}

function checkClaimUsername(claims, claimUsername) {
    if (!claims[claimUsername]) {
        throw `Missing claim ['${claimUsername}'] in token`;
    }
}
