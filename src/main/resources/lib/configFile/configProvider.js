const getConfigService = require('/lib/configFile/services/getConfig');
const wellKnownService = require('/lib/configFile/wellKnownService');

const END_SESSION_ADDITIONAL_PARAMETERS_PATTERN = '^idprovider\.[a-zA-Z0-9_-]+\.endSession\.additionalParameters\.(\\d+)\.(key|value)$';
const ADDITIONAL_ENDPOINTS = "^idprovider\.[a-zA-Z0-9_-]+\.additionalEndpoints\.(\\d+)\.(name|url)$";
const GROUP_FILTER =
    /^idprovider\.[a-zA-Z0-9_-]+\.groupFilter\.(\d+)\.(groupProperty|regexp|and)$/;

const parseStringArray = value => value ? value.split(' ').filter(v => !!v) : [];
const firstAtsToDollar = value => value ? value.replace(/@@\{/g, '${') : value;
const defaultBooleanTrue = value => value !== 'false';
const parseLong = (value, defaultValue) => /^-?\d+$/.test(value) ? +value : defaultValue;

exports.getIdProviderConfig = function (idProviderName) {
    const cachedConfig = wellKnownService.getIdProviderConfig(idProviderName);
    if (cachedConfig) {
        return cachedConfig;
    }

    const idProviderKeyBase = `idprovider.${idProviderName}`;

    const rawIdProviderConfig = getRawIdProviderConfig(idProviderKeyBase);

    const config = {
        _idProviderName: idProviderName,

        usePkce: defaultBooleanTrue(rawIdProviderConfig[`${idProviderKeyBase}.usePkce`]),
        displayName: rawIdProviderConfig[`${idProviderKeyBase}.displayName`] || null,
        description: rawIdProviderConfig[`${idProviderKeyBase}.description`] || null,

        oidcWellKnownEndpoint: rawIdProviderConfig[`${idProviderKeyBase}.oidcWellKnownEndpoint`] || null,
        issuer: rawIdProviderConfig[`${idProviderKeyBase}.issuer`] || null,
        authorizationUrl: rawIdProviderConfig[`${idProviderKeyBase}.authorizationUrl`] || null,
        tokenUrl: rawIdProviderConfig[`${idProviderKeyBase}.tokenUrl`] || null,
        userinfoUrl: rawIdProviderConfig[`${idProviderKeyBase}.userinfoUrl`] || null,
        jwksUri: rawIdProviderConfig[`${idProviderKeyBase}.jwksUri`] || null,
        useUserinfo: defaultBooleanTrue(rawIdProviderConfig[`${idProviderKeyBase}.useUserinfo`]),
        method: rawIdProviderConfig[`${idProviderKeyBase}.method`] || 'post',
        scopes: parseStringArray(rawIdProviderConfig[`${idProviderKeyBase}.scopes`]).join(' ') || 'profile email',
        clientId: rawIdProviderConfig[`${idProviderKeyBase}.clientId`] || null,
        clientSecret: rawIdProviderConfig[`${idProviderKeyBase}.clientSecret`] || null,
        defaultGroups: parseStringArray(rawIdProviderConfig[`${idProviderKeyBase}.defaultGroups`]),
        claimUsername: rawIdProviderConfig[`${idProviderKeyBase}.claimUsername`] || 'oid',
        mappings: {
            displayName: firstAtsToDollar(rawIdProviderConfig[`${idProviderKeyBase}.mappings.displayName`]) ||
                         '${userinfo.preferred_username}',
            email: firstAtsToDollar(rawIdProviderConfig[`${idProviderKeyBase}.mappings.email`]) || '${userinfo.email}',
        },
        rules: {
            forceEmailVerification: rawIdProviderConfig[`${idProviderKeyBase}.rules.forceEmailVerification`] === 'true',
        },
        additionalEndpoints: extractPropertiesToArray(rawIdProviderConfig, `${idProviderKeyBase}.additionalEndpoints.`,
            ADDITIONAL_ENDPOINTS),
        autoLogin: {
            createUser: defaultBooleanTrue(rawIdProviderConfig[`${idProviderKeyBase}.autoLogin.createUser`]),
            createSession: rawIdProviderConfig[`${idProviderKeyBase}.autoLogin.createSession`] === 'true' || false,
            wsHeader: rawIdProviderConfig[`${idProviderKeyBase}.autoLogin.wsHeader`] === 'true' || false,
            allowedAudience: parseStringArray(rawIdProviderConfig[`${idProviderKeyBase}.autoLogin.allowedAudience`]),
        },
        userEventPrefix: rawIdProviderConfig[`${idProviderKeyBase}.userEventPrefix`] || app.name,
        userEventMode: rawIdProviderConfig[`${idProviderKeyBase}.userEventMode`] || 'local',
        createAndUpdateGroupsOnLoginFromGraphApi: rawIdProviderConfig[`${idProviderKeyBase}.createAndUpdateGroupsOnLoginFromGraphApi`] ===
                                                  'true' || false,
        pageSize: rawIdProviderConfig[`${idProviderKeyBase}.pageSize`] || null,
        groupPrefix: rawIdProviderConfig[`${idProviderKeyBase}.groupPrefix`] || 'azure-ad',
        allowedTenants: parseStringArray(rawIdProviderConfig[`${idProviderKeyBase}.allowedTenants`]),
        acceptLeeway: parseLong(rawIdProviderConfig[`${idProviderKeyBase}.acceptLeeway`], 1),
    };

    if (hasProperty(rawIdProviderConfig, idProviderKeyBase, 'groupFilter')) {
        config.groupFilter = extractPropertiesToArray(
            rawIdProviderConfig,
            `${idProviderKeyBase}.groupFilter.`,
            GROUP_FILTER
        );
    }

    if (hasProperty(rawIdProviderConfig, idProviderKeyBase, 'endSession')) {
        config.endSession = {
            url: required(rawIdProviderConfig[`${idProviderKeyBase}.endSession.url`], 'endSession.url', idProviderName),
            idTokenHintKey: rawIdProviderConfig[`${idProviderKeyBase}.endSession.idTokenHintKey`] || null,
            postLogoutRedirectUriKey: rawIdProviderConfig[`${idProviderKeyBase}.endSession.postLogoutRedirectUriKey`] || null,
            additionalParameters: extractPropertiesToArray(rawIdProviderConfig, `${idProviderKeyBase}.endSession.additionalParameters.`,
                END_SESSION_ADDITIONAL_PARAMETERS_PATTERN),
        }
    }

    if (config.oidcWellKnownEndpoint != null) {
        takeConfigurationFromWellKnownEndpoint(config);
    }

    if (hasProperty(rawIdProviderConfig, idProviderKeyBase, 'proxy')) {
        config.proxy = {
            host: required(rawIdProviderConfig[`${idProviderKeyBase}.proxy.host`], 'proxy.host', idProviderName),
            port: rawIdProviderConfig[`${idProviderKeyBase}.proxy.port`] || null,
            user: rawIdProviderConfig[`${idProviderKeyBase}.proxy.user`] || null,
            password: rawIdProviderConfig[`${idProviderKeyBase}.proxy.password`] || null,
        }
    }

    validate(config, idProviderName);

    wellKnownService.cacheIdProviderConfig(idProviderName, config);

    return config;
};

function getRawIdProviderConfig(idProviderKeyBase) {
    const result = {};
    const appConfig = getConfigService.getConfigOrEmpty();

    Object.keys(appConfig).filter(k => k && (k.startsWith(idProviderKeyBase))).forEach(k => result[k] = appConfig[k]);

    return result;
}

function hasProperty(idProviderConfig, idProviderKeyBase, property) {
    const properties = Object.keys(idProviderConfig).filter(k => k.startsWith(`${idProviderKeyBase}.${property}`));
    return properties.length > 0;
}

function takeConfigurationFromWellKnownEndpoint(config) {
    const wellKnownConfiguration = wellKnownService.getWellKnownConfiguration(config.oidcWellKnownEndpoint);

    config.issuer = wellKnownConfiguration.issuer;
    config.authorizationUrl = wellKnownConfiguration.authorization_endpoint;
    config.tokenUrl = wellKnownConfiguration.token_endpoint;
    config.userinfoUrl = wellKnownConfiguration.userinfo_endpoint;
    config.jwksUri = wellKnownConfiguration.jwks_uri;
}

function validate(config, idProviderName) {
    checkConfig(config, 'issuer', idProviderName);
    checkConfig(config, 'authorizationUrl', idProviderName);
    checkConfig(config, 'tokenUrl', idProviderName);

    if (config.clientId != null) {
        checkConfig(config, 'clientSecret', idProviderName);
    }
    if (config.clientSecret != null) {
        checkConfig(config, 'clientId', idProviderName);
    }

    checkArrayConfig(config.additionalEndpoints, 'additionalEndpoints', idProviderName);
    if (config.endSession) {
        checkArrayConfig(config.endSession.additionalParameters, 'endSession.additionalParameters', idProviderName);
    }
}

function extractPropertiesToArray(rawConfig, basePropertyPath, propertyPattern) {
    const options = Object.keys(rawConfig).filter(k => k && k.startsWith(basePropertyPath));

    const result = [];

    options.forEach(option => {
        const match = option.match(propertyPattern);
        if (match) {
            const index = parseInt(match[1], 10);
            const propertyName = match[2];
            if (!result[index]) {
                result[index] = {};
            }
            result[index][propertyName] = rawConfig[option];
        }
    });

    return result;
}

function required(value, name, idProviderName) {
    if (value == null) {
        throw `Missing config '${name}' for ID Provider '${idProviderName}'.`;
    }
    return value;
}

function checkConfig(params, name, idProviderName) {
    const value = params[name];
    return required(value, name, idProviderName);
}

function checkArrayConfig(items, name, idProviderName) {
    items.forEach(item => {
        if (Object.keys(item).length !== 2) {
            throw `Invalid configuration of '${name}' for ID Provider '${idProviderName}'.`;
        }
    })
}
