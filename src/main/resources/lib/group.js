//  The majority of this code is copied from https://github.com/enonic/app-azure-ad-idprovider, licensed under Apache 2.0.

const authLib = require('/lib/xp/auth')
const httpClient = require('/lib/http-client');
const contextLib = require('/lib/xp/context')
const configLib = require('/lib/config')

const addMembers = authLib.addMembers;
const createGroup = authLib.createGroup;
const getIdProviderConfig = configLib.getIdProviderConfig;
const getPrincipal = authLib.getPrincipal
const modifyGroup = authLib.modifyGroup;
const removeMembers = authLib.removeMembers;
const sendRequest = httpClient.request;
const getMemberships = authLib.getMemberships;
const forceArray = (data) => (Array.isArray(data) ? data : [data]);

exports.createAndUpdateGroupsFromJwt = function(params, idProviderConfig) {
    log.debug('idProviderConfig:' + toStr(idProviderConfig));

    var createAndUpdateGroupsOnLoginFromGraphApi = !!idProviderConfig.createAndUpdateGroupsOnLoginFromGraphApi;
    log.debug('createAndUpdateGroupsOnLoginFromGraphApi:' + toStr(createAndUpdateGroupsOnLoginFromGraphApi));

    if (createAndUpdateGroupsOnLoginFromGraphApi) {
        return fromGraph(params, idProviderConfig);
    }
}; // createAndUpdateGroupsFromJwt

// get groups from graph api
function fromGraph(params, idProviderConfig) {
    // https://docs.microsoft.com/en-us/graph/api/user-list-memberof?view=graph-rest-1.0&tabs=cs
    // https://developer.microsoft.com/en-us/graph/graph-explorer?request=me/memberOf&method=GET&version=v1.0&GraphUrl=https://graph.microsoft.com
    var groupPrefix = idProviderConfig.groupPrefix;
    log.debug("groupPrefix: %s", groupPrefix);
    
    var pageSize = idProviderConfig.pageSize ? '?$top=' + idProviderConfig.pageSize : '';

    var groupRequest = {
        method: 'GET',
        url: 'https://graph.microsoft.com/v1.0/users/' + params.jwt.payload.oid + '/memberOf' + pageSize,
        headers: {
            Accept: 'application/json',
            Authorization: 'Bearer ' + params.accessToken
        },
        proxy: idProviderConfig.proxy
    };
    
    var groupResponse = sendRequest(groupRequest);

    var body = JSON.parse(groupResponse.body);
    if (body && body.value) {
        // find users current ad groups
        var groupKeysInXp = getGroups(params.user.key)
            .filter(function(group) {
                return group.key.startsWith(`group:${params.user.idProvider}:${groupPrefix}`);
            })
            .map(function(group) {
                return group.key;
            });

        // create or modify groups and add the user to the group
        var groups = body.value;

        // filter groups
        if (idProviderConfig.groupFilter && idProviderConfig.groupFilter.length > 0) {
            var groupFilters = forceArray(idProviderConfig.groupFilter);
            var checkGroups = groupFilters.reduce((t, f) => {
                f.regexp = new RegExp(f.regexp)
                if(f.and === true || t[t.length -1].length === 0) {
                    t[t.length -1].push(f);
                } else{
                    t.push([f]);
                }
                return t;
            }, [[]])

            log.debug('groupFilters:' + toStr(checkGroups))

            groups = groups.reduce((filteredGroups, group) => {
                for(let i = 0; i < checkGroups.length; i++) {
                    var checkGroup = checkGroups[i];
                    var match = false;
                    for(let j = 0; j < checkGroup.length; j++) {
                        var filter = checkGroup[j];
                        if(filter.regexp.test(group[filter.groupProperty])) {
                            match = true;
                        } else {
                            match = false;
                            break;
                        }
                    }
                    if(match) {
                        filteredGroups.push(group);
                        break;
                    }
                }
                return filteredGroups;
            }, [])
            log.debug('groupsAfterFilter:' + toStr(groups));
        }

        var groupKeysinAd = [];
        groups.forEach(function(adGroup) {
            var xpGroup = createOrModify({
                idProvider: params.user.idProvider,
                name: sanitizeName(`${groupPrefix}${adGroup.id}`),
                displayName: adGroup.displayName,
                description: adGroup.description
            });
            groupKeysinAd.push(xpGroup.key);
        });
        log.debug('groupKeysinAd:' + toStr(groupKeysinAd));

        var newGroupKeys = inFirstButNotInSecond(groupKeysinAd, groupKeysInXp);
        log.debug('newGroupKeys:' + toStr(newGroupKeys));

        var oldGroupKeys = inFirstButNotInSecond(groupKeysInXp, groupKeysinAd);
        log.debug('oldGroupKeys:' + toStr(oldGroupKeys));

        newGroupKeys.forEach(function(groupKey) {
            addUser({
                groupKey: groupKey,
                userKey: params.user.key
            });
        });

        oldGroupKeys.forEach(function(groupKey) {
            removeUser({
                groupKey: groupKey,
                userKey: params.user.key
            });
        });
        return groupKeysinAd
    } else {
        log.debug('Could not load and create groups on login, turn on debug to see more infomation');
    }
}

