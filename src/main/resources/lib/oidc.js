const preconditions = require('/lib/preconditions');
const httpClient = require('/lib/http-client');

function generateToken() {
    const bean = __.newBean('com.enonic.app.oidcidprovider.OIDCUtils');
    return bean.generateToken();
}

function parseClaims(idToken, issuer, clientId, nonce, idProviderName, allowedTenants, acceptLeeway) {
    const bean = __.newBean('com.enonic.app.oidcidprovider.OIDCUtils');
    const parsedJwt = bean.parseClaims(idToken, issuer, clientId, nonce, idProviderName, allowedTenants, acceptLeeway);
    return __.toNativeObject(parsedJwt);
}

function generateJwt(jwtData, clientSecret) {
    const bean = __.newBean('com.enonic.app.oidcidprovider.OIDCUtils');
    return bean.generateJwt(jwtData, clientSecret);
}

function generateVerifier() {
    return __.newBean('com.enonic.app.oidcidprovider.OIDCUtils').generateVerifier();
}

function generateChallenge(verifier) {
    return __.newBean('com.enonic.app.oidcidprovider.OIDCUtils').generateChallenge(verifier);
}

function generateAuthorizationUrl(params) {
    const authorizationUrl = preconditions.checkParameter(params, 'authorizationUrl');
    const clientId = preconditions.checkParameter(params, 'clientId');
    const redirectUri = preconditions.checkParameter(params, 'redirectUri');
    const scope = preconditions.checkParameter(params, 'scopes');
    const state = preconditions.checkParameter(params, 'state');
    const nonce = preconditions.checkParameter(params, 'nonce');
    const codeChallenge = params.codeChallenge;

    //https://openid.net/specs/openid-connect-core-1_0.html#AuthRequest
    return authorizationUrl
           + '?response_type=code'
           + '&scope=' + encodeURIComponent(scope)
           + '&client_id=' + encodeURIComponent(clientId)
           + '&redirect_uri=' + encodeURIComponent(redirectUri)
           + '&state=' + state
           + '&nonce=' + nonce
           + (codeChallenge ? '&code_challenge_method=S256' + '&code_challenge=' + codeChallenge : '');
}

function requestIDToken(params) {
    const issuer = preconditions.checkParameter(params, 'issuer');
    const tokenUrl = preconditions.checkParameter(params, 'tokenUrl');
    const clientId = preconditions.checkParameter(params, 'clientId');
    const clientSecret = preconditions.checkParameter(params, 'clientSecret');
    const redirectUri = preconditions.checkParameter(params, 'redirectUri');
    const nonce = preconditions.checkParameter(params, 'nonce');
    const code = preconditions.checkParameter(params, 'code');
    const idProviderName = preconditions.checkParameter(params, 'idProviderName');
    const method = params.method;
    const codeVerifier = params.codeVerifier;
    const allowedTenants = params.allowedTenants || [];
    const acceptLeeway = params.acceptLeeway;

    //https://openid.net/specs/openid-connect-core-1_0.html#TokenRequest
    let requestParams = {'grant_type': 'authorization_code', 'code': code, 'redirect_uri': redirectUri};

    if (codeVerifier) {
        requestParams.code_verifier = codeVerifier;
    }

    let headers = null;

    switch (method) {
    case 'basic':
        headers = {
            'Authorization': 'Basic ' +
                             Java.type('java.util.Base64').getEncoder().encodeToString((clientId + ':' + clientSecret).getBytes())
        };
        break;
    case 'jwt':
        requestParams.client_assertion_type = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';
        requestParams.client_assertion = generateJwt({
            'iss': clientId,
            'sub': clientId,
            'aud': tokenUrl,
            'exp': Math.floor(new Date().getTime() / 1000.0 + 5 * 60),
            'iat': Math.floor(new Date().getTime() / 1000.0)
        }, clientSecret);
        break;
    case 'post':
    default:
        requestParams.client_id=clientId;
        requestParams.client_secret=clientSecret;
    }

    const request = {
        url: tokenUrl,
        method: 'POST',
        headers: headers,
        params: requestParams,
        contentType: 'application/x-www-form-urlencoded'
    };
    log.debug('Sending token request: ' + JSON.stringify(request));

    const response = httpClient.request(request);
    log.debug('Received token response: ' + JSON.stringify(response));

    if (response.status !== 200) {
        throw 'Error ' + response.status + ' while retrieving the ID Token';
    }

    const responseBody = JSON.parse(response.body);

    if (responseBody.error) {
        throw 'Token error [' + params.error + ']' + (params.error_description ? ': ' + params.error_description : '');
    }

    const claims = parseClaims(responseBody.id_token, issuer, clientId, nonce, idProviderName, allowedTenants, acceptLeeway);
    log.debug('Parsed claims: ' + JSON.stringify(claims));

    return {
        idToken: responseBody.id_token,
        accessToken: responseBody.access_token,
        claims: claims
    };
}

function requestOAuth2(params) {
    const url = preconditions.checkParameter(params, 'url');
    const accessToken = preconditions.checkParameter(params, 'accessToken');
    const request = {
        url: url,
        headers: {
            'Authorization': 'Bearer ' + accessToken
        },
        contentType: 'application/json'
    };
    log.debug('Sending user info request: ' + JSON.stringify(request));

    const response = httpClient.request(request);
    log.debug('Received user info response: ' + JSON.stringify(response));

    return JSON.parse(response.body);
}

function mergeClaims(priorityClaims, additionalClaims) {
    const claims = {};
    Object.keys(additionalClaims).forEach(claimKey => claims[claimKey] = additionalClaims[claimKey]);
    Object.keys(priorityClaims).forEach(claimKey => claims[claimKey] = priorityClaims[claimKey]);
    return claims;
}

exports.generateToken = generateToken;
exports.generateAuthorizationUrl = generateAuthorizationUrl;
exports.requestIDToken = requestIDToken;
exports.requestOAuth2 = requestOAuth2;
exports.mergeClaims = mergeClaims;
exports.generateVerifier = generateVerifier;
exports.generateChallenge = generateChallenge;
