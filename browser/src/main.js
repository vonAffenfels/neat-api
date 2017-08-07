"use strict";

(function (window, ng) {

    const neatFormModule = ng.module("neat-api", []);

    neatFormModule.service("neatApi", [
        "$resource",
        "$location",
        function ($resource, $location) {
            let rootUrl = "//" + $location.host() + ":" + $location.port();

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
                    isArray: true,
                    params: {
                        form: "@form",
                        _id: "@_id"
                    }
                },
                formSubmit: {
                    url: rootUrl + "/form-api/:form",
                    method: "POST",
                    isArray: true,
                    params: {
                        form: "@form"
                    }
                }
            });
        }
    ]);

})(window, window.angular)