function inFirstButNotInSecond(a1, a2) {
	var a2obj = {};
	a2.forEach(function(v2) {
		a2obj[v2] = true;
	});
	return a1.filter(function(v1) {
		return !a2obj.hasOwnProperty(v1);
	});
};

function runAsAdmin(callback) {
    return contextLib.run({
        user: {
            login: 'su',
            idProvider: 'system'
        },
        principals: ["role:system.admin"]
    }, callback);
};

function toStr(value) {
	var replacer = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : null;
	var space = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 4;
	return JSON.stringify(value, replacer, space);
};

function sanitizeName(name) {
	return name.toLowerCase()
		.replace(/[!"()]+/g, '') // ASCII removed.
		.replace(/[#$%&'*+,/:;<=>?@[\\\]^_`{|}~\s]+/g, '-') // ASCII replaced.
		.replace(/[æÆ]/g, 'ae').replace(/[øØ]/g, 'o').replace(/[åÅ]/g, 'a') // Norwegian chars.
		.replace(/[äÄ]/g, 'ae').replace(/[öÖ]/g, 'o') // Swedish chars.
		.replace(/--+/g, '-') // Two or more dashes becomes just one.
		.replace(/^[-.]+/, '') // Do not begin with - or .
		.replace(/[-.]+$/, ''); // Do not end in - or .
};

function getGroups(principalKey) {
	var principals = runAsAdmin(function() {
		return getMemberships(principalKey);
	});
	log.debug('getGroups(' + toStr(principalKey) + ') principals:' + toStr(principals));
	var groups = principals.filter(function(principal) {
		return principal.type === 'group';
	});
	log.debug('getGroups(' + toStr(principalKey) + ') -->' + toStr(groups));
	return groups;
};


function createOrModify(params) {
    log.debug('createOrModify(' + toStr(params) + ')');

    var group = runAsAdmin(function() {
        return getPrincipal('group:' + params.idProvider + ':' + params.name);
    });
    //log.debug('getPrincipalResult:' + toStr(group));

    if (group) {
        if (group.displayName === params.displayName && group.description === params.description) {
            log.debug('unchanged group:' + toStr(group));
        } else {
            group = runAsAdmin(function() {
                return modifyGroup({
                    key: group.key,
                    editor: function(c) {
                        c.displayName = params.displayName;
                        c.description = params.description || '';
                        return c;
                    }
                });
            });
            log.debug('modified group:' + toStr(group));
        }
    } else {
        runAsAdmin(function() {
            group = createGroup(params);
        });
        log.debug('created group:' + toStr(group));
    }
    return group;
} // function createOrModify

function addUser(params) {
    var addMembersResult = runAsAdmin(function() {
        return addMembers(params.groupKey, [params.userKey]);
    });
    log.debug('addMembersResult:' + toStr(addMembersResult)); // In Enonic XP 6.9.2 return undefined even if group is unmodified
}


function removeUser(params) {
    log.debug('removeUser(' + toStr(params) + ')');
    var removeMembersResult = runAsAdmin(function() {
        return removeMembers(params.groupKey, [params.userKey]);
    });
    log.debug('removeMembersResult:' + toStr(removeMembersResult));
}