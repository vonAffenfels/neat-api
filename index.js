"use strict";

var Application = require("neat-base").Application;
var Module = require("neat-base").Module;
var Tools = require("neat-base").Tools;
var redis = require("redis");
var Promise = require("bluebird");
var crypto = require('crypto');
var fs = require('fs');
var mongoose = require("mongoose");

module.exports = class Api extends Module {

    static defaultConfig() {
        return {
            elementsModuleName: "elements",
            webserverModuleName: "webserver",
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
            var model = mongoose.model(req.params.model);
        } catch (e) {
            res.status();
            return res.err("model " + req.params.model + " does not exist");
        }

        var limit = req.body.limit || 10;
        var page = req.body.page || 0;
        var sort = req.body.sort || {};
        var query = req.body.query || {};
        var select = req.body.select || {};

        switch (req.params.action) {
            case "find":
                if (Application.modules[this.config.authModuleName]) {
                    if (!Application.modules[this.config.authModuleName].hasPermission(req, req.params.model, req.params.action)) {
                        return res.status(401).end();
                    }
                }

                model.find(query).limit(limit).skip(limit * page).select(select).sort(sort).then((docs) => {
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

                model.findOne(query).select(select).sort(sort).then((doc) => {
                    res.json(doc);
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

                if (req.body._id) {
                    getPromise = model.findOne({
                        _id: req.body._id
                    });
                }

                getPromise.then((doc) => {
                    if (!doc) {
                        doc = new model(req.body);
                        doc.set("_createdBy", req.user || null);
                    } else {
                        for (var key in req.body) {
                            doc.set(key, req.body[key]);
                        }
                        doc.set("_updatedBy", req.user || null);
                    }

                    if (Application.modules[this.config.authModuleName]) {
                        if (!Application.modules[this.config.authModuleName].hasPermission(req, req.params.model, req.params.action, doc)) {
                            return res.status(401).end();
                        }
                    }

                    doc.save().then(() => {
                        return model.findOne({
                            _id: doc._id
                        })
                    }, (err) => {
                        res.err(err);
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

                model.remove(query).then((count) => {
                    res.end(count);
                }, (err) => {
                    res.err(err);
                });
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

    getPageFromRequest(req) {
        for (var key in this.pages) {
            var page = this.pages[key];
            if (new RegExp(page.path).test(req.path)) {
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

    modifySchema(modelName, schema) {
        schema.add({
            _createdAt: {
                type: Date,
                default: function () {
                    return new Date();
                }
            },
            _createdBy: {
                type: mongoose.Schema.Types.ObjectId,
                ref: "user",
                default: null
            },

            _updatedAt: {
                type: Date,
                default: function () {
                    return new Date();
                }
            },
            _updatedBy: {
                type: mongoose.Schema.Types.ObjectId,
                ref: "user",
                default: null
            },

            _versions: {
                type: Array,
                default: []
            }
        });

        if (schema.options.toJSON.transform && typeof schema.options.toJSON.transform === "function") {
            schema.options.toJSON._transform = schema.options.toJSON.transform;
        }

        schema.options.toJSON.transform = function (doc) {
            var obj = schema.options.toJSON._transform(doc);

            delete obj._versions;
            return obj;
        }

        schema.pre("save", function (next) {
            this._updatedAt = new Date();

            var newVersion = this.toJSON();
            delete newVersion._versions;
            newVersion._version = this._versions.length;
            this._versions.push(newVersion);
            return next();
        });
    }
}