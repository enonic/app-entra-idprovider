function getRequestUrl() {
    var bean = __.newBean('com.enonic.app.oidcidprovider.PortalRequestBean');
    return bean.getRequestUrl();
}

function storeContext(params) {
    var bean = __.newBean('com.enonic.app.oidcidprovider.PortalRequestBean');
    bean.storeContext(params.state, params.nonce, params.originalUrl, params.redirectUri, params.codeVerifier);
}

function removeContext(state) {
    var bean = __.newBean('com.enonic.app.oidcidprovider.PortalRequestBean');
    return __.toNativeObject(bean.removeContext(state));
}

function storeIdToken(idToken) {
    var bean = __.newBean('com.enonic.app.oidcidprovider.PortalRequestBean');
    bean.storeIdToken(idToken);
}

function getIdToken() {
    var bean = __.newBean('com.enonic.app.oidcidprovider.PortalRequestBean');
    return bean.getIdToken();
}

function autoLoginFailed() {
    const bean = __.newBean('com.enonic.app.oidcidprovider.PortalRequestBean');
    bean.autoLoginFailed();
}

function isAutoLoginFailed() {
    const bean = __.newBean('com.enonic.app.oidcidprovider.PortalRequestBean');
    return bean.isAutoLoginFailed();
}

function getRedirectUri() {
    const bean = __.newBean('com.enonic.app.oidcidprovider.PortalRequestBean');
    return bean.getRedirectUri();
}

exports.getRequestUrl = getRequestUrl;
exports.storeContext = storeContext;
exports.removeContext = removeContext;
exports.storeIdToken = storeIdToken;
exports.getIdToken = getIdToken;
exports.autoLoginFailed = autoLoginFailed;
exports.isAutoLoginFailed = isAutoLoginFailed;
exports.getRedirectUri = getRedirectUri;
