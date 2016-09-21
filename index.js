"use strict";

var Application = require("neat-base").Application;
var Module = require("neat-base").Module;
var Tools = require("neat-base").Tools;
var redis = require("redis");
var Promise = require("bluebird");
var crypto = require('crypto');
var fs = require('fs');

module.exports = class Api extends Module {

    static defaultConfig() {
        return {
            elementsModuleName: "elements"
        }
    }

    init() {
        return new Promise((resolve, reject) => {
            this.log.debug("Initializing...");
            return this.loadStaticPages().then(() => {
                return resolve(this);
            });
        });
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

            if(!page) {
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
}