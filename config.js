const babelParse = require("@babel/parser/new/index").parse;
const acornParse = require("acorn").parse;
const esprimaParse = require("esprima").parse;
const cherowParse = require("cherow").parse;

exports.files = [
  "./fixtures/ember.debug.js",
  "./fixtures/jquery.js",
  "./fixtures/angular.js",
  "./fixtures/babylon-dist.js",
  "./fixtures/backbone.js",
  "./fixtures/react-with-addons.js"
];

exports.parsers = {
  acorn: {
    parse: acornParse,
    options: { sourceType: "script" }
  },
  babel: {
    parse: babelParse,
    options: { sourceType: "script" }
  },
  cherow: {
    parse: cherowParse,
    options: { sourceType: "script" }
  },
  esprima: {
    parse: esprimaParse,
    options: { sourceType: "script" }
  }
};
