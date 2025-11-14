// Based on app-simple-idprovider

const beanService = require("/lib/configFile/services/bean");
const configFileLib = require("/lib/configFile/configFile");


/**
 * Check all idproviders by name
 *
 * @param {Array} providers
 * @returns {Boolean} true if exists, false if not
 */
function exists(providers, name) {
    for (const count in providers) {
        const provider = providers[count];
        if (provider && provider.key === name) {
            log.info(`Userstore '${name}' already exists - no autoinit.`);
            return true;
        }
    }
    log.info(`Userstore '${name}' doesn't exist yet. Will try autoinit.`);
    return false;
}

exports.initUserStores = function() {
    const systemIdProviders = beanService.getIdProviders();
    const configedIdProviderNames = configFileLib.getAllIdProviderNames();

    configedIdProviderNames.forEach(idProviderName => {
        if (
            configFileLib.shouldAutoInit() &&
            !exists(systemIdProviders, idProviderName)
        ) {
            log.info(`Autoinit: creating userstore '${idProviderName}'...`);

            const config = configFileLib.getConfigForIdProvider(idProviderName);
            const displayName = config.displayName || idProviderName;
            const description = config.description || `${configFileLib.CONFIG_NAMESPACE}.${idProviderName} in ${app.config["config.filename"]}`;

            const result = beanService.createIdProvider({
                name: idProviderName,
                displayName: displayName,
                description: description,
                idProviderConfig: {
                    description: description,
                    applicationKey: app.name,
                },
                permissions: [],
            });

            if (result) {
                log.info(`Autoinit: success, created userstore: ${JSON.stringify({
                    name: idProviderName,
                    displayName,
                    description
                })}`);

            } else {
                log.warning(`Autoinit: something went wrong trying to create userstore '${idProviderName}'.`);
                log.debug("createIdProvider result:");
                log.debug(result);
            }
        }
    });
}
