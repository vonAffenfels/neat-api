var path = require("path");
var fs = require('fs');

module.exports = function (grunt) {

    grunt.initConfig({

        pkg: grunt.file.readJSON('package.json'),

        uglify: {
            bundle: {
                options: {
                    mangle: true,
                    compress: true,
                    beautify: false,
                    sourceMap: false,
                    preserveComments: false,
                    report: "min",
                    except: []
                },
                files: {
                    'browser/js/bundle.js': ['browser/js/bundle.js']
                }
            }
        },

        webpack: {
            bundle: {
                entry: path.resolve('./browser/src/main.js'),
                watch: true,
                module: {
                    loaders: [
                        {
                            test: /\.js$/,
                            loader: 'babel-loader',
                            query: {
                                presets: ['es2015']
                            },
                            exclude: /node_modules|templates/
                        },
                        {
                            test: /\.html$/,
                            loader: 'html-loader'
                        }
                    ]
                },
                output: {
                    path: path.resolve("./browser/js/"),
                    publicPath: "/neat-form/js/",
                    filename: 'bundle.js'
                },
                resolveLoader: {
                    root: path.resolve('node_modules')
                },
                resolve: {
                    root: [
                        path.resolve('./browser/js/')
                    ],
                    extensions: [
                        '',
                        '.js',
                        '.json'
                    ]
                }
            }
        }
    });

    grunt.loadNpmTasks('grunt-contrib-uglify');
    grunt.loadNpmTasks('grunt-keepalive');
    grunt.loadNpmTasks('grunt-webpack');

    grunt.registerTask('build', [
        'webpack',
        "uglify"
    ]);

    grunt.registerTask('dev', [
        "webpack",
        "keepalive"
    ]);
};
