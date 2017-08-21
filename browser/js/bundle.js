/******/ (function(modules) { // webpackBootstrap
/******/ 	// The module cache
/******/ 	var installedModules = {};

/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {

/******/ 		// Check if module is in cache
/******/ 		if(installedModules[moduleId])
/******/ 			return installedModules[moduleId].exports;

/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = installedModules[moduleId] = {
/******/ 			exports: {},
/******/ 			id: moduleId,
/******/ 			loaded: false
/******/ 		};

/******/ 		// Execute the module function
/******/ 		modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);

/******/ 		// Flag the module as loaded
/******/ 		module.loaded = true;

/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}


/******/ 	// expose the modules object (__webpack_modules__)
/******/ 	__webpack_require__.m = modules;

/******/ 	// expose the module cache
/******/ 	__webpack_require__.c = installedModules;

/******/ 	// __webpack_public_path__
/******/ 	__webpack_require__.p = "/neat-form/js/";

/******/ 	// Load entry module and return exports
/******/ 	return __webpack_require__(0);
/******/ })
/************************************************************************/
/******/ ([
/* 0 */
/***/ (function(module, exports) {

	"use strict";

	(function (window, ng) {

	    var neatFormModule = ng.module("neat-api", []);

	    neatFormModule.service("neatApi", ["$resource", "$location", function ($resource, $location) {
	        var rootUrl = "//" + $location.host() + ":" + $location.port();

	        return $resource(rootUrl, {}, {
	            // AUTH
	            login: {
	                url: rootUrl + "/auth/login",
	                method: "POST",
	                isArray: false,
	                params: {}
	            },
	            logout: {
	                url: rootUrl + "/auth/logout",
	                method: "POST",
	                isArray: false,
	                params: {}
	            },
	            resendActivation: {
	                url: rootUrl + "/auth/resend-activation",
	                method: "POST",
	                isArray: false,
	                params: {}
	            },
	            activate: {
	                url: rootUrl + "/auth/activate-account",
	                method: "POST",
	                isArray: false,
	                params: {}
	            },
	            resetPassword: {
	                url: rootUrl + "/auth/do-reset-password",
	                method: "POST",
	                isArray: false,
	                params: {}
	            },
	            requestResetPassword: {
	                url: rootUrl + "/auth/reset-password",
	                method: "POST",
	                isArray: false,
	                params: {}
	            },

	            // API
	            find: {
	                url: rootUrl + "/api/:model/find",
	                method: "POST",
	                isArray: true,
	                params: {
	                    model: '@model'
	                }
	            },
	            findOne: {
	                url: rootUrl + "/api/:model/findOne",
	                method: "POST",
	                params: {
	                    model: '@model'
	                }
	            },
	            versions: {
	                url: rootUrl + "/api/:model/versions",
	                method: "POST",
	                isArray: true,
	                params: {
	                    model: '@model'
	                }
	            },
	            save: {
	                url: rootUrl + "/api/:model/save",
	                method: "POST",
	                params: {
	                    model: '@model'
	                }
	            },
	            update: {
	                url: rootUrl + "/api/:model/update",
	                method: "POST",
	                params: {
	                    model: '@model'
	                }
	            },
	            remove: {
	                url: rootUrl + "/api/:model/remove",
	                method: "POST",
	                params: {
	                    model: '@model'
	                }
	            },
	            count: {
	                url: rootUrl + "/api/:model/count",
	                method: "POST",
	                params: {
	                    model: "@model"
	                }
	            },
	            pagination: {
	                url: rootUrl + "/api/:model/pagination",
	                method: "POST",
	                params: {
	                    model: "@model"
	                }
	            },
	            schema: {
	                url: rootUrl + "/api/:model/schema",
	                method: "POST",
	                params: {
	                    model: "@model"
	                }
	            },
	            dropdownoptions: {
	                url: rootUrl + "/api/:model/dropdownoptions",
	                method: "POST",
	                isArray: true,
	                params: {
	                    model: "@model"
	                }
	            },

	            // FORM
	            form: {
	                url: rootUrl + "/form-api/:form/:_id",
	                method: "GET",
	                params: {
	                    form: "@form",
	                    _id: "@_id"
	                }
	            },
	            formSubmit: {
	                url: rootUrl + "/form-api/:form",
	                method: "POST",
	                params: {
	                    form: "@form"
	                }
	            }
	        });
	    }]);
	})(window, window.angular);

/***/ })
/******/ ]);