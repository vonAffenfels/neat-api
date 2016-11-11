"use strict";

var Application = require("neat-base").Application;
var Module = require("neat-base").Module;
var Tools = require("neat-base").Tools;
var redis = require("redis");
var Promise = require("bluebird");
var crypto = require('crypto');
var fs = require('fs');
var pathToRegexp = require('path-to-regexp');

module.exports = class Api extends Module {

    static defaultConfig() {
        return {
            loginPath: "/login",
            elementsModuleName: "elements",
            webserverModuleName: "webserver",
            projectionModuleName: "projection",
            dbModuleName: "database",
            authModuleName: "auth"
        }
    }

    init() {
        return new Promise((resolve, reject) => {
            this.log.debug("Initializing...");

            if (Application.modules[this.config.webserverModuleName]) {
                Application.modules[this.config.webserverModuleName].addRoute("post", "/api/:model/:action", (req, res, next) => {
                    this.handleRequest(req, res);
                }, 9999);
            }

            return this.loadStaticPages().then(() => {
                return resolve(this);
            });
        });
    }

    handleRequest(req, res) {

        try {
            var model = Application.modules[this.config.dbModuleName].getModel(req.params.model);
        } catch (e) {
            res.status();
            return res.err("model " + req.params.model + " does not exist");
        }

        var limit = req.body.limit || 10;
        var page = req.body.page || 0;
        var sort = req.body.sort || {};
        var query = req.body.query || {};
        var select = req.body.select || {};
        var field = req.body.field || null;
        var populate = req.body.populate || [];
        var projection = req.body.projection || null;

        switch (req.params.action) {
            case "find":
                if (Application.modules[this.config.authModuleName]) {
                    if (!Application.modules[this.config.authModuleName].hasPermission(req, req.params.model, req.params.action)) {
                        return res.status(401).end();
                    }
                }

                var dbQuery = model.find(query).limit(limit).skip(limit * page).populate(populate).select(select).sort(sort);

                if (projection && Application.modules[this.config.projectionModuleName]) {
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

                var dbQuery = model.findOne(query).select(select).sort(sort).populate(populate);

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

                model.findOne(query).select(select).sort(sort).then((doc) => {
                    return Promise.map(doc.get("_versions"), (obj) => {
                        var doc = new model(obj);
                        return doc.populate(populate).execPopulate();
                    }).then((docs) => {
                        return res.json(docs);
                    });
                }, (err) => {
                    res.err(err);
                });
                break;
            case "count":
                if (Application.modules[this.config.authModuleName]) {
                    if (!Application.modules[this.config.authModuleName].hasPermission(req, req.params.model, req.params.action)) {
                        return res.status(401).end();
                    }
                }

                model.count(query).then((count) => {
                    res.end(count);
                }, (err) => {
                    res.err(err);
                });
                break;
            case "save":
                var getPromise = Promise.resolve();

                delete req.body.data.__v;
                req.body.data._version = null; // save means new version, so in case any version was submitted, just ignore it

                if (req.body.data._id) {
                    getPromise = model.findOne({
                        _id: req.body.data._id
                    });
                }

                getPromise.then((doc) => {
                    if (!doc) {
                        doc = new model(req.body.data);
                        doc.set("_createdBy", req.user ? req.user._id : null);
                    } else {
                        for (var key in req.body.data) {
                            doc.set(key, req.body.data[key]);
                        }
                        doc.set("_updatedBy", req.user ? req.user._id : null);
                    }

                    if (Application.modules[this.config.authModuleName]) {
                        if (!Application.modules[this.config.authModuleName].hasPermission(req, req.params.model, req.params.action, doc)) {
                            return res.status(401).end();
                        }
                    }

                    doc.save().then(() => {
                        return model.findOne({
                            _id: doc._id
                        }).populate(populate)
                    }).then((doc) => {
                        res.json(doc);
                    }, (err) => {
                        res.err(err);
                    });
                })
                break;
            case "remove":
                if (Application.modules[this.config.authModuleName]) {
                    if (!Application.modules[this.config.authModuleName].hasPermission(req, req.params.model, req.params.action, null, query)) {
                        return res.status(401).end();
                    }
                }

                model.remove(query).then(() => {
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

                var preAggregateQuery = {};
                var aggregateProject = {};

                preAggregateQuery[field] = {
                    $exists: true
                };

                aggregateProject._id = "$" + field;

                return model.aggregate([
                    {
                        $match: preAggregateQuery
                    },
                    {
                        $project: aggregateProject
                    },
                    {
                        $group: {
                            _id: "$_id"
                        }
                    }
                ]).then((results) => {
                    res.json(results.map(v => v._id));
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
            var rootDir = Application.config.config_path + "/pages";

            if (!fs.existsSync(rootDir)) {
                fs.mkdirSync(rootDir);
            }

            var files = fs.readdirSync(rootDir);
            var pages = {};

            for (var i = 0; i < files.length; i++) {
                var file = files[i];

                if (file.indexOf(".json") === -1) {
                    continue;
                }

                var config = Tools.loadCommentedConfigFile(rootDir + "/" + file);
                for (var key in config) {
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
        var cleanSchema = {};

        return new Promise((resolve, reject) => {

            for (var key in model.schema.paths) {
                var conf = JSON.parse(JSON.stringify(model.schema.paths[key]));

                delete conf.options;

                cleanSchema[key] = {
                    options: conf.options,
                    enumValues: conf.enumValues,
                    regExp: conf.regExp,
                    path: conf.path,
                    instance: conf.instance
                };
            }

            resolve(cleanSchema);
        });
    }

    getPageFromRequest(req) {
        for (var key in this.pages) {
            var page = this.pages[key];
            page.id = key;

            if (page.regexp) {
                if (new RegExp("^" + page.path + "$").test(req.path)) {
                    return page;
                }
            }

            var keys = [];
            var re = pathToRegexp(page.path, keys);
            var result = re.exec(req.path);

            if (result) {
                for (var i = 0; i < keys.length; i++) {
                    var key = keys[i];
                    req.params[key.name] = result[i + 1];
                }

                req.activePage = page;

                return page;
            }
        }

        return this.pages[404];
    }

    getPageJson(req) {
        return new Promise((resolve, reject) => {
            var page = this.getPageFromRequest(req);

            if (!page) {
                return resolve({
                    status: 404
                });
            }

            if (page && page.requires && page.requires.auth) {
                if (!req.user) {
                    return resolve({
                        status: 302,
                        redirect: this.config.loginPath
                    });
                }

                if (page.requires.permissions && !req.user.admin) {
                    if (typeof page.requires.permissions === "string") {
                        page.requires.permissions = [page.requires.permissions];
                    }

                    for (var i = 0; i < page.requires.permissions.length; i++) {
                        var permission = page.requires.permissions[i];
                        if (req.user.permissions.indexOf(permission) == -1) {
                            return resolve({
                                status: 302,
                                redirect: this.config.loginPath
                            });
                        }
                    }
                }
            }

            var status = page.status || 200;

            return Application.modules[this.config.elementsModuleName].dispatchElementsInSlots(page.slots, req).then((dispatchedSlots) => {
                resolve({
                    layout: page.layout || "default",
                    url: req.path,
                    status: status,
                    meta: req.meta,
                    data: dispatchedSlots
                });
            }, reject);
        });
    }

}