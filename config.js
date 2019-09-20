const babelDevPath = process.env.BABEL_PARSER_PATH || "../babel/packages/babel-parser";

const babelParse = require("@babel/parser").parse;
const babelDevParse = require(babelDevPath).parse;
const acornParse = require("acorn").parse;
const esprimaParse = require("esprima").parse;
const meriyahParse = require("meriyah").parseModule;

exports.files = [
  "./fixtures/es5/angular.js",
  "./fixtures/es5/ember.debug.js",
  "./fixtures/es5/babylon-dist.js",
  "./fixtures/es5/jquery.js",
  "./fixtures/es5/backbone.js",
  "./fixtures/es5/react-with-addons.js",
  "./fixtures/es6/angular-compiler.js",
  "./fixtures/es6/material-ui-core.js",
].filter(file => {
  return !process.env.FILE || file.includes(process.env.FILE)
});

exports.benchmarkOptions = {
  minSamples: 16000
};

const parsers = {
  acorn: {
    parse: acornParse,
    options: { sourceType: "module", locations: true }
  },
  babel: {
    parse: babelParse,
    options: { sourceType: "module" }
  },
  dev: {
    parse: babelDevParse,
    options: { sourceType: "module" }
  },
  esprima: {
    parse: esprimaParse,
    options: { sourceType: "module", loc: true, comment: true, attachComment: true }
  },
  meriyah: {
    parse: meriyahParse,
    options: { loc: true }
  },
};

const parserSelection = (function () {
  if (process.env.PARSER_ALL) {
    return Object.keys(parsers);
  }
  if (process.env.PARSER) {
    return process.env.PARSER.split(",");
  } else {
    return ["dev"];
  }
})();

exports.parsers = Object.keys(parsers).filter(key => {
  return parserSelection.includes(key);
}).reduce((p, key) => {
  p[key] = parsers[key];
  return p;
}, {});
