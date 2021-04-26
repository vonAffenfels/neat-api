"use strict";

const Application = require("neat-base").Application;
const Module = require("neat-base").Module;
const Tools = require("neat-base").Tools;
const redis = require("redis");
const apeStatus = require('ape-status');
const Promise = require("bluebird");
const crypto = require('crypto');
const fs = require('fs');
const pathToRegexp = require('path-to-regexp');

module.exports = class Api extends Module {

    static defaultConfig() {
        return {
            loginPath: "/login",
            elementsModuleName: "elements",
            webserverModuleName: "webserver",
            projectionModuleName: "projection",
            cacheModuleName: "cache",
            dbModuleName: "database",
            authModuleName: "auth",
        };
    }

    init() {
        return new Promise((resolve, reject) => {
            this.log.debug("Initializing...");

            if (Application.modules[this.config.webserverModuleName]) {
                Application.modules[this.config.webserverModuleName].addRoute("post", "/api/:model/:action", (req, res, next) => {
                    this.handleRequest(req, res);
                }, 9999);
                Application.modules[this.config.webserverModuleName].addRoute("get", "/api/:model/changes/:type/:projection/:from?/:to?", (req, res, next) => {
                    this.handleChangesRequest(req, res);
                }, 9999);
            }

            return this.loadStaticPages().then(() => {
                return resolve(this);
            });
        });
    }

    handleRequest(req, res) {

        let model, userModel;

        try {
            model = Application.modules[this.config.dbModuleName].getModel(req.params.model);
        } catch (e) {
            res.status(400);
            return res.err("model " + req.params.model + " does not exist");
        }

        try {
            userModel = Application.modules[this.config.dbModuleName].getModel("user");
        } catch (e) {
        }

        let mongoose = Application.modules[this.config.dbModuleName].mongoose;
        let limit = req.body.limit || 10;
        let page = req.body.page || 0;
        let sort = req.body.sort || {};
        let query = req.body.query || {};
        let select = req.body.select || {};
        let field = req.body.field || null;
        let populate = req.body.populate || [];
        let projection = req.body.projection || null;
        let dbQuery;
        let data = req.body.data;
        let isFilteringForOwnData = query._createdBy && req.user && query._createdBy + "" === req.user._id + "";

        switch (req.params.action) {
            case "find":
                if (Application.modules[this.config.authModuleName]) {
                    if (!Application.modules[this.config.authModuleName].hasPermission(req, req.params.model, req.params.action)) {
                        return res.status(401).end();
                    }
                }

                dbQuery = model.find(query).limit(limit).skip(limit * page).populate(populate).select(select).sort(sort);

                // if the request didn't ask for a projection allow this only if the user has either complete access to the model or the specific action permission
                if (!projection) {
                    if ((!req.user || !req.user.hasPermission([
                        req.params.model,
                        req.params.model + "." + req.params.action,
                    ])) && !isFilteringForOwnData) {
                        return res.status(401).end("No projection given or no permission to use this projection. Or the projection is missing in the config...");
                    }
                } else if (projection && Application.modules[this.config.projectionModuleName]) {
                    // check if the current user has permission to use this projection
                    if (!Application.modules[this.config.projectionModuleName].hasPermission(req.user, req.params.model, projection)) {
                        return res.status(401).end("No projection given or no permission to use this projection");
                    }

                    dbQuery.projection(projection, req);
                }

                dbQuery.exec().then((docs) => {
                    res.json(docs);
                }, (err) => {
                    res.err(err);
                });
                break;
            case "findOne":
                if (Application.modules[this.config.authModuleName]) {
                    if (!Application.modules[this.config.authModuleName].hasPermission(req, req.params.model, req.params.action)) {
                        return res.status(401).end();
                    }
                }

                dbQuery = model.findOne(query).select(select).sort(sort).populate(populate);

                if (projection && Application.modules[this.config.projectionModuleName]) {
                    dbQuery.projection(projection, req);
                }

                dbQuery.exec().then((doc) => {
                    res.json(doc);
                }, (err) => {
                    res.err(err);
                });
                break;
            case "versions":
                if (Application.modules[this.config.authModuleName]) {
                    if (!Application.modules[this.config.authModuleName].hasPermission(req, req.params.model, req.params.action)) {
                        return res.status(401).end();
                    }
                }

                if (populate && populate.length) {
                    select = null;
                }

                model.findOne(query).select(select).sort(sort).then((doc) => {
                    return Promise.map(doc.get("_versions"), (obj) => {
                        if (select) {
                            return obj;
                        } else {
                            let doc = new model(obj);
                            return doc.populate(populate).execPopulate();
                        }
                    }).then((docs) => {
                        return res.json(docs);
                    });
                }, (err) => {
                    res.err(err);
                });
                break;
            case "unpublished":
                if (!req.body._ids || !req.body._ids instanceof Array) {
                    return res.json([]);
                }

                model.find({}).lean(true).select({_id: 1}).then((docs) => {
                    let existing = docs.map((v) => v._id + "");
                    let deleted = req.body._ids.filter(function (id) {
                        return existing.indexOf(id) === -1;
                    });

                    res.json(deleted);
                });
                break;
            case "count":
                if (Application.modules[this.config.authModuleName]) {
                    if (!Application.modules[this.config.authModuleName].hasPermission(req, req.params.model, req.params.action)) {
                        return res.status(401).end();
                    }
                }

                model.count(query).then((count) => {
                    res.end(count.toString());
                }, (err) => {
                    res.err(err);
                });
                break;
            case "update":
                if (Application.modules[this.config.authModuleName]) {
                    if (!Application.modules[this.config.authModuleName].hasPermission(req, req.params.model, "save")) {
                        return res.status(401).end();
                    }
                }

                if (userModel && req.user) {
                    userModel.update({
                        _id: req.user._id,
                    }, {
                        $set: {
                            lastActivity: new Date(),
                        },
                    }).then(() => {
                        this.log.debug("User Activity updated");
                    }, () => {
                        this.log.debug("User Activity update failed");
                    });
                }

                data = this.cleanupDataForSave(data, model, req.user);

                if (!data) {
                    return res.err(new Error("no data"), 400);
                }

                model.update(query, {
                    $set: data,
                }, {
                    multi: true,
                }).then(() => {
                    res.json({});
                }, (err) => {
                    res.err(err);
                });
                break;
            case "save":
                let getPromise = Promise.resolve();
                let saveChildDocs = [];
                let isUpdate = false;

                data = this.cleanupDataForSave(data, model, req.user, true);

                if (!data) {
                    return res.err(new Error("no data"), 400);
                }

                if (data._id) {
                    getPromise = model.findOne({
                        _id: data._id,
                    });
                }

                getPromise.then((doc) => {
                    if (!doc) {
                        doc = new model(data);
                        doc.set("_createdBy", req.user ? req.user._id : null);
                    } else {
                        isUpdate = true;
                        for (let key in data) {

                            if (field === "__v" || field === "_id") {
                                continue;
                            }

                            doc.set(key, data[key]);
                        }
                        doc.set("_updatedBy", req.user ? req.user._id : null);
                    }

                    if (Application.modules[this.config.authModuleName]) {
                        if (!Application.modules[this.config.authModuleName].hasPermission(req, req.params.model, req.params.action, doc)) {
                            return res.status(401).end();
                        }
                    }

                    if (userModel && req.user) {
                        userModel.update({
                            _id: req.user._id,
                        }, {
                            $set: {
                                lastActivity: new Date(),
                            },
                        }).then(() => {
                            this.log.debug("User Activity updated");
                        }, () => {
                            this.log.debug("User Activity update failed");
                        });
                    }

                    if (req.body.saveReferences) {

                        if (!(req.body.saveReferences instanceof Array)) {
                            return res.err(new Error("saveReferences must be an Array with schema paths"));
                        }

                        return Promise.map(req.body.saveReferences, (path) => {

                            let pathConfig = model.schema.paths[path];

                            if (!pathConfig) {
                                throw new Error("path " + path + " does not exist");
                            }

                            if (pathConfig instanceof mongoose.Schema.Types.Array && pathConfig.caster instanceof mongoose.Schema.Types.ObjectId) {
                                // path is an array, we need to save multiple things
                                let relatedModel = Application.modules[this.config.dbModuleName].getModel(pathConfig.caster.options.ref);
                                let subdata = data[path];

                                // If not array make one
                                if (!Array.isArray(subdata)) {
                                    subdata = [subdata].filter(v => !!v);
                                }


                                return Promise.map(subdata, (subdata, index) => {
                                    subdata = this.cleanupDataForSave(subdata, relatedModel, req.user);

                                    let itemDoc;
                                    let itemPromise = Promise.resolve();

                                    if (subdata._id) {
                                        itemPromise = relatedModel.findOne({
                                            _id: subdata._id,
                                        });
                                    }

                                    return itemPromise.then((tempItemDoc) => {

                                        if (!tempItemDoc) {
                                            delete subdata._id;
                                            tempItemDoc = new relatedModel(subdata);
                                        }

                                        itemDoc = tempItemDoc;
                                        for (let field in subdata) {

                                            if (field === "__v" || field === "_id") {
                                                continue;
                                            }

                                            itemDoc.set(field, subdata[field]);
                                        }

                                        let err = itemDoc.validateSync();

                                        if (err) {
                                            return Promise.reject(err);
                                        }

                                        return Promise.resolve();
                                    }).then(() => {
                                        return itemDoc;
                                    }, (err) => {
                                        let formatted = Tools.formatMongooseError(err);
                                        let childFormatted = {};

                                        for (let key in formatted) {
                                            childFormatted[path + "." + index + "." + key] = formatted[key];
                                        }

                                        let newErr = Error("child error");
                                        newErr.formatted = childFormatted;

                                        throw newErr;
                                    });
                                }).then((docs) => {
                                    doc.set(path, docs);
                                    saveChildDocs = saveChildDocs.concat(docs);
                                });
                            } else if (pathConfig instanceof mongoose.Schema.Types.ObjectId) {
                                // path is a single reference
                                let relatedModel = Application.modules[this.config.dbModuleName].getModel(pathConfig.options.ref);
                                let subdata = data[path];
                                subdata = this.cleanupDataForSave(subdata, relatedModel, req.user);

                                let itemDoc;
                                let itemPromise = Promise.resolve();

                                if (subdata._id) {
                                    itemPromise = relatedModel.findOne({
                                        _id: subdata._id,
                                    });
                                }

                                return itemPromise.then((tempItemDoc) => {

                                    if (!tempItemDoc) {
                                        delete subdata._id;
                                        tempItemDoc = new relatedModel(subdata);
                                    }

                                    itemDoc = tempItemDoc;
                                    for (let field in subdata) {

                                        if (field === "__v" || field === "_id") {
                                            continue;
                                        }

                                        itemDoc.set(field, subdata[field]);
                                    }

                                    // don't save yet! - prevents saving of child docs when parent doc throws an save error
                                    let err = itemDoc.validateSync();

                                    if (err) {
                                        return Promise.reject(err);
                                    }

                                    return Promise.resolve();

                                }).then(() => {
                                    doc.set(path, itemDoc._id);
                                    saveChildDocs.push(itemDoc);
                                }, (err) => {
                                    let formatted = Tools.formatMongooseError(err, this.config.autoTranslateErrors ? req.__ : null);
                                    let childFormatted = {};

                                    for (let key in formatted) {
                                        childFormatted[path + "." + key] = formatted[key];
                                    }

                                    let newErr = Error("child error");
                                    newErr.formatted = childFormatted;

                                    throw newErr;
                                });
                            } else {
                                this.log.warn("path " + path + " is not a supported reference to save");
                                return;
                            }
                        }).then(() => {

                            let saveChildDocsPromise = Promise.resolve();
                            let err = doc.validateSync();

                            if (err) {
                                return res.err(err);
                            }

                            if (saveChildDocs.length) {
                                saveChildDocsPromise = Promise.map(saveChildDocs, (childDoc) => {
                                    return childDoc.save();
                                });
                            }

                            return saveChildDocsPromise.then(() => {
                                return doc.save().then(() => {
                                    return model.findOne({
                                        _id: doc._id,
                                    }).read("primary").populate(populate);
                                }).then((newDoc) => {
                                    res.json(newDoc.toObject({virtuals: true, getters: true}));
                                }).catch((err) => {
                                    res.err(err);
                                });
                            }).catch((err) => {
                                res.err(err);
                            });

                        }, (err) => {
                            if (err.formatted) {
                                res.status(400);
                                return res.json(err.formatted);
                            }

                            res.err(err);
                        });
                    } else {
                        return doc.save().then(() => {
                            return model.findOne({
                                _id: doc._id,
                            }).read("primary").populate(populate);
                        }, (err) => {
                            throw err;
                        }).then((newDoc) => {
                            res.json(newDoc.toObject({virtuals: true, getters: true}));
                        }, (err) => {
                            res.err(err);
                        });
                    }
                });

                break;
            case "remove":
                if (Application.modules[this.config.authModuleName]) {
                    if (!Application.modules[this.config.authModuleName].hasPermission(req, req.params.model, req.params.action, null, query)) {
                        return res.status(401).end();
                    }
                }

                if (Object.keys(query).length === 0) {
                    return res.status(401).end("Empty query is not allowed");
                }

                if (userModel && req.user) {
                    userModel.update({
                        _id: req.user._id,
                    }, {
                        $set: {
                            lastActivity: new Date(),
                        },
                    }).then(() => {
                        this.log.debug("User Activity updated");
                    }, () => {
                        this.log.debug("User Activity update failed");
                    });
                }

                model.find(query).then((docs) => {
                    return Promise.map(docs, (doc) => {
                        return doc.remove();
                    });
                }, (err) => {
                    res.err(err);
                }).then(() => {
                    res.end();
                }, (err) => {
                    res.err(err);
                });
                break;
            case "pagination":
                if (Application.modules[this.config.authModuleName]) {
                    if (!Application.modules[this.config.authModuleName].hasPermission(req, req.params.model, "count", null, query)) {
                        return res.status(401).end();
                    }
                }

                model.count(req.body.query || {}).then((count) => {
                    res.json(Tools.getPaginationForCount(count, req.body.limit || 15, req.body.page, req.body.pagesInView, req));
                }, (err) => {
                    res.err(err);
                });
                break;
            case "schema":
                if (Application.modules[this.config.authModuleName]) {
                    if (!Application.modules[this.config.authModuleName].hasPermission(req, req.params.model, "schema", null, query)) {
                        return res.status(401).end();
                    }
                }

                return this.getSchemaForModel(model).then((data) => {
                    res.json(data);
                }, (err) => {
                    res.err(err);
                });
                break;
            case "dropdownoptions":
                if (Application.modules[this.config.authModuleName]) {
                    if (!Application.modules[this.config.authModuleName].hasPermission(req, req.params.model, "find", null, query)) {
                        return res.status(401).end();
                    }
                }

                let preAggregateQuery = query;
                let aggregateProject = {};
                let sortDir = req.body.sortDir || 1;
                let purgeEmpty = req.body.purgeEmpty || true;

                preAggregateQuery[field] = {
                    $exists: true,
                };

                aggregateProject._id = "$" + field;
                aggregateProject.sortKey = {
                    $toLower: "$" + field,
                };

                return model.aggregate([
                    {
                        $match: preAggregateQuery,
                    },
                    {
                        $project: aggregateProject,
                    },
                    {
                        $group: {
                            _id: "$_id",
                            sortKey: {
                                $first: "$sortKey",
                            },
                        },
                    },
                    {
                        $sort: {
                            sortKey: sortDir,
                        },
                    },
                ]).then((results) => {
                    let _ids = results.map(v => v._id);

                    if (purgeEmpty) {
                        _ids = _ids.filter(v => !!v);
                    }

                    res.json(_ids);
                }, (err) => {
                    res.err(err);
                });
                break;
            default:
                res.status(501);
                res.end();
                break;
        }

    }


    /**
     * /api/:model/changes/:type/:projection/:from?/:to?
     *
     * @param req
     * @param res
     */
    handleChangesRequest(req, res) {
        let supportedTypes = ["json"];
        let type = req.params.type;

        if (supportedTypes.indexOf(type) === -1) {
            res.status(400);
            return res.err("type " + type + " not supported, try on of the following" + supportedTypes.join(","));
        }

        let projection = req.params.projection;
        let from = req.params.from;
        let to = req.params.to;
        let count = req.query.count;
        let hasPublish = Application.modules[this.config.projectionModuleName].config.publish[req.params.model];
        let publishedModel;
        let query;

        if (hasPublish) {
            publishedModel = Application.modules[this.config.dbModuleName].getModel("published");
            query = {
                model: req.params.model,
                projection: projection,
                $and: [],
            };
        } else {
            publishedModel = Application.modules[this.config.dbModuleName].getModel(req.params.model);
            query = {};
        }

        let limit = req.query.limit;
        let page = req.query.page;

        if (from) {
            from = new Date(from);
        }

        if (to) {
            to = new Date(to);
        }

        if (from) {
            query.$and.push({
                _updatedAt: {
                    $gte: from,
                },
            });
        }

        if (to) {
            query.$and.push({
                _updatedAt: {
                    $lte: to,
                },
            });
        }

        if (query.$and && query.$and.length === 0) {
            delete query.$and;
        }

        if (hasPublish) {
            if (count) {
                return publishedModel
                    .count(query).then((count) => {
                        res.json({
                            total: count,
                        });
                    }, (err) => {
                        res.status(500).end(err);
                    });
            }

            if (page !== undefined) {
                page = parseInt(page) || 0;
                limit = parseInt(limit) || 100;
                return publishedModel
                    .find(query)
                    .lean(true)
                    .skip(page * limit)
                    .limit(limit)
                    .exec().then((data) => {
                        res.json(data);
                    }, (err) => {
                        res.status(500).end(err);
                    });
            }

            let lastData = null;

            if (type === "json") {
                res.header("Content-Type", "application/json;charset=UTF-8");
            }

            res.write("[");
            publishedModel
                .find(query)
                .lean(true)
                .cursor()
                .on('data', function (data) {
                    if (lastData) {
                        res.write(",");
                    }
                    lastData = true;
                    res.write(JSON.stringify(data.data));
                })
                .on('end', function () {
                    res.write("]");
                    res.end();
                });
        } else {
            if (count) {
                return publishedModel
                    .count(query)
                    .then((count) => {
                        res.json({
                            total: count,
                        });
                    }, (err) => {
                        res.status(500).end(err);
                    });
            }

            page = parseInt(page) || 0;
            limit = parseInt(limit) || 100;
            return publishedModel
                .find(query)
                .projection(req.params.projection)
                .skip(page * limit)
                .limit(limit)
                .exec().then((data) => {
                    res.json(data);
                }, (err) => {
                    res.status(500).end(err);
                });
        }
    }


    /**
     *
     * @param {{}} data
     * @param {Model} model
     * @param {Document} user
     * @returns {{}}
     */
    cleanupDataForSave(data, model, user, maintainSubDocs) {

        if (!data) {
            return null;
        }


        // remove __v by default, you cant update it anyways, do it here so we dont get any warnings
        delete data.__v;
        // save means new version, so in case any version was submitted, just reset it
        data._version = null;

        let mongoose = Application.modules[this.config.dbModuleName].mongoose;
        let forbiddenPaths = [];
        let paths = model.schema.paths;
        let modelName = new model().constructor.modelName; // @TODO really isnt there a better way? wasted...

        // checks paths for non public paths
        for (let path in paths) {
            let pathConfig = paths[path];

            if (pathConfig.options.permission === undefined) {
                // no permission option set, so if other permissions are ok he might modify this field
            } else if (pathConfig.options.permission === false) {
                // no permission, check for the required permissions
                if (!user) {
                    // no user ? no permission ! probably wont get past the check in api/save anyways...
                    forbiddenPaths.push(path);
                } else if (!user.hasPermission([
                    modelName,
                    modelName + ".save",
                ])) {
                    // no general or specific save permission
                    forbiddenPaths.push(path);
                }
            } else if (typeof pathConfig.options.permission === "string") {
                // specific permission to modify this field
                if (!user.hasPermission(pathConfig.options.permission)) {
                    forbiddenPaths.push(path);
                }
            }
        }

        // @TODO ok we get more creative here, feel free to refactor...
        let tempDoc = new model(data); // make temp model just to have access to mongoose functionality
        let finalData = {};

        for (let path in paths) {
            let pathConfig = paths[path];

            // check if the user is not allowed to modify this path
            if (forbiddenPaths.indexOf(path) !== -1) {
                this.log.debug("Ignored path " + path + " for save, insufficient permissions");
                continue;
            }

            // check if this path is a reference, if so completely ignore it, dont modify it at all!
            if (pathConfig instanceof mongoose.Schema.Types.ObjectId || (pathConfig instanceof mongoose.Schema.Types.Array && pathConfig.caster instanceof mongoose.Schema.Types.ObjectId)) {
                finalData[path] = Tools.getObjectValueByPath(data, path); // get it from the original data, this is required since the model will just return the id
                if (finalData[path] === null) {
                    delete finalData[path];
                }
                continue;
            }

            if (!tempDoc.isModified(path) && path !== "_id") {
                continue;
            }

            finalData[path] = tempDoc.get(path);
        }

        // this is important, otherwise _id will be null so things will be reeeeeaaaaally weird
        if (!finalData._id) {
            delete finalData._id;
        }

        return finalData;
    }

    start() {
        return new Promise((resolve, reject) => {
            this.log.debug("Starting...");
            return resolve(this);
        });
    }

    stop() {
        return new Promise((resolve, reject) => {
            this.log.debug("Stopping...");
            return resolve(this);
        });
    }

    loadStaticPages() {
        return new Promise((resolve, reject) => {
            let rootDir = Application.config.config_path + "/pages";

            if (!fs.existsSync(rootDir)) {
                fs.mkdirSync(rootDir);
            }

            let files = fs.readdirSync(rootDir);
            let pages = {};

            for (let i = 0; i < files.length; i++) {
                let file = files[i];

                if (file.indexOf(".json") === -1) {
                    continue;
                }

                let config = Tools.loadCommentedConfigFile(rootDir + "/" + file);
                for (let key in config) {
                    if (pages[key]) {
                        this.log.warn("Page " + key + " duplicated");
                    }

                    pages[key] = config[key];
                }
            }

            this.pages = pages;

            resolve();
        });
    }

    getSchemaForModel(model) {
        let cleanSchema = {};

        return new Promise((resolve, reject) => {

            for (let key in model.schema.paths) {
                let conf = JSON.parse(JSON.stringify(model.schema.paths[key]));

                if (!conf) {
                    continue;
                }

                cleanSchema[key] = {
                    enumValues: conf.enumValues || conf.options.enum,
                    regExp: conf.regExp,
                    path: conf.path,
                    instance: conf.instance,
                    defaultValue: conf.defaultValue || conf.options.default || null,
                    map: conf.options.map || null,
                };
            }

            resolve(cleanSchema);
        });
    }

    getPageFromRequest(req) {
        for (let key in this.pages) {
            let page = this.pages[key];
            page.id = key;

            if (page.regexp) {
                if (new RegExp("^" + page.path + "$").test(req.path)) {
                    return page;
                }
            }

            let keys = [];
            let re = pathToRegexp(page.path, keys);
            let result = re.exec(req.path);

            if (result) {
                for (let i = 0; i < keys.length; i++) {
                    let key = keys[i];
                    req.params[key.name] = result[i + 1];
                }

                req.activePage = page;

                return page;
            }
        }
    }

    getPageJson(req, page) {
        return new Promise((resolve, reject) => {
            page = page || this.getPageFromRequest(req);

            if (!page) {
                return this.getPageJson(req, this.pages[404]).then(resolve, reject);
            }

            req.activePage = page;

            if (page && page.requires && page.requires.auth) {
                if (!req.user) {
                    return resolve({
                        status: 302,
                        redirect: this.config.loginPath + "?return=" + req.path,
                    });
                }

                if (page.requires.permissions && !req.user.admin) {
                    if (typeof page.requires.permissions === "string") {
                        page.requires.permissions = [page.requires.permissions];
                    }

                    for (let i = 0; i < page.requires.permissions.length; i++) {
                        let permission = page.requires.permissions[i];
                        if (req.user.permissions.indexOf(permission) === -1) {

                            let redirect = this.config.loginPath + "?return=" + req.path;
                            let redirectPermissions = page.requires.redirectPermissions || {};

                            for (let [redirectPermission, link] of Object.entries(redirectPermissions)) {
                                if (req.user.permissions.indexOf(redirectPermission) !== -1) {
                                    redirect = link;
                                    break;
                                }
                            }

                            return resolve({
                                status: 302,
                                redirect: redirect,
                            });
                        }
                    }
                }
            }

            let status = page.status || 200;
            let pagePreparationPromise = Promise.resolve();
            let stats = {};

            if (page.model) {
                pagePreparationPromise = new Promise((pageItemResolve, reject) => {

                    let pageItemModel = Application.modules[this.config.dbModuleName].getModel(page.model.name);

                    if (pageItemModel.schema.paths._id && pageItemModel.schema.paths._id.instance === "ObjectID") {
                        try {
                            Application.modules[this.config.dbModuleName].mongoose.Types.ObjectId(req.params._id);
                        } catch (e) {
                            // invalid id => 404
                            return this.getPageJson(req, this.pages[404]).then(resolve, reject);
                        }
                    }

                    let query = pageItemModel.findOne({
                        _id: req.params._id,
                    }).populate(page.model.populate || []);

                    if (page.model.projection) {
                        query.projection(page.model.projection, req);
                    }

                    return query.then((doc) => {

                        if (!doc) {
                            this.log.debug("No Document found in model " + page.model.name + " for id " + req.params._id);
                            return this.getPageJson(req, this.pages[404]).then(resolve, reject);
                        }

                        req.activePageItem = doc;
                        req.activePageItemType = page.model;

                        return pageItemResolve();
                    }, reject);
                });
            }

            pagePreparationPromise.then(() => {
                return Application.modules[this.config.elementsModuleName].dispatchElementsInSlots(page.slots, req).then((dispatchedSlots) => {

                    // allow elements to modify the status code (for example set 500 if they fail)
                    // you could set this option on your meta element to prevent the page from going 200 OK in case the db or something is down
                    for (let slot in dispatchedSlots) {
                        for (let i = 0; i < dispatchedSlots[slot].length; i++) {
                            let el = dispatchedSlots[slot][i];

                            if (el.statusCodeIfError && (el.isError || el.tooLong)) {
                                status = el.statusCodeIfError;
                            }
                        }
                    }

                    stats.cache = this.getCacheHeaderFromSlots(dispatchedSlots);

                    resolve({
                        layout: page.layout || "default",
                        url: req.path,
                        status: status,
                        meta: req.meta,
                        stats,
                        data: dispatchedSlots,
                    });
                }, reject);
            }, (err) => {
                this.log.error(err);
                return resolve({
                    status: 500,
                });
            });

        });
    }

    getCacheHeaderFromSlots(slots) {
        let cache = null;

        for (let slotName in slots) {
            for (let i = 0; i < slots[slotName].length; i++) {
                let elementData = slots[slotName][i];

                if (elementData.doesNotExist || elementData.esi) {
                    continue;
                }

                let ttl = null;

                if (elementData.cache === false && !elementData.esi) {
                    return false;
                } else {
                    if (elementData.cache && elementData.cache.expires) {
                        ttl = elementData.cache.expires;
                    } else if (elementData.cache) {
                        ttl = elementData.cache;
                    } else {
                        ttl = Application.modules[this.config.cacheModuleName].config.caches.elementDefault;
                    }
                }

                if (cache === null) {
                    cache = ttl;
                } else if (ttl < cache) {
                    cache = ttl;
                }
            }
        }

        return cache;
    }

};
