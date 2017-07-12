'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

// A second optional argument can be given to further configure
// the parser process. These options are recognized:

const defaultOptions = {
  // Source type ("script" or "module") for different semantics
  sourceType: "script",
  // Source filename.
  sourceFilename: undefined,
  // Line from which to start counting source. Useful for
  // integration with other tools.
  startLine: 1,
  // When enabled, a return at the top level is not considered an
  // error.
  allowReturnOutsideFunction: false,
  // When enabled, import/export statements are not constrained to
  // appearing at the top of the program.
  allowImportExportEverywhere: false,
  // TODO
  allowSuperOutsideMethod: false,
  // An array of plugins to enable
  plugins: [],
  // TODO
  strictMode: null,
  // Nodes have their start and end characters offsets recorded in
  // `start` and `end` properties (directly on the node, rather than
  // the `loc` object, which holds line/column data. To also add a
  // [semi-standardized][range] `range` property holding a `[start,
  // end]` array with the same numbers, set the `ranges` option to
  // `true`.
  //
  // [range]: https://bugzilla.mozilla.org/show_bug.cgi?id=745678
  ranges: false,
  // Adds all parsed tokens to a `tokens` property on the `File` node
  tokens: false
};

// Interpret and default an options object

function getOptions(opts) {
  const options = {};
  for (const key in defaultOptions) {
    options[key] = opts && key in opts ? opts[key] : defaultOptions[key];
  }
  return options;
}

// ## Token types

// The assignment of fine-grained, information-carrying type objects
// allows the tokenizer to store the information it has about a
// token in a way that is very cheap for the parser to look up.

// All token type variables start with an underscore, to make them
// easy to recognize.

// The `beforeExpr` property is used to disambiguate between regular
// expressions and divisions. It is set on all token types that can
// be followed by an expression (thus, a slash after them would be a
// regular expression).
//
// `isLoop` marks a keyword as starting a loop, which is important
// to know when parsing a label, in order to allow or disallow
// continue jumps to that label.

const beforeExpr = true;
const startsExpr = true;
const isLoop = true;
const isAssign = true;
const prefix = true;
const postfix = true;

class TokenType {

  constructor(label, conf = {}) {
    this.label = label;
    this.keyword = conf.keyword;
    this.beforeExpr = !!conf.beforeExpr;
    this.startsExpr = !!conf.startsExpr;
    this.rightAssociative = !!conf.rightAssociative;
    this.isLoop = !!conf.isLoop;
    this.isAssign = !!conf.isAssign;
    this.prefix = !!conf.prefix;
    this.postfix = !!conf.postfix;
    this.binop = conf.binop || null;
    this.updateContext = null;
  }
}

class KeywordTokenType extends TokenType {
  constructor(name, options = {}) {
    options.keyword = name;

    super(name, options);
  }
}

class BinopTokenType extends TokenType {
  constructor(name, prec) {
    super(name, { beforeExpr, binop: prec });
  }
}

const types = {
  num: new TokenType("num", { startsExpr }),
  bigint: new TokenType("bigint", { startsExpr }),
  regexp: new TokenType("regexp", { startsExpr }),
  string: new TokenType("string", { startsExpr }),
  name: new TokenType("name", { startsExpr }),
  eof: new TokenType("eof"),

  // Punctuation token types.
  bracketL: new TokenType("[", { beforeExpr, startsExpr }),
  bracketR: new TokenType("]"),
  braceL: new TokenType("{", { beforeExpr, startsExpr }),
  braceBarL: new TokenType("{|", { beforeExpr, startsExpr }),
  braceR: new TokenType("}"),
  braceBarR: new TokenType("|}"),
  parenL: new TokenType("(", { beforeExpr, startsExpr }),
  parenR: new TokenType(")"),
  comma: new TokenType(",", { beforeExpr }),
  semi: new TokenType(";", { beforeExpr }),
  colon: new TokenType(":", { beforeExpr }),
  doubleColon: new TokenType("::", { beforeExpr }),
  dot: new TokenType("."),
  question: new TokenType("?", { beforeExpr }),
  questionDot: new TokenType("?."),
  arrow: new TokenType("=>", { beforeExpr }),
  template: new TokenType("template"),
  ellipsis: new TokenType("...", { beforeExpr }),
  backQuote: new TokenType("`", { startsExpr }),
  dollarBraceL: new TokenType("${", { beforeExpr, startsExpr }),
  at: new TokenType("@"),
  hash: new TokenType("#"),

  // Operators. These carry several kinds of properties to help the
  // parser use them properly (the presence of these properties is
  // what categorizes them as operators).
  //
  // `binop`, when present, specifies that this operator is a binary
  // operator, and will refer to its precedence.
  //
  // `prefix` and `postfix` mark the operator as a prefix or postfix
  // unary operator.
  //
  // `isAssign` marks all of `=`, `+=`, `-=` etcetera, which act as
  // binary operators with a very low precedence, that should result
  // in AssignmentExpression nodes.

  eq: new TokenType("=", { beforeExpr, isAssign }),
  assign: new TokenType("_=", { beforeExpr, isAssign }),
  incDec: new TokenType("++/--", { prefix, postfix, startsExpr }),
  bang: new TokenType("!", { beforeExpr, prefix, startsExpr }),
  tilde: new TokenType("~", { beforeExpr, prefix, startsExpr }),
  logicalOR: new BinopTokenType("||", 1),
  logicalAND: new BinopTokenType("&&", 2),
  bitwiseOR: new BinopTokenType("|", 3),
  bitwiseXOR: new BinopTokenType("^", 4),
  bitwiseAND: new BinopTokenType("&", 5),
  equality: new BinopTokenType("==/!=", 6),
  relational: new BinopTokenType("</>", 7),
  bitShift: new BinopTokenType("<</>>", 8),
  plusMin: new TokenType("+/-", { beforeExpr, binop: 9, prefix, startsExpr }),
  modulo: new BinopTokenType("%", 10),
  star: new BinopTokenType("*", 10),
  slash: new BinopTokenType("/", 10),
  exponent: new TokenType("**", {
    beforeExpr,
    binop: 11,
    rightAssociative: true
  })
};

const keywords = {
  break: new KeywordTokenType("break"),
  case: new KeywordTokenType("case", { beforeExpr }),
  catch: new KeywordTokenType("catch"),
  continue: new KeywordTokenType("continue"),
  debugger: new KeywordTokenType("debugger"),
  default: new KeywordTokenType("default", { beforeExpr }),
  do: new KeywordTokenType("do", { isLoop, beforeExpr }),
  else: new KeywordTokenType("else", { beforeExpr }),
  finally: new KeywordTokenType("finally"),
  for: new KeywordTokenType("for", { isLoop }),
  function: new KeywordTokenType("function", { startsExpr }),
  if: new KeywordTokenType("if"),
  return: new KeywordTokenType("return", { beforeExpr }),
  switch: new KeywordTokenType("switch"),
  throw: new KeywordTokenType("throw", { beforeExpr }),
  try: new KeywordTokenType("try"),
  var: new KeywordTokenType("var"),
  let: new KeywordTokenType("let"),
  const: new KeywordTokenType("const"),
  while: new KeywordTokenType("while", { isLoop }),
  with: new KeywordTokenType("with"),
  new: new KeywordTokenType("new", { beforeExpr, startsExpr }),
  this: new KeywordTokenType("this", { startsExpr }),
  super: new KeywordTokenType("super", { startsExpr }),
  class: new KeywordTokenType("class"),
  extends: new KeywordTokenType("extends", { beforeExpr }),
  export: new KeywordTokenType("export"),
  import: new KeywordTokenType("import", { startsExpr }),
  yield: new KeywordTokenType("yield", { beforeExpr, startsExpr }),
  null: new KeywordTokenType("null", { startsExpr }),
  true: new KeywordTokenType("true", { startsExpr }),
  false: new KeywordTokenType("false", { startsExpr }),
  in: new KeywordTokenType("in", { beforeExpr, binop: 7 }),
  instanceof: new KeywordTokenType("instanceof", { beforeExpr, binop: 7 }),
  typeof: new KeywordTokenType("typeof", { beforeExpr, prefix, startsExpr }),
  void: new KeywordTokenType("void", { beforeExpr, prefix, startsExpr }),
  delete: new KeywordTokenType("delete", { beforeExpr, prefix, startsExpr })
};

// Map keyword names to token types.
Object.keys(keywords).forEach(name => {
  types["_" + name] = keywords[name];
});

/* eslint max-len: 0 */

// This is a trick taken from Esprima. It turns out that, on
// non-Chrome browsers, to check whether a string is in a set, a
// predicate containing a big ugly `switch` statement is faster than
// a regular expression, and on Chrome the two are about on par.
// This function uses `eval` (non-lexical) to produce such a
// predicate from a space-separated string of words.
//
// It starts by sorting the words by length.

function makePredicate(words) {
  const wordsArr = words.split(" ");
  return function (str) {
    return wordsArr.indexOf(str) >= 0;
  };
}

// Reserved word lists for various dialects of the language

const reservedWords = {
  "6": makePredicate("enum await"),
  strict: makePredicate("implements interface let package private protected public static yield"),
  strictBind: makePredicate("eval arguments")
};

// And the keywords

const isKeyword = makePredicate("break case catch continue debugger default do else finally for function if return switch throw try var while with null true false instanceof typeof void delete new in this let const class extends export import yield super");

// ## Character categories

// Big ugly regular expressions that match characters in the
// whitespace, identifier, and identifier-start categories. These
// are only applied when a character is found to actually have a
// code point above 128.
// Generated by `bin/generate-identifier-regex.js`.

let nonASCIIidentifierStartChars = "\xaa\xb5\xba\xc0-\xd6\xd8-\xf6\xf8-\u02c1\u02c6-\u02d1\u02e0-\u02e4\u02ec\u02ee\u0370-\u0374\u0376\u0377\u037a-\u037d\u037f\u0386\u0388-\u038a\u038c\u038e-\u03a1\u03a3-\u03f5\u03f7-\u0481\u048a-\u052f\u0531-\u0556\u0559\u0561-\u0587\u05d0-\u05ea\u05f0-\u05f2\u0620-\u064a\u066e\u066f\u0671-\u06d3\u06d5\u06e5\u06e6\u06ee\u06ef\u06fa-\u06fc\u06ff\u0710\u0712-\u072f\u074d-\u07a5\u07b1\u07ca-\u07ea\u07f4\u07f5\u07fa\u0800-\u0815\u081a\u0824\u0828\u0840-\u0858\u08a0-\u08b4\u08b6-\u08bd\u0904-\u0939\u093d\u0950\u0958-\u0961\u0971-\u0980\u0985-\u098c\u098f\u0990\u0993-\u09a8\u09aa-\u09b0\u09b2\u09b6-\u09b9\u09bd\u09ce\u09dc\u09dd\u09df-\u09e1\u09f0\u09f1\u0a05-\u0a0a\u0a0f\u0a10\u0a13-\u0a28\u0a2a-\u0a30\u0a32\u0a33\u0a35\u0a36\u0a38\u0a39\u0a59-\u0a5c\u0a5e\u0a72-\u0a74\u0a85-\u0a8d\u0a8f-\u0a91\u0a93-\u0aa8\u0aaa-\u0ab0\u0ab2\u0ab3\u0ab5-\u0ab9\u0abd\u0ad0\u0ae0\u0ae1\u0af9\u0b05-\u0b0c\u0b0f\u0b10\u0b13-\u0b28\u0b2a-\u0b30\u0b32\u0b33\u0b35-\u0b39\u0b3d\u0b5c\u0b5d\u0b5f-\u0b61\u0b71\u0b83\u0b85-\u0b8a\u0b8e-\u0b90\u0b92-\u0b95\u0b99\u0b9a\u0b9c\u0b9e\u0b9f\u0ba3\u0ba4\u0ba8-\u0baa\u0bae-\u0bb9\u0bd0\u0c05-\u0c0c\u0c0e-\u0c10\u0c12-\u0c28\u0c2a-\u0c39\u0c3d\u0c58-\u0c5a\u0c60\u0c61\u0c80\u0c85-\u0c8c\u0c8e-\u0c90\u0c92-\u0ca8\u0caa-\u0cb3\u0cb5-\u0cb9\u0cbd\u0cde\u0ce0\u0ce1\u0cf1\u0cf2\u0d05-\u0d0c\u0d0e-\u0d10\u0d12-\u0d3a\u0d3d\u0d4e\u0d54-\u0d56\u0d5f-\u0d61\u0d7a-\u0d7f\u0d85-\u0d96\u0d9a-\u0db1\u0db3-\u0dbb\u0dbd\u0dc0-\u0dc6\u0e01-\u0e30\u0e32\u0e33\u0e40-\u0e46\u0e81\u0e82\u0e84\u0e87\u0e88\u0e8a\u0e8d\u0e94-\u0e97\u0e99-\u0e9f\u0ea1-\u0ea3\u0ea5\u0ea7\u0eaa\u0eab\u0ead-\u0eb0\u0eb2\u0eb3\u0ebd\u0ec0-\u0ec4\u0ec6\u0edc-\u0edf\u0f00\u0f40-\u0f47\u0f49-\u0f6c\u0f88-\u0f8c\u1000-\u102a\u103f\u1050-\u1055\u105a-\u105d\u1061\u1065\u1066\u106e-\u1070\u1075-\u1081\u108e\u10a0-\u10c5\u10c7\u10cd\u10d0-\u10fa\u10fc-\u1248\u124a-\u124d\u1250-\u1256\u1258\u125a-\u125d\u1260-\u1288\u128a-\u128d\u1290-\u12b0\u12b2-\u12b5\u12b8-\u12be\u12c0\u12c2-\u12c5\u12c8-\u12d6\u12d8-\u1310\u1312-\u1315\u1318-\u135a\u1380-\u138f\u13a0-\u13f5\u13f8-\u13fd\u1401-\u166c\u166f-\u167f\u1681-\u169a\u16a0-\u16ea\u16ee-\u16f8\u1700-\u170c\u170e-\u1711\u1720-\u1731\u1740-\u1751\u1760-\u176c\u176e-\u1770\u1780-\u17b3\u17d7\u17dc\u1820-\u1877\u1880-\u18a8\u18aa\u18b0-\u18f5\u1900-\u191e\u1950-\u196d\u1970-\u1974\u1980-\u19ab\u19b0-\u19c9\u1a00-\u1a16\u1a20-\u1a54\u1aa7\u1b05-\u1b33\u1b45-\u1b4b\u1b83-\u1ba0\u1bae\u1baf\u1bba-\u1be5\u1c00-\u1c23\u1c4d-\u1c4f\u1c5a-\u1c7d\u1c80-\u1c88\u1ce9-\u1cec\u1cee-\u1cf1\u1cf5\u1cf6\u1d00-\u1dbf\u1e00-\u1f15\u1f18-\u1f1d\u1f20-\u1f45\u1f48-\u1f4d\u1f50-\u1f57\u1f59\u1f5b\u1f5d\u1f5f-\u1f7d\u1f80-\u1fb4\u1fb6-\u1fbc\u1fbe\u1fc2-\u1fc4\u1fc6-\u1fcc\u1fd0-\u1fd3\u1fd6-\u1fdb\u1fe0-\u1fec\u1ff2-\u1ff4\u1ff6-\u1ffc\u2071\u207f\u2090-\u209c\u2102\u2107\u210a-\u2113\u2115\u2118-\u211d\u2124\u2126\u2128\u212a-\u2139\u213c-\u213f\u2145-\u2149\u214e\u2160-\u2188\u2c00-\u2c2e\u2c30-\u2c5e\u2c60-\u2ce4\u2ceb-\u2cee\u2cf2\u2cf3\u2d00-\u2d25\u2d27\u2d2d\u2d30-\u2d67\u2d6f\u2d80-\u2d96\u2da0-\u2da6\u2da8-\u2dae\u2db0-\u2db6\u2db8-\u2dbe\u2dc0-\u2dc6\u2dc8-\u2dce\u2dd0-\u2dd6\u2dd8-\u2dde\u3005-\u3007\u3021-\u3029\u3031-\u3035\u3038-\u303c\u3041-\u3096\u309b-\u309f\u30a1-\u30fa\u30fc-\u30ff\u3105-\u312d\u3131-\u318e\u31a0-\u31ba\u31f0-\u31ff\u3400-\u4db5\u4e00-\u9fd5\ua000-\ua48c\ua4d0-\ua4fd\ua500-\ua60c\ua610-\ua61f\ua62a\ua62b\ua640-\ua66e\ua67f-\ua69d\ua6a0-\ua6ef\ua717-\ua71f\ua722-\ua788\ua78b-\ua7ae\ua7b0-\ua7b7\ua7f7-\ua801\ua803-\ua805\ua807-\ua80a\ua80c-\ua822\ua840-\ua873\ua882-\ua8b3\ua8f2-\ua8f7\ua8fb\ua8fd\ua90a-\ua925\ua930-\ua946\ua960-\ua97c\ua984-\ua9b2\ua9cf\ua9e0-\ua9e4\ua9e6-\ua9ef\ua9fa-\ua9fe\uaa00-\uaa28\uaa40-\uaa42\uaa44-\uaa4b\uaa60-\uaa76\uaa7a\uaa7e-\uaaaf\uaab1\uaab5\uaab6\uaab9-\uaabd\uaac0\uaac2\uaadb-\uaadd\uaae0-\uaaea\uaaf2-\uaaf4\uab01-\uab06\uab09-\uab0e\uab11-\uab16\uab20-\uab26\uab28-\uab2e\uab30-\uab5a\uab5c-\uab65\uab70-\uabe2\uac00-\ud7a3\ud7b0-\ud7c6\ud7cb-\ud7fb\uf900-\ufa6d\ufa70-\ufad9\ufb00-\ufb06\ufb13-\ufb17\ufb1d\ufb1f-\ufb28\ufb2a-\ufb36\ufb38-\ufb3c\ufb3e\ufb40\ufb41\ufb43\ufb44\ufb46-\ufbb1\ufbd3-\ufd3d\ufd50-\ufd8f\ufd92-\ufdc7\ufdf0-\ufdfb\ufe70-\ufe74\ufe76-\ufefc\uff21-\uff3a\uff41-\uff5a\uff66-\uffbe\uffc2-\uffc7\uffca-\uffcf\uffd2-\uffd7\uffda-\uffdc";
let nonASCIIidentifierChars = "\u200c\u200d\xb7\u0300-\u036f\u0387\u0483-\u0487\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7\u0610-\u061a\u064b-\u0669\u0670\u06d6-\u06dc\u06df-\u06e4\u06e7\u06e8\u06ea-\u06ed\u06f0-\u06f9\u0711\u0730-\u074a\u07a6-\u07b0\u07c0-\u07c9\u07eb-\u07f3\u0816-\u0819\u081b-\u0823\u0825-\u0827\u0829-\u082d\u0859-\u085b\u08d4-\u08e1\u08e3-\u0903\u093a-\u093c\u093e-\u094f\u0951-\u0957\u0962\u0963\u0966-\u096f\u0981-\u0983\u09bc\u09be-\u09c4\u09c7\u09c8\u09cb-\u09cd\u09d7\u09e2\u09e3\u09e6-\u09ef\u0a01-\u0a03\u0a3c\u0a3e-\u0a42\u0a47\u0a48\u0a4b-\u0a4d\u0a51\u0a66-\u0a71\u0a75\u0a81-\u0a83\u0abc\u0abe-\u0ac5\u0ac7-\u0ac9\u0acb-\u0acd\u0ae2\u0ae3\u0ae6-\u0aef\u0b01-\u0b03\u0b3c\u0b3e-\u0b44\u0b47\u0b48\u0b4b-\u0b4d\u0b56\u0b57\u0b62\u0b63\u0b66-\u0b6f\u0b82\u0bbe-\u0bc2\u0bc6-\u0bc8\u0bca-\u0bcd\u0bd7\u0be6-\u0bef\u0c00-\u0c03\u0c3e-\u0c44\u0c46-\u0c48\u0c4a-\u0c4d\u0c55\u0c56\u0c62\u0c63\u0c66-\u0c6f\u0c81-\u0c83\u0cbc\u0cbe-\u0cc4\u0cc6-\u0cc8\u0cca-\u0ccd\u0cd5\u0cd6\u0ce2\u0ce3\u0ce6-\u0cef\u0d01-\u0d03\u0d3e-\u0d44\u0d46-\u0d48\u0d4a-\u0d4d\u0d57\u0d62\u0d63\u0d66-\u0d6f\u0d82\u0d83\u0dca\u0dcf-\u0dd4\u0dd6\u0dd8-\u0ddf\u0de6-\u0def\u0df2\u0df3\u0e31\u0e34-\u0e3a\u0e47-\u0e4e\u0e50-\u0e59\u0eb1\u0eb4-\u0eb9\u0ebb\u0ebc\u0ec8-\u0ecd\u0ed0-\u0ed9\u0f18\u0f19\u0f20-\u0f29\u0f35\u0f37\u0f39\u0f3e\u0f3f\u0f71-\u0f84\u0f86\u0f87\u0f8d-\u0f97\u0f99-\u0fbc\u0fc6\u102b-\u103e\u1040-\u1049\u1056-\u1059\u105e-\u1060\u1062-\u1064\u1067-\u106d\u1071-\u1074\u1082-\u108d\u108f-\u109d\u135d-\u135f\u1369-\u1371\u1712-\u1714\u1732-\u1734\u1752\u1753\u1772\u1773\u17b4-\u17d3\u17dd\u17e0-\u17e9\u180b-\u180d\u1810-\u1819\u18a9\u1920-\u192b\u1930-\u193b\u1946-\u194f\u19d0-\u19da\u1a17-\u1a1b\u1a55-\u1a5e\u1a60-\u1a7c\u1a7f-\u1a89\u1a90-\u1a99\u1ab0-\u1abd\u1b00-\u1b04\u1b34-\u1b44\u1b50-\u1b59\u1b6b-\u1b73\u1b80-\u1b82\u1ba1-\u1bad\u1bb0-\u1bb9\u1be6-\u1bf3\u1c24-\u1c37\u1c40-\u1c49\u1c50-\u1c59\u1cd0-\u1cd2\u1cd4-\u1ce8\u1ced\u1cf2-\u1cf4\u1cf8\u1cf9\u1dc0-\u1df5\u1dfb-\u1dff\u203f\u2040\u2054\u20d0-\u20dc\u20e1\u20e5-\u20f0\u2cef-\u2cf1\u2d7f\u2de0-\u2dff\u302a-\u302f\u3099\u309a\ua620-\ua629\ua66f\ua674-\ua67d\ua69e\ua69f\ua6f0\ua6f1\ua802\ua806\ua80b\ua823-\ua827\ua880\ua881\ua8b4-\ua8c5\ua8d0-\ua8d9\ua8e0-\ua8f1\ua900-\ua909\ua926-\ua92d\ua947-\ua953\ua980-\ua983\ua9b3-\ua9c0\ua9d0-\ua9d9\ua9e5\ua9f0-\ua9f9\uaa29-\uaa36\uaa43\uaa4c\uaa4d\uaa50-\uaa59\uaa7b-\uaa7d\uaab0\uaab2-\uaab4\uaab7\uaab8\uaabe\uaabf\uaac1\uaaeb-\uaaef\uaaf5\uaaf6\uabe3-\uabea\uabec\uabed\uabf0-\uabf9\ufb1e\ufe00-\ufe0f\ufe20-\ufe2f\ufe33\ufe34\ufe4d-\ufe4f\uff10-\uff19\uff3f";

const nonASCIIidentifierStart = new RegExp("[" + nonASCIIidentifierStartChars + "]");
const nonASCIIidentifier = new RegExp("[" + nonASCIIidentifierStartChars + nonASCIIidentifierChars + "]");

nonASCIIidentifierStartChars = nonASCIIidentifierChars = null;

// These are a run-length and offset encoded representation of the
// >0xffff code points that are a valid part of identifiers. The
// offset starts at 0x10000, and each pair of numbers represents an
// offset to the next range, and then a size of the range. They were
// generated by `bin/generate-identifier-regex.js`.
// eslint-disable-next-line comma-spacing
/* prettier-ignore */const astralIdentifierStartCodes = [0, 11, 2, 25, 2, 18, 2, 1, 2, 14, 3, 13, 35, 122, 70, 52, 268, 28, 4, 48, 48, 31, 17, 26, 6, 37, 11, 29, 3, 35, 5, 7, 2, 4, 43, 157, 19, 35, 5, 35, 5, 39, 9, 51, 157, 310, 10, 21, 11, 7, 153, 5, 3, 0, 2, 43, 2, 1, 4, 0, 3, 22, 11, 22, 10, 30, 66, 18, 2, 1, 11, 21, 11, 25, 71, 55, 7, 1, 65, 0, 16, 3, 2, 2, 2, 26, 45, 28, 4, 28, 36, 7, 2, 27, 28, 53, 11, 21, 11, 18, 14, 17, 111, 72, 56, 50, 14, 50, 785, 52, 76, 44, 33, 24, 27, 35, 42, 34, 4, 0, 13, 47, 15, 3, 22, 0, 2, 0, 36, 17, 2, 24, 85, 6, 2, 0, 2, 3, 2, 14, 2, 9, 8, 46, 39, 7, 3, 1, 3, 21, 2, 6, 2, 1, 2, 4, 4, 0, 19, 0, 13, 4, 159, 52, 19, 3, 54, 47, 21, 1, 2, 0, 185, 46, 42, 3, 37, 47, 21, 0, 60, 42, 86, 25, 391, 63, 32, 0, 449, 56, 264, 8, 2, 36, 18, 0, 50, 29, 881, 921, 103, 110, 18, 195, 2749, 1070, 4050, 582, 8634, 568, 8, 30, 114, 29, 19, 47, 17, 3, 32, 20, 6, 18, 881, 68, 12, 0, 67, 12, 65, 0, 32, 6124, 20, 754, 9486, 1, 3071, 106, 6, 12, 4, 8, 8, 9, 5991, 84, 2, 70, 2, 1, 3, 0, 3, 1, 3, 3, 2, 11, 2, 0, 2, 6, 2, 64, 2, 3, 3, 7, 2, 6, 2, 27, 2, 3, 2, 4, 2, 0, 4, 6, 2, 339, 3, 24, 2, 24, 2, 30, 2, 24, 2, 30, 2, 24, 2, 30, 2, 24, 2, 30, 2, 24, 2, 7, 4149, 196, 60, 67, 1213, 3, 2, 26, 2, 1, 2, 0, 3, 0, 2, 9, 2, 3, 2, 0, 2, 0, 7, 0, 5, 0, 2, 0, 2, 0, 2, 2, 2, 1, 2, 0, 3, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 1, 2, 0, 3, 3, 2, 6, 2, 3, 2, 3, 2, 0, 2, 9, 2, 16, 6, 2, 2, 4, 2, 16, 4421, 42710, 42, 4148, 12, 221, 3, 5761, 10591, 541];
// eslint-disable-next-line comma-spacing
/* prettier-ignore */const astralIdentifierCodes = [509, 0, 227, 0, 150, 4, 294, 9, 1368, 2, 2, 1, 6, 3, 41, 2, 5, 0, 166, 1, 1306, 2, 54, 14, 32, 9, 16, 3, 46, 10, 54, 9, 7, 2, 37, 13, 2, 9, 52, 0, 13, 2, 49, 13, 10, 2, 4, 9, 83, 11, 7, 0, 161, 11, 6, 9, 7, 3, 57, 0, 2, 6, 3, 1, 3, 2, 10, 0, 11, 1, 3, 6, 4, 4, 193, 17, 10, 9, 87, 19, 13, 9, 214, 6, 3, 8, 28, 1, 83, 16, 16, 9, 82, 12, 9, 9, 84, 14, 5, 9, 423, 9, 838, 7, 2, 7, 17, 9, 57, 21, 2, 13, 19882, 9, 135, 4, 60, 6, 26, 9, 1016, 45, 17, 3, 19723, 1, 5319, 4, 4, 5, 9, 7, 3, 6, 31, 3, 149, 2, 1418, 49, 513, 54, 5, 49, 9, 0, 15, 0, 23, 4, 2, 14, 1361, 6, 2, 16, 3, 6, 2, 1, 2, 4, 2214, 6, 110, 6, 6, 9, 792487, 239];

// This has a complexity linear to the value of the code. The
// assumption is that looking up astral identifier characters is
// rare.
function isInAstralSet(code, set) {
  let pos = 0x10000;
  for (let i = 0; i < set.length; i += 2) {
    pos += set[i];
    if (pos > code) return false;

    pos += set[i + 1];
    if (pos >= code) return true;
  }
  return false;
}

// Test whether a given character code starts an identifier.

function isIdentifierStart(code) {
  if (code < 65) return code === 36;
  if (code < 91) return true;
  if (code < 97) return code === 95;
  if (code < 123) return true;
  if (code <= 0xffff) return code >= 0xaa && nonASCIIidentifierStart.test(String.fromCharCode(code));
  return isInAstralSet(code, astralIdentifierStartCodes);
}

// Test whether a given character is part of an identifier.

function isIdentifierChar(code) {
  if (code < 48) return code === 36;
  if (code < 58) return true;
  if (code < 65) return false;
  if (code < 91) return true;
  if (code < 97) return code === 95;
  if (code < 123) return true;
  if (code <= 0xffff) return code >= 0xaa && nonASCIIidentifier.test(String.fromCharCode(code));
  return isInAstralSet(code, astralIdentifierStartCodes) || isInAstralSet(code, astralIdentifierCodes);
}

// Matches a whole line break (where CRLF is considered a single
// line break). Used to count lines.

const lineBreak = /\r\n?|\n|\u2028|\u2029/;
const lineBreakG = new RegExp(lineBreak.source, "g");

function isNewLine(code) {
  return code === 10 || code === 13 || code === 0x2028 || code === 0x2029;
}

const nonASCIIwhitespace = /[\u1680\u180e\u2000-\u200a\u202f\u205f\u3000\ufeff]/;

// The algorithm used to determine whether a regexp can appear at a
// given point in the program is loosely based on sweet.js' approach.
// See https://github.com/mozilla/sweet.js/wiki/design

class TokContext {
  constructor(token, isExpr, preserveSpace, override) // Takes a Tokenizer as a this-parameter, and returns void.
  {
    this.token = token;
    this.isExpr = !!isExpr;
    this.preserveSpace = !!preserveSpace;
    this.override = override;
  }

}

const types$1 = {
  braceStatement: new TokContext("{", false),
  braceExpression: new TokContext("{", true),
  templateQuasi: new TokContext("${", true),
  parenStatement: new TokContext("(", false),
  parenExpression: new TokContext("(", true),
  template: new TokContext("`", true, true, p => p.readTmplToken()),
  functionExpression: new TokContext("function", true)
};

// Token-specific context update code

types.parenR.updateContext = types.braceR.updateContext = function () {
  if (this.state.context.length === 1) {
    this.state.exprAllowed = true;
    return;
  }

  const out = this.state.context.pop();
  if (out === types$1.braceStatement && this.curContext() === types$1.functionExpression) {
    this.state.context.pop();
    this.state.exprAllowed = false;
  } else if (out === types$1.templateQuasi) {
    this.state.exprAllowed = true;
  } else {
    this.state.exprAllowed = !out.isExpr;
  }
};

types.name.updateContext = function (prevType) {
  this.state.exprAllowed = false;

  if (prevType === types._let || prevType === types._const || prevType === types._var) {
    if (lineBreak.test(this.input.slice(this.state.end))) {
      this.state.exprAllowed = true;
    }
  }
};

types.braceL.updateContext = function (prevType) {
  this.state.context.push(this.braceIsBlock(prevType) ? types$1.braceStatement : types$1.braceExpression);
  this.state.exprAllowed = true;
};

types.dollarBraceL.updateContext = function () {
  this.state.context.push(types$1.templateQuasi);
  this.state.exprAllowed = true;
};

types.parenL.updateContext = function (prevType) {
  const statementParens = prevType === types._if || prevType === types._for || prevType === types._with || prevType === types._while;
  this.state.context.push(statementParens ? types$1.parenStatement : types$1.parenExpression);
  this.state.exprAllowed = true;
};

types.incDec.updateContext = function () {
  // tokExprAllowed stays unchanged
};

types._function.updateContext = function () {
  if (this.curContext() !== types$1.braceStatement) {
    this.state.context.push(types$1.functionExpression);
  }

  this.state.exprAllowed = false;
};

types.backQuote.updateContext = function () {
  if (this.curContext() === types$1.template) {
    this.state.context.pop();
  } else {
    this.state.context.push(types$1.template);
  }
  this.state.exprAllowed = false;
};

// These are used when `options.locations` is on, for the
// `startLoc` and `endLoc` properties.

class Position {

  constructor(line, col) {
    this.line = line;
    this.column = col;
  }
}

class SourceLocation {

  constructor(start, end) {
    this.start = start;
    // $FlowIgnore (may start as null, but initialized later)
    this.end = end;
  }
}

// The `getLineInfo` function is mostly useful when the
// `locations` option is off (for performance reasons) and you
// want to find the line/column position for a given character
// offset. `input` should be the code string that the offset refers
// into.

function getLineInfo(input, offset) {
  for (let line = 1, cur = 0;;) {
    lineBreakG.lastIndex = cur;
    const match = lineBreakG.exec(input);
    if (match && match.index < offset) {
      ++line;
      cur = match.index + match[0].length;
    } else {
      return new Position(line, offset - cur);
    }
  }
  // istanbul ignore next
  throw new Error("Unreachable");
}

class BaseParser {
  // Properties set by constructor in index.js


  // Initialized by Tokenizer
  isReservedWord(word) {
    if (word === "await") {
      return this.inModule;
    } else {
      return reservedWords[6](word);
    }
  }

  hasPlugin(name) {
    return !!this.plugins[name];
  }
}

/* eslint max-len: 0 */

/**
 * Based on the comment attachment algorithm used in espree and estraverse.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * * Redistributions of source code must retain the above copyright
 *   notice, this list of conditions and the following disclaimer.
 * * Redistributions in binary form must reproduce the above copyright
 *   notice, this list of conditions and the following disclaimer in the
 *   documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

function last(stack) {
  return stack[stack.length - 1];
}

class CommentsParser extends BaseParser {
  addComment(comment) {
    if (this.filename) comment.loc.filename = this.filename;
    this.state.trailingComments.push(comment);
    this.state.leadingComments.push(comment);
  }

  processComment(node) {
    if (node.type === "Program" && node.body.length > 0) return;

    const stack = this.state.commentStack;

    let firstChild, lastChild, trailingComments, i, j;

    if (this.state.trailingComments.length > 0) {
      // If the first comment in trailingComments comes after the
      // current node, then we're good - all comments in the array will
      // come after the node and so it's safe to add them as official
      // trailingComments.
      if (this.state.trailingComments[0].start >= node.end) {
        trailingComments = this.state.trailingComments;
        this.state.trailingComments = [];
      } else {
        // Otherwise, if the first comment doesn't come after the
        // current node, that means we have a mix of leading and trailing
        // comments in the array and that leadingComments contains the
        // same items as trailingComments. Reset trailingComments to
        // zero items and we'll handle this by evaluating leadingComments
        // later.
        this.state.trailingComments.length = 0;
      }
    } else {
      const lastInStack = last(stack);
      if (stack.length > 0 && lastInStack.trailingComments && lastInStack.trailingComments[0].start >= node.end) {
        trailingComments = lastInStack.trailingComments;
        lastInStack.trailingComments = null;
      }
    }

    // Eating the stack.
    if (stack.length > 0 && last(stack).start >= node.start) {
      firstChild = stack.pop();
    }

    while (stack.length > 0 && last(stack).start >= node.start) {
      lastChild = stack.pop();
    }

    if (!lastChild && firstChild) lastChild = firstChild;

    // Attach comments that follow a trailing comma on the last
    // property in an object literal or a trailing comma in function arguments
    // as trailing comments
    if (firstChild && this.state.leadingComments.length > 0) {
      const lastComment = last(this.state.leadingComments);

      if (firstChild.type === "ObjectProperty") {
        if (lastComment.start >= node.start) {
          if (this.state.commentPreviousNode) {
            for (j = 0; j < this.state.leadingComments.length; j++) {
              if (this.state.leadingComments[j].end < this.state.commentPreviousNode.end) {
                this.state.leadingComments.splice(j, 1);
                j--;
              }
            }

            if (this.state.leadingComments.length > 0) {
              firstChild.trailingComments = this.state.leadingComments;
              this.state.leadingComments = [];
            }
          }
        }
      } else if (node.type === "CallExpression" && node.arguments && node.arguments.length) {
        const lastArg = last(node.arguments);

        if (lastArg && lastComment.start >= lastArg.start && lastComment.end <= node.end) {
          if (this.state.commentPreviousNode) {
            if (this.state.leadingComments.length > 0) {
              lastArg.trailingComments = this.state.leadingComments;
              this.state.leadingComments = [];
            }
          }
        }
      }
    }

    if (lastChild) {
      if (lastChild.leadingComments) {
        if (lastChild !== node && last(lastChild.leadingComments).end <= node.start) {
          node.leadingComments = lastChild.leadingComments;
          lastChild.leadingComments = null;
        } else {
          // A leading comment for an anonymous class had been stolen by its first ClassMethod,
          // so this takes back the leading comment.
          // See also: https://github.com/eslint/espree/issues/158
          for (i = lastChild.leadingComments.length - 2; i >= 0; --i) {
            if (lastChild.leadingComments[i].end <= node.start) {
              node.leadingComments = lastChild.leadingComments.splice(0, i + 1);
              break;
            }
          }
        }
      }
    } else if (this.state.leadingComments.length > 0) {
      if (last(this.state.leadingComments).end <= node.start) {
        if (this.state.commentPreviousNode) {
          for (j = 0; j < this.state.leadingComments.length; j++) {
            if (this.state.leadingComments[j].end < this.state.commentPreviousNode.end) {
              this.state.leadingComments.splice(j, 1);
              j--;
            }
          }
        }
        if (this.state.leadingComments.length > 0) {
          node.leadingComments = this.state.leadingComments;
          this.state.leadingComments = [];
        }
      } else {
        // https://github.com/eslint/espree/issues/2
        //
        // In special cases, such as return (without a value) and
        // debugger, all comments will end up as leadingComments and
        // will otherwise be eliminated. This step runs when the
        // commentStack is empty and there are comments left
        // in leadingComments.
        //
        // This loop figures out the stopping point between the actual
        // leading and trailing comments by finding the location of the
        // first comment that comes after the given node.
        for (i = 0; i < this.state.leadingComments.length; i++) {
          if (this.state.leadingComments[i].end > node.start) {
            break;
          }
        }

        // Split the array based on the location of the first comment
        // that comes after the node. Keep in mind that this could
        // result in an empty array, and if so, the array must be
        // deleted.
        const leadingComments = this.state.leadingComments.slice(0, i);
        node.leadingComments = leadingComments.length === 0 ? null : leadingComments;

        // Similarly, trailing comments are attached later. The variable
        // must be reset to null if there are no trailing comments.
        trailingComments = this.state.leadingComments.slice(i);
        if (trailingComments.length === 0) {
          trailingComments = null;
        }
      }
    }

    this.state.commentPreviousNode = node;

    if (trailingComments) {
      if (trailingComments.length && trailingComments[0].start >= node.start && last(trailingComments).end <= node.end) {
        node.innerComments = trailingComments;
      } else {
        node.trailingComments = trailingComments;
      }
    }

    stack.push(node);
  }
}

// This function is used to raise exceptions on parse errors. It
// takes an offset integer (into the current `input`) to indicate
// the location of the error, attaches the position to the end
// of the error message, and then raises a `SyntaxError` with that
// message.

class LocationParser extends CommentsParser {
  raise(pos, message) {
    const loc = getLineInfo(this.input, pos);
    message += ` (${loc.line}:${loc.column})`;
    // $FlowIgnore
    const err = new SyntaxError(message);
    err.pos = pos;
    err.loc = loc;
    throw err;
  }
}

class State {
  init(options, input) {
    this.strict = options.strictMode === false ? false : options.sourceType === "module";

    this.input = input;

    this.potentialArrowAt = -1;

    // eslint-disable-next-line max-len
    this.inMethod = this.inFunction = this.inGenerator = this.inAsync = this.inPropertyName = this.inType = this.inClassProperty = this.noAnonFunctionType = false;

    this.classLevel = 0;

    this.labels = [];

    this.decoratorStack = [[]];

    this.tokens = [];

    this.comments = [];

    this.trailingComments = [];
    this.leadingComments = [];
    this.commentStack = [];
    // $FlowIgnore
    this.commentPreviousNode = null;

    this.pos = this.lineStart = 0;
    this.curLine = options.startLine;

    this.type = types.eof;
    this.value = null;
    this.start = this.end = this.pos;
    this.startLoc = this.endLoc = this.curPosition();

    // $FlowIgnore
    this.lastTokEndLoc = this.lastTokStartLoc = null;
    this.lastTokStart = this.lastTokEnd = this.pos;

    this.context = [types$1.braceStatement];
    this.exprAllowed = true;

    this.containsEsc = this.containsOctal = false;
    this.octalPosition = null;

    this.invalidTemplateEscapePosition = null;

    this.exportedIdentifiers = [];
  }

  // TODO


  curPosition() {
    return new Position(this.curLine, this.pos - this.lineStart);
  }

  clone(skipArrays) {
    const state = new State();
    for (const key in this) {
      // $FlowIgnore
      let val = this[key];

      if ((!skipArrays || key === "context") && Array.isArray(val)) {
        val = val.slice();
      }

      // $FlowIgnore
      state[key] = val;
    }
    return state;
  }
}

/* eslint max-len: 0 */

// The following character codes are forbidden from being
// an immediate sibling of NumericLiteralSeparator _

const forbiddenNumericSeparatorSiblings = {
  decBinOct: [46, // .
  66, // B
  69, // E
  79, // O
  95, // _ (multiple separators are not allowed)
  98, // b
  101, // e
  111],
  hex: [46, // .
  88, // X
  95, // _ (multiple separators are not allowed)
  120]
};

// Object type used to represent tokens. Note that normally, tokens
// simply exist as properties on the parser object. This is only
// used for the onToken callback and the external tokenizer.

class Token {
  constructor(state) {
    this.type = state.type;
    this.value = state.value;
    this.start = state.start;
    this.end = state.end;
    this.loc = new SourceLocation(state.startLoc, state.endLoc);
  }

}

// ## Tokenizer

function codePointToString(code) {
  // UTF-16 Decoding
  if (code <= 0xffff) {
    return String.fromCharCode(code);
  } else {
    return String.fromCharCode((code - 0x10000 >> 10) + 0xd800, (code - 0x10000 & 1023) + 0xdc00);
  }
}

class Tokenizer extends LocationParser {
  // Forward-declarations
  // parser/util.js
  constructor(options, input) {
    super();
    this.state = new State();
    this.state.init(options, input);
    this.isLookahead = false;
  }

  // Move to the next token

  next() {
    if (this.options.tokens && !this.isLookahead) {
      this.state.tokens.push(new Token(this.state));
    }

    this.state.lastTokEnd = this.state.end;
    this.state.lastTokStart = this.state.start;
    this.state.lastTokEndLoc = this.state.endLoc;
    this.state.lastTokStartLoc = this.state.startLoc;
    this.nextToken();
  }

  // TODO

  eat(type) {
    if (this.match(type)) {
      this.next();
      return true;
    } else {
      return false;
    }
  }

  // TODO

  match(type) {
    return this.state.type === type;
  }

  // TODO

  isKeyword(word) {
    return isKeyword(word);
  }

  // TODO

  lookahead() {
    const old = this.state;
    this.state = old.clone(true);

    this.isLookahead = true;
    this.next();
    this.isLookahead = false;

    const curr = this.state;
    this.state = old;
    return curr;
  }

  // Toggle strict mode. Re-reads the next number or string to please
  // pedantic tests (`"use strict"; 010;` should fail).

  setStrict(strict) {
    this.state.strict = strict;
    if (!this.match(types.num) && !this.match(types.string)) return;
    this.state.pos = this.state.start;
    while (this.state.pos < this.state.lineStart) {
      this.state.lineStart = this.input.lastIndexOf("\n", this.state.lineStart - 2) + 1;
      --this.state.curLine;
    }
    this.nextToken();
  }

  curContext() {
    return this.state.context[this.state.context.length - 1];
  }

  // Read a single token, updating the parser object's token-related
  // properties.

  nextToken() {
    const curContext = this.curContext();
    if (!curContext || !curContext.preserveSpace) this.skipSpace();

    this.state.containsOctal = false;
    this.state.octalPosition = null;
    this.state.start = this.state.pos;
    this.state.startLoc = this.state.curPosition();
    if (this.state.pos >= this.input.length) return this.finishToken(types.eof);

    if (curContext.override) {
      return curContext.override(this);
    } else {
      return this.readToken(this.fullCharCodeAtPos());
    }
  }

  readToken(code) {
    // Identifier or keyword. '\uXXXX' sequences are allowed in
    // identifiers, so '\' also dispatches to that.
    if (isIdentifierStart(code) || code === 92 /* '\' */) {
        return this.readWord();
      } else {
      return this.getTokenFromCode(code);
    }
  }

  fullCharCodeAtPos() {
    const code = this.input.charCodeAt(this.state.pos);
    if (code <= 0xd7ff || code >= 0xe000) return code;

    const next = this.input.charCodeAt(this.state.pos + 1);
    return (code << 10) + next - 0x35fdc00;
  }

  pushComment(block, text, start, end, startLoc, endLoc) {
    const comment = {
      type: block ? "CommentBlock" : "CommentLine",
      value: text,
      start: start,
      end: end,
      loc: new SourceLocation(startLoc, endLoc)
    };

    if (!this.isLookahead) {
      if (this.options.tokens) this.state.tokens.push(comment);
      this.state.comments.push(comment);
      this.addComment(comment);
    }
  }

  skipBlockComment() {
    const startLoc = this.state.curPosition();
    const start = this.state.pos;
    const end = this.input.indexOf("*/", this.state.pos += 2);
    if (end === -1) this.raise(this.state.pos - 2, "Unterminated comment");

    this.state.pos = end + 2;
    lineBreakG.lastIndex = start;
    let match;
    while ((match = lineBreakG.exec(this.input)) && match.index < this.state.pos) {
      ++this.state.curLine;
      this.state.lineStart = match.index + match[0].length;
    }

    this.pushComment(true, this.input.slice(start + 2, end), start, this.state.pos, startLoc, this.state.curPosition());
  }

  skipLineComment(startSkip) {
    const start = this.state.pos;
    const startLoc = this.state.curPosition();
    let ch = this.input.charCodeAt(this.state.pos += startSkip);
    if (this.state.pos < this.input.length) {
      while (ch !== 10 && ch !== 13 && ch !== 8232 && ch !== 8233 && ++this.state.pos < this.input.length) {
        ch = this.input.charCodeAt(this.state.pos);
      }
    }

    this.pushComment(false, this.input.slice(start + startSkip, this.state.pos), start, this.state.pos, startLoc, this.state.curPosition());
  }

  // Called at the start of the parse and after every token. Skips
  // whitespace and comments, and.

  skipSpace() {
    loop: while (this.state.pos < this.input.length) {
      const ch = this.input.charCodeAt(this.state.pos);
      switch (ch) {
        case 32:
        case 160:
          // ' '
          ++this.state.pos;
          break;

        case 13:
          if (this.input.charCodeAt(this.state.pos + 1) === 10) {
            ++this.state.pos;
          }

        case 10:
        case 8232:
        case 8233:
          ++this.state.pos;
          ++this.state.curLine;
          this.state.lineStart = this.state.pos;
          break;

        case 47:
          // '/'
          switch (this.input.charCodeAt(this.state.pos + 1)) {
            case 42:
              // '*'
              this.skipBlockComment();
              break;

            case 47:
              this.skipLineComment(2);
              break;

            default:
              break loop;
          }
          break;

        default:
          if (ch > 8 && ch < 14 || ch >= 5760 && nonASCIIwhitespace.test(String.fromCharCode(ch))) {
            ++this.state.pos;
          } else {
            break loop;
          }
      }
    }
  }

  // Called at the end of every token. Sets `end`, `val`, and
  // maintains `context` and `exprAllowed`, and skips the space after
  // the token, so that the next one's `start` will point at the
  // right position.

  finishToken(type, val) {
    this.state.end = this.state.pos;
    this.state.endLoc = this.state.curPosition();
    const prevType = this.state.type;
    this.state.type = type;
    this.state.value = val;

    this.updateContext(prevType);
  }

  // ### Token reading

  // This is the function that is called to fetch the next token. It
  // is somewhat obscure, because it works in character codes rather
  // than characters, and because operator parsing has been inlined
  // into it.
  //
  // All in the name of speed.
  //
  readToken_dot() {
    const next = this.input.charCodeAt(this.state.pos + 1);
    if (next >= 48 && next <= 57) {
      return this.readNumber(true);
    }

    const next2 = this.input.charCodeAt(this.state.pos + 2);
    if (next === 46 && next2 === 46) {
      // 46 = dot '.'
      this.state.pos += 3;
      return this.finishToken(types.ellipsis);
    } else {
      ++this.state.pos;
      return this.finishToken(types.dot);
    }
  }

  readToken_slash() {
    // '/'
    if (this.state.exprAllowed) {
      ++this.state.pos;
      return this.readRegexp();
    }

    const next = this.input.charCodeAt(this.state.pos + 1);
    if (next === 61) {
      return this.finishOp(types.assign, 2);
    } else {
      return this.finishOp(types.slash, 1);
    }
  }

  readToken_mult_modulo(code) {
    // '%*'
    let type = code === 42 ? types.star : types.modulo;
    let width = 1;
    let next = this.input.charCodeAt(this.state.pos + 1);

    if (next === 42) {
      // '*'
      width++;
      next = this.input.charCodeAt(this.state.pos + 2);
      type = types.exponent;
    }

    if (next === 61) {
      width++;
      type = types.assign;
    }

    return this.finishOp(type, width);
  }

  readToken_pipe_amp(code) {
    // '|&'
    const next = this.input.charCodeAt(this.state.pos + 1);
    if (next === code) return this.finishOp(code === 124 ? types.logicalOR : types.logicalAND, 2);
    if (next === 61) return this.finishOp(types.assign, 2);
    if (code === 124 && next === 125 && this.hasPlugin("flow")) return this.finishOp(types.braceBarR, 2);
    return this.finishOp(code === 124 ? types.bitwiseOR : types.bitwiseAND, 1);
  }

  readToken_caret() {
    // '^'
    const next = this.input.charCodeAt(this.state.pos + 1);
    if (next === 61) {
      return this.finishOp(types.assign, 2);
    } else {
      return this.finishOp(types.bitwiseXOR, 1);
    }
  }

  readToken_plus_min(code) {
    // '+-'
    const next = this.input.charCodeAt(this.state.pos + 1);

    if (next === code) {
      if (next === 45 && this.input.charCodeAt(this.state.pos + 2) === 62 && lineBreak.test(this.input.slice(this.state.lastTokEnd, this.state.pos))) {
        // A `-->` line comment
        this.skipLineComment(3);
        this.skipSpace();
        return this.nextToken();
      }
      return this.finishOp(types.incDec, 2);
    }

    if (next === 61) {
      return this.finishOp(types.assign, 2);
    } else {
      return this.finishOp(types.plusMin, 1);
    }
  }

  readToken_lt_gt(code) {
    // '<>'
    const next = this.input.charCodeAt(this.state.pos + 1);
    let size = 1;

    if (next === code) {
      size = code === 62 && this.input.charCodeAt(this.state.pos + 2) === 62 ? 3 : 2;
      if (this.input.charCodeAt(this.state.pos + size) === 61) return this.finishOp(types.assign, size + 1);
      return this.finishOp(types.bitShift, size);
    }

    if (next === 33 && code === 60 && this.input.charCodeAt(this.state.pos + 2) === 45 && this.input.charCodeAt(this.state.pos + 3) === 45) {
      if (this.inModule) this.unexpected();
      // `<!--`, an XML-style comment that should be interpreted as a line comment
      this.skipLineComment(4);
      this.skipSpace();
      return this.nextToken();
    }

    if (next === 61) {
      // <= | >=
      size = 2;
    }

    return this.finishOp(types.relational, size);
  }

  readToken_eq_excl(code) {
    // '=!'
    const next = this.input.charCodeAt(this.state.pos + 1);
    if (next === 61) return this.finishOp(types.equality, this.input.charCodeAt(this.state.pos + 2) === 61 ? 3 : 2);
    if (code === 61 && next === 62) {
      // '=>'
      this.state.pos += 2;
      return this.finishToken(types.arrow);
    }
    return this.finishOp(code === 61 ? types.eq : types.bang, 1);
  }

  readToken_question() {
    // '?'
    const next = this.input.charCodeAt(this.state.pos + 1);
    const next2 = this.input.charCodeAt(this.state.pos + 2);
    if (next === 46 && !(next2 >= 48 && next2 <= 57)) {
      // '.' not followed by a number
      this.state.pos += 2;
      return this.finishToken(types.questionDot);
    } else {
      ++this.state.pos;
      return this.finishToken(types.question);
    }
  }

  getTokenFromCode(code) {
    switch (code) {
      case 35:
        // '#'
        if (this.hasPlugin("classPrivateProperties") && this.state.classLevel > 0) {
          ++this.state.pos;
          return this.finishToken(types.hash);
        } else {
          this.raise(this.state.pos, `Unexpected character '${codePointToString(code)}'`);
        }

      // The interpretation of a dot depends on whether it is followed
      // by a digit or another two dots.

      case 46:
        // '.'
        return this.readToken_dot();

      // Punctuation tokens.
      case 40:
        ++this.state.pos;
        return this.finishToken(types.parenL);
      case 41:
        ++this.state.pos;
        return this.finishToken(types.parenR);
      case 59:
        ++this.state.pos;
        return this.finishToken(types.semi);
      case 44:
        ++this.state.pos;
        return this.finishToken(types.comma);
      case 91:
        ++this.state.pos;
        return this.finishToken(types.bracketL);
      case 93:
        ++this.state.pos;
        return this.finishToken(types.bracketR);

      case 123:
        if (this.hasPlugin("flow") && this.input.charCodeAt(this.state.pos + 1) === 124) {
          return this.finishOp(types.braceBarL, 2);
        } else {
          ++this.state.pos;
          return this.finishToken(types.braceL);
        }

      case 125:
        ++this.state.pos;
        return this.finishToken(types.braceR);

      case 58:
        if (this.hasPlugin("functionBind") && this.input.charCodeAt(this.state.pos + 1) === 58) {
          return this.finishOp(types.doubleColon, 2);
        } else {
          ++this.state.pos;
          return this.finishToken(types.colon);
        }

      case 63:
        return this.readToken_question();
      case 64:
        ++this.state.pos;
        return this.finishToken(types.at);

      case 96:
        // '`'
        ++this.state.pos;
        return this.finishToken(types.backQuote);

      case 48:
        // '0'
        const next = this.input.charCodeAt(this.state.pos + 1);
        if (next === 120 || next === 88) return this.readRadixNumber(16); // '0x', '0X' - hex number
        if (next === 111 || next === 79) return this.readRadixNumber(8); // '0o', '0O' - octal number
        if (next === 98 || next === 66) return this.readRadixNumber(2); // '0b', '0B' - binary number
      // Anything else beginning with a digit is an integer, octal
      // number, or float.
      case 49:
      case 50:
      case 51:
      case 52:
      case 53:
      case 54:
      case 55:
      case 56:
      case 57:
        // 1-9
        return this.readNumber(false);

      // Quotes produce strings.
      case 34:
      case 39:
        // '"', "'"
        return this.readString(code);

      // Operators are parsed inline in tiny state machines. '=' (61) is
      // often referred to. `finishOp` simply skips the amount of
      // characters it is given as second argument, and returns a token
      // of the type given by its first argument.

      case 47:
        // '/'
        return this.readToken_slash();

      case 37:
      case 42:
        // '%*'
        return this.readToken_mult_modulo(code);

      case 124:
      case 38:
        // '|&'
        return this.readToken_pipe_amp(code);

      case 94:
        // '^'
        return this.readToken_caret();

      case 43:
      case 45:
        // '+-'
        return this.readToken_plus_min(code);

      case 60:
      case 62:
        // '<>'
        return this.readToken_lt_gt(code);

      case 61:
      case 33:
        // '=!'
        return this.readToken_eq_excl(code);

      case 126:
        // '~'
        return this.finishOp(types.tilde, 1);
    }

    this.raise(this.state.pos, `Unexpected character '${codePointToString(code)}'`);
  }

  finishOp(type, size) {
    const str = this.input.slice(this.state.pos, this.state.pos + size);
    this.state.pos += size;
    return this.finishToken(type, str);
  }

  readRegexp() {
    const start = this.state.pos;
    let escaped, inClass;
    for (;;) {
      if (this.state.pos >= this.input.length) this.raise(start, "Unterminated regular expression");
      const ch = this.input.charAt(this.state.pos);
      if (lineBreak.test(ch)) {
        this.raise(start, "Unterminated regular expression");
      }
      if (escaped) {
        escaped = false;
      } else {
        if (ch === "[") {
          inClass = true;
        } else if (ch === "]" && inClass) {
          inClass = false;
        } else if (ch === "/" && !inClass) {
          break;
        }
        escaped = ch === "\\";
      }
      ++this.state.pos;
    }
    const content = this.input.slice(start, this.state.pos);
    ++this.state.pos;
    // Need to use `readWord1` because '\uXXXX' sequences are allowed
    // here (don't ask).
    const mods = this.readWord1();
    if (mods) {
      const validFlags = /^[gmsiyu]*$/;
      if (!validFlags.test(mods)) this.raise(start, "Invalid regular expression flag");
    }
    return this.finishToken(types.regexp, {
      pattern: content,
      flags: mods
    });
  }

  // Read an integer in the given radix. Return null if zero digits
  // were read, the integer value otherwise. When `len` is given, this
  // will return `null` unless the integer has exactly `len` digits.

  readInt(radix, len) {
    const start = this.state.pos;
    const forbiddenSiblings = radix === 16 ? forbiddenNumericSeparatorSiblings.hex : forbiddenNumericSeparatorSiblings.decBinOct;
    let total = 0;

    for (let i = 0, e = len == null ? Infinity : len; i < e; ++i) {
      const code = this.input.charCodeAt(this.state.pos);
      let val;

      if (this.hasPlugin("numericSeparator")) {
        const prev = this.input.charCodeAt(this.state.pos - 1);
        const next = this.input.charCodeAt(this.state.pos + 1);
        if (code === 95) {
          if (forbiddenSiblings.indexOf(prev) > -1 || forbiddenSiblings.indexOf(next) > -1 || Number.isNaN(next)) {
            this.raise(this.state.pos, "Invalid NumericLiteralSeparator");
          }

          // Ignore this _ character
          ++this.state.pos;
          continue;
        }
      }

      if (code >= 97) {
        val = code - 97 + 10; // a
      } else if (code >= 65) {
        val = code - 65 + 10; // A
      } else if (code >= 48 && code <= 57) {
        val = code - 48; // 0-9
      } else {
        val = Infinity;
      }
      if (val >= radix) break;
      ++this.state.pos;
      total = total * radix + val;
    }
    if (this.state.pos === start || len != null && this.state.pos - start !== len) return null;

    return total;
  }

  readRadixNumber(radix) {
    const start = this.state.pos;
    let isBigInt = false;

    this.state.pos += 2; // 0x
    const val = this.readInt(radix);
    if (val == null) this.raise(this.state.start + 2, "Expected number in radix " + radix);

    if (this.hasPlugin("bigInt")) {
      if (this.input.charCodeAt(this.state.pos) === 0x6e) {
        // 'n'
        ++this.state.pos;
        isBigInt = true;
      }
    }

    if (isIdentifierStart(this.fullCharCodeAtPos())) this.raise(this.state.pos, "Identifier directly after number");

    if (isBigInt) {
      const str = this.input.slice(start, this.state.pos).replace(/[_n]/g, "");
      return this.finishToken(types.bigint, str);
    }

    return this.finishToken(types.num, val);
  }

  // Read an integer, octal integer, or floating-point number.

  readNumber(startsWithDot) {
    const start = this.state.pos;
    let octal = this.input.charCodeAt(start) === 0x30; // '0'
    let isFloat = false;
    let isBigInt = false;

    if (!startsWithDot && this.readInt(10) === null) this.raise(start, "Invalid number");
    if (octal && this.state.pos == start + 1) octal = false; // number === 0

    let next = this.input.charCodeAt(this.state.pos);
    if (next === 0x2e && !octal) {
      // '.'
      ++this.state.pos;
      this.readInt(10);
      isFloat = true;
      next = this.input.charCodeAt(this.state.pos);
    }

    if ((next === 0x45 || next === 0x65) && !octal) {
      // 'Ee'
      next = this.input.charCodeAt(++this.state.pos);
      if (next === 0x2b || next === 0x2d) ++this.state.pos; // '+-'
      if (this.readInt(10) === null) this.raise(start, "Invalid number");
      isFloat = true;
      next = this.input.charCodeAt(this.state.pos);
    }

    if (this.hasPlugin("bigInt")) {
      if (next === 0x6e) {
        // 'n'
        // disallow floats and legacy octal syntax, new style octal ("0o") is handled in this.readRadixNumber
        if (isFloat || octal) this.raise(start, "Invalid BigIntLiteral");
        ++this.state.pos;
        isBigInt = true;
      }
    }

    if (isIdentifierStart(this.fullCharCodeAtPos())) this.raise(this.state.pos, "Identifier directly after number");

    // remove "_" for numeric literal separator, and "n" for BigInts
    const str = this.input.slice(start, this.state.pos).replace(/[_n]/g, "");

    if (isBigInt) {
      return this.finishToken(types.bigint, str);
    }

    let val;
    if (isFloat) {
      val = parseFloat(str);
    } else if (!octal || str.length === 1) {
      val = parseInt(str, 10);
    } else if (this.state.strict) {
      this.raise(start, "Invalid number");
    } else if (/[89]/.test(str)) {
      val = parseInt(str, 10);
    } else {
      val = parseInt(str, 8);
    }
    return this.finishToken(types.num, val);
  }

  // Read a string value, interpreting backslash-escapes.

  readCodePoint(throwOnInvalid) {
    const ch = this.input.charCodeAt(this.state.pos);
    let code;

    if (ch === 123) {
      // '{'
      const codePos = ++this.state.pos;
      code = this.readHexChar(this.input.indexOf("}", this.state.pos) - this.state.pos, throwOnInvalid);
      ++this.state.pos;
      if (code === null) {
        // $FlowFixMe (is this always non-null?)
        --this.state.invalidTemplateEscapePosition; // to point to the '\'' instead of the 'u'
      } else if (code > 0x10ffff) {
        if (throwOnInvalid) {
          this.raise(codePos, "Code point out of bounds");
        } else {
          this.state.invalidTemplateEscapePosition = codePos - 2;
          return null;
        }
      }
    } else {
      code = this.readHexChar(4, throwOnInvalid);
    }
    return code;
  }

  readString(quote) {
    let out = "",
        chunkStart = ++this.state.pos;
    for (;;) {
      if (this.state.pos >= this.input.length) this.raise(this.state.start, "Unterminated string constant");
      const ch = this.input.charCodeAt(this.state.pos);
      if (ch === quote) break;
      if (ch === 92) {
        // '\'
        out += this.input.slice(chunkStart, this.state.pos);
        // $FlowFixMe
        out += this.readEscapedChar(false);
        chunkStart = this.state.pos;
      } else {
        if (isNewLine(ch)) this.raise(this.state.start, "Unterminated string constant");
        ++this.state.pos;
      }
    }
    out += this.input.slice(chunkStart, this.state.pos++);
    return this.finishToken(types.string, out);
  }

  // Reads template string tokens.

  readTmplToken() {
    let out = "",
        chunkStart = this.state.pos,
        containsInvalid = false;
    for (;;) {
      if (this.state.pos >= this.input.length) this.raise(this.state.start, "Unterminated template");
      const ch = this.input.charCodeAt(this.state.pos);
      if (ch === 96 || ch === 36 && this.input.charCodeAt(this.state.pos + 1) === 123) {
        // '`', '${'
        if (this.state.pos === this.state.start && this.match(types.template)) {
          if (ch === 36) {
            this.state.pos += 2;
            return this.finishToken(types.dollarBraceL);
          } else {
            ++this.state.pos;
            return this.finishToken(types.backQuote);
          }
        }
        out += this.input.slice(chunkStart, this.state.pos);
        return this.finishToken(types.template, containsInvalid ? null : out);
      }
      if (ch === 92) {
        // '\'
        out += this.input.slice(chunkStart, this.state.pos);
        const escaped = this.readEscapedChar(true);
        if (escaped === null) {
          containsInvalid = true;
        } else {
          out += escaped;
        }
        chunkStart = this.state.pos;
      } else if (isNewLine(ch)) {
        out += this.input.slice(chunkStart, this.state.pos);
        ++this.state.pos;
        switch (ch) {
          case 13:
            if (this.input.charCodeAt(this.state.pos) === 10) ++this.state.pos;
          case 10:
            out += "\n";
            break;
          default:
            out += String.fromCharCode(ch);
            break;
        }
        ++this.state.curLine;
        this.state.lineStart = this.state.pos;
        chunkStart = this.state.pos;
      } else {
        ++this.state.pos;
      }
    }
  }

  // Used to read escaped characters

  readEscapedChar(inTemplate) {
    const throwOnInvalid = !inTemplate;
    const ch = this.input.charCodeAt(++this.state.pos);
    ++this.state.pos;
    switch (ch) {
      case 110:
        return "\n"; // 'n' -> '\n'
      case 114:
        return "\r"; // 'r' -> '\r'
      case 120:
        {
          // 'x'
          const code = this.readHexChar(2, throwOnInvalid);
          return code === null ? null : String.fromCharCode(code);
        }
      case 117:
        {
          // 'u'
          const code = this.readCodePoint(throwOnInvalid);
          return code === null ? null : codePointToString(code);
        }
      case 116:
        return "\t"; // 't' -> '\t'
      case 98:
        return "\b"; // 'b' -> '\b'
      case 118:
        return "\u000b"; // 'v' -> '\u000b'
      case 102:
        return "\f"; // 'f' -> '\f'
      case 13:
        if (this.input.charCodeAt(this.state.pos) === 10) ++this.state.pos; // '\r\n'
      case 10:
        // ' \n'
        this.state.lineStart = this.state.pos;
        ++this.state.curLine;
        return "";
      default:
        if (ch >= 48 && ch <= 55) {
          const codePos = this.state.pos - 1;
          // $FlowFixMe
          let octalStr = this.input.substr(this.state.pos - 1, 3).match(/^[0-7]+/)[0];
          let octal = parseInt(octalStr, 8);
          if (octal > 255) {
            octalStr = octalStr.slice(0, -1);
            octal = parseInt(octalStr, 8);
          }
          if (octal > 0) {
            if (inTemplate) {
              this.state.invalidTemplateEscapePosition = codePos;
              return null;
            } else if (this.state.strict) {
              this.raise(codePos, "Octal literal in strict mode");
            } else if (!this.state.containsOctal) {
              // These properties are only used to throw an error for an octal which occurs
              // in a directive which occurs prior to a "use strict" directive.
              this.state.containsOctal = true;
              this.state.octalPosition = codePos;
            }
          }
          this.state.pos += octalStr.length - 1;
          return String.fromCharCode(octal);
        }
        return String.fromCharCode(ch);
    }
  }

  // Used to read character escape sequences ('\x', '\u').

  readHexChar(len, throwOnInvalid) {
    const codePos = this.state.pos;
    const n = this.readInt(16, len);
    if (n === null) {
      if (throwOnInvalid) {
        this.raise(codePos, "Bad character escape sequence");
      } else {
        this.state.pos = codePos - 1;
        this.state.invalidTemplateEscapePosition = codePos - 1;
      }
    }
    return n;
  }

  // Read an identifier, and return it as a string. Sets `this.state.containsEsc`
  // to whether the word contained a '\u' escape.
  //
  // Incrementally adds only escaped chars, adding other chunks as-is
  // as a micro-optimization.

  readWord1() {
    this.state.containsEsc = false;
    let word = "",
        first = true,
        chunkStart = this.state.pos;
    while (this.state.pos < this.input.length) {
      const ch = this.fullCharCodeAtPos();
      if (isIdentifierChar(ch)) {
        this.state.pos += ch <= 0xffff ? 1 : 2;
      } else if (ch === 92) {
        // "\"
        this.state.containsEsc = true;

        word += this.input.slice(chunkStart, this.state.pos);
        const escStart = this.state.pos;

        if (this.input.charCodeAt(++this.state.pos) !== 117) {
          // "u"
          this.raise(this.state.pos, "Expecting Unicode escape sequence \\uXXXX");
        }

        ++this.state.pos;
        const esc = this.readCodePoint(true);
        // $FlowFixMe (thinks esc may be null, but throwOnInvalid is true)
        if (!(first ? isIdentifierStart : isIdentifierChar)(esc, true)) {
          this.raise(escStart, "Invalid Unicode escape");
        }

        // $FlowFixMe
        word += codePointToString(esc);
        chunkStart = this.state.pos;
      } else {
        break;
      }
      first = false;
    }
    return word + this.input.slice(chunkStart, this.state.pos);
  }

  // Read an identifier or keyword token. Will check for reserved
  // words when necessary.

  readWord() {
    const word = this.readWord1();
    let type = types.name;
    if (!this.state.containsEsc && this.isKeyword(word)) {
      type = keywords[word];
    }
    return this.finishToken(type, word);
  }

  braceIsBlock(prevType) {
    if (prevType === types.colon) {
      const parent = this.curContext();
      if (parent === types$1.braceStatement || parent === types$1.braceExpression) {
        return !parent.isExpr;
      }
    }

    if (prevType === types._return) {
      return lineBreak.test(this.input.slice(this.state.lastTokEnd, this.state.start));
    }

    if (prevType === types._else || prevType === types.semi || prevType === types.eof || prevType === types.parenR) {
      return true;
    }

    if (prevType === types.braceL) {
      return this.curContext() === types$1.braceStatement;
    }

    if (prevType === types.relational) {
      // `class C<T> { ... }`
      return true;
    }

    return !this.state.exprAllowed;
  }

  updateContext(prevType) {
    const type = this.state.type;
    let update;

    if (type.keyword && (prevType === types.dot || prevType === types.questionDot)) {
      this.state.exprAllowed = false;
    } else if (update = type.updateContext) {
      update.call(this, prevType);
    } else {
      this.state.exprAllowed = type.beforeExpr;
    }
  }
}

// ## Parser utilities

class UtilParser extends Tokenizer {
  // TODO

  addExtra(node, key, val) {
    if (!node) return;

    const extra = node.extra = node.extra || {};
    extra[key] = val;
  }

  // TODO

  isRelational(op) {
    return this.match(types.relational) && this.state.value === op;
  }

  // TODO

  expectRelational(op) {
    if (this.isRelational(op)) {
      this.next();
    } else {
      this.unexpected(null, types.relational);
    }
  }

  // eat() for relational operators.

  eatRelational(op) {
    if (this.isRelational(op)) {
      this.next();
      return true;
    }
    return false;
  }

  // Tests whether parsed token is a contextual keyword.

  isContextual(name) {
    return this.match(types.name) && this.state.value === name;
  }

  // Consumes contextual keyword if possible.

  eatContextual(name) {
    return this.state.value === name && this.eat(types.name);
  }

  // Asserts that following token is given contextual keyword.

  expectContextual(name, message) {
    if (!this.eatContextual(name)) this.unexpected(null, message);
  }

  // Test whether a semicolon can be inserted at the current position.

  canInsertSemicolon() {
    return this.match(types.eof) || this.match(types.braceR) || this.hasPrecedingLineBreak();
  }

  hasPrecedingLineBreak() {
    return lineBreak.test(this.input.slice(this.state.lastTokEnd, this.state.start));
  }

  // TODO

  isLineTerminator() {
    return this.eat(types.semi) || this.canInsertSemicolon();
  }

  // Consume a semicolon, or, failing that, see if we are allowed to
  // pretend that there is a semicolon at this position.

  semicolon() {
    if (!this.isLineTerminator()) this.unexpected(null, types.semi);
  }

  // Expect a token of a given type. If found, consume it, otherwise,
  // raise an unexpected token error at given pos.

  expect(type, pos) {
    this.eat(type) || this.unexpected(pos, type);
  }

  // Raise an unexpected token error. Can take the expected token type
  // instead of a message string.

  unexpected(pos, messageOrType = "Unexpected token") {
    if (typeof messageOrType !== "string") {
      messageOrType = `Unexpected token, expected ${messageOrType.label}`;
    }
    throw this.raise(pos != null ? pos : this.state.start, messageOrType);
  }
}

// Start an AST node, attaching a start offset.

const commentKeys = ["leadingComments", "trailingComments", "innerComments"];

class Node {
  constructor(parser, pos, loc) {
    this.type = "";
    this.start = pos;
    this.end = 0;
    this.loc = new SourceLocation(loc);
    if (parser && parser.options.ranges) this.range = [pos, 0];
    if (parser && parser.filename) this.loc.filename = parser.filename;
  }

  __clone() {
    // $FlowIgnore
    const node2 = new Node();
    for (const key in this) {
      // Do not clone comments that are already attached to the node
      if (commentKeys.indexOf(key) < 0) {
        // $FlowIgnore
        node2[key] = this[key];
      }
    }

    return node2;
  }
}

class NodeUtils extends UtilParser {
  startNode() {
    // $FlowIgnore
    return new Node(this, this.state.start, this.state.startLoc);
  }

  startNodeAt(pos, loc) {
    // $FlowIgnore
    return new Node(this, pos, loc);
  }

  /** Start a new node with a previous node's location. */
  startNodeAtNode(type) {
    return this.startNodeAt(type.start, type.loc.start);
  }

  // Finish an AST node, adding `type` and `end` properties.

  finishNode(node, type) {
    return this.finishNodeAt(node, type, this.state.lastTokEnd, this.state.lastTokEndLoc);
  }

  // Finish node at given position

  finishNodeAt(node, type, pos, loc) {
    node.type = type;
    node.end = pos;
    node.loc.end = loc;
    if (this.options.ranges) node.range[1] = pos;
    this.processComment(node);
    return node;
  }

  /**
   * Reset the start location of node to the start location of locationNode
   */
  resetStartLocationFromNode(node, locationNode) {
    node.start = locationNode.start;
    node.loc.start = locationNode.loc.start;
    if (this.options.ranges) node.range[0] = locationNode.range[0];
  }
}

class LValParser extends NodeUtils {
  // Forward-declaration: defined in expression.js

  // Forward-declaration: defined in statement.js


  // Convert existing expression atom to assignable pattern
  // if possible.

  toAssignable(node, isBinding, contextDescription) {
    if (node) {
      switch (node.type) {
        case "Identifier":
        case "PrivateName":
        case "ObjectPattern":
        case "ArrayPattern":
        case "AssignmentPattern":
          break;

        case "ObjectExpression":
          node.type = "ObjectPattern";
          for (const prop of node.properties) {
            if (prop.type === "ObjectMethod") {
              if (prop.kind === "get" || prop.kind === "set") {
                this.raise(prop.key.start, "Object pattern can't contain getter or setter");
              } else {
                this.raise(prop.key.start, "Object pattern can't contain methods");
              }
            } else {
              this.toAssignable(prop, isBinding, "object destructuring pattern");
            }
          }
          break;

        case "ObjectProperty":
          this.toAssignable(node.value, isBinding, contextDescription);
          break;

        case "SpreadElement":
          node.type = "RestElement";
          const arg = node.argument;
          this.toAssignable(arg, isBinding, contextDescription);
          break;

        case "ArrayExpression":
          node.type = "ArrayPattern";
          this.toAssignableList(node.elements, isBinding, contextDescription);
          break;

        case "AssignmentExpression":
          if (node.operator === "=") {
            node.type = "AssignmentPattern";
            delete node.operator;
          } else {
            this.raise(node.left.end, "Only '=' operator can be used for specifying default value.");
          }
          break;

        case "MemberExpression":
          if (!isBinding) break;

        default:
          {
            const message = "Invalid left-hand side" + (contextDescription ? " in " + contextDescription : /* istanbul ignore next */"expression");
            this.raise(node.start, message);
          }
      }
    }
    return node;
  }

  // Convert list of expression atoms to binding list.

  toAssignableList(exprList, isBinding, contextDescription) {
    let end = exprList.length;
    if (end) {
      const last = exprList[end - 1];
      if (last && last.type === "RestElement") {
        --end;
      } else if (last && last.type === "SpreadElement") {
        last.type = "RestElement";
        const arg = last.argument;
        this.toAssignable(arg, isBinding, contextDescription);
        if (arg.type !== "Identifier" && arg.type !== "MemberExpression" && arg.type !== "ArrayPattern") {
          this.unexpected(arg.start);
        }
        --end;
      }
    }
    for (let i = 0; i < end; i++) {
      const elt = exprList[i];
      if (elt && elt.type === "SpreadElement") this.raise(elt.start, "The rest element has to be the last element when destructuring");
      if (elt) this.toAssignable(elt, isBinding, contextDescription);
    }
    return exprList;
  }

  // Convert list of expression atoms to a list of

  toReferencedList(exprList) {
    return exprList;
  }

  // Parses spread element.

  parseSpread(refShorthandDefaultPos) {
    const node = this.startNode();
    this.next();
    node.argument = this.parseMaybeAssign(false, refShorthandDefaultPos);
    return this.finishNode(node, "SpreadElement");
  }

  parseRest() {
    const node = this.startNode();
    this.next();
    node.argument = this.parseBindingAtom();
    return this.finishNode(node, "RestElement");
  }

  shouldAllowYieldIdentifier() {
    return this.match(types._yield) && !this.state.strict && !this.state.inGenerator;
  }

  parseBindingIdentifier() {
    return this.parseIdentifier(this.shouldAllowYieldIdentifier());
  }

  // Parses lvalue (assignable) atom.
  parseBindingAtom() {
    switch (this.state.type) {
      case types._yield:
      case types.name:
        return this.parseBindingIdentifier();

      case types.bracketL:
        const node = this.startNode();
        this.next();
        node.elements = this.parseBindingList(types.bracketR, true);
        return this.finishNode(node, "ArrayPattern");

      case types.braceL:
        return this.parseObj(true);

      default:
        throw this.unexpected();
    }
  }

  parseBindingList(close, allowEmpty, allowModifiers) {
    const elts = [];
    let first = true;
    while (!this.eat(close)) {
      if (first) {
        first = false;
      } else {
        this.expect(types.comma);
      }
      if (allowEmpty && this.match(types.comma)) {
        // $FlowFixMe This method returns `$ReadOnlyArray<?Pattern>` if `allowEmpty` is set.
        elts.push(null);
      } else if (this.eat(close)) {
        break;
      } else if (this.match(types.ellipsis)) {
        elts.push(this.parseAssignableListItemTypes(this.parseRest()));
        this.expect(close);
        break;
      } else {
        const decorators = [];
        if (this.match(types.at) && this.hasPlugin("decorators2")) {
          this.raise(this.state.start, "Stage 2 decorators cannot be used to decorate parameters");
        }
        while (this.match(types.at)) {
          decorators.push(this.parseDecorator());
        }
        elts.push(this.parseAssignableListItem(allowModifiers, decorators));
      }
    }
    return elts;
  }

  parseAssignableListItem(allowModifiers, decorators) {
    const left = this.parseMaybeDefault();
    this.parseAssignableListItemTypes(left);
    const elt = this.parseMaybeDefault(left.start, left.loc.start, left);
    if (decorators.length) {
      left.decorators = decorators;
    }
    return elt;
  }

  parseAssignableListItemTypes(param) {
    return param;
  }

  // Parses assignment pattern around given atom if possible.

  parseMaybeDefault(startPos, startLoc, left) {
    startLoc = startLoc || this.state.startLoc;
    startPos = startPos || this.state.start;
    left = left || this.parseBindingAtom();
    if (!this.eat(types.eq)) return left;

    const node = this.startNodeAt(startPos, startLoc);
    node.left = left;
    node.right = this.parseMaybeAssign();
    return this.finishNode(node, "AssignmentPattern");
  }

  // Verify that a node is an lval — something that can be assigned
  // to.

  checkLVal(expr, isBinding, checkClashes, contextDescription) {
    switch (expr.type) {
      case "PrivateName":
      case "Identifier":
        this.checkReservedWord(expr.name, expr.start, false, true);

        if (checkClashes) {
          // we need to prefix this with an underscore for the cases where we have a key of
          // `__proto__`. there's a bug in old V8 where the following wouldn't work:
          //
          //   > var obj = Object.create(null);
          //   undefined
          //   > obj.__proto__
          //   null
          //   > obj.__proto__ = true;
          //   true
          //   > obj.__proto__
          //   null
          const key = `_${expr.name}`;

          if (checkClashes[key]) {
            this.raise(expr.start, "Argument name clash in strict mode");
          } else {
            checkClashes[key] = true;
          }
        }
        break;

      case "MemberExpression":
        if (isBinding) this.raise(expr.start, "Binding member expression");
        break;

      case "ObjectPattern":
        for (let prop of expr.properties) {
          if (prop.type === "ObjectProperty") prop = prop.value;
          this.checkLVal(prop, isBinding, checkClashes, "object destructuring pattern");
        }
        break;

      case "ArrayPattern":
        for (const elem of expr.elements) {
          if (elem) this.checkLVal(elem, isBinding, checkClashes, "array destructuring pattern");
        }
        break;

      case "AssignmentPattern":
        this.checkLVal(expr.left, isBinding, checkClashes, "assignment pattern");
        break;

      case "RestElement":
        this.checkLVal(expr.argument, isBinding, checkClashes, "rest element");
        break;

      default:
        {
          const message = (isBinding ? /* istanbul ignore next */"Binding invalid" : "Invalid") + " left-hand side" + (contextDescription ? " in " + contextDescription : /* istanbul ignore next */"expression");
          this.raise(expr.start, message);
        }
    }
  }
}

/* eslint max-len: 0 */

// A recursive descent parser operates by defining functions for all
// syntactic elements, and recursively calling those, each function
// advancing the input stream and returning an AST node. Precedence
// of constructs (for example, the fact that `!x[1]` means `!(x[1])`
// instead of `(!x)[1]` is handled by the fact that the parser
// function that parses unary prefix operators is called first, and
// in turn calls the function that parses `[]` subscripts — that
// way, it'll receive the node for `x[1]` already parsed, and wraps
// *that* in the unary operator node.
//
// Acorn uses an [operator precedence parser][opp] to handle binary
// operator precedence, because it is much more compact than using
// the technique outlined above, which uses different, nesting
// functions to specify precedence, for all of the ten binary
// precedence levels that JavaScript defines.
//
// [opp]: http://en.wikipedia.org/wiki/Operator-precedence_parser

class ExpressionParser extends LValParser {
  // Forward-declaration: defined in statement.js


  // Check if property name clashes with already added.
  // Object/class getters and setters are not allowed to clash —
  // either with each other or with an init property — and in
  // strict mode, init properties are also not allowed to be repeated.

  checkPropClash(prop, propHash) {
    if (prop.computed || prop.kind) return;

    const key = prop.key;
    // It is either an Identifier or a String/NumericLiteral
    const name = key.type === "Identifier" ? key.name : String(key.value);

    if (name === "__proto__") {
      if (propHash.proto) this.raise(key.start, "Redefinition of __proto__ property");
      propHash.proto = true;
    }
  }

  // Convenience method to parse an Expression only
  getExpression() {
    this.nextToken();
    const expr = this.parseExpression();
    if (!this.match(types.eof)) {
      this.unexpected();
    }
    return expr;
  }

  // ### Expression parsing

  // These nest, from the most general expression type at the top to
  // 'atomic', nondivisible expression types at the bottom. Most of
  // the functions will simply let the function (s) below them parse,
  // and, *if* the syntactic construct they handle is present, wrap
  // the AST node that the inner parser gave them in another node.

  // Parse a full expression. The optional arguments are used to
  // forbid the `in` operator (in for loops initialization expressions)
  // and provide reference for storing '=' operator inside shorthand
  // property assignment in contexts where both object expression
  // and object pattern might appear (so it's possible to raise
  // delayed syntax error at correct position).

  parseExpression(noIn, refShorthandDefaultPos) {
    const startPos = this.state.start;
    const startLoc = this.state.startLoc;
    const expr = this.parseMaybeAssign(noIn, refShorthandDefaultPos);
    if (this.match(types.comma)) {
      const node = this.startNodeAt(startPos, startLoc);
      node.expressions = [expr];
      while (this.eat(types.comma)) {
        node.expressions.push(this.parseMaybeAssign(noIn, refShorthandDefaultPos));
      }
      this.toReferencedList(node.expressions);
      return this.finishNode(node, "SequenceExpression");
    }
    return expr;
  }

  // Parse an assignment expression. This includes applications of
  // operators like `+=`.

  parseMaybeAssign(noIn, refShorthandDefaultPos, afterLeftParse, refNeedsArrowPos) {
    const startPos = this.state.start;
    const startLoc = this.state.startLoc;
    if (this.match(types._yield) && this.state.inGenerator) {
      let left = this.parseYield();
      if (afterLeftParse) left = afterLeftParse.call(this, left, startPos, startLoc);
      return left;
    }

    let failOnShorthandAssign;
    if (refShorthandDefaultPos) {
      failOnShorthandAssign = false;
    } else {
      refShorthandDefaultPos = { start: 0 };
      failOnShorthandAssign = true;
    }

    if (this.match(types.parenL) || this.match(types.name)) {
      this.state.potentialArrowAt = this.state.start;
    }

    let left = this.parseMaybeConditional(noIn, refShorthandDefaultPos, refNeedsArrowPos);
    if (afterLeftParse) left = afterLeftParse.call(this, left, startPos, startLoc);
    if (this.state.type.isAssign) {
      const node = this.startNodeAt(startPos, startLoc);
      node.operator = this.state.value;
      node.left = this.match(types.eq) ? this.toAssignable(left, undefined, "assignment expression") : left;
      refShorthandDefaultPos.start = 0; // reset because shorthand default was used correctly

      this.checkLVal(left, undefined, undefined, "assignment expression");

      if (left.extra && left.extra.parenthesized) {
        let errorMsg;
        if (left.type === "ObjectPattern") {
          errorMsg = "`({a}) = 0` use `({a} = 0)`";
        } else if (left.type === "ArrayPattern") {
          errorMsg = "`([a]) = 0` use `([a] = 0)`";
        }
        if (errorMsg) {
          this.raise(left.start, `You're trying to assign to a parenthesized expression, eg. instead of ${errorMsg}`);
        }
      }

      this.next();
      node.right = this.parseMaybeAssign(noIn);
      return this.finishNode(node, "AssignmentExpression");
    } else if (failOnShorthandAssign && refShorthandDefaultPos.start) {
      this.unexpected(refShorthandDefaultPos.start);
    }

    return left;
  }

  // Parse a ternary conditional (`?:`) operator.

  parseMaybeConditional(noIn, refShorthandDefaultPos, refNeedsArrowPos) {
    const startPos = this.state.start;
    const startLoc = this.state.startLoc;
    const expr = this.parseExprOps(noIn, refShorthandDefaultPos);
    if (refShorthandDefaultPos && refShorthandDefaultPos.start) return expr;

    return this.parseConditional(expr, noIn, startPos, startLoc, refNeedsArrowPos);
  }

  parseConditional(expr, noIn, startPos, startLoc,
  // FIXME: Disabling this for now since can't seem to get it to play nicely
  refNeedsArrowPos) {
    if (this.eat(types.question)) {
      const node = this.startNodeAt(startPos, startLoc);
      node.test = expr;
      node.consequent = this.parseMaybeAssign();
      this.expect(types.colon);
      node.alternate = this.parseMaybeAssign(noIn);
      return this.finishNode(node, "ConditionalExpression");
    }
    return expr;
  }

  // Start the precedence parser.

  parseExprOps(noIn, refShorthandDefaultPos) {
    const startPos = this.state.start;
    const startLoc = this.state.startLoc;
    const expr = this.parseMaybeUnary(refShorthandDefaultPos);
    if (refShorthandDefaultPos && refShorthandDefaultPos.start) {
      return expr;
    } else {
      return this.parseExprOp(expr, startPos, startLoc, -1, noIn);
    }
  }

  // Parse binary operators with the operator precedence parsing
  // algorithm. `left` is the left-hand side of the operator.
  // `minPrec` provides context that allows the function to stop and
  // defer further parser to one of its callers when it encounters an
  // operator that has a lower precedence than the set it is parsing.

  parseExprOp(left, leftStartPos, leftStartLoc, minPrec, noIn) {
    const prec = this.state.type.binop;
    if (prec != null && (!noIn || !this.match(types._in))) {
      if (prec > minPrec) {
        const node = this.startNodeAt(leftStartPos, leftStartLoc);
        node.left = left;
        node.operator = this.state.value;

        if (node.operator === "**" && left.type === "UnaryExpression" && left.extra && !left.extra.parenthesizedArgument && !left.extra.parenthesized) {
          this.raise(left.argument.start, "Illegal expression. Wrap left hand side or entire exponentiation in parentheses.");
        }

        const op = this.state.type;
        this.next();

        const startPos = this.state.start;
        const startLoc = this.state.startLoc;
        node.right = this.parseExprOp(this.parseMaybeUnary(), startPos, startLoc, op.rightAssociative ? prec - 1 : prec, noIn);

        this.finishNode(node, op === types.logicalOR || op === types.logicalAND ? "LogicalExpression" : "BinaryExpression");
        return this.parseExprOp(node, leftStartPos, leftStartLoc, minPrec, noIn);
      }
    }
    return left;
  }

  // Parse unary operators, both prefix and postfix.

  parseMaybeUnary(refShorthandDefaultPos) {
    if (this.state.type.prefix) {
      const node = this.startNode();
      const update = this.match(types.incDec);
      node.operator = this.state.value;
      node.prefix = true;
      this.next();

      const argType = this.state.type;
      node.argument = this.parseMaybeUnary();

      this.addExtra(node, "parenthesizedArgument", argType === types.parenL && (!node.argument.extra || !node.argument.extra.parenthesized));

      if (refShorthandDefaultPos && refShorthandDefaultPos.start) {
        this.unexpected(refShorthandDefaultPos.start);
      }

      if (update) {
        this.checkLVal(node.argument, undefined, undefined, "prefix operation");
      } else if (this.state.strict && node.operator === "delete") {
        const arg = node.argument;

        if (arg.type === "Identifier") {
          this.raise(node.start, "Deleting local variable in strict mode");
        } else if (this.hasPlugin("classPrivateProperties")) {
          if (arg.type === "PrivateName" || arg.type === "MemberExpression" && arg.property.type === "PrivateName") {
            this.raise(node.start, "Deleting a private field is not allowed");
          }
        }
      }

      return this.finishNode(node, update ? "UpdateExpression" : "UnaryExpression");
    }

    const startPos = this.state.start;
    const startLoc = this.state.startLoc;
    let expr = this.parseExprSubscripts(refShorthandDefaultPos);
    if (refShorthandDefaultPos && refShorthandDefaultPos.start) return expr;
    while (this.state.type.postfix && !this.canInsertSemicolon()) {
      const node = this.startNodeAt(startPos, startLoc);
      node.operator = this.state.value;
      node.prefix = false;
      node.argument = expr;
      this.checkLVal(expr, undefined, undefined, "postfix operation");
      this.next();
      expr = this.finishNode(node, "UpdateExpression");
    }
    return expr;
  }

  // Parse call, dot, and `[]`-subscript expressions.

  parseExprSubscripts(refShorthandDefaultPos) {
    const startPos = this.state.start;
    const startLoc = this.state.startLoc;
    const potentialArrowAt = this.state.potentialArrowAt;
    const expr = this.parseExprAtom(refShorthandDefaultPos);

    if (expr.type === "ArrowFunctionExpression" && expr.start === potentialArrowAt) {
      return expr;
    }

    if (refShorthandDefaultPos && refShorthandDefaultPos.start) {
      return expr;
    }

    return this.parseSubscripts(expr, startPos, startLoc);
  }

  parseSubscripts(base, startPos, startLoc, noCalls) {
    const state = { stop: false };
    do {
      base = this.parseSubscript(base, startPos, startLoc, noCalls, state);
    } while (!state.stop);
    return base;
  }

  /** @param state Set 'state.stop = true' to indicate that we should stop parsing subscripts. */
  parseSubscript(base, startPos, startLoc, noCalls, state) {
    if (!noCalls && this.eat(types.doubleColon)) {
      const node = this.startNodeAt(startPos, startLoc);
      node.object = base;
      node.callee = this.parseNoCallExpr();
      state.stop = true;
      return this.parseSubscripts(this.finishNode(node, "BindExpression"), startPos, startLoc, noCalls);
    } else if (this.match(types.questionDot)) {
      if (!this.hasPlugin("optionalChaining")) {
        this.raise(startPos, "You can only use optional-chaining when the 'optionalChaining' plugin is enabled.");
      }

      if (noCalls && this.lookahead().type == types.parenL) {
        state.stop = true;
        return base;
      }
      this.next();

      const node = this.startNodeAt(startPos, startLoc);

      if (this.eat(types.bracketL)) {
        node.object = base;
        node.property = this.parseExpression();
        node.computed = true;
        node.optional = true;
        this.expect(types.bracketR);
        return this.finishNode(node, "MemberExpression");
      } else if (this.eat(types.parenL)) {
        const possibleAsync = this.atPossibleAsync(base);

        node.callee = base;
        node.arguments = this.parseCallExpressionArguments(types.parenR, possibleAsync);
        node.optional = true;

        return this.finishNode(node, "CallExpression");
      } else {
        node.object = base;
        node.property = this.parseIdentifier(true);
        node.computed = false;
        node.optional = true;
        return this.finishNode(node, "MemberExpression");
      }
    } else if (this.eat(types.dot)) {
      const node = this.startNodeAt(startPos, startLoc);
      node.object = base;
      node.property = this.hasPlugin("classPrivateProperties") ? this.parseMaybePrivateName() : this.parseIdentifier(true);
      node.computed = false;
      return this.finishNode(node, "MemberExpression");
    } else if (this.eat(types.bracketL)) {
      const node = this.startNodeAt(startPos, startLoc);
      node.object = base;
      node.property = this.parseExpression();
      node.computed = true;
      this.expect(types.bracketR);
      return this.finishNode(node, "MemberExpression");
    } else if (!noCalls && this.match(types.parenL)) {
      const possibleAsync = this.atPossibleAsync(base);
      this.next();

      const node = this.startNodeAt(startPos, startLoc);
      node.callee = base;
      node.arguments = this.parseCallExpressionArguments(types.parenR, possibleAsync);
      this.finishCallExpression(node);

      if (possibleAsync && this.shouldParseAsyncArrow()) {
        state.stop = true;
        return this.parseAsyncArrowFromCallExpression(this.startNodeAt(startPos, startLoc), node);
      } else {
        this.toReferencedList(node.arguments);
      }
      return node;
    } else if (this.match(types.backQuote)) {
      const node = this.startNodeAt(startPos, startLoc);
      node.tag = base;
      node.quasi = this.parseTemplate(true);
      return this.finishNode(node, "TaggedTemplateExpression");
    } else {
      state.stop = true;
      return base;
    }
  }

  atPossibleAsync(base) {
    return this.state.potentialArrowAt === base.start && base.type === "Identifier" && base.name === "async" && !this.canInsertSemicolon();
  }

  finishCallExpression(node) {
    if (node.callee.type === "Import") {
      if (node.arguments.length !== 1) {
        this.raise(node.start, "import() requires exactly one argument");
      }

      const importArg = node.arguments[0];
      if (importArg && importArg.type === "SpreadElement") {
        this.raise(importArg.start, "... is not allowed in import()");
      }
    }
    return this.finishNode(node, "CallExpression");
  }

  parseCallExpressionArguments(close, possibleAsyncArrow) {
    const elts = [];
    let innerParenStart;
    let first = true;

    while (!this.eat(close)) {
      if (first) {
        first = false;
      } else {
        this.expect(types.comma);
        if (this.eat(close)) break;
      }

      // we need to make sure that if this is an async arrow functions, that we don't allow inner parens inside the params
      if (this.match(types.parenL) && !innerParenStart) {
        innerParenStart = this.state.start;
      }

      elts.push(this.parseExprListItem(false, possibleAsyncArrow ? { start: 0 } : undefined, possibleAsyncArrow ? { start: 0 } : undefined));
    }

    // we found an async arrow function so let's not allow any inner parens
    if (possibleAsyncArrow && innerParenStart && this.shouldParseAsyncArrow()) {
      this.unexpected();
    }

    return elts;
  }

  shouldParseAsyncArrow() {
    return this.match(types.arrow);
  }

  parseAsyncArrowFromCallExpression(node, call) {
    this.expect(types.arrow);
    return this.parseArrowExpression(node, call.arguments, true);
  }

  // Parse a no-call expression (like argument of `new` or `::` operators).

  parseNoCallExpr() {
    const startPos = this.state.start;
    const startLoc = this.state.startLoc;
    return this.parseSubscripts(this.parseExprAtom(), startPos, startLoc, true);
  }

  // Parse an atomic expression — either a single token that is an
  // expression, an expression started by a keyword like `function` or
  // `new`, or an expression wrapped in punctuation like `()`, `[]`,
  // or `{}`.

  parseExprAtom(refShorthandDefaultPos) {
    const canBeArrow = this.state.potentialArrowAt === this.state.start;
    let node;

    switch (this.state.type) {
      case types._super:
        if (!this.state.inMethod && !this.state.inClassProperty && !this.options.allowSuperOutsideMethod) {
          this.raise(this.state.start, "'super' outside of function or class");
        }

        node = this.startNode();
        this.next();
        if (!this.match(types.parenL) && !this.match(types.bracketL) && !this.match(types.dot)) {
          this.unexpected();
        }
        if (this.match(types.parenL) && this.state.inMethod !== "constructor" && !this.options.allowSuperOutsideMethod) {
          this.raise(node.start, "super() is only valid inside a class constructor. Make sure the method name is spelled exactly as 'constructor'.");
        }
        return this.finishNode(node, "Super");

      case types._import:
        if (this.hasPlugin("importMeta") && this.lookahead().type === types.dot) {
          return this.parseImportMetaProperty();
        }

        if (!this.hasPlugin("dynamicImport")) this.unexpected();

        node = this.startNode();
        this.next();
        if (!this.match(types.parenL)) {
          this.unexpected(null, types.parenL);
        }
        return this.finishNode(node, "Import");

      case types._this:
        node = this.startNode();
        this.next();
        return this.finishNode(node, "ThisExpression");

      case types._yield:
        if (this.state.inGenerator) this.unexpected();

      case types.name:
        node = this.startNode();
        const allowAwait = this.state.value === "await" && this.state.inAsync;
        const allowYield = this.shouldAllowYieldIdentifier();
        const id = this.parseIdentifier(allowAwait || allowYield);

        if (id.name === "await") {
          if (this.state.inAsync || this.inModule) {
            return this.parseAwait(node);
          }
        } else if (id.name === "async" && this.match(types._function) && !this.canInsertSemicolon()) {
          this.next();
          return this.parseFunction(node, false, false, true);
        } else if (canBeArrow && id.name === "async" && this.match(types.name)) {
          const params = [this.parseIdentifier()];
          this.expect(types.arrow);
          // let foo = bar => {};
          return this.parseArrowExpression(node, params, true);
        }

        if (canBeArrow && !this.canInsertSemicolon() && this.eat(types.arrow)) {
          return this.parseArrowExpression(node, [id]);
        }

        return id;

      case types._do:
        if (this.hasPlugin("doExpressions")) {
          const node = this.startNode();
          this.next();
          const oldInFunction = this.state.inFunction;
          const oldLabels = this.state.labels;
          this.state.labels = [];
          this.state.inFunction = false;
          node.body = this.parseBlock(false);
          this.state.inFunction = oldInFunction;
          this.state.labels = oldLabels;
          return this.finishNode(node, "DoExpression");
        }

      case types.regexp:
        const value = this.state.value;
        node = this.parseLiteral(value.value, "RegExpLiteral");
        node.pattern = value.pattern;
        node.flags = value.flags;
        return node;

      case types.num:
        return this.parseLiteral(this.state.value, "NumericLiteral");

      case types.bigint:
        return this.parseLiteral(this.state.value, "BigIntLiteral");

      case types.string:
        return this.parseLiteral(this.state.value, "StringLiteral");

      case types._null:
        node = this.startNode();
        this.next();
        return this.finishNode(node, "NullLiteral");

      case types._true:
      case types._false:
        return this.parseBooleanLiteral();

      case types.parenL:
        return this.parseParenAndDistinguishExpression(canBeArrow);

      case types.bracketL:
        node = this.startNode();
        this.next();
        node.elements = this.parseExprList(types.bracketR, true, refShorthandDefaultPos);
        this.toReferencedList(node.elements);
        return this.finishNode(node, "ArrayExpression");

      case types.braceL:
        return this.parseObj(false, refShorthandDefaultPos);

      case types._function:
        return this.parseFunctionExpression();

      case types.at:
        this.parseDecorators();

      case types._class:
        node = this.startNode();
        this.takeDecorators(node);
        return this.parseClass(node, false);

      case types.hash:
        if (this.hasPlugin("classPrivateProperties")) {
          return this.parseMaybePrivateName();
        } else {
          throw this.unexpected();
        }

      case types._new:
        return this.parseNew();

      case types.backQuote:
        return this.parseTemplate(false);

      case types.doubleColon:
        node = this.startNode();
        this.next();
        node.object = null;
        const callee = node.callee = this.parseNoCallExpr();
        if (callee.type === "MemberExpression") {
          return this.finishNode(node, "BindExpression");
        } else {
          throw this.raise(callee.start, "Binding should be performed on object property.");
        }

      default:
        throw this.unexpected();
    }
  }

  parseBooleanLiteral() {
    const node = this.startNode();
    node.value = this.match(types._true);
    this.next();
    return this.finishNode(node, "BooleanLiteral");
  }

  parseMaybePrivateName() {
    const isPrivate = this.eat(types.hash);

    if (isPrivate) {
      const node = this.startNode();
      node.name = this.parseIdentifier(true);
      return this.finishNode(node, "PrivateName");
    } else {
      return this.parseIdentifier(true);
    }
  }

  parseFunctionExpression() {
    const node = this.startNode();
    const meta = this.parseIdentifier(true);
    if (this.state.inGenerator && this.hasPlugin("functionSent") && this.eat(types.dot)) {
      return this.parseMetaProperty(node, meta, "sent");
    }
    return this.parseFunction(node, false);
  }

  parseMetaProperty(node, meta, propertyName) {
    node.meta = meta;
    node.property = this.parseIdentifier(true);

    if (node.property.name !== propertyName) {
      this.raise(node.property.start, `The only valid meta property for ${meta.name} is ${meta.name}.${propertyName}`);
    }

    return this.finishNode(node, "MetaProperty");
  }

  parseImportMetaProperty() {
    const node = this.startNode();
    const id = this.parseIdentifier(true);
    this.expect(types.dot);
    if (!this.inModule) {
      this.raise(id.start, `import.meta may appear only with 'sourceType: "module"'`);
    }
    return this.parseMetaProperty(node, id, "meta");
  }

  parseLiteral(value, type, startPos, startLoc) {
    startPos = startPos || this.state.start;
    startLoc = startLoc || this.state.startLoc;

    const node = this.startNodeAt(startPos, startLoc);
    this.addExtra(node, "rawValue", value);
    this.addExtra(node, "raw", this.input.slice(startPos, this.state.end));
    node.value = value;
    this.next();
    return this.finishNode(node, type);
  }

  parseParenExpression() {
    this.expect(types.parenL);
    const val = this.parseExpression();
    this.expect(types.parenR);
    return val;
  }

  parseParenAndDistinguishExpression(canBeArrow) {
    const startPos = this.state.start;
    const startLoc = this.state.startLoc;

    let val;
    this.expect(types.parenL);

    const innerStartPos = this.state.start;
    const innerStartLoc = this.state.startLoc;
    const exprList = [];
    const refShorthandDefaultPos = { start: 0 };
    const refNeedsArrowPos = { start: 0 };
    let first = true;
    let spreadStart;
    let optionalCommaStart;

    while (!this.match(types.parenR)) {
      if (first) {
        first = false;
      } else {
        this.expect(types.comma, refNeedsArrowPos.start || null);
        if (this.match(types.parenR)) {
          optionalCommaStart = this.state.start;
          break;
        }
      }

      if (this.match(types.ellipsis)) {
        const spreadNodeStartPos = this.state.start;
        const spreadNodeStartLoc = this.state.startLoc;
        spreadStart = this.state.start;
        exprList.push(this.parseParenItem(this.parseRest(), spreadNodeStartPos, spreadNodeStartLoc));
        break;
      } else {
        exprList.push(this.parseMaybeAssign(false, refShorthandDefaultPos, this.parseParenItem, refNeedsArrowPos));
      }
    }

    const innerEndPos = this.state.start;
    const innerEndLoc = this.state.startLoc;
    this.expect(types.parenR);

    let arrowNode = this.startNodeAt(startPos, startLoc);
    if (canBeArrow && this.shouldParseArrow() && (arrowNode = this.parseArrow(arrowNode))) {
      for (const param of exprList) {
        if (param.extra && param.extra.parenthesized) this.unexpected(param.extra.parenStart);
      }

      return this.parseArrowExpression(arrowNode, exprList);
    }

    if (!exprList.length) {
      this.unexpected(this.state.lastTokStart);
    }
    if (optionalCommaStart) this.unexpected(optionalCommaStart);
    if (spreadStart) this.unexpected(spreadStart);
    if (refShorthandDefaultPos.start) this.unexpected(refShorthandDefaultPos.start);
    if (refNeedsArrowPos.start) this.unexpected(refNeedsArrowPos.start);

    if (exprList.length > 1) {
      val = this.startNodeAt(innerStartPos, innerStartLoc);
      val.expressions = exprList;
      this.toReferencedList(val.expressions);
      this.finishNodeAt(val, "SequenceExpression", innerEndPos, innerEndLoc);
    } else {
      val = exprList[0];
    }

    this.addExtra(val, "parenthesized", true);
    this.addExtra(val, "parenStart", startPos);

    return val;
  }

  shouldParseArrow() {
    return !this.canInsertSemicolon();
  }

  parseArrow(node) {
    if (this.eat(types.arrow)) {
      return node;
    }
  }

  parseParenItem(node, startPos,
  // eslint-disable-next-line no-unused-vars
  startLoc) {
    return node;
  }

  // New's precedence is slightly tricky. It must allow its argument
  // to be a `[]` or dot subscript expression, but not a call — at
  // least, not without wrapping it in parentheses. Thus, it uses the

  parseNew() {
    const node = this.startNode();
    const meta = this.parseIdentifier(true);

    if (this.eat(types.dot)) {
      const metaProp = this.parseMetaProperty(node, meta, "target");

      if (!this.state.inFunction) {
        this.raise(metaProp.property.start, "new.target can only be used in functions");
      }

      return metaProp;
    }

    node.callee = this.parseNoCallExpr();
    if (this.eat(types.questionDot)) node.optional = true;
    this.parseNewArguments(node);
    return this.finishNode(node, "NewExpression");
  }

  parseNewArguments(node) {
    if (this.eat(types.parenL)) {
      const args = this.parseExprList(types.parenR);
      this.toReferencedList(args);
      // $FlowFixMe (parseExprList should be all non-null in this case)
      node.arguments = args;
    } else {
      node.arguments = [];
    }
  }

  // Parse template expression.

  parseTemplateElement(isTagged) {
    const elem = this.startNode();
    if (this.state.value === null) {
      if (!isTagged) {
        // TODO: fix this
        this.raise(this.state.invalidTemplateEscapePosition || 0, "Invalid escape sequence in template");
      } else {
        this.state.invalidTemplateEscapePosition = null;
      }
    }
    elem.value = {
      raw: this.input.slice(this.state.start, this.state.end).replace(/\r\n?/g, "\n"),
      cooked: this.state.value
    };
    this.next();
    elem.tail = this.match(types.backQuote);
    return this.finishNode(elem, "TemplateElement");
  }

  parseTemplate(isTagged) {
    const node = this.startNode();
    this.next();
    node.expressions = [];
    let curElt = this.parseTemplateElement(isTagged);
    node.quasis = [curElt];
    while (!curElt.tail) {
      this.expect(types.dollarBraceL);
      node.expressions.push(this.parseExpression());
      this.expect(types.braceR);
      node.quasis.push(curElt = this.parseTemplateElement(isTagged));
    }
    this.next();
    return this.finishNode(node, "TemplateLiteral");
  }

  // Parse an object literal or binding pattern.

  parseObj(isPattern, refShorthandDefaultPos) {
    let decorators = [];
    const propHash = Object.create(null);
    let first = true;
    const node = this.startNode();

    node.properties = [];
    this.next();

    let firstRestLocation = null;

    while (!this.eat(types.braceR)) {
      if (first) {
        first = false;
      } else {
        this.expect(types.comma);
        if (this.eat(types.braceR)) break;
      }

      if (this.match(types.at)) {
        if (this.hasPlugin("decorators2")) {
          this.raise(this.state.start, "Stage 2 decorators disallow object literal property decorators");
        } else {
          // we needn't check if decorators (stage 0) plugin is enabled since it's checked by
          // the call to this.parseDecorator
          while (this.match(types.at)) {
            decorators.push(this.parseDecorator());
          }
        }
      }

      let prop = this.startNode(),
          isGenerator = false,
          isAsync = false,
          startPos,
          startLoc;
      if (decorators.length) {
        prop.decorators = decorators;
        decorators = [];
      }

      if (this.hasPlugin("objectRestSpread") && this.match(types.ellipsis)) {
        prop = this.parseSpread(isPattern ? { start: 0 } : undefined);
        prop.type = isPattern ? "RestElement" : "SpreadElement";
        if (isPattern) this.toAssignable(prop.argument, true, "object pattern");
        node.properties.push(prop);
        if (isPattern) {
          const position = this.state.start;
          if (firstRestLocation !== null) {
            this.unexpected(firstRestLocation, "Cannot have multiple rest elements when destructuring");
          } else if (this.eat(types.braceR)) {
            break;
          } else if (this.match(types.comma) && this.lookahead().type === types.braceR) {
            this.unexpected(position, "A trailing comma is not permitted after the rest element");
          } else {
            firstRestLocation = position;
            continue;
          }
        } else {
          continue;
        }
      }

      prop.method = false;

      if (isPattern || refShorthandDefaultPos) {
        startPos = this.state.start;
        startLoc = this.state.startLoc;
      }

      if (!isPattern) {
        isGenerator = this.eat(types.star);
      }

      if (!isPattern && this.isContextual("async")) {
        if (isGenerator) this.unexpected();

        const asyncId = this.parseIdentifier();
        if (this.match(types.colon) || this.match(types.parenL) || this.match(types.braceR) || this.match(types.eq) || this.match(types.comma)) {
          prop.key = asyncId;
          prop.computed = false;
        } else {
          isAsync = true;
          if (this.hasPlugin("asyncGenerators")) isGenerator = this.eat(types.star);
          this.parsePropertyName(prop);
        }
      } else {
        this.parsePropertyName(prop);
      }

      this.parseObjPropValue(prop, startPos, startLoc, isGenerator, isAsync, isPattern, refShorthandDefaultPos);
      this.checkPropClash(prop, propHash);

      if (prop.shorthand) {
        this.addExtra(prop, "shorthand", true);
      }

      node.properties.push(prop);
    }

    if (firstRestLocation !== null) {
      this.unexpected(firstRestLocation, "The rest element has to be the last element when destructuring");
    }

    if (decorators.length) {
      this.raise(this.state.start, "You have trailing decorators with no property");
    }

    return this.finishNode(node, isPattern ? "ObjectPattern" : "ObjectExpression");
  }

  isGetterOrSetterMethod(prop, isPattern) {
    return !isPattern && !prop.computed && prop.key.type === "Identifier" && (prop.key.name === "get" || prop.key.name === "set") && (this.match(types.string) || // get "string"() {}
    this.match(types.num) || // get 1() {}
    this.match(types.bracketL) || // get ["string"]() {}
    this.match(types.name) || // get foo() {}
    !!this.state.type.keyword) // get debugger() {}
    ;
  }

  // get methods aren't allowed to have any parameters
  // set methods must have exactly 1 parameter
  checkGetterSetterParamCount(method) {
    const paramCount = method.kind === "get" ? 0 : 1;
    if (method.params.length !== paramCount) {
      const start = method.start;
      if (method.kind === "get") {
        this.raise(start, "getter should have no params");
      } else {
        this.raise(start, "setter should have exactly one param");
      }
    }
  }

  parseObjectMethod(prop, isGenerator, isAsync, isPattern) {
    if (isAsync || isGenerator || this.match(types.parenL)) {
      if (isPattern) this.unexpected();
      prop.kind = "method";
      prop.method = true;
      return this.parseMethod(prop, isGenerator, isAsync,
      /* isConstructor */false, "ObjectMethod");
    }

    if (this.isGetterOrSetterMethod(prop, isPattern)) {
      if (isGenerator || isAsync) this.unexpected();
      prop.kind = prop.key.name;
      this.parsePropertyName(prop);
      this.parseMethod(prop,
      /* isGenerator */false,
      /* isAsync */false,
      /* isConstructor */false, "ObjectMethod");
      this.checkGetterSetterParamCount(prop);
      return prop;
    }
  }

  parseObjectProperty(prop, startPos, startLoc, isPattern, refShorthandDefaultPos) {
    prop.shorthand = false;

    if (this.eat(types.colon)) {
      prop.value = isPattern ? this.parseMaybeDefault(this.state.start, this.state.startLoc) : this.parseMaybeAssign(false, refShorthandDefaultPos);

      return this.finishNode(prop, "ObjectProperty");
    }

    if (!prop.computed && prop.key.type === "Identifier") {
      this.checkReservedWord(prop.key.name, prop.key.start, true, true);

      if (isPattern) {
        prop.value = this.parseMaybeDefault(startPos, startLoc, prop.key.__clone());
      } else if (this.match(types.eq) && refShorthandDefaultPos) {
        if (!refShorthandDefaultPos.start) {
          refShorthandDefaultPos.start = this.state.start;
        }
        prop.value = this.parseMaybeDefault(startPos, startLoc, prop.key.__clone());
      } else {
        prop.value = prop.key.__clone();
      }
      prop.shorthand = true;

      return this.finishNode(prop, "ObjectProperty");
    }
  }

  parseObjPropValue(prop, startPos, startLoc, isGenerator, isAsync, isPattern, refShorthandDefaultPos) {
    const node = this.parseObjectMethod(prop, isGenerator, isAsync, isPattern) || this.parseObjectProperty(prop, startPos, startLoc, isPattern, refShorthandDefaultPos);

    if (!node) this.unexpected();

    // $FlowFixMe
    return node;
  }

  parsePropertyName(prop) {
    if (this.eat(types.bracketL)) {
      prop.computed = true;
      prop.key = this.parseMaybeAssign();
      this.expect(types.bracketR);
    } else {
      prop.computed = false;
      const oldInPropertyName = this.state.inPropertyName;
      this.state.inPropertyName = true;
      prop.key = this.match(types.num) || this.match(types.string) ? this.parseExprAtom() : this.parseIdentifier(true);
      this.state.inPropertyName = oldInPropertyName;
    }

    return prop.key;
  }

  // Initialize empty function node.

  initFunction(node, isAsync) {
    node.id = null;
    node.generator = false;
    node.expression = false;
    node.async = !!isAsync;
  }

  // Parse object or class method.

  parseMethod(node, isGenerator, isAsync, isConstructor, type) {
    const oldInMethod = this.state.inMethod;
    this.state.inMethod = node.kind || true;
    this.initFunction(node, isAsync);
    this.expect(types.parenL);
    const allowModifiers = isConstructor; // For TypeScript parameter properties
    node.params = this.parseBindingList(types.parenR,
    /* allowEmpty */false, allowModifiers);
    node.generator = !!isGenerator;
    this.parseFunctionBodyAndFinish(node, type);
    this.state.inMethod = oldInMethod;
    return node;
  }

  // Parse arrow function expression with given parameters.

  parseArrowExpression(node, params, isAsync) {
    this.initFunction(node, isAsync);
    node.params = this.toAssignableList(params, true, "arrow function parameters");
    this.parseFunctionBody(node, true);
    return this.finishNode(node, "ArrowFunctionExpression");
  }

  isStrictBody(node, isExpression) {
    if (!isExpression && node.body.directives.length) {
      for (const directive of node.body.directives) {
        if (directive.value.value === "use strict") {
          return true;
        }
      }
    }

    return false;
  }

  parseFunctionBodyAndFinish(node, type, allowExpressionBody) {
    // $FlowIgnore (node is not bodiless if we get here)
    this.parseFunctionBody(node, allowExpressionBody);
    this.finishNode(node, type);
  }

  // Parse function body and check parameters.
  parseFunctionBody(node, allowExpression) {
    const isExpression = allowExpression && !this.match(types.braceL);

    const oldInAsync = this.state.inAsync;
    this.state.inAsync = node.async;
    if (isExpression) {
      node.body = this.parseMaybeAssign();
      node.expression = true;
    } else {
      // Start a new scope with regard to labels and the `inFunction`
      // flag (restore them to their old value afterwards).
      const oldInFunc = this.state.inFunction;
      const oldInGen = this.state.inGenerator;
      const oldLabels = this.state.labels;
      this.state.inFunction = true;
      this.state.inGenerator = node.generator;
      this.state.labels = [];
      node.body = this.parseBlock(true);
      node.expression = false;
      this.state.inFunction = oldInFunc;
      this.state.inGenerator = oldInGen;
      this.state.labels = oldLabels;
    }
    this.state.inAsync = oldInAsync;

    // If this is a strict mode function, verify that argument names
    // are not repeated, and it does not try to bind the words `eval`
    // or `arguments`.
    const isStrict = this.isStrictBody(node, isExpression);
    // Also check when allowExpression === true for arrow functions
    const checkLVal = this.state.strict || allowExpression || isStrict;

    if (isStrict && node.id && node.id.type === "Identifier" && node.id.name === "yield") {
      this.raise(node.id.start, "Binding yield in strict mode");
    }

    if (checkLVal) {
      const nameHash = Object.create(null);
      const oldStrict = this.state.strict;
      if (isStrict) this.state.strict = true;
      if (node.id) {
        this.checkLVal(node.id, true, undefined, "function name");
      }
      for (const param of node.params) {
        if (isStrict && param.type !== "Identifier") {
          this.raise(param.start, "Non-simple parameter in strict mode");
        }
        this.checkLVal(param, true, nameHash, "function parameter list");
      }
      this.state.strict = oldStrict;
    }
  }

  // Parses a comma-separated list of expressions, and returns them as
  // an array. `close` is the token type that ends the list, and
  // `allowEmpty` can be turned on to allow subsequent commas with
  // nothing in between them to be parsed as `null` (which is needed
  // for array literals).

  parseExprList(close, allowEmpty, refShorthandDefaultPos) {
    const elts = [];
    let first = true;

    while (!this.eat(close)) {
      if (first) {
        first = false;
      } else {
        this.expect(types.comma);
        if (this.eat(close)) break;
      }

      elts.push(this.parseExprListItem(allowEmpty, refShorthandDefaultPos));
    }
    return elts;
  }

  parseExprListItem(allowEmpty, refShorthandDefaultPos, refNeedsArrowPos) {
    let elt;
    if (allowEmpty && this.match(types.comma)) {
      elt = null;
    } else if (this.match(types.ellipsis)) {
      elt = this.parseSpread(refShorthandDefaultPos);
    } else {
      elt = this.parseMaybeAssign(false, refShorthandDefaultPos, this.parseParenItem, refNeedsArrowPos);
    }
    return elt;
  }

  // Parse the next token as an identifier. If `liberal` is true (used
  // when parsing properties), it will also convert keywords into
  // identifiers.

  parseIdentifier(liberal) {
    const node = this.startNode();
    const name = this.parseIdentifierName(node.start, liberal);
    node.name = name;
    node.loc.identifierName = name;
    return this.finishNode(node, "Identifier");
  }

  parseIdentifierName(pos, liberal) {
    if (!liberal) {
      this.checkReservedWord(this.state.value, this.state.start, !!this.state.type.keyword, false);
    }

    let name;

    if (this.match(types.name)) {
      name = this.state.value;
    } else if (this.state.type.keyword) {
      name = this.state.type.keyword;
    } else {
      throw this.unexpected();
    }

    if (!liberal && name === "await" && this.state.inAsync) {
      this.raise(pos, "invalid use of await inside of an async function");
    }

    this.next();
    return name;
  }

  checkReservedWord(word, startLoc, checkKeywords, isBinding) {
    if (this.isReservedWord(word) || checkKeywords && this.isKeyword(word)) {
      this.raise(startLoc, word + " is a reserved word");
    }

    if (this.state.strict && (reservedWords.strict(word) || isBinding && reservedWords.strictBind(word))) {
      this.raise(startLoc, word + " is a reserved word in strict mode");
    }
  }

  // Parses await expression inside async function.

  parseAwait(node) {
    // istanbul ignore next: this condition is checked at the call site so won't be hit here
    if (!this.state.inAsync) {
      this.unexpected();
    }
    if (this.match(types.star)) {
      this.raise(node.start, "await* has been removed from the async functions proposal. Use Promise.all() instead.");
    }
    node.argument = this.parseMaybeUnary();
    return this.finishNode(node, "AwaitExpression");
  }

  // Parses yield expression inside generator.

  parseYield() {
    const node = this.startNode();
    this.next();
    if (this.match(types.semi) || this.canInsertSemicolon() || !this.match(types.star) && !this.state.type.startsExpr) {
      node.delegate = false;
      node.argument = null;
    } else {
      node.delegate = this.eat(types.star);
      node.argument = this.parseMaybeAssign();
    }
    return this.finishNode(node, "YieldExpression");
  }
}

/* eslint max-len: 0 */

// Reused empty array added for node fields that are always empty.

const empty = [];

const loopLabel = { kind: "loop" };
const switchLabel = { kind: "switch" };

class StatementParser extends ExpressionParser {
  // ### Statement parsing

  // Parse a program. Initializes the parser, reads any number of
  // statements, and wraps them in a Program node.  Optionally takes a
  // `program` argument.  If present, the statements will be appended
  // to its body instead of creating a new node.

  parseTopLevel(file, program) {
    program.sourceType = this.options.sourceType;

    this.parseBlockBody(program, true, true, types.eof);

    file.program = this.finishNode(program, "Program");
    file.comments = this.state.comments;

    if (this.options.tokens) file.tokens = this.state.tokens;

    return this.finishNode(file, "File");
  }

  // TODO

  stmtToDirective(stmt) {
    const expr = stmt.expression;

    const directiveLiteral = this.startNodeAt(expr.start, expr.loc.start);
    const directive = this.startNodeAt(stmt.start, stmt.loc.start);

    const raw = this.input.slice(expr.start, expr.end);
    const val = directiveLiteral.value = raw.slice(1, -1); // remove quotes

    this.addExtra(directiveLiteral, "raw", raw);
    this.addExtra(directiveLiteral, "rawValue", val);

    directive.value = this.finishNodeAt(directiveLiteral, "DirectiveLiteral", expr.end, expr.loc.end);

    return this.finishNodeAt(directive, "Directive", stmt.end, stmt.loc.end);
  }

  // Parse a single statement.
  //
  // If expecting a statement and finding a slash operator, parse a
  // regular expression literal. This is to handle cases like
  // `if (foo) /blah/.exec(foo)`, where looking at the previous token
  // does not help.

  parseStatement(declaration, topLevel) {
    if (this.match(types.at)) {
      this.parseDecorators(true);
    }
    return this.parseStatementContent(declaration, topLevel);
  }

  parseStatementContent(declaration, topLevel) {
    const starttype = this.state.type;
    const node = this.startNode();

    // Most types of statements are recognized by the keyword they
    // start with. Many are trivial to parse, some require a bit of
    // complexity.

    switch (starttype) {
      case types._break:
      case types._continue:
        // $FlowFixMe
        return this.parseBreakContinueStatement(node, starttype.keyword);
      case types._debugger:
        return this.parseDebuggerStatement(node);
      case types._do:
        return this.parseDoStatement(node);
      case types._for:
        return this.parseForStatement(node);
      case types._function:
        if (this.lookahead().type === types.dot) break;
        if (!declaration) this.unexpected();
        return this.parseFunctionStatement(node);

      case types._class:
        if (!declaration) this.unexpected();
        return this.parseClass(node, true);

      case types._if:
        return this.parseIfStatement(node);
      case types._return:
        return this.parseReturnStatement(node);
      case types._switch:
        return this.parseSwitchStatement(node);
      case types._throw:
        return this.parseThrowStatement(node);
      case types._try:
        return this.parseTryStatement(node);

      case types._let:
      case types._const:
        if (!declaration) this.unexpected(); // NOTE: falls through to _var

      case types._var:
        return this.parseVarStatement(node, starttype);

      case types._while:
        return this.parseWhileStatement(node);
      case types._with:
        return this.parseWithStatement(node);
      case types.braceL:
        return this.parseBlock();
      case types.semi:
        return this.parseEmptyStatement(node);
      case types._export:
      case types._import:
        if (this.hasPlugin("dynamicImport") && this.lookahead().type === types.parenL || this.hasPlugin("importMeta") && this.lookahead().type === types.dot) break;

        if (!this.options.allowImportExportEverywhere) {
          if (!topLevel) {
            this.raise(this.state.start, "'import' and 'export' may only appear at the top level");
          }

          if (!this.inModule) {
            this.raise(this.state.start, `'import' and 'export' may appear only with 'sourceType: "module"'`);
          }
        }

        this.next();
        if (starttype == types._import) {
          return this.parseImport(node);
        } else {
          return this.parseExport(node);
        }

      case types.name:
        if (this.state.value === "async") {
          // peek ahead and see if next token is a function
          const state = this.state.clone();
          this.next();
          if (this.match(types._function) && !this.canInsertSemicolon()) {
            this.expect(types._function);
            return this.parseFunction(node, true, false, true);
          } else {
            this.state = state;
          }
        }
    }

    // If the statement does not start with a statement keyword or a
    // brace, it's an ExpressionStatement or LabeledStatement. We
    // simply start parsing an expression, and afterwards, if the
    // next token is a colon and the expression was a simple
    // Identifier node, we switch to interpreting it as a label.
    const maybeName = this.state.value;
    const expr = this.parseExpression();

    if (starttype === types.name && expr.type === "Identifier" && this.eat(types.colon)) {
      return this.parseLabeledStatement(node, maybeName, expr);
    } else {
      return this.parseExpressionStatement(node, expr);
    }
  }

  takeDecorators(node) {
    const decorators = this.state.decoratorStack[this.state.decoratorStack.length - 1];
    if (decorators.length) {
      node.decorators = decorators;
      if (this.hasPlugin("decorators2")) {
        this.resetStartLocationFromNode(node, decorators[0]);
      }
      this.state.decoratorStack[this.state.decoratorStack.length - 1] = [];
    }
  }

  parseDecorators(allowExport) {
    if (this.hasPlugin("decorators2")) {
      allowExport = false;
    }

    const currentContextDecorators = this.state.decoratorStack[this.state.decoratorStack.length - 1];
    while (this.match(types.at)) {
      const decorator = this.parseDecorator();
      currentContextDecorators.push(decorator);
    }

    if (this.match(types._export)) {
      if (allowExport) {
        return;
      } else {
        this.raise(this.state.start, "Using the export keyword between a decorator and a class is not allowed. Please use `export @dec class` instead");
      }
    }

    if (!this.match(types._class)) {
      this.raise(this.state.start, "Leading decorators must be attached to a class declaration");
    }
  }

  parseDecorator() {
    if (!(this.hasPlugin("decorators") || this.hasPlugin("decorators2"))) {
      this.unexpected();
    }

    const node = this.startNode();
    this.next();

    if (this.hasPlugin("decorators2")) {
      const startPos = this.state.start;
      const startLoc = this.state.startLoc;
      let expr = this.parseIdentifier(false);

      while (this.eat(types.dot)) {
        const node = this.startNodeAt(startPos, startLoc);
        node.object = expr;
        node.property = this.parseIdentifier(true);
        node.computed = false;
        expr = this.finishNode(node, "MemberExpression");
      }

      if (this.eat(types.parenL)) {
        const node = this.startNodeAt(startPos, startLoc);
        node.callee = expr;
        // Every time a decorator class expression is evaluated, a new empty array is pushed onto the stack
        // So that the decorators of any nested class expressions will be dealt with separately
        this.state.decoratorStack.push([]);
        node.arguments = this.parseCallExpressionArguments(types.parenR, false);
        this.state.decoratorStack.pop();
        expr = this.finishNode(node, "CallExpression");
        this.toReferencedList(expr.arguments);
      }

      node.expression = expr;
    } else {
      node.expression = this.parseMaybeAssign();
    }
    return this.finishNode(node, "Decorator");
  }

  parseBreakContinueStatement(node, keyword) {
    const isBreak = keyword === "break";
    this.next();

    if (this.isLineTerminator()) {
      node.label = null;
    } else if (!this.match(types.name)) {
      this.unexpected();
    } else {
      node.label = this.parseIdentifier();
      this.semicolon();
    }

    // Verify that there is an actual destination to break or
    // continue to.
    let i;
    for (i = 0; i < this.state.labels.length; ++i) {
      const lab = this.state.labels[i];
      if (node.label == null || lab.name === node.label.name) {
        if (lab.kind != null && (isBreak || lab.kind === "loop")) break;
        if (node.label && isBreak) break;
      }
    }
    if (i === this.state.labels.length) this.raise(node.start, "Unsyntactic " + keyword);
    return this.finishNode(node, isBreak ? "BreakStatement" : "ContinueStatement");
  }

  parseDebuggerStatement(node) {
    this.next();
    this.semicolon();
    return this.finishNode(node, "DebuggerStatement");
  }

  parseDoStatement(node) {
    this.next();
    this.state.labels.push(loopLabel);
    node.body = this.parseStatement(false);
    this.state.labels.pop();
    this.expect(types._while);
    node.test = this.parseParenExpression();
    this.eat(types.semi);
    return this.finishNode(node, "DoWhileStatement");
  }

  // Disambiguating between a `for` and a `for`/`in` or `for`/`of`
  // loop is non-trivial. Basically, we have to parse the init `var`
  // statement or expression, disallowing the `in` operator (see
  // the second parameter to `parseExpression`), and then check
  // whether the next token is `in` or `of`. When there is no init
  // part (semicolon immediately after the opening parenthesis), it
  // is a regular `for` loop.

  parseForStatement(node) {
    this.next();
    this.state.labels.push(loopLabel);

    let forAwait = false;
    if (this.hasPlugin("asyncGenerators") && this.state.inAsync && this.isContextual("await")) {
      forAwait = true;
      this.next();
    }
    this.expect(types.parenL);

    if (this.match(types.semi)) {
      if (forAwait) {
        this.unexpected();
      }
      return this.parseFor(node, null);
    }

    if (this.match(types._var) || this.match(types._let) || this.match(types._const)) {
      const init = this.startNode();
      const varKind = this.state.type;
      this.next();
      this.parseVar(init, true, varKind);
      this.finishNode(init, "VariableDeclaration");

      if (this.match(types._in) || this.isContextual("of")) {
        if (init.declarations.length === 1 && !init.declarations[0].init) {
          return this.parseForIn(node, init, forAwait);
        }
      }
      if (forAwait) {
        this.unexpected();
      }
      return this.parseFor(node, init);
    }

    const refShorthandDefaultPos = { start: 0 };
    const init = this.parseExpression(true, refShorthandDefaultPos);
    if (this.match(types._in) || this.isContextual("of")) {
      const description = this.isContextual("of") ? "for-of statement" : "for-in statement";
      this.toAssignable(init, undefined, description);
      this.checkLVal(init, undefined, undefined, description);
      return this.parseForIn(node, init, forAwait);
    } else if (refShorthandDefaultPos.start) {
      this.unexpected(refShorthandDefaultPos.start);
    }
    if (forAwait) {
      this.unexpected();
    }
    return this.parseFor(node, init);
  }

  parseFunctionStatement(node) {
    this.next();
    return this.parseFunction(node, true);
  }

  parseIfStatement(node) {
    this.next();
    node.test = this.parseParenExpression();
    node.consequent = this.parseStatement(false);
    node.alternate = this.eat(types._else) ? this.parseStatement(false) : null;
    return this.finishNode(node, "IfStatement");
  }

  parseReturnStatement(node) {
    if (!this.state.inFunction && !this.options.allowReturnOutsideFunction) {
      this.raise(this.state.start, "'return' outside of function");
    }

    this.next();

    // In `return` (and `break`/`continue`), the keywords with
    // optional arguments, we eagerly look for a semicolon or the
    // possibility to insert one.

    if (this.isLineTerminator()) {
      node.argument = null;
    } else {
      node.argument = this.parseExpression();
      this.semicolon();
    }

    return this.finishNode(node, "ReturnStatement");
  }

  parseSwitchStatement(node) {
    this.next();
    node.discriminant = this.parseParenExpression();
    const cases = node.cases = [];
    this.expect(types.braceL);
    this.state.labels.push(switchLabel);

    // Statements under must be grouped (by label) in SwitchCase
    // nodes. `cur` is used to keep the node that we are currently
    // adding statements to.

    let cur;
    for (let sawDefault; !this.match(types.braceR);) {
      if (this.match(types._case) || this.match(types._default)) {
        const isCase = this.match(types._case);
        if (cur) this.finishNode(cur, "SwitchCase");
        cases.push(cur = this.startNode());
        cur.consequent = [];
        this.next();
        if (isCase) {
          cur.test = this.parseExpression();
        } else {
          if (sawDefault) this.raise(this.state.lastTokStart, "Multiple default clauses");
          sawDefault = true;
          cur.test = null;
        }
        this.expect(types.colon);
      } else {
        if (cur) {
          cur.consequent.push(this.parseStatement(true));
        } else {
          this.unexpected();
        }
      }
    }
    if (cur) this.finishNode(cur, "SwitchCase");
    this.next(); // Closing brace
    this.state.labels.pop();
    return this.finishNode(node, "SwitchStatement");
  }

  parseThrowStatement(node) {
    this.next();
    if (lineBreak.test(this.input.slice(this.state.lastTokEnd, this.state.start))) this.raise(this.state.lastTokEnd, "Illegal newline after throw");
    node.argument = this.parseExpression();
    this.semicolon();
    return this.finishNode(node, "ThrowStatement");
  }

  parseTryStatement(node) {
    this.next();

    node.block = this.parseBlock();
    node.handler = null;

    if (this.match(types._catch)) {
      const clause = this.startNode();
      this.next();

      this.expect(types.parenL);
      clause.param = this.parseBindingAtom();
      this.checkLVal(clause.param, true, Object.create(null), "catch clause");
      this.expect(types.parenR);

      clause.body = this.parseBlock();
      node.handler = this.finishNode(clause, "CatchClause");
    }

    node.guardedHandlers = empty;
    node.finalizer = this.eat(types._finally) ? this.parseBlock() : null;

    if (!node.handler && !node.finalizer) {
      this.raise(node.start, "Missing catch or finally clause");
    }

    return this.finishNode(node, "TryStatement");
  }

  parseVarStatement(node, kind) {
    this.next();
    this.parseVar(node, false, kind);
    this.semicolon();
    return this.finishNode(node, "VariableDeclaration");
  }

  parseWhileStatement(node) {
    this.next();
    node.test = this.parseParenExpression();
    this.state.labels.push(loopLabel);
    node.body = this.parseStatement(false);
    this.state.labels.pop();
    return this.finishNode(node, "WhileStatement");
  }

  parseWithStatement(node) {
    if (this.state.strict) this.raise(this.state.start, "'with' in strict mode");
    this.next();
    node.object = this.parseParenExpression();
    node.body = this.parseStatement(false);
    return this.finishNode(node, "WithStatement");
  }

  parseEmptyStatement(node) {
    this.next();
    return this.finishNode(node, "EmptyStatement");
  }

  parseLabeledStatement(node, maybeName, expr) {
    for (const label of this.state.labels) {
      if (label.name === maybeName) {
        this.raise(expr.start, `Label '${maybeName}' is already declared`);
      }
    }

    const kind = this.state.type.isLoop ? "loop" : this.match(types._switch) ? "switch" : null;
    for (let i = this.state.labels.length - 1; i >= 0; i--) {
      const label = this.state.labels[i];
      if (label.statementStart === node.start) {
        label.statementStart = this.state.start;
        label.kind = kind;
      } else {
        break;
      }
    }

    this.state.labels.push({
      name: maybeName,
      kind: kind,
      statementStart: this.state.start
    });
    node.body = this.parseStatement(true);
    this.state.labels.pop();
    node.label = expr;
    return this.finishNode(node, "LabeledStatement");
  }

  parseExpressionStatement(node, expr) {
    node.expression = expr;
    this.semicolon();
    return this.finishNode(node, "ExpressionStatement");
  }

  // Parse a semicolon-enclosed block of statements, handling `"use
  // strict"` declarations when `allowStrict` is true (used for
  // function bodies).

  parseBlock(allowDirectives) {
    const node = this.startNode();
    this.expect(types.braceL);
    this.parseBlockBody(node, allowDirectives, false, types.braceR);
    return this.finishNode(node, "BlockStatement");
  }

  isValidDirective(stmt) {
    return stmt.type === "ExpressionStatement" && stmt.expression.type === "StringLiteral" && !stmt.expression.extra.parenthesized;
  }

  parseBlockBody(node, allowDirectives, topLevel, end) {
    const body = node.body = [];
    const directives = node.directives = [];
    this.parseBlockOrModuleBlockBody(body, allowDirectives ? directives : undefined, topLevel, end);
  }

  // Undefined directives means that directives are not allowed.
  parseBlockOrModuleBlockBody(body, directives, topLevel, end) {
    let parsedNonDirective = false;
    let oldStrict;
    let octalPosition;

    while (!this.eat(end)) {
      if (!parsedNonDirective && this.state.containsOctal && !octalPosition) {
        octalPosition = this.state.octalPosition;
      }

      const stmt = this.parseStatement(true, topLevel);

      if (directives && !parsedNonDirective && this.isValidDirective(stmt)) {
        const directive = this.stmtToDirective(stmt);
        directives.push(directive);

        if (oldStrict === undefined && directive.value.value === "use strict") {
          oldStrict = this.state.strict;
          this.setStrict(true);

          if (octalPosition) {
            this.raise(octalPosition, "Octal literal in strict mode");
          }
        }

        continue;
      }

      parsedNonDirective = true;
      body.push(stmt);
    }

    if (oldStrict === false) {
      this.setStrict(false);
    }
  }

  // Parse a regular `for` loop. The disambiguation code in
  // `parseStatement` will already have parsed the init statement or
  // expression.

  parseFor(node, init) {
    node.init = init;
    this.expect(types.semi);
    node.test = this.match(types.semi) ? null : this.parseExpression();
    this.expect(types.semi);
    node.update = this.match(types.parenR) ? null : this.parseExpression();
    this.expect(types.parenR);
    node.body = this.parseStatement(false);
    this.state.labels.pop();
    return this.finishNode(node, "ForStatement");
  }

  // Parse a `for`/`in` and `for`/`of` loop, which are almost
  // same from parser's perspective.

  parseForIn(node, init, forAwait) {
    const type = this.match(types._in) ? "ForInStatement" : "ForOfStatement";
    if (forAwait) {
      this.eatContextual("of");
    } else {
      this.next();
    }
    if (type === "ForOfStatement") {
      node.await = !!forAwait;
    }
    node.left = init;
    node.right = this.parseExpression();
    this.expect(types.parenR);
    node.body = this.parseStatement(false);
    this.state.labels.pop();
    return this.finishNode(node, type);
  }

  // Parse a list of variable declarations.

  parseVar(node, isFor, kind) {
    const declarations = node.declarations = [];
    // $FlowFixMe
    node.kind = kind.keyword;
    for (;;) {
      const decl = this.startNode();
      this.parseVarHead(decl);
      if (this.eat(types.eq)) {
        decl.init = this.parseMaybeAssign(isFor);
      } else {
        if (kind === types._const && !(this.match(types._in) || this.isContextual("of"))) {
          // `const` with no initializer is allowed in TypeScript. It could be a declaration `const x: number;`.
          if (!this.hasPlugin("typescript")) {
            this.unexpected();
          }
        } else if (decl.id.type !== "Identifier" && !(isFor && (this.match(types._in) || this.isContextual("of")))) {
          this.raise(this.state.lastTokEnd, "Complex binding patterns require an initialization value");
        }
        decl.init = null;
      }
      declarations.push(this.finishNode(decl, "VariableDeclarator"));
      if (!this.eat(types.comma)) break;
    }
    return node;
  }

  parseVarHead(decl) {
    decl.id = this.parseBindingAtom();
    this.checkLVal(decl.id, true, undefined, "variable declaration");
  }

  // Parse a function declaration or literal (depending on the
  // `isStatement` parameter).

  parseFunction(node, isStatement, allowExpressionBody, isAsync, optionalId) {
    const oldInMethod = this.state.inMethod;
    this.state.inMethod = false;

    this.initFunction(node, isAsync);

    if (this.match(types.star)) {
      if (node.async && !this.hasPlugin("asyncGenerators")) {
        this.unexpected();
      } else {
        node.generator = true;
        this.next();
      }
    }

    if (isStatement && !optionalId && !this.match(types.name) && !this.match(types._yield)) {
      this.unexpected();
    }

    if (this.match(types.name) || this.match(types._yield)) {
      node.id = this.parseBindingIdentifier();
    }

    this.parseFunctionParams(node);
    this.parseFunctionBodyAndFinish(node, isStatement ? "FunctionDeclaration" : "FunctionExpression", allowExpressionBody);
    this.state.inMethod = oldInMethod;
    return node;
  }

  parseFunctionParams(node) {
    this.expect(types.parenL);
    node.params = this.parseBindingList(types.parenR);
  }

  // Parse a class declaration or literal (depending on the
  // `isStatement` parameter).

  parseClass(node, isStatement, optionalId) {
    this.next();
    this.takeDecorators(node);
    this.parseClassId(node, isStatement, optionalId);
    this.parseClassSuper(node);
    this.parseClassBody(node);
    return this.finishNode(node, isStatement ? "ClassDeclaration" : "ClassExpression");
  }

  isClassProperty() {
    return this.match(types.eq) || this.match(types.semi) || this.match(types.braceR);
  }

  isClassMethod() {
    return this.match(types.parenL);
  }

  isNonstaticConstructor(method) {
    return !method.computed && !method.static && (method.key.name === "constructor" || // Identifier
    method.key.value === "constructor") // Literal
    ;
  }

  parseClassBody(node) {
    // class bodies are implicitly strict
    const oldStrict = this.state.strict;
    this.state.strict = true;
    this.state.classLevel++;

    const state = { hadConstructor: false };
    let decorators = [];
    const classBody = this.startNode();

    classBody.body = [];

    this.expect(types.braceL);

    while (!this.eat(types.braceR)) {
      if (this.eat(types.semi)) {
        if (decorators.length > 0) {
          this.raise(this.state.lastTokEnd, "Decorators must not be followed by a semicolon");
        }
        continue;
      }

      if (this.match(types.at)) {
        decorators.push(this.parseDecorator());
        continue;
      }

      const member = this.startNode();

      // steal the decorators if there are any
      if (decorators.length) {
        member.decorators = decorators;
        if (this.hasPlugin("decorators2")) {
          this.resetStartLocationFromNode(member, decorators[0]);
        }
        decorators = [];
      }

      this.parseClassMember(classBody, member, state);

      if (this.hasPlugin("decorators2") && member.kind != "method" && member.decorators && member.decorators.length > 0) {
        this.raise(member.start, "Stage 2 decorators may only be used with a class or a class method");
      }
    }

    if (decorators.length) {
      this.raise(this.state.start, "You have trailing decorators with no method");
    }

    node.body = this.finishNode(classBody, "ClassBody");

    this.state.classLevel--;
    this.state.strict = oldStrict;
  }

  parseClassMember(classBody, member, state) {
    // Use the appropriate variable to represent `member` once a more specific type is known.
    const memberAny = member;
    const method = memberAny;
    const prop = memberAny;

    let isStatic = false;
    if (this.match(types.name) && this.state.value === "static") {
      const key = this.parseIdentifier(true); // eats 'static'
      if (this.isClassMethod()) {
        // a method named 'static'
        method.kind = "method";
        method.computed = false;
        method.key = key;
        method.static = false;
        this.parseClassMethod(classBody, method, false, false,
        /* isConstructor */false);
        return;
      } else if (this.isClassProperty()) {
        // a property named 'static'
        prop.computed = false;
        prop.key = key;
        prop.static = false;
        classBody.body.push(this.parseClassProperty(prop));
        return;
      }
      // otherwise something static
      isStatic = true;
    }

    if (this.hasPlugin("classPrivateProperties") && this.match(types.hash)) {
      // Private property
      this.next();
      const privateProp = memberAny;
      privateProp.key = this.parseIdentifier(true);
      privateProp.static = isStatic;
      classBody.body.push(this.parsePrivateClassProperty(privateProp));
      return;
    }

    this.parseClassMemberWithIsStatic(classBody, member, state, isStatic);
  }

  parseClassMemberWithIsStatic(classBody, member, state, isStatic) {
    const memberAny = member;
    const methodOrProp = memberAny;
    const method = memberAny;
    const prop = memberAny;

    methodOrProp.static = isStatic;

    if (this.eat(types.star)) {
      // a generator
      method.kind = "method";
      this.parsePropertyName(method);
      if (this.isNonstaticConstructor(method)) {
        this.raise(method.key.start, "Constructor can't be a generator");
      }
      if (!method.computed && method.static && (method.key.name === "prototype" || method.key.value === "prototype")) {
        this.raise(method.key.start, "Classes may not have static property named prototype");
      }
      this.parseClassMethod(classBody, method, true, false,
      /* isConstructor */false);
      return;
    }

    const isSimple = this.match(types.name);
    const key = this.parseClassPropertyName(methodOrProp);

    this.parsePostMemberNameModifiers(methodOrProp);

    if (this.isClassMethod()) {
      // a normal method
      const isConstructor = this.isNonstaticConstructor(method);
      if (isConstructor) {
        method.kind = "constructor";
      } else {
        method.kind = "method";
      }

      if (isConstructor) {
        if (method.decorators) {
          this.raise(method.start, "You can't attach decorators to a class constructor");
        }

        // TypeScript allows multiple overloaded constructor declarations.
        if (state.hadConstructor && !this.hasPlugin("typescript")) {
          this.raise(key.start, "Duplicate constructor in the same class");
        }
        state.hadConstructor = true;
      }

      this.parseClassMethod(classBody, method, false, false, isConstructor);
    } else if (this.isClassProperty()) {
      this.pushClassProperty(classBody, prop);
    } else if (isSimple && key.name === "async" && !this.isLineTerminator()) {
      // an async method
      const isGenerator = this.hasPlugin("asyncGenerators") && this.eat(types.star);
      method.kind = "method";
      this.parsePropertyName(method);
      if (this.isNonstaticConstructor(method)) {
        this.raise(method.key.start, "Constructor can't be an async function");
      }
      this.parseClassMethod(classBody, method, isGenerator, true,
      /* isConstructor */false);
    } else if (isSimple && (key.name === "get" || key.name === "set") && !(this.isLineTerminator() && this.match(types.star))) {
      // `get\n*` is an uninitialized property named 'get' followed by a generator.
      // a getter or setter
      method.kind = key.name;
      this.parsePropertyName(method);
      if (this.isNonstaticConstructor(method)) {
        this.raise(method.key.start, "Constructor can't have get/set modifier");
      }
      this.parseClassMethod(classBody, method, false, false,
      /* isConstructor */false);
      this.checkGetterSetterParamCount(method);
    } else if (this.isLineTerminator()) {
      // an uninitialized class property (due to ASI, since we don't otherwise recognize the next token)
      if (this.isNonstaticConstructor(prop)) {
        this.raise(prop.key.start, "Classes may not have a non-static field named 'constructor'");
      }
      classBody.body.push(this.parseClassProperty(prop));
    } else {
      this.unexpected();
    }
  }

  parseClassPropertyName(methodOrProp) {
    const key = this.parsePropertyName(methodOrProp);
    if (!methodOrProp.computed && methodOrProp.static && (methodOrProp.key.name === "prototype" || methodOrProp.key.value === "prototype")) {
      this.raise(methodOrProp.key.start, "Classes may not have static property named prototype");
    }
    return key;
  }

  pushClassProperty(classBody, prop) {
    if (this.isNonstaticConstructor(prop)) {
      this.raise(prop.key.start, "Classes may not have a non-static field named 'constructor'");
    }
    classBody.body.push(this.parseClassProperty(prop));
  }

  // Overridden in typescript.js
  parsePostMemberNameModifiers(
  // eslint-disable-next-line no-unused-vars
  methodOrProp) {}

  // Overridden in typescript.js
  parseAccessModifier() {
    return undefined;
  }

  parsePrivateClassProperty(node) {
    this.state.inClassProperty = true;

    if (this.match(types.eq)) {
      this.next();
      node.value = this.parseMaybeAssign();
    } else {
      node.value = null;
    }
    this.semicolon();
    this.state.inClassProperty = false;
    return this.finishNode(node, "ClassPrivateProperty");
  }

  parseClassProperty(node) {
    const hasPlugin = this.hasPlugin("classProperties") || this.hasPlugin("typescript");
    const noPluginMsg = "You can only use Class Properties when the 'classProperties' plugin is enabled.";
    if (!node.typeAnnotation && !hasPlugin) {
      this.raise(node.start, noPluginMsg);
    }

    this.state.inClassProperty = true;

    if (this.match(types.eq)) {
      if (!hasPlugin) this.raise(this.state.start, noPluginMsg);
      this.next();
      node.value = this.parseMaybeAssign();
    } else {
      node.value = null;
    }
    this.semicolon();
    this.state.inClassProperty = false;
    return this.finishNode(node, "ClassProperty");
  }

  parseClassMethod(classBody, method, isGenerator, isAsync, isConstructor) {
    classBody.body.push(this.parseMethod(method, isGenerator, isAsync, isConstructor, "ClassMethod"));
  }

  parseClassId(node, isStatement, optionalId) {
    if (this.match(types.name)) {
      node.id = this.parseIdentifier();
    } else {
      if (optionalId || !isStatement) {
        node.id = null;
      } else {
        this.unexpected(null, "A class name is required");
      }
    }
  }

  parseClassSuper(node) {
    node.superClass = this.eat(types._extends) ? this.parseExprSubscripts() : null;
  }

  // Parses module export declaration.

  // TODO: better type. Node is an N.AnyExport.
  parseExport(node) {
    // export * from '...'
    if (this.shouldParseExportStar()) {
      this.parseExportStar(node, this.hasPlugin("exportExtensions"));
      if (node.type === "ExportAllDeclaration") return node;
    } else if (this.hasPlugin("exportExtensions") && this.isExportDefaultSpecifier()) {
      const specifier = this.startNode();
      specifier.exported = this.parseIdentifier(true);
      const specifiers = [this.finishNode(specifier, "ExportDefaultSpecifier")];
      node.specifiers = specifiers;
      if (this.match(types.comma) && this.lookahead().type === types.star) {
        this.expect(types.comma);
        const specifier = this.startNode();
        this.expect(types.star);
        this.expectContextual("as");
        specifier.exported = this.parseIdentifier();
        specifiers.push(this.finishNode(specifier, "ExportNamespaceSpecifier"));
      } else {
        this.parseExportSpecifiersMaybe(node);
      }
      this.parseExportFrom(node, true);
    } else if (this.eat(types._default)) {
      // export default ...
      let expr = this.startNode();
      let needsSemi = false;
      if (this.eat(types._function)) {
        expr = this.parseFunction(expr, true, false, false, true);
      } else if (this.isContextual("async") && this.lookahead().type === types._function) {
        // async function declaration
        this.eatContextual("async");
        this.eat(types._function);
        expr = this.parseFunction(expr, true, false, true, true);
      } else if (this.match(types._class)) {
        expr = this.parseClass(expr, true, true);
      } else {
        needsSemi = true;
        expr = this.parseMaybeAssign();
      }
      node.declaration = expr;
      if (needsSemi) this.semicolon();
      this.checkExport(node, true, true);
      return this.finishNode(node, "ExportDefaultDeclaration");
    } else if (this.shouldParseExportDeclaration()) {
      node.specifiers = [];
      node.source = null;
      node.declaration = this.parseExportDeclaration(node);
    } else {
      // export { x, y as z } [from '...']
      node.declaration = null;
      node.specifiers = this.parseExportSpecifiers();
      this.parseExportFrom(node);
    }
    this.checkExport(node, true);
    return this.finishNode(node, "ExportNamedDeclaration");
  }

  // eslint-disable-next-line no-unused-vars
  parseExportDeclaration(node) {
    return this.parseStatement(true);
  }

  isExportDefaultSpecifier() {
    if (this.match(types.name)) {
      return this.state.value !== "async";
    }

    if (!this.match(types._default)) {
      return false;
    }

    const lookahead = this.lookahead();
    return lookahead.type === types.comma || lookahead.type === types.name && lookahead.value === "from";
  }

  parseExportSpecifiersMaybe(node) {
    if (this.eat(types.comma)) {
      node.specifiers = node.specifiers.concat(this.parseExportSpecifiers());
    }
  }

  parseExportFrom(node, expect) {
    if (this.eatContextual("from")) {
      node.source = this.match(types.string) ? this.parseExprAtom() : this.unexpected();
      this.checkExport(node);
    } else {
      if (expect) {
        this.unexpected();
      } else {
        node.source = null;
      }
    }

    this.semicolon();
  }

  shouldParseExportStar() {
    return this.match(types.star);
  }

  parseExportStar(node, allowNamed) {
    this.expect(types.star);

    if (allowNamed && this.isContextual("as")) {
      const specifier = this.startNodeAt(this.state.lastTokStart, this.state.lastTokStartLoc);
      this.next();
      specifier.exported = this.parseIdentifier(true);
      node.specifiers = [this.finishNode(specifier, "ExportNamespaceSpecifier")];
      this.parseExportSpecifiersMaybe(node);
      this.parseExportFrom(node, true);
    } else {
      this.parseExportFrom(node, true);
      this.finishNode(node, "ExportAllDeclaration");
    }
  }

  shouldParseExportDeclaration() {
    return this.state.type.keyword === "var" || this.state.type.keyword === "const" || this.state.type.keyword === "let" || this.state.type.keyword === "function" || this.state.type.keyword === "class" || this.isContextual("async");
  }

  checkExport(node, checkNames, isDefault) {
    if (checkNames) {
      // Check for duplicate exports
      if (isDefault) {
        // Default exports
        this.checkDuplicateExports(node, "default");
      } else if (node.specifiers && node.specifiers.length) {
        // Named exports
        for (const specifier of node.specifiers) {
          this.checkDuplicateExports(specifier, specifier.exported.name);
        }
      } else if (node.declaration) {
        // Exported declarations
        if (node.declaration.type === "FunctionDeclaration" || node.declaration.type === "ClassDeclaration") {
          this.checkDuplicateExports(node, node.declaration.id.name);
        } else if (node.declaration.type === "VariableDeclaration") {
          for (const declaration of node.declaration.declarations) {
            this.checkDeclaration(declaration.id);
          }
        }
      }
    }

    const currentContextDecorators = this.state.decoratorStack[this.state.decoratorStack.length - 1];
    if (currentContextDecorators.length) {
      const isClass = node.declaration && (node.declaration.type === "ClassDeclaration" || node.declaration.type === "ClassExpression");
      if (!node.declaration || !isClass) {
        throw this.raise(node.start, "You can only use decorators on an export when exporting a class");
      }
      this.takeDecorators(node.declaration);
    }
  }

  checkDeclaration(node) {
    if (node.type === "ObjectPattern") {
      for (const prop of node.properties) {
        // $FlowFixMe (prop may be an AssignmentProperty, in which case this does nothing?)
        this.checkDeclaration(prop);
      }
    } else if (node.type === "ArrayPattern") {
      for (const elem of node.elements) {
        if (elem) {
          this.checkDeclaration(elem);
        }
      }
    } else if (node.type === "ObjectProperty") {
      this.checkDeclaration(node.value);
    } else if (node.type === "RestElement") {
      this.checkDeclaration(node.argument);
    } else if (node.type === "Identifier") {
      this.checkDuplicateExports(node, node.name);
    }
  }

  checkDuplicateExports(node, name) {
    if (this.state.exportedIdentifiers.indexOf(name) > -1) {
      this.raiseDuplicateExportError(node, name);
    }
    this.state.exportedIdentifiers.push(name);
  }

  raiseDuplicateExportError(node, name) {
    throw this.raise(node.start, name === "default" ? "Only one default export allowed per module." : `\`${name}\` has already been exported. Exported identifiers must be unique.`);
  }

  // Parses a comma-separated list of module exports.

  parseExportSpecifiers() {
    const nodes = [];
    let first = true;
    let needsFrom;

    // export { x, y as z } [from '...']
    this.expect(types.braceL);

    while (!this.eat(types.braceR)) {
      if (first) {
        first = false;
      } else {
        this.expect(types.comma);
        if (this.eat(types.braceR)) break;
      }

      const isDefault = this.match(types._default);
      if (isDefault && !needsFrom) needsFrom = true;

      const node = this.startNode();
      node.local = this.parseIdentifier(isDefault);
      node.exported = this.eatContextual("as") ? this.parseIdentifier(true) : node.local.__clone();
      nodes.push(this.finishNode(node, "ExportSpecifier"));
    }

    // https://github.com/ember-cli/ember-cli/pull/3739
    if (needsFrom && !this.isContextual("from")) {
      this.unexpected();
    }

    return nodes;
  }

  // Parses import declaration.

  parseImport(node) {
    // import '...'
    if (this.match(types.string)) {
      node.specifiers = [];
      node.source = this.parseExprAtom();
    } else {
      node.specifiers = [];
      this.parseImportSpecifiers(node);
      this.expectContextual("from");
      node.source = this.match(types.string) ? this.parseExprAtom() : this.unexpected();
    }
    this.semicolon();
    return this.finishNode(node, "ImportDeclaration");
  }

  // Parses a comma-separated list of module imports.

  parseImportSpecifiers(node) {
    let first = true;
    if (this.match(types.name)) {
      // import defaultObj, { x, y as z } from '...'
      const startPos = this.state.start;
      const startLoc = this.state.startLoc;
      node.specifiers.push(this.parseImportSpecifierDefault(this.parseIdentifier(), startPos, startLoc));
      if (!this.eat(types.comma)) return;
    }

    if (this.match(types.star)) {
      const specifier = this.startNode();
      this.next();
      this.expectContextual("as");
      specifier.local = this.parseIdentifier();
      this.checkLVal(specifier.local, true, undefined, "import namespace specifier");
      node.specifiers.push(this.finishNode(specifier, "ImportNamespaceSpecifier"));
      return;
    }

    this.expect(types.braceL);
    while (!this.eat(types.braceR)) {
      if (first) {
        first = false;
      } else {
        // Detect an attempt to deep destructure
        if (this.eat(types.colon)) {
          this.unexpected(null, "ES2015 named imports do not destructure. Use another statement for destructuring after the import.");
        }

        this.expect(types.comma);
        if (this.eat(types.braceR)) break;
      }

      this.parseImportSpecifier(node);
    }
  }

  parseImportSpecifier(node) {
    const specifier = this.startNode();
    specifier.imported = this.parseIdentifier(true);
    if (this.eatContextual("as")) {
      specifier.local = this.parseIdentifier();
    } else {
      this.checkReservedWord(specifier.imported.name, specifier.start, true, true);
      specifier.local = specifier.imported.__clone();
    }
    this.checkLVal(specifier.local, true, undefined, "import specifier");
    node.specifiers.push(this.finishNode(specifier, "ImportSpecifier"));
  }

  parseImportSpecifierDefault(id, startPos, startLoc) {
    const node = this.startNodeAt(startPos, startLoc);
    node.local = id;
    this.checkLVal(node.local, true, undefined, "default import specifier");
    return this.finishNode(node, "ImportDefaultSpecifier");
  }
}

const plugins = {};

class Parser extends StatementParser {
  constructor(options, input) {
    options = getOptions(options);
    super(options, input);

    this.options = options;
    this.inModule = this.options.sourceType === "module";
    this.input = input;
    this.plugins = pluginsMap(this.options.plugins);
    this.filename = options.sourceFilename;

    // If enabled, skip leading hashbang line.
    if (this.state.pos === 0 && this.input[0] === "#" && this.input[1] === "!") {
      this.skipLineComment(2);
    }
  }

  parse() {
    const file = this.startNode();
    const program = this.startNode();
    this.nextToken();
    return this.parseTopLevel(file, program);
  }
}

function pluginsMap(pluginList) {
  const pluginMap = {};
  for (const name of pluginList) {
    pluginMap[name] = true;
  }
  return pluginMap;
}

function isSimpleProperty(node) {
  return node != null && node.type === "Property" && node.kind === "init" && node.method === false;
}

var estreePlugin = (superClass => class extends superClass {
  estreeParseRegExpLiteral({ pattern, flags }) {
    let regex = null;
    try {
      regex = new RegExp(pattern, flags);
    } catch (e) {
      // In environments that don't support these flags value will
      // be null as the regex can't be represented natively.
    }
    const node = this.estreeParseLiteral(regex);
    node.regex = { pattern, flags };

    return node;
  }

  estreeParseLiteral(value) {
    return this.parseLiteral(value, "Literal");
  }

  directiveToStmt(directive) {
    const directiveLiteral = directive.value;

    const stmt = this.startNodeAt(directive.start, directive.loc.start);
    const expression = this.startNodeAt(directiveLiteral.start, directiveLiteral.loc.start);

    expression.value = directiveLiteral.value;
    expression.raw = directiveLiteral.extra.raw;

    stmt.expression = this.finishNodeAt(expression, "Literal", directiveLiteral.end, directiveLiteral.loc.end);
    stmt.directive = directiveLiteral.extra.raw.slice(1, -1);

    return this.finishNodeAt(stmt, "ExpressionStatement", directive.end, directive.loc.end);
  }

  // ==================================
  // Overrides
  // ==================================

  checkDeclaration(node) {
    if (isSimpleProperty(node)) {
      // $FlowFixMe
      this.checkDeclaration(node.value);
    } else {
      super.checkDeclaration(node);
    }
  }

  checkGetterSetterParamCount(prop) {
    const paramCount = prop.kind === "get" ? 0 : 1;
    // $FlowFixMe (prop.value present for ObjectMethod, but for ClassMethod should use prop.params?)
    if (prop.value.params.length !== paramCount) {
      const start = prop.start;
      if (prop.kind === "get") {
        this.raise(start, "getter should have no params");
      } else {
        this.raise(start, "setter should have exactly one param");
      }
    }
  }

  checkLVal(expr, isBinding, checkClashes, contextDescription) {
    switch (expr.type) {
      case "ObjectPattern":
        expr.properties.forEach(prop => {
          this.checkLVal(prop.type === "Property" ? prop.value : prop, isBinding, checkClashes, "object destructuring pattern");
        });
        break;
      default:
        super.checkLVal(expr, isBinding, checkClashes, contextDescription);
    }
  }

  checkPropClash(prop, propHash) {
    if (prop.computed || !isSimpleProperty(prop)) return;

    const key = prop.key;
    // It is either an Identifier or a String/NumericLiteral
    const name = key.type === "Identifier" ? key.name : String(key.value);

    if (name === "__proto__") {
      if (propHash.proto) this.raise(key.start, "Redefinition of __proto__ property");
      propHash.proto = true;
    }
  }

  isStrictBody(node, isExpression) {
    if (!isExpression && node.body.body.length > 0) {
      for (const directive of node.body.body) {
        if (directive.type === "ExpressionStatement" && directive.expression.type === "Literal") {
          if (directive.expression.value === "use strict") return true;
        } else {
          // Break for the first non literal expression
          break;
        }
      }
    }

    return false;
  }

  isValidDirective(stmt) {
    return stmt.type === "ExpressionStatement" && stmt.expression.type === "Literal" && typeof stmt.expression.value === "string" && (!stmt.expression.extra || !stmt.expression.extra.parenthesized);
  }

  stmtToDirective(stmt) {
    const directive = super.stmtToDirective(stmt);
    const value = stmt.expression.value;

    // Reset value to the actual value as in estree mode we want
    // the stmt to have the real value and not the raw value
    directive.value.value = value;

    return directive;
  }

  parseBlockBody(node, allowDirectives, topLevel, end) {
    super.parseBlockBody(node, allowDirectives, topLevel, end);

    const directiveStatements = node.directives.map(d => this.directiveToStmt(d));
    node.body = directiveStatements.concat(node.body);
    delete node.directives;
  }

  parseClassMethod(classBody, method, isGenerator, isAsync, isConstructor) {
    this.parseMethod(method, isGenerator, isAsync, isConstructor, "MethodDefinition");
    if (method.typeParameters) {
      // $FlowIgnore
      method.value.typeParameters = method.typeParameters;
      delete method.typeParameters;
    }
    classBody.body.push(method);
  }

  parseExprAtom(refShorthandDefaultPos) {
    switch (this.state.type) {
      case types.regexp:
        return this.estreeParseRegExpLiteral(this.state.value);

      case types.num:
      case types.string:
        return this.estreeParseLiteral(this.state.value);

      case types._null:
        return this.estreeParseLiteral(null);

      case types._true:
        return this.estreeParseLiteral(true);

      case types._false:
        return this.estreeParseLiteral(false);

      default:
        return super.parseExprAtom(refShorthandDefaultPos);
    }
  }

  parseLiteral(value, type, startPos, startLoc) {
    const node = super.parseLiteral(value, type, startPos, startLoc);
    node.raw = node.extra.raw;
    delete node.extra;

    return node;
  }

  parseMethod(node, isGenerator, isAsync, isConstructor, type) {
    let funcNode = this.startNode();
    funcNode.kind = node.kind; // provide kind, so super method correctly sets state
    funcNode = super.parseMethod(funcNode, isGenerator, isAsync, isConstructor, "FunctionExpression");
    delete funcNode.kind;
    // $FlowIgnore
    node.value = funcNode;

    return this.finishNode(node, type);
  }

  parseObjectMethod(prop, isGenerator, isAsync, isPattern) {
    const node = super.parseObjectMethod(prop, isGenerator, isAsync, isPattern);

    if (node) {
      node.type = "Property";
      if (node.kind === "method") node.kind = "init";
      node.shorthand = false;
    }

    return node;
  }

  parseObjectProperty(prop, startPos, startLoc, isPattern, refShorthandDefaultPos) {
    const node = super.parseObjectProperty(prop, startPos, startLoc, isPattern, refShorthandDefaultPos);

    if (node) {
      node.kind = "init";
      node.type = "Property";
    }

    return node;
  }

  toAssignable(node, isBinding, contextDescription) {
    if (isSimpleProperty(node)) {
      this.toAssignable(node.value, isBinding, contextDescription);

      return node;
    } else if (node.type === "ObjectExpression") {
      node.type = "ObjectPattern";
      for (const prop of node.properties) {
        if (prop.kind === "get" || prop.kind === "set") {
          this.raise(prop.key.start, "Object pattern can't contain getter or setter");
        } else if (prop.method) {
          this.raise(prop.key.start, "Object pattern can't contain methods");
        } else {
          this.toAssignable(prop, isBinding, "object destructuring pattern");
        }
      }

      return node;
    }

    return super.toAssignable(node, isBinding, contextDescription);
  }
});

/* eslint max-len: 0 */

const primitiveTypes = ["any", "mixed", "empty", "bool", "boolean", "number", "string", "void", "null"];

function isEsModuleType(bodyElement) {
  return bodyElement.type === "DeclareExportAllDeclaration" || bodyElement.type === "DeclareExportDeclaration" && (!bodyElement.declaration || bodyElement.declaration.type !== "TypeAlias" && bodyElement.declaration.type !== "InterfaceDeclaration");
}

const exportSuggestions = {
  const: "declare export var",
  let: "declare export var",
  type: "export type",
  interface: "export interface"
};

var flowPlugin = (superClass => class extends superClass {
  flowParseTypeInitialiser(tok) {
    const oldInType = this.state.inType;
    this.state.inType = true;
    this.expect(tok || types.colon);

    const type = this.flowParseType();
    this.state.inType = oldInType;
    return type;
  }

  flowParsePredicate() {
    const node = this.startNode();
    const moduloLoc = this.state.startLoc;
    const moduloPos = this.state.start;
    this.expect(types.modulo);
    const checksLoc = this.state.startLoc;
    this.expectContextual("checks");
    // Force '%' and 'checks' to be adjacent
    if (moduloLoc.line !== checksLoc.line || moduloLoc.column !== checksLoc.column - 1) {
      this.raise(moduloPos, "Spaces between ´%´ and ´checks´ are not allowed here.");
    }
    if (this.eat(types.parenL)) {
      node.value = this.parseExpression();
      this.expect(types.parenR);
      return this.finishNode(node, "DeclaredPredicate");
    } else {
      return this.finishNode(node, "InferredPredicate");
    }
  }

  flowParseTypeAndPredicateInitialiser() {
    const oldInType = this.state.inType;
    this.state.inType = true;
    this.expect(types.colon);
    let type = null;
    let predicate = null;
    if (this.match(types.modulo)) {
      this.state.inType = oldInType;
      predicate = this.flowParsePredicate();
    } else {
      type = this.flowParseType();
      this.state.inType = oldInType;
      if (this.match(types.modulo)) {
        predicate = this.flowParsePredicate();
      }
    }
    return [type, predicate];
  }

  flowParseDeclareClass(node) {
    this.next();
    this.flowParseInterfaceish(node);
    return this.finishNode(node, "DeclareClass");
  }

  flowParseDeclareFunction(node) {
    this.next();

    const id = node.id = this.parseIdentifier();

    const typeNode = this.startNode();
    const typeContainer = this.startNode();

    if (this.isRelational("<")) {
      typeNode.typeParameters = this.flowParseTypeParameterDeclaration();
    } else {
      typeNode.typeParameters = null;
    }

    this.expect(types.parenL);
    const tmp = this.flowParseFunctionTypeParams();
    typeNode.params = tmp.params;
    typeNode.rest = tmp.rest;
    this.expect(types.parenR);

    [
    // $FlowFixMe (destructuring not supported yet)
    typeNode.returnType,
    // $FlowFixMe (destructuring not supported yet)
    node.predicate] = this.flowParseTypeAndPredicateInitialiser();

    typeContainer.typeAnnotation = this.finishNode(typeNode, "FunctionTypeAnnotation");

    id.typeAnnotation = this.finishNode(typeContainer, "TypeAnnotation");

    this.finishNode(id, id.type);

    this.semicolon();

    return this.finishNode(node, "DeclareFunction");
  }

  flowParseDeclare(node, insideModule) {
    if (this.match(types._class)) {
      return this.flowParseDeclareClass(node);
    } else if (this.match(types._function)) {
      return this.flowParseDeclareFunction(node);
    } else if (this.match(types._var)) {
      return this.flowParseDeclareVariable(node);
    } else if (this.isContextual("module")) {
      if (this.lookahead().type === types.dot) {
        return this.flowParseDeclareModuleExports(node);
      } else {
        if (insideModule) this.unexpected(null, "`declare module` cannot be used inside another `declare module`");
        return this.flowParseDeclareModule(node);
      }
    } else if (this.isContextual("type")) {
      return this.flowParseDeclareTypeAlias(node);
    } else if (this.isContextual("interface")) {
      return this.flowParseDeclareInterface(node);
    } else if (this.match(types._export)) {
      return this.flowParseDeclareExportDeclaration(node, insideModule);
    } else {
      throw this.unexpected();
    }
  }

  flowParseDeclareVariable(node) {
    this.next();
    node.id = this.flowParseTypeAnnotatableIdentifier();
    this.semicolon();
    return this.finishNode(node, "DeclareVariable");
  }

  flowParseDeclareModule(node) {
    this.next();

    if (this.match(types.string)) {
      node.id = this.parseExprAtom();
    } else {
      node.id = this.parseIdentifier();
    }

    const bodyNode = node.body = this.startNode();
    const body = bodyNode.body = [];
    this.expect(types.braceL);
    while (!this.match(types.braceR)) {
      let bodyNode = this.startNode();

      if (this.match(types._import)) {
        const lookahead = this.lookahead();
        if (lookahead.value !== "type" && lookahead.value !== "typeof") {
          this.unexpected(null, "Imports within a `declare module` body must always be `import type` or `import typeof`");
        }
        this.next();
        this.parseImport(bodyNode);
      } else {
        this.expectContextual("declare", "Only declares and type imports are allowed inside declare module");

        bodyNode = this.flowParseDeclare(bodyNode, true);
      }

      body.push(bodyNode);
    }
    this.expect(types.braceR);

    this.finishNode(bodyNode, "BlockStatement");

    let kind = null;
    let hasModuleExport = false;
    const errorMessage = "Found both `declare module.exports` and `declare export` in the same module. Modules can only have 1 since they are either an ES module or they are a CommonJS module";
    body.forEach(bodyElement => {
      if (isEsModuleType(bodyElement)) {
        if (kind === "CommonJS") this.unexpected(bodyElement.start, errorMessage);
        kind = "ES";
      } else if (bodyElement.type === "DeclareModuleExports") {
        if (hasModuleExport) this.unexpected(bodyElement.start, "Duplicate `declare module.exports` statement");
        if (kind === "ES") this.unexpected(bodyElement.start, errorMessage);
        kind = "CommonJS";
        hasModuleExport = true;
      }
    });

    node.kind = kind || "CommonJS";
    return this.finishNode(node, "DeclareModule");
  }

  flowParseDeclareExportDeclaration(node, insideModule) {
    this.expect(types._export);

    if (this.eat(types._default)) {
      if (this.match(types._function) || this.match(types._class)) {
        // declare export default class ...
        // declare export default function ...
        node.declaration = this.flowParseDeclare(this.startNode());
      } else {
        // declare export default [type];
        node.declaration = this.flowParseType();
        this.semicolon();
      }
      node.default = true;

      return this.finishNode(node, "DeclareExportDeclaration");
    } else {
      if (this.match(types._const) || this.match(types._let) || (this.isContextual("type") || this.isContextual("interface")) && !insideModule) {
        const label = this.state.value;
        const suggestion = exportSuggestions[label];
        this.unexpected(this.state.start, `\`declare export ${label}\` is not supported. Use \`${suggestion}\` instead`);
      }

      if (this.match(types._var) || // declare export var ...
      this.match(types._function) || // declare export function ...
      this.match(types._class // declare export class ...
      )) {
        node.declaration = this.flowParseDeclare(this.startNode());
        node.default = false;

        return this.finishNode(node, "DeclareExportDeclaration");
      } else if (this.match(types.star) || // declare export * from ''
      this.match(types.braceL) || // declare export {} ...
      this.isContextual("interface") || // declare export interface ...
      this.isContextual("type" // declare export type ...
      )) {
        node = this.parseExport(node);
        if (node.type === "ExportNamedDeclaration") {
          // flow does not support the ExportNamedDeclaration
          // $FlowIgnore
          node.type = "ExportDeclaration";
          // $FlowFixMe
          node.default = false;
          delete node.exportKind;
        }

        // $FlowIgnore
        node.type = "Declare" + node.type;

        return node;
      }
    }

    throw this.unexpected();
  }

  flowParseDeclareModuleExports(node) {
    this.expectContextual("module");
    this.expect(types.dot);
    this.expectContextual("exports");
    node.typeAnnotation = this.flowParseTypeAnnotation();
    this.semicolon();

    return this.finishNode(node, "DeclareModuleExports");
  }

  flowParseDeclareTypeAlias(node) {
    this.next();
    this.flowParseTypeAlias(node);
    return this.finishNode(node, "DeclareTypeAlias");
  }

  flowParseDeclareInterface(node) {
    this.next();
    this.flowParseInterfaceish(node);
    return this.finishNode(node, "DeclareInterface");
  }

  // Interfaces

  flowParseInterfaceish(node) {
    node.id = this.parseIdentifier();

    if (this.isRelational("<")) {
      node.typeParameters = this.flowParseTypeParameterDeclaration();
    } else {
      node.typeParameters = null;
    }

    node.extends = [];
    node.mixins = [];

    if (this.eat(types._extends)) {
      do {
        node.extends.push(this.flowParseInterfaceExtends());
      } while (this.eat(types.comma));
    }

    if (this.isContextual("mixins")) {
      this.next();
      do {
        node.mixins.push(this.flowParseInterfaceExtends());
      } while (this.eat(types.comma));
    }

    node.body = this.flowParseObjectType(true, false, false);
  }

  flowParseInterfaceExtends() {
    const node = this.startNode();

    node.id = this.flowParseQualifiedTypeIdentifier();
    if (this.isRelational("<")) {
      node.typeParameters = this.flowParseTypeParameterInstantiation();
    } else {
      node.typeParameters = null;
    }

    return this.finishNode(node, "InterfaceExtends");
  }

  flowParseInterface(node) {
    this.flowParseInterfaceish(node);
    return this.finishNode(node, "InterfaceDeclaration");
  }

  flowParseRestrictedIdentifier(liberal) {
    if (primitiveTypes.indexOf(this.state.value) > -1) {
      this.raise(this.state.start, `Cannot overwrite primitive type ${this.state.value}`);
    }

    return this.parseIdentifier(liberal);
  }

  // Type aliases

  flowParseTypeAlias(node) {
    node.id = this.flowParseRestrictedIdentifier();

    if (this.isRelational("<")) {
      node.typeParameters = this.flowParseTypeParameterDeclaration();
    } else {
      node.typeParameters = null;
    }

    node.right = this.flowParseTypeInitialiser(types.eq);
    this.semicolon();

    return this.finishNode(node, "TypeAlias");
  }

  // Type annotations

  flowParseTypeParameter() {
    const node = this.startNode();

    const variance = this.flowParseVariance();

    const ident = this.flowParseTypeAnnotatableIdentifier();
    node.name = ident.name;
    node.variance = variance;
    node.bound = ident.typeAnnotation;

    if (this.match(types.eq)) {
      this.eat(types.eq);
      node.default = this.flowParseType();
    }

    return this.finishNode(node, "TypeParameter");
  }

  flowParseTypeParameterDeclaration() {
    const oldInType = this.state.inType;
    const node = this.startNode();
    node.params = [];

    this.state.inType = true;

    // istanbul ignore else: this condition is already checked at all call sites
    if (this.isRelational("<") || this.match(types.jsxTagStart)) {
      this.next();
    } else {
      this.unexpected();
    }

    do {
      node.params.push(this.flowParseTypeParameter());
      if (!this.isRelational(">")) {
        this.expect(types.comma);
      }
    } while (!this.isRelational(">"));
    this.expectRelational(">");

    this.state.inType = oldInType;

    return this.finishNode(node, "TypeParameterDeclaration");
  }

  flowParseTypeParameterInstantiation() {
    const node = this.startNode();
    const oldInType = this.state.inType;
    node.params = [];

    this.state.inType = true;

    this.expectRelational("<");
    while (!this.isRelational(">")) {
      node.params.push(this.flowParseType());
      if (!this.isRelational(">")) {
        this.expect(types.comma);
      }
    }
    this.expectRelational(">");

    this.state.inType = oldInType;

    return this.finishNode(node, "TypeParameterInstantiation");
  }

  flowParseObjectPropertyKey() {
    return this.match(types.num) || this.match(types.string) ? this.parseExprAtom() : this.parseIdentifier(true);
  }

  flowParseObjectTypeIndexer(node, isStatic, variance) {
    node.static = isStatic;

    this.expect(types.bracketL);
    if (this.lookahead().type === types.colon) {
      node.id = this.flowParseObjectPropertyKey();
      node.key = this.flowParseTypeInitialiser();
    } else {
      node.id = null;
      node.key = this.flowParseType();
    }
    this.expect(types.bracketR);
    node.value = this.flowParseTypeInitialiser();
    node.variance = variance;

    return this.finishNode(node, "ObjectTypeIndexer");
  }

  flowParseObjectTypeMethodish(node) {
    node.params = [];
    node.rest = null;
    node.typeParameters = null;

    if (this.isRelational("<")) {
      node.typeParameters = this.flowParseTypeParameterDeclaration();
    }

    this.expect(types.parenL);
    while (!this.match(types.parenR) && !this.match(types.ellipsis)) {
      node.params.push(this.flowParseFunctionTypeParam());
      if (!this.match(types.parenR)) {
        this.expect(types.comma);
      }
    }

    if (this.eat(types.ellipsis)) {
      node.rest = this.flowParseFunctionTypeParam();
    }
    this.expect(types.parenR);
    node.returnType = this.flowParseTypeInitialiser();

    return this.finishNode(node, "FunctionTypeAnnotation");
  }

  flowParseObjectTypeCallProperty(node, isStatic) {
    const valueNode = this.startNode();
    node.static = isStatic;
    node.value = this.flowParseObjectTypeMethodish(valueNode);
    return this.finishNode(node, "ObjectTypeCallProperty");
  }

  flowParseObjectType(allowStatic, allowExact, allowSpread) {
    const oldInType = this.state.inType;
    this.state.inType = true;

    const nodeStart = this.startNode();

    nodeStart.callProperties = [];
    nodeStart.properties = [];
    nodeStart.indexers = [];

    let endDelim;
    let exact;
    if (allowExact && this.match(types.braceBarL)) {
      this.expect(types.braceBarL);
      endDelim = types.braceBarR;
      exact = true;
    } else {
      this.expect(types.braceL);
      endDelim = types.braceR;
      exact = false;
    }

    nodeStart.exact = exact;

    while (!this.match(endDelim)) {
      let isStatic = false;
      const node = this.startNode();
      if (allowStatic && this.isContextual("static") && this.lookahead().type !== types.colon) {
        this.next();
        isStatic = true;
      }

      const variance = this.flowParseVariance();

      if (this.match(types.bracketL)) {
        nodeStart.indexers.push(this.flowParseObjectTypeIndexer(node, isStatic, variance));
      } else if (this.match(types.parenL) || this.isRelational("<")) {
        if (variance) {
          this.unexpected(variance.start);
        }
        nodeStart.callProperties.push(this.flowParseObjectTypeCallProperty(node, isStatic));
      } else {
        let kind = "init";

        if (this.isContextual("get") || this.isContextual("set")) {
          const lookahead = this.lookahead();
          if (lookahead.type === types.name || lookahead.type === types.string || lookahead.type === types.num) {
            kind = this.state.value;
            this.next();
          }
        }

        nodeStart.properties.push(this.flowParseObjectTypeProperty(node, isStatic, variance, kind, allowSpread));
      }

      this.flowObjectTypeSemicolon();
    }

    this.expect(endDelim);

    const out = this.finishNode(nodeStart, "ObjectTypeAnnotation");

    this.state.inType = oldInType;

    return out;
  }

  flowParseObjectTypeProperty(node, isStatic, variance, kind, allowSpread) {
    if (this.match(types.ellipsis)) {
      if (!allowSpread) {
        this.unexpected(null, "Spread operator cannot appear in class or interface definitions");
      }
      if (variance) {
        this.unexpected(variance.start, "Spread properties cannot have variance");
      }
      this.expect(types.ellipsis);
      node.argument = this.flowParseType();

      return this.finishNode(node, "ObjectTypeSpreadProperty");
    } else {
      node.key = this.flowParseObjectPropertyKey();
      node.static = isStatic;
      node.kind = kind;

      let optional = false;
      if (this.isRelational("<") || this.match(types.parenL)) {
        // This is a method property
        if (variance) {
          this.unexpected(variance.start);
        }

        node.value = this.flowParseObjectTypeMethodish(this.startNodeAt(node.start, node.loc.start));
        if (kind === "get" || kind === "set") this.flowCheckGetterSetterParamCount(node);
      } else {
        if (kind !== "init") this.unexpected();
        if (this.eat(types.question)) {
          optional = true;
        }
        node.value = this.flowParseTypeInitialiser();
        node.variance = variance;
      }

      node.optional = optional;

      return this.finishNode(node, "ObjectTypeProperty");
    }
  }

  // This is similar to checkGetterSetterParamCount, but as
  // babylon uses non estree properties we cannot reuse it here
  flowCheckGetterSetterParamCount(property) {
    const paramCount = property.kind === "get" ? 0 : 1;
    if (property.value.params.length !== paramCount) {
      const start = property.start;
      if (property.kind === "get") {
        this.raise(start, "getter should have no params");
      } else {
        this.raise(start, "setter should have exactly one param");
      }
    }
  }

  flowObjectTypeSemicolon() {
    if (!this.eat(types.semi) && !this.eat(types.comma) && !this.match(types.braceR) && !this.match(types.braceBarR)) {
      this.unexpected();
    }
  }

  flowParseQualifiedTypeIdentifier(startPos, startLoc, id) {
    startPos = startPos || this.state.start;
    startLoc = startLoc || this.state.startLoc;
    let node = id || this.parseIdentifier();

    while (this.eat(types.dot)) {
      const node2 = this.startNodeAt(startPos, startLoc);
      node2.qualification = node;
      node2.id = this.parseIdentifier();
      node = this.finishNode(node2, "QualifiedTypeIdentifier");
    }

    return node;
  }

  flowParseGenericType(startPos, startLoc, id) {
    const node = this.startNodeAt(startPos, startLoc);

    node.typeParameters = null;
    node.id = this.flowParseQualifiedTypeIdentifier(startPos, startLoc, id);

    if (this.isRelational("<")) {
      node.typeParameters = this.flowParseTypeParameterInstantiation();
    }

    return this.finishNode(node, "GenericTypeAnnotation");
  }

  flowParseTypeofType() {
    const node = this.startNode();
    this.expect(types._typeof);
    node.argument = this.flowParsePrimaryType();
    return this.finishNode(node, "TypeofTypeAnnotation");
  }

  flowParseTupleType() {
    const node = this.startNode();
    node.types = [];
    this.expect(types.bracketL);
    // We allow trailing commas
    while (this.state.pos < this.input.length && !this.match(types.bracketR)) {
      node.types.push(this.flowParseType());
      if (this.match(types.bracketR)) break;
      this.expect(types.comma);
    }
    this.expect(types.bracketR);
    return this.finishNode(node, "TupleTypeAnnotation");
  }

  flowParseFunctionTypeParam() {
    let name = null;
    let optional = false;
    let typeAnnotation = null;
    const node = this.startNode();
    const lh = this.lookahead();
    if (lh.type === types.colon || lh.type === types.question) {
      name = this.parseIdentifier();
      if (this.eat(types.question)) {
        optional = true;
      }
      typeAnnotation = this.flowParseTypeInitialiser();
    } else {
      typeAnnotation = this.flowParseType();
    }
    node.name = name;
    node.optional = optional;
    node.typeAnnotation = typeAnnotation;
    return this.finishNode(node, "FunctionTypeParam");
  }

  reinterpretTypeAsFunctionTypeParam(type) {
    const node = this.startNodeAt(type.start, type.loc.start);
    node.name = null;
    node.optional = false;
    node.typeAnnotation = type;
    return this.finishNode(node, "FunctionTypeParam");
  }

  flowParseFunctionTypeParams(params = []) {
    let rest = null;
    while (!this.match(types.parenR) && !this.match(types.ellipsis)) {
      params.push(this.flowParseFunctionTypeParam());
      if (!this.match(types.parenR)) {
        this.expect(types.comma);
      }
    }
    if (this.eat(types.ellipsis)) {
      rest = this.flowParseFunctionTypeParam();
    }
    return { params, rest };
  }

  flowIdentToTypeAnnotation(startPos, startLoc, node, id) {
    switch (id.name) {
      case "any":
        return this.finishNode(node, "AnyTypeAnnotation");

      case "void":
        return this.finishNode(node, "VoidTypeAnnotation");

      case "bool":
      case "boolean":
        return this.finishNode(node, "BooleanTypeAnnotation");

      case "mixed":
        return this.finishNode(node, "MixedTypeAnnotation");

      case "empty":
        return this.finishNode(node, "EmptyTypeAnnotation");

      case "number":
        return this.finishNode(node, "NumberTypeAnnotation");

      case "string":
        return this.finishNode(node, "StringTypeAnnotation");

      default:
        return this.flowParseGenericType(startPos, startLoc, id);
    }
  }

  // The parsing of types roughly parallels the parsing of expressions, and
  // primary types are kind of like primary expressions...they're the
  // primitives with which other types are constructed.
  flowParsePrimaryType() {
    const startPos = this.state.start;
    const startLoc = this.state.startLoc;
    const node = this.startNode();
    let tmp;
    let type;
    let isGroupedType = false;
    const oldNoAnonFunctionType = this.state.noAnonFunctionType;

    switch (this.state.type) {
      case types.name:
        return this.flowIdentToTypeAnnotation(startPos, startLoc, node, this.parseIdentifier());

      case types.braceL:
        return this.flowParseObjectType(false, false, true);

      case types.braceBarL:
        return this.flowParseObjectType(false, true, true);

      case types.bracketL:
        return this.flowParseTupleType();

      case types.relational:
        if (this.state.value === "<") {
          node.typeParameters = this.flowParseTypeParameterDeclaration();
          this.expect(types.parenL);
          tmp = this.flowParseFunctionTypeParams();
          node.params = tmp.params;
          node.rest = tmp.rest;
          this.expect(types.parenR);

          this.expect(types.arrow);

          node.returnType = this.flowParseType();

          return this.finishNode(node, "FunctionTypeAnnotation");
        }
        break;

      case types.parenL:
        this.next();

        // Check to see if this is actually a grouped type
        if (!this.match(types.parenR) && !this.match(types.ellipsis)) {
          if (this.match(types.name)) {
            const token = this.lookahead().type;
            isGroupedType = token !== types.question && token !== types.colon;
          } else {
            isGroupedType = true;
          }
        }

        if (isGroupedType) {
          this.state.noAnonFunctionType = false;
          type = this.flowParseType();
          this.state.noAnonFunctionType = oldNoAnonFunctionType;

          // A `,` or a `) =>` means this is an anonymous function type
          if (this.state.noAnonFunctionType || !(this.match(types.comma) || this.match(types.parenR) && this.lookahead().type === types.arrow)) {
            this.expect(types.parenR);
            return type;
          } else {
            // Eat a comma if there is one
            this.eat(types.comma);
          }
        }

        if (type) {
          tmp = this.flowParseFunctionTypeParams([this.reinterpretTypeAsFunctionTypeParam(type)]);
        } else {
          tmp = this.flowParseFunctionTypeParams();
        }

        node.params = tmp.params;
        node.rest = tmp.rest;

        this.expect(types.parenR);

        this.expect(types.arrow);

        node.returnType = this.flowParseType();

        node.typeParameters = null;

        return this.finishNode(node, "FunctionTypeAnnotation");

      case types.string:
        return this.parseLiteral(this.state.value, "StringLiteralTypeAnnotation");

      case types._true:
      case types._false:
        node.value = this.match(types._true);
        this.next();
        return this.finishNode(node, "BooleanLiteralTypeAnnotation");

      case types.plusMin:
        if (this.state.value === "-") {
          this.next();
          if (!this.match(types.num)) this.unexpected(null, "Unexpected token, expected number");

          return this.parseLiteral(-this.state.value, "NumberLiteralTypeAnnotation", node.start, node.loc.start);
        }

        this.unexpected();
      case types.num:
        return this.parseLiteral(this.state.value, "NumberLiteralTypeAnnotation");

      case types._null:
        node.value = this.match(types._null);
        this.next();
        return this.finishNode(node, "NullLiteralTypeAnnotation");

      case types._this:
        node.value = this.match(types._this);
        this.next();
        return this.finishNode(node, "ThisTypeAnnotation");

      case types.star:
        this.next();
        return this.finishNode(node, "ExistsTypeAnnotation");

      default:
        if (this.state.type.keyword === "typeof") {
          return this.flowParseTypeofType();
        }
    }

    throw this.unexpected();
  }

  flowParsePostfixType() {
    const startPos = this.state.start,
          startLoc = this.state.startLoc;
    let type = this.flowParsePrimaryType();
    while (!this.canInsertSemicolon() && this.match(types.bracketL)) {
      const node = this.startNodeAt(startPos, startLoc);
      node.elementType = type;
      this.expect(types.bracketL);
      this.expect(types.bracketR);
      type = this.finishNode(node, "ArrayTypeAnnotation");
    }
    return type;
  }

  flowParsePrefixType() {
    const node = this.startNode();
    if (this.eat(types.question)) {
      node.typeAnnotation = this.flowParsePrefixType();
      return this.finishNode(node, "NullableTypeAnnotation");
    } else {
      return this.flowParsePostfixType();
    }
  }

  flowParseAnonFunctionWithoutParens() {
    const param = this.flowParsePrefixType();
    if (!this.state.noAnonFunctionType && this.eat(types.arrow)) {
      // TODO: This should be a type error. Passing in a SourceLocation, and it expects a Position.
      const node = this.startNodeAt(param.start, param.loc.start);
      node.params = [this.reinterpretTypeAsFunctionTypeParam(param)];
      node.rest = null;
      node.returnType = this.flowParseType();
      node.typeParameters = null;
      return this.finishNode(node, "FunctionTypeAnnotation");
    }
    return param;
  }

  flowParseIntersectionType() {
    const node = this.startNode();
    this.eat(types.bitwiseAND);
    const type = this.flowParseAnonFunctionWithoutParens();
    node.types = [type];
    while (this.eat(types.bitwiseAND)) {
      node.types.push(this.flowParseAnonFunctionWithoutParens());
    }
    return node.types.length === 1 ? type : this.finishNode(node, "IntersectionTypeAnnotation");
  }

  flowParseUnionType() {
    const node = this.startNode();
    this.eat(types.bitwiseOR);
    const type = this.flowParseIntersectionType();
    node.types = [type];
    while (this.eat(types.bitwiseOR)) {
      node.types.push(this.flowParseIntersectionType());
    }
    return node.types.length === 1 ? type : this.finishNode(node, "UnionTypeAnnotation");
  }

  flowParseType() {
    const oldInType = this.state.inType;
    this.state.inType = true;
    const type = this.flowParseUnionType();
    this.state.inType = oldInType;
    // noAnonFunctionType is true when parsing an arrow function
    this.state.exprAllowed = this.state.noAnonFunctionType;
    return type;
  }

  flowParseTypeAnnotation() {
    const node = this.startNode();
    node.typeAnnotation = this.flowParseTypeInitialiser();
    return this.finishNode(node, "TypeAnnotation");
  }

  flowParseTypeAnnotatableIdentifier() {
    const ident = this.flowParseRestrictedIdentifier();
    if (this.match(types.colon)) {
      ident.typeAnnotation = this.flowParseTypeAnnotation();
      this.finishNode(ident, ident.type);
    }
    return ident;
  }

  typeCastToParameter(node) {
    node.expression.typeAnnotation = node.typeAnnotation;

    return this.finishNodeAt(node.expression, node.expression.type, node.typeAnnotation.end, node.typeAnnotation.loc.end);
  }

  flowParseVariance() {
    let variance = null;
    if (this.match(types.plusMin)) {
      variance = this.startNode();
      if (this.state.value === "+") {
        variance.kind = "plus";
      } else {
        variance.kind = "minus";
      }
      this.next();
      this.finishNode(variance, "Variance");
    }
    return variance;
  }

  // ==================================
  // Overrides
  // ==================================

  parseFunctionBodyAndFinish(node, type, allowExpressionBody) {
    // For arrow functions, `parseArrow` handles the return type itself.
    if (!allowExpressionBody && this.match(types.colon)) {
      const typeNode = this.startNode();

      [
      // $FlowFixMe (destructuring not supported yet)
      typeNode.typeAnnotation,
      // $FlowFixMe (destructuring not supported yet)
      node.predicate] = this.flowParseTypeAndPredicateInitialiser();

      node.returnType = typeNode.typeAnnotation ? this.finishNode(typeNode, "TypeAnnotation") : null;
    }

    super.parseFunctionBodyAndFinish(node, type, allowExpressionBody);
  }

  // interfaces
  parseStatement(declaration, topLevel) {
    // strict mode handling of `interface` since it's a reserved word
    if (this.state.strict && this.match(types.name) && this.state.value === "interface") {
      const node = this.startNode();
      this.next();
      return this.flowParseInterface(node);
    } else {
      return super.parseStatement(declaration, topLevel);
    }
  }

  // declares, interfaces and type aliases
  parseExpressionStatement(node, expr) {
    if (expr.type === "Identifier") {
      if (expr.name === "declare") {
        if (this.match(types._class) || this.match(types.name) || this.match(types._function) || this.match(types._var) || this.match(types._export)) {
          return this.flowParseDeclare(node);
        }
      } else if (this.match(types.name)) {
        if (expr.name === "interface") {
          return this.flowParseInterface(node);
        } else if (expr.name === "type") {
          return this.flowParseTypeAlias(node);
        }
      }
    }

    return super.parseExpressionStatement(node, expr);
  }

  // export type
  shouldParseExportDeclaration() {
    return this.isContextual("type") || this.isContextual("interface") || super.shouldParseExportDeclaration();
  }

  isExportDefaultSpecifier() {
    if (this.match(types.name) && (this.state.value === "type" || this.state.value === "interface")) {
      return false;
    }

    return super.isExportDefaultSpecifier();
  }

  parseConditional(expr, noIn, startPos, startLoc, refNeedsArrowPos) {
    // only do the expensive clone if there is a question mark
    // and if we come from inside parens
    if (refNeedsArrowPos && this.match(types.question)) {
      const state = this.state.clone();
      try {
        return super.parseConditional(expr, noIn, startPos, startLoc);
      } catch (err) {
        if (err instanceof SyntaxError) {
          this.state = state;
          refNeedsArrowPos.start = err.pos || this.state.start;
          return expr;
        } else {
          // istanbul ignore next: no such error is expected
          throw err;
        }
      }
    }

    return super.parseConditional(expr, noIn, startPos, startLoc);
  }

  parseParenItem(node, startPos, startLoc) {
    node = super.parseParenItem(node, startPos, startLoc);
    if (this.eat(types.question)) {
      node.optional = true;
    }

    if (this.match(types.colon)) {
      const typeCastNode = this.startNodeAt(startPos, startLoc);
      typeCastNode.expression = node;
      typeCastNode.typeAnnotation = this.flowParseTypeAnnotation();

      return this.finishNode(typeCastNode, "TypeCastExpression");
    }

    return node;
  }

  parseExport(node) {
    node = super.parseExport(node);
    if (node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") {
      node.exportKind = node.exportKind || "value";
    }
    return node;
  }

  parseExportDeclaration(node) {
    if (this.isContextual("type")) {
      node.exportKind = "type";

      const declarationNode = this.startNode();
      this.next();

      if (this.match(types.braceL)) {
        // export type { foo, bar };
        node.specifiers = this.parseExportSpecifiers();
        this.parseExportFrom(node);
        return null;
      } else {
        // export type Foo = Bar;
        return this.flowParseTypeAlias(declarationNode);
      }
    } else if (this.isContextual("interface")) {
      node.exportKind = "type";
      const declarationNode = this.startNode();
      this.next();
      return this.flowParseInterface(declarationNode);
    } else {
      return super.parseExportDeclaration(node);
    }
  }

  shouldParseExportStar() {
    return super.shouldParseExportStar() || this.isContextual("type") && this.lookahead().type === types.star;
  }

  parseExportStar(node, allowNamed) {
    if (this.eatContextual("type")) {
      node.exportKind = "type";
      allowNamed = false;
    }

    return super.parseExportStar(node, allowNamed);
  }

  parseClassId(node, isStatement, optionalId) {
    super.parseClassId(node, isStatement, optionalId);
    if (this.isRelational("<")) {
      node.typeParameters = this.flowParseTypeParameterDeclaration();
    }
  }

  // don't consider `void` to be a keyword as then it'll use the void token type
  // and set startExpr
  isKeyword(name) {
    if (this.state.inType && name === "void") {
      return false;
    } else {
      return super.isKeyword(name);
    }
  }

  // ensure that inside flow types, we bypass the jsx parser plugin
  readToken(code) {
    if (this.state.inType && (code === 62 || code === 60)) {
      return this.finishOp(types.relational, 1);
    } else {
      return super.readToken(code);
    }
  }

  toAssignable(node, isBinding, contextDescription) {
    if (node.type === "TypeCastExpression") {
      return super.toAssignable(this.typeCastToParameter(node), isBinding, contextDescription);
    } else {
      return super.toAssignable(node, isBinding, contextDescription);
    }
  }

  // turn type casts that we found in function parameter head into type annotated params
  toAssignableList(exprList, isBinding, contextDescription) {
    for (let i = 0; i < exprList.length; i++) {
      const expr = exprList[i];
      if (expr && expr.type === "TypeCastExpression") {
        exprList[i] = this.typeCastToParameter(expr);
      }
    }
    return super.toAssignableList(exprList, isBinding, contextDescription);
  }

  // this is a list of nodes, from something like a call expression, we need to filter the
  // type casts that we've found that are illegal in this context
  toReferencedList(exprList) {
    for (let i = 0; i < exprList.length; i++) {
      const expr = exprList[i];
      if (expr && expr._exprListItem && expr.type === "TypeCastExpression") {
        this.raise(expr.start, "Unexpected type cast");
      }
    }

    return exprList;
  }

  // parse an item inside a expression list eg. `(NODE, NODE)` where NODE represents
  // the position where this function is called
  parseExprListItem(allowEmpty, refShorthandDefaultPos, refNeedsArrowPos) {
    const container = this.startNode();
    const node = super.parseExprListItem(allowEmpty, refShorthandDefaultPos, refNeedsArrowPos);
    if (this.match(types.colon)) {
      container._exprListItem = true;
      container.expression = node;
      container.typeAnnotation = this.flowParseTypeAnnotation();
      return this.finishNode(container, "TypeCastExpression");
    } else {
      return node;
    }
  }

  checkLVal(expr, isBinding, checkClashes, contextDescription) {
    if (expr.type !== "TypeCastExpression") {
      return super.checkLVal(expr, isBinding, checkClashes, contextDescription);
    }
  }

  // parse class property type annotations
  parseClassProperty(node) {
    if (this.match(types.colon)) {
      node.typeAnnotation = this.flowParseTypeAnnotation();
    }
    return super.parseClassProperty(node);
  }

  // determine whether or not we're currently in the position where a class method would appear
  isClassMethod() {
    return this.isRelational("<") || super.isClassMethod();
  }

  // determine whether or not we're currently in the position where a class property would appear
  isClassProperty() {
    return this.match(types.colon) || super.isClassProperty();
  }

  isNonstaticConstructor(method) {
    return !this.match(types.colon) && super.isNonstaticConstructor(method);
  }

  // parse type parameters for class methods
  parseClassMethod(classBody, method, isGenerator, isAsync, isConstructor) {
    if (method.variance) {
      this.unexpected(method.variance.start);
    }
    delete method.variance;
    if (this.isRelational("<")) {
      method.typeParameters = this.flowParseTypeParameterDeclaration();
    }

    super.parseClassMethod(classBody, method, isGenerator, isAsync, isConstructor);
  }

  // parse a the super class type parameters and implements
  parseClassSuper(node) {
    super.parseClassSuper(node);
    if (node.superClass && this.isRelational("<")) {
      node.superTypeParameters = this.flowParseTypeParameterInstantiation();
    }
    if (this.isContextual("implements")) {
      this.next();
      const implemented = node.implements = [];
      do {
        const node = this.startNode();
        node.id = this.parseIdentifier();
        if (this.isRelational("<")) {
          node.typeParameters = this.flowParseTypeParameterInstantiation();
        } else {
          node.typeParameters = null;
        }
        implemented.push(this.finishNode(node, "ClassImplements"));
      } while (this.eat(types.comma));
    }
  }

  parsePropertyName(node) {
    const variance = this.flowParseVariance();
    const key = super.parsePropertyName(node);
    // $FlowIgnore ("variance" not defined on TsNamedTypeElementBase)
    node.variance = variance;
    return key;
  }

  // parse type parameters for object method shorthand
  parseObjPropValue(prop, startPos, startLoc, isGenerator, isAsync, isPattern, refShorthandDefaultPos) {
    if (prop.variance) {
      this.unexpected(prop.variance.start);
    }
    delete prop.variance;

    let typeParameters;

    // method shorthand
    if (this.isRelational("<")) {
      typeParameters = this.flowParseTypeParameterDeclaration();
      if (!this.match(types.parenL)) this.unexpected();
    }

    super.parseObjPropValue(prop, startPos, startLoc, isGenerator, isAsync, isPattern, refShorthandDefaultPos);

    // add typeParameters if we found them
    if (typeParameters) {
      // $FlowFixMe (trying to set '.typeParameters' on an expression)
      (prop.value || prop).typeParameters = typeParameters;
    }
  }

  parseAssignableListItemTypes(param) {
    if (this.eat(types.question)) {
      if (param.type !== "Identifier") {
        throw this.raise(param.start, "A binding pattern parameter cannot be optional in an implementation signature.");
      }

      param.optional = true;
    }
    if (this.match(types.colon)) {
      param.typeAnnotation = this.flowParseTypeAnnotation();
    }
    this.finishNode(param, param.type);
    return param;
  }

  parseMaybeDefault(startPos, startLoc, left) {
    const node = super.parseMaybeDefault(startPos, startLoc, left);

    if (node.type === "AssignmentPattern" && node.typeAnnotation && node.right.start < node.typeAnnotation.start) {
      this.raise(node.typeAnnotation.start, "Type annotations must come before default assignments, e.g. instead of `age = 25: number` use `age: number = 25`");
    }

    return node;
  }

  // parse typeof and type imports
  parseImportSpecifiers(node) {
    node.importKind = "value";

    let kind = null;
    if (this.match(types._typeof)) {
      kind = "typeof";
    } else if (this.isContextual("type")) {
      kind = "type";
    }
    if (kind) {
      const lh = this.lookahead();
      if (lh.type === types.name && lh.value !== "from" || lh.type === types.braceL || lh.type === types.star) {
        this.next();
        node.importKind = kind;
      }
    }

    super.parseImportSpecifiers(node);
  }

  // parse import-type/typeof shorthand
  parseImportSpecifier(node) {
    const specifier = this.startNode();
    const firstIdentLoc = this.state.start;
    const firstIdent = this.parseIdentifier(true);

    let specifierTypeKind = null;
    if (firstIdent.name === "type") {
      specifierTypeKind = "type";
    } else if (firstIdent.name === "typeof") {
      specifierTypeKind = "typeof";
    }

    let isBinding = false;
    if (this.isContextual("as")) {
      const as_ident = this.parseIdentifier(true);
      if (specifierTypeKind !== null && !this.match(types.name) && !this.state.type.keyword) {
        // `import {type as ,` or `import {type as }`
        specifier.imported = as_ident;
        specifier.importKind = specifierTypeKind;
        specifier.local = as_ident.__clone();
      } else {
        // `import {type as foo`
        specifier.imported = firstIdent;
        specifier.importKind = null;
        specifier.local = this.parseIdentifier();
      }
    } else if (specifierTypeKind !== null && (this.match(types.name) || this.state.type.keyword)) {
      // `import {type foo`
      specifier.imported = this.parseIdentifier(true);
      specifier.importKind = specifierTypeKind;
      if (this.eatContextual("as")) {
        specifier.local = this.parseIdentifier();
      } else {
        isBinding = true;
        specifier.local = specifier.imported.__clone();
      }
    } else {
      isBinding = true;
      specifier.imported = firstIdent;
      specifier.importKind = null;
      specifier.local = specifier.imported.__clone();
    }

    if ((node.importKind === "type" || node.importKind === "typeof") && (specifier.importKind === "type" || specifier.importKind === "typeof")) {
      this.raise(firstIdentLoc, "`The `type` and `typeof` keywords on named imports can only be used on regular `import` statements. It cannot be used with `import type` or `import typeof` statements`");
    }

    if (isBinding) this.checkReservedWord(specifier.local.name, specifier.start, true, true);

    this.checkLVal(specifier.local, true, undefined, "import specifier");
    node.specifiers.push(this.finishNode(specifier, "ImportSpecifier"));
  }

  // parse function type parameters - function foo<T>() {}
  parseFunctionParams(node) {
    if (this.isRelational("<")) {
      node.typeParameters = this.flowParseTypeParameterDeclaration();
    }
    super.parseFunctionParams(node);
  }

  // parse flow type annotations on variable declarator heads - let foo: string = bar
  parseVarHead(decl) {
    super.parseVarHead(decl);
    if (this.match(types.colon)) {
      decl.id.typeAnnotation = this.flowParseTypeAnnotation();
      this.finishNode(decl.id, decl.id.type);
    }
  }

  // parse the return type of an async arrow function - let foo = (async (): number => {});
  parseAsyncArrowFromCallExpression(node, call) {
    if (this.match(types.colon)) {
      const oldNoAnonFunctionType = this.state.noAnonFunctionType;
      this.state.noAnonFunctionType = true;
      node.returnType = this.flowParseTypeAnnotation();
      this.state.noAnonFunctionType = oldNoAnonFunctionType;
    }

    return super.parseAsyncArrowFromCallExpression(node, call);
  }

  // todo description
  shouldParseAsyncArrow() {
    return this.match(types.colon) || super.shouldParseAsyncArrow();
  }

  // We need to support type parameter declarations for arrow functions. This
  // is tricky. There are three situations we need to handle
  //
  // 1. This is either JSX or an arrow function. We'll try JSX first. If that
  //    fails, we'll try an arrow function. If that fails, we'll throw the JSX
  //    error.
  // 2. This is an arrow function. We'll parse the type parameter declaration,
  //    parse the rest, make sure the rest is an arrow function, and go from
  //    there
  // 3. This is neither. Just call the super method
  parseMaybeAssign(noIn, refShorthandDefaultPos, afterLeftParse, refNeedsArrowPos) {
    let jsxError = null;
    if (types.jsxTagStart && this.match(types.jsxTagStart)) {
      const state = this.state.clone();
      try {
        return super.parseMaybeAssign(noIn, refShorthandDefaultPos, afterLeftParse, refNeedsArrowPos);
      } catch (err) {
        if (err instanceof SyntaxError) {
          this.state = state;

          // Remove `tc.j_expr` and `tc.j_oTag` from context added
          // by parsing `jsxTagStart` to stop the JSX plugin from
          // messing with the tokens
          this.state.context.length -= 2;

          jsxError = err;
        } else {
          // istanbul ignore next: no such error is expected
          throw err;
        }
      }
    }

    if (jsxError != null || this.isRelational("<")) {
      let arrowExpression;
      let typeParameters;
      try {
        typeParameters = this.flowParseTypeParameterDeclaration();

        arrowExpression = super.parseMaybeAssign(noIn, refShorthandDefaultPos, afterLeftParse, refNeedsArrowPos);
        arrowExpression.typeParameters = typeParameters;
        this.resetStartLocationFromNode(arrowExpression, typeParameters);
      } catch (err) {
        throw jsxError || err;
      }

      if (arrowExpression.type === "ArrowFunctionExpression") {
        return arrowExpression;
      } else if (jsxError != null) {
        throw jsxError;
      } else {
        this.raise(typeParameters.start, "Expected an arrow function after this type parameter declaration");
      }
    }

    return super.parseMaybeAssign(noIn, refShorthandDefaultPos, afterLeftParse, refNeedsArrowPos);
  }

  // handle return types for arrow functions
  parseArrow(node) {
    if (this.match(types.colon)) {
      const state = this.state.clone();
      try {
        const oldNoAnonFunctionType = this.state.noAnonFunctionType;
        this.state.noAnonFunctionType = true;

        const typeNode = this.startNode();

        [
        // $FlowFixMe (destructuring not supported yet)
        typeNode.typeAnnotation,
        // $FlowFixMe (destructuring not supported yet)
        node.predicate] = this.flowParseTypeAndPredicateInitialiser();

        this.state.noAnonFunctionType = oldNoAnonFunctionType;

        if (this.canInsertSemicolon()) this.unexpected();
        if (!this.match(types.arrow)) this.unexpected();

        // assign after it is clear it is an arrow
        node.returnType = typeNode.typeAnnotation ? this.finishNode(typeNode, "TypeAnnotation") : null;
      } catch (err) {
        if (err instanceof SyntaxError) {
          this.state = state;
        } else {
          // istanbul ignore next: no such error is expected
          throw err;
        }
      }
    }

    return super.parseArrow(node);
  }

  shouldParseArrow() {
    return this.match(types.colon) || super.shouldParseArrow();
  }
});

const entities = {
  quot: "\u0022",
  amp: "&",
  apos: "\u0027",
  lt: "<",
  gt: ">",
  nbsp: "\u00A0",
  iexcl: "\u00A1",
  cent: "\u00A2",
  pound: "\u00A3",
  curren: "\u00A4",
  yen: "\u00A5",
  brvbar: "\u00A6",
  sect: "\u00A7",
  uml: "\u00A8",
  copy: "\u00A9",
  ordf: "\u00AA",
  laquo: "\u00AB",
  not: "\u00AC",
  shy: "\u00AD",
  reg: "\u00AE",
  macr: "\u00AF",
  deg: "\u00B0",
  plusmn: "\u00B1",
  sup2: "\u00B2",
  sup3: "\u00B3",
  acute: "\u00B4",
  micro: "\u00B5",
  para: "\u00B6",
  middot: "\u00B7",
  cedil: "\u00B8",
  sup1: "\u00B9",
  ordm: "\u00BA",
  raquo: "\u00BB",
  frac14: "\u00BC",
  frac12: "\u00BD",
  frac34: "\u00BE",
  iquest: "\u00BF",
  Agrave: "\u00C0",
  Aacute: "\u00C1",
  Acirc: "\u00C2",
  Atilde: "\u00C3",
  Auml: "\u00C4",
  Aring: "\u00C5",
  AElig: "\u00C6",
  Ccedil: "\u00C7",
  Egrave: "\u00C8",
  Eacute: "\u00C9",
  Ecirc: "\u00CA",
  Euml: "\u00CB",
  Igrave: "\u00CC",
  Iacute: "\u00CD",
  Icirc: "\u00CE",
  Iuml: "\u00CF",
  ETH: "\u00D0",
  Ntilde: "\u00D1",
  Ograve: "\u00D2",
  Oacute: "\u00D3",
  Ocirc: "\u00D4",
  Otilde: "\u00D5",
  Ouml: "\u00D6",
  times: "\u00D7",
  Oslash: "\u00D8",
  Ugrave: "\u00D9",
  Uacute: "\u00DA",
  Ucirc: "\u00DB",
  Uuml: "\u00DC",
  Yacute: "\u00DD",
  THORN: "\u00DE",
  szlig: "\u00DF",
  agrave: "\u00E0",
  aacute: "\u00E1",
  acirc: "\u00E2",
  atilde: "\u00E3",
  auml: "\u00E4",
  aring: "\u00E5",
  aelig: "\u00E6",
  ccedil: "\u00E7",
  egrave: "\u00E8",
  eacute: "\u00E9",
  ecirc: "\u00EA",
  euml: "\u00EB",
  igrave: "\u00EC",
  iacute: "\u00ED",
  icirc: "\u00EE",
  iuml: "\u00EF",
  eth: "\u00F0",
  ntilde: "\u00F1",
  ograve: "\u00F2",
  oacute: "\u00F3",
  ocirc: "\u00F4",
  otilde: "\u00F5",
  ouml: "\u00F6",
  divide: "\u00F7",
  oslash: "\u00F8",
  ugrave: "\u00F9",
  uacute: "\u00FA",
  ucirc: "\u00FB",
  uuml: "\u00FC",
  yacute: "\u00FD",
  thorn: "\u00FE",
  yuml: "\u00FF",
  OElig: "\u0152",
  oelig: "\u0153",
  Scaron: "\u0160",
  scaron: "\u0161",
  Yuml: "\u0178",
  fnof: "\u0192",
  circ: "\u02C6",
  tilde: "\u02DC",
  Alpha: "\u0391",
  Beta: "\u0392",
  Gamma: "\u0393",
  Delta: "\u0394",
  Epsilon: "\u0395",
  Zeta: "\u0396",
  Eta: "\u0397",
  Theta: "\u0398",
  Iota: "\u0399",
  Kappa: "\u039A",
  Lambda: "\u039B",
  Mu: "\u039C",
  Nu: "\u039D",
  Xi: "\u039E",
  Omicron: "\u039F",
  Pi: "\u03A0",
  Rho: "\u03A1",
  Sigma: "\u03A3",
  Tau: "\u03A4",
  Upsilon: "\u03A5",
  Phi: "\u03A6",
  Chi: "\u03A7",
  Psi: "\u03A8",
  Omega: "\u03A9",
  alpha: "\u03B1",
  beta: "\u03B2",
  gamma: "\u03B3",
  delta: "\u03B4",
  epsilon: "\u03B5",
  zeta: "\u03B6",
  eta: "\u03B7",
  theta: "\u03B8",
  iota: "\u03B9",
  kappa: "\u03BA",
  lambda: "\u03BB",
  mu: "\u03BC",
  nu: "\u03BD",
  xi: "\u03BE",
  omicron: "\u03BF",
  pi: "\u03C0",
  rho: "\u03C1",
  sigmaf: "\u03C2",
  sigma: "\u03C3",
  tau: "\u03C4",
  upsilon: "\u03C5",
  phi: "\u03C6",
  chi: "\u03C7",
  psi: "\u03C8",
  omega: "\u03C9",
  thetasym: "\u03D1",
  upsih: "\u03D2",
  piv: "\u03D6",
  ensp: "\u2002",
  emsp: "\u2003",
  thinsp: "\u2009",
  zwnj: "\u200C",
  zwj: "\u200D",
  lrm: "\u200E",
  rlm: "\u200F",
  ndash: "\u2013",
  mdash: "\u2014",
  lsquo: "\u2018",
  rsquo: "\u2019",
  sbquo: "\u201A",
  ldquo: "\u201C",
  rdquo: "\u201D",
  bdquo: "\u201E",
  dagger: "\u2020",
  Dagger: "\u2021",
  bull: "\u2022",
  hellip: "\u2026",
  permil: "\u2030",
  prime: "\u2032",
  Prime: "\u2033",
  lsaquo: "\u2039",
  rsaquo: "\u203A",
  oline: "\u203E",
  frasl: "\u2044",
  euro: "\u20AC",
  image: "\u2111",
  weierp: "\u2118",
  real: "\u211C",
  trade: "\u2122",
  alefsym: "\u2135",
  larr: "\u2190",
  uarr: "\u2191",
  rarr: "\u2192",
  darr: "\u2193",
  harr: "\u2194",
  crarr: "\u21B5",
  lArr: "\u21D0",
  uArr: "\u21D1",
  rArr: "\u21D2",
  dArr: "\u21D3",
  hArr: "\u21D4",
  forall: "\u2200",
  part: "\u2202",
  exist: "\u2203",
  empty: "\u2205",
  nabla: "\u2207",
  isin: "\u2208",
  notin: "\u2209",
  ni: "\u220B",
  prod: "\u220F",
  sum: "\u2211",
  minus: "\u2212",
  lowast: "\u2217",
  radic: "\u221A",
  prop: "\u221D",
  infin: "\u221E",
  ang: "\u2220",
  and: "\u2227",
  or: "\u2228",
  cap: "\u2229",
  cup: "\u222A",
  int: "\u222B",
  there4: "\u2234",
  sim: "\u223C",
  cong: "\u2245",
  asymp: "\u2248",
  ne: "\u2260",
  equiv: "\u2261",
  le: "\u2264",
  ge: "\u2265",
  sub: "\u2282",
  sup: "\u2283",
  nsub: "\u2284",
  sube: "\u2286",
  supe: "\u2287",
  oplus: "\u2295",
  otimes: "\u2297",
  perp: "\u22A5",
  sdot: "\u22C5",
  lceil: "\u2308",
  rceil: "\u2309",
  lfloor: "\u230A",
  rfloor: "\u230B",
  lang: "\u2329",
  rang: "\u232A",
  loz: "\u25CA",
  spades: "\u2660",
  clubs: "\u2663",
  hearts: "\u2665",
  diams: "\u2666"
};

const HEX_NUMBER = /^[\da-fA-F]+$/;
const DECIMAL_NUMBER = /^\d+$/;

types$1.j_oTag = new TokContext("<tag", false);
types$1.j_cTag = new TokContext("</tag", false);
types$1.j_expr = new TokContext("<tag>...</tag>", true, true);

types.jsxName = new TokenType("jsxName");
types.jsxText = new TokenType("jsxText", { beforeExpr: true });
types.jsxTagStart = new TokenType("jsxTagStart", { startsExpr: true });
types.jsxTagEnd = new TokenType("jsxTagEnd");

types.jsxTagStart.updateContext = function () {
  this.state.context.push(types$1.j_expr); // treat as beginning of JSX expression
  this.state.context.push(types$1.j_oTag); // start opening tag context
  this.state.exprAllowed = false;
};

types.jsxTagEnd.updateContext = function (prevType) {
  const out = this.state.context.pop();
  if (out === types$1.j_oTag && prevType === types.slash || out === types$1.j_cTag) {
    this.state.context.pop();
    this.state.exprAllowed = this.curContext() === types$1.j_expr;
  } else {
    this.state.exprAllowed = true;
  }
};

// Transforms JSX element name to string.

function getQualifiedJSXName(object) {
  if (object.type === "JSXIdentifier") {
    return object.name;
  }

  if (object.type === "JSXNamespacedName") {
    return object.namespace.name + ":" + object.name.name;
  }

  if (object.type === "JSXMemberExpression") {
    return getQualifiedJSXName(object.object) + "." + getQualifiedJSXName(object.property);
  }

  // istanbul ignore next
  throw new Error("Node had unexpected type: " + object.type);
}

var jsxPlugin = (superClass => class extends superClass {
  // Reads inline JSX contents token.

  jsxReadToken() {
    let out = "";
    let chunkStart = this.state.pos;
    for (;;) {
      if (this.state.pos >= this.input.length) {
        this.raise(this.state.start, "Unterminated JSX contents");
      }

      const ch = this.input.charCodeAt(this.state.pos);

      switch (ch) {
        case 60: // "<"
        case 123:
          // "{"
          if (this.state.pos === this.state.start) {
            if (ch === 60 && this.state.exprAllowed) {
              ++this.state.pos;
              return this.finishToken(types.jsxTagStart);
            }
            return this.getTokenFromCode(ch);
          }
          out += this.input.slice(chunkStart, this.state.pos);
          return this.finishToken(types.jsxText, out);

        case 38:
          // "&"
          out += this.input.slice(chunkStart, this.state.pos);
          out += this.jsxReadEntity();
          chunkStart = this.state.pos;
          break;

        default:
          if (isNewLine(ch)) {
            out += this.input.slice(chunkStart, this.state.pos);
            out += this.jsxReadNewLine(true);
            chunkStart = this.state.pos;
          } else {
            ++this.state.pos;
          }
      }
    }
  }

  jsxReadNewLine(normalizeCRLF) {
    const ch = this.input.charCodeAt(this.state.pos);
    let out;
    ++this.state.pos;
    if (ch === 13 && this.input.charCodeAt(this.state.pos) === 10) {
      ++this.state.pos;
      out = normalizeCRLF ? "\n" : "\r\n";
    } else {
      out = String.fromCharCode(ch);
    }
    ++this.state.curLine;
    this.state.lineStart = this.state.pos;

    return out;
  }

  jsxReadString(quote) {
    let out = "";
    let chunkStart = ++this.state.pos;
    for (;;) {
      if (this.state.pos >= this.input.length) {
        this.raise(this.state.start, "Unterminated string constant");
      }

      const ch = this.input.charCodeAt(this.state.pos);
      if (ch === quote) break;
      if (ch === 38) {
        // "&"
        out += this.input.slice(chunkStart, this.state.pos);
        out += this.jsxReadEntity();
        chunkStart = this.state.pos;
      } else if (isNewLine(ch)) {
        out += this.input.slice(chunkStart, this.state.pos);
        out += this.jsxReadNewLine(false);
        chunkStart = this.state.pos;
      } else {
        ++this.state.pos;
      }
    }
    out += this.input.slice(chunkStart, this.state.pos++);
    return this.finishToken(types.string, out);
  }

  jsxReadEntity() {
    let str = "";
    let count = 0;
    let entity;
    let ch = this.input[this.state.pos];

    const startPos = ++this.state.pos;
    while (this.state.pos < this.input.length && count++ < 10) {
      ch = this.input[this.state.pos++];
      if (ch === ";") {
        if (str[0] === "#") {
          if (str[1] === "x") {
            str = str.substr(2);
            if (HEX_NUMBER.test(str)) entity = String.fromCodePoint(parseInt(str, 16));
          } else {
            str = str.substr(1);
            if (DECIMAL_NUMBER.test(str)) entity = String.fromCodePoint(parseInt(str, 10));
          }
        } else {
          entity = entities[str];
        }
        break;
      }
      str += ch;
    }
    if (!entity) {
      this.state.pos = startPos;
      return "&";
    }
    return entity;
  }

  // Read a JSX identifier (valid tag or attribute name).
  //
  // Optimized version since JSX identifiers can"t contain
  // escape characters and so can be read as single slice.
  // Also assumes that first character was already checked
  // by isIdentifierStart in readToken.

  jsxReadWord() {
    let ch;
    const start = this.state.pos;
    do {
      ch = this.input.charCodeAt(++this.state.pos);
    } while (isIdentifierChar(ch) || ch === 45); // "-"
    return this.finishToken(types.jsxName, this.input.slice(start, this.state.pos));
  }

  // Parse next token as JSX identifier

  jsxParseIdentifier() {
    const node = this.startNode();
    if (this.match(types.jsxName)) {
      node.name = this.state.value;
    } else if (this.state.type.keyword) {
      node.name = this.state.type.keyword;
    } else {
      this.unexpected();
    }
    this.next();
    return this.finishNode(node, "JSXIdentifier");
  }

  // Parse namespaced identifier.

  jsxParseNamespacedName() {
    const startPos = this.state.start;
    const startLoc = this.state.startLoc;
    const name = this.jsxParseIdentifier();
    if (!this.eat(types.colon)) return name;

    const node = this.startNodeAt(startPos, startLoc);
    node.namespace = name;
    node.name = this.jsxParseIdentifier();
    return this.finishNode(node, "JSXNamespacedName");
  }

  // Parses element name in any form - namespaced, member
  // or single identifier.

  jsxParseElementName() {
    const startPos = this.state.start;
    const startLoc = this.state.startLoc;
    let node = this.jsxParseNamespacedName();
    while (this.eat(types.dot)) {
      const newNode = this.startNodeAt(startPos, startLoc);
      newNode.object = node;
      newNode.property = this.jsxParseIdentifier();
      node = this.finishNode(newNode, "JSXMemberExpression");
    }
    return node;
  }

  // Parses any type of JSX attribute value.

  jsxParseAttributeValue() {
    let node;
    switch (this.state.type) {
      case types.braceL:
        node = this.jsxParseExpressionContainer();
        if (node.expression.type === "JSXEmptyExpression") {
          throw this.raise(node.start, "JSX attributes must only be assigned a non-empty expression");
        } else {
          return node;
        }

      case types.jsxTagStart:
      case types.string:
        return this.parseExprAtom();

      default:
        throw this.raise(this.state.start, "JSX value should be either an expression or a quoted JSX text");
    }
  }

  // JSXEmptyExpression is unique type since it doesn't actually parse anything,
  // and so it should start at the end of last read token (left brace) and finish
  // at the beginning of the next one (right brace).

  jsxParseEmptyExpression() {
    const node = this.startNodeAt(this.state.lastTokEnd, this.state.lastTokEndLoc);
    return this.finishNodeAt(node, "JSXEmptyExpression", this.state.start, this.state.startLoc);
  }

  // Parse JSX spread child

  jsxParseSpreadChild() {
    const node = this.startNode();
    this.expect(types.braceL);
    this.expect(types.ellipsis);
    node.expression = this.parseExpression();
    this.expect(types.braceR);

    return this.finishNode(node, "JSXSpreadChild");
  }

  // Parses JSX expression enclosed into curly brackets.

  jsxParseExpressionContainer() {
    const node = this.startNode();
    this.next();
    if (this.match(types.braceR)) {
      node.expression = this.jsxParseEmptyExpression();
    } else {
      node.expression = this.parseExpression();
    }
    this.expect(types.braceR);
    return this.finishNode(node, "JSXExpressionContainer");
  }

  // Parses following JSX attribute name-value pair.

  jsxParseAttribute() {
    const node = this.startNode();
    if (this.eat(types.braceL)) {
      this.expect(types.ellipsis);
      node.argument = this.parseMaybeAssign();
      this.expect(types.braceR);
      return this.finishNode(node, "JSXSpreadAttribute");
    }
    node.name = this.jsxParseNamespacedName();
    node.value = this.eat(types.eq) ? this.jsxParseAttributeValue() : null;
    return this.finishNode(node, "JSXAttribute");
  }

  // Parses JSX opening tag starting after "<".

  jsxParseOpeningElementAt(startPos, startLoc) {
    const node = this.startNodeAt(startPos, startLoc);
    node.attributes = [];
    node.name = this.jsxParseElementName();
    while (!this.match(types.slash) && !this.match(types.jsxTagEnd)) {
      node.attributes.push(this.jsxParseAttribute());
    }
    node.selfClosing = this.eat(types.slash);
    this.expect(types.jsxTagEnd);
    return this.finishNode(node, "JSXOpeningElement");
  }

  // Parses JSX closing tag starting after "</".

  jsxParseClosingElementAt(startPos, startLoc) {
    const node = this.startNodeAt(startPos, startLoc);
    node.name = this.jsxParseElementName();
    this.expect(types.jsxTagEnd);
    return this.finishNode(node, "JSXClosingElement");
  }

  // Parses entire JSX element, including it"s opening tag
  // (starting after "<"), attributes, contents and closing tag.

  jsxParseElementAt(startPos, startLoc) {
    const node = this.startNodeAt(startPos, startLoc);
    const children = [];
    const openingElement = this.jsxParseOpeningElementAt(startPos, startLoc);
    let closingElement = null;

    if (!openingElement.selfClosing) {
      contents: for (;;) {
        switch (this.state.type) {
          case types.jsxTagStart:
            startPos = this.state.start;
            startLoc = this.state.startLoc;
            this.next();
            if (this.eat(types.slash)) {
              closingElement = this.jsxParseClosingElementAt(startPos, startLoc);
              break contents;
            }
            children.push(this.jsxParseElementAt(startPos, startLoc));
            break;

          case types.jsxText:
            children.push(this.parseExprAtom());
            break;

          case types.braceL:
            if (this.lookahead().type === types.ellipsis) {
              children.push(this.jsxParseSpreadChild());
            } else {
              children.push(this.jsxParseExpressionContainer());
            }

            break;

          // istanbul ignore next - should never happen
          default:
            throw this.unexpected();
        }
      }

      if (
      // $FlowIgnore
      getQualifiedJSXName(closingElement.name) !== getQualifiedJSXName(openingElement.name)) {
        this.raise(
        // $FlowIgnore
        closingElement.start, "Expected corresponding JSX closing tag for <" + getQualifiedJSXName(openingElement.name) + ">");
      }
    }

    node.openingElement = openingElement;
    node.closingElement = closingElement;
    node.children = children;
    if (this.match(types.relational) && this.state.value === "<") {
      this.raise(this.state.start, "Adjacent JSX elements must be wrapped in an enclosing tag");
    }
    return this.finishNode(node, "JSXElement");
  }

  // Parses entire JSX element from current position.

  jsxParseElement() {
    const startPos = this.state.start;
    const startLoc = this.state.startLoc;
    this.next();
    return this.jsxParseElementAt(startPos, startLoc);
  }

  // ==================================
  // Overrides
  // ==================================

  parseExprAtom(refShortHandDefaultPos) {
    if (this.match(types.jsxText)) {
      return this.parseLiteral(this.state.value, "JSXText");
    } else if (this.match(types.jsxTagStart)) {
      return this.jsxParseElement();
    } else {
      return super.parseExprAtom(refShortHandDefaultPos);
    }
  }

  readToken(code) {
    if (this.state.inPropertyName) return super.readToken(code);

    const context = this.curContext();

    if (context === types$1.j_expr) {
      return this.jsxReadToken();
    }

    if (context === types$1.j_oTag || context === types$1.j_cTag) {
      if (isIdentifierStart(code)) {
        return this.jsxReadWord();
      }

      if (code === 62) {
        ++this.state.pos;
        return this.finishToken(types.jsxTagEnd);
      }

      if ((code === 34 || code === 39) && context === types$1.j_oTag) {
        return this.jsxReadString(code);
      }
    }

    if (code === 60 && this.state.exprAllowed) {
      ++this.state.pos;
      return this.finishToken(types.jsxTagStart);
    }

    return super.readToken(code);
  }

  updateContext(prevType) {
    if (this.match(types.braceL)) {
      const curContext = this.curContext();
      if (curContext === types$1.j_oTag) {
        this.state.context.push(types$1.braceExpression);
      } else if (curContext === types$1.j_expr) {
        this.state.context.push(types$1.templateQuasi);
      } else {
        super.updateContext(prevType);
      }
      this.state.exprAllowed = true;
    } else if (this.match(types.slash) && prevType === types.jsxTagStart) {
      this.state.context.length -= 2; // do not consider JSX expr -> JSX open tag -> ... anymore
      this.state.context.push(types$1.j_cTag); // reconsider as closing tag context
      this.state.exprAllowed = false;
    } else {
      return super.updateContext(prevType);
    }
  }
});

function nonNull(x) {
  if (x == null) {
    // $FlowIgnore
    throw new Error(`Unexpected ${x} value.`);
  }
  return x;
}

function assert(x) {
  if (!x) {
    throw new Error("Assert fail");
  }
}

// Doesn't handle "void" or "null" because those are keywords, not identifiers.
function keywordTypeFromName(value) {
  switch (value) {
    case "any":
      return "TSAnyKeyword";
    case "boolean":
      return "TSBooleanKeyword";
    case "never":
      return "TSNeverKeyword";
    case "number":
      return "TSNumberKeyword";
    case "object":
      return "TSObjectKeyword";
    case "string":
      return "TSStringKeyword";
    case "symbol":
      return "TSSymbolKeyword";
    case "undefined":
      return "TSUndefinedKeyword";
    default:
      return undefined;
  }
}

var typescriptPlugin = (superClass => class extends superClass {
  tsIsIdentifier() {
    // TODO: actually a bit more complex in TypeScript, but shouldn't matter.
    // See https://github.com/Microsoft/TypeScript/issues/15008
    return this.match(types.name);
  }

  tsNextTokenCanFollowModifier() {
    // Note: TypeScript's implementation is much more complicated because
    // more things are considered modifiers there.
    // This implementation only handles modifiers not handled by babylon itself. And "static".
    // TODO: Would be nice to avoid lookahead. Want a hasLineBreakUpNext() method...
    this.next();
    return !this.hasPrecedingLineBreak() && !this.match(types.parenL) && !this.match(types.colon) && !this.match(types.eq) && !this.match(types.question);
  }

  /** Parses a modifier matching one the given modifier names. */
  tsParseModifier(allowedModifiers) {
    if (!this.match(types.name)) {
      return undefined;
    }

    const modifier = this.state.value;
    if (allowedModifiers.indexOf(modifier) !== -1 && this.tsTryParse(this.tsNextTokenCanFollowModifier.bind(this))) {
      return modifier;
    }
    return undefined;
  }

  tsIsListTerminator(kind) {
    switch (kind) {
      case "EnumMembers":
      case "TypeMembers":
        return this.match(types.braceR);
      case "HeritageClauseElement":
        return this.match(types.braceL);
      case "TupleElementTypes":
        return this.match(types.bracketR);
      case "TypeParametersOrArguments":
        return this.isRelational(">");
    }

    throw new Error("Unreachable");
  }

  tsParseList(kind, parseElement) {
    const result = [];
    while (!this.tsIsListTerminator(kind)) {
      // Skipping "parseListElement" from the TS source since that's just for error handling.
      result.push(parseElement());
    }
    return result;
  }

  tsParseDelimitedList(kind, parseElement) {
    return nonNull(this.tsParseDelimitedListWorker(kind, parseElement,
    /* expectSuccess */true));
  }

  tsTryParseDelimitedList(kind, parseElement) {
    return this.tsParseDelimitedListWorker(kind, parseElement,
    /* expectSuccess */false);
  }

  /**
  * If !expectSuccess, returns undefined instead of failing to parse.
  * If expectSuccess, parseElement should always return a defined value.
  */
  tsParseDelimitedListWorker(kind, parseElement, expectSuccess) {
    const result = [];

    while (true) {
      if (this.tsIsListTerminator(kind)) {
        break;
      }

      const element = parseElement();
      if (element == null) {
        return undefined;
      }
      result.push(element);

      if (this.eat(types.comma)) {
        continue;
      }

      if (this.tsIsListTerminator(kind)) {
        break;
      }

      if (expectSuccess) {
        // This will fail with an error about a missing comma
        this.expect(types.comma);
      }
      return undefined;
    }

    return result;
  }

  tsParseBracketedList(kind, parseElement, bracket, skipFirstToken) {
    if (!skipFirstToken) {
      if (bracket) {
        this.expect(types.bracketL);
      } else {
        this.expectRelational("<");
      }
    }

    const result = this.tsParseDelimitedList(kind, parseElement);

    if (bracket) {
      this.expect(types.bracketR);
    } else {
      this.expectRelational(">");
    }

    return result;
  }

  tsParseEntityName(allowReservedWords) {
    let entity = this.parseIdentifier();
    while (this.eat(types.dot)) {
      const node = this.startNodeAtNode(entity);
      node.left = entity;
      node.right = this.parseIdentifier(allowReservedWords);
      entity = this.finishNode(node, "TSQualifiedName");
    }
    return entity;
  }

  tsParseTypeReference() {
    const node = this.startNode();
    node.typeName = this.tsParseEntityName( /* allowReservedWords */false);
    if (!this.hasPrecedingLineBreak() && this.isRelational("<")) {
      node.typeParameters = this.tsParseTypeArguments();
    }
    return this.finishNode(node, "TSTypeReference");
  }

  tsParseThisTypePredicate(lhs) {
    this.next();
    const node = this.startNode();
    node.parameterName = lhs;
    node.typeAnnotation = this.tsParseTypeAnnotation( /* eatColon */false);
    return this.finishNode(node, "TSTypePredicate");
  }

  tsParseThisTypeNode() {
    const node = this.startNode();
    this.next();
    return this.finishNode(node, "TSThisType");
  }

  tsParseTypeQuery() {
    const node = this.startNode();
    this.expect(types._typeof);
    node.exprName = this.tsParseEntityName( /* allowReservedWords */true);
    return this.finishNode(node, "TSTypeQuery");
  }

  tsParseTypeParameter() {
    const node = this.startNode();
    node.name = this.parseIdentifierName(node.start);
    if (this.eat(types._extends)) {
      node.constraint = this.tsParseType();
    }

    if (this.eat(types.eq)) {
      node.default = this.tsParseType();
    }

    return this.finishNode(node, "TypeParameter");
  }

  tsTryParseTypeParameters() {
    if (this.eatRelational("<")) {
      return this.tsParseTypeParameters();
    }
  }

  tsParseTypeParameters() {
    const node = this.startNode();
    node.params = this.tsParseBracketedList("TypeParametersOrArguments", this.tsParseTypeParameter.bind(this),
    /* bracket */false,
    /* skipFirstToken */true);
    return this.finishNode(node, "TypeParameterDeclaration");
  }

  // Note: In TypeScript implementation we must provide `yieldContext` and `awaitContext`,
  // but here it's always false, because this is only used for types.
  tsFillSignature(returnToken, signature) {
    // Arrow fns *must* have return token (`=>`). Normal functions can omit it.
    const returnTokenRequired = returnToken === types.arrow;
    signature.typeParameters = this.tsTryParseTypeParameters();
    this.expect(types.parenL);
    signature.parameters = this.tsParseBindingListForSignature();
    if (returnTokenRequired) {
      signature.typeAnnotation = this.tsParseTypeOrTypePredicateAnnotation(returnToken);
    } else if (this.match(returnToken)) {
      signature.typeAnnotation = this.tsParseTypeOrTypePredicateAnnotation(returnToken);
    }
  }

  tsParseBindingListForSignature() {
    return this.parseBindingList(types.parenR).map(pattern => {
      if (pattern.type !== "Identifier" && pattern.type !== "RestElement") {
        throw this.unexpected(pattern.start, "Name in a signature must be an Identifier.");
      }
      return pattern;
    });
  }

  tsParseTypeMemberSemicolon() {
    if (!this.eat(types.comma)) {
      this.semicolon();
    }
  }

  tsParseSignatureMember(kind) {
    const node = this.startNode();
    if (kind === "TSConstructSignatureDeclaration") {
      this.expect(types._new);
    }
    this.tsFillSignature(types.colon, node);
    this.tsParseTypeMemberSemicolon();
    return this.finishNode(node, kind);
  }

  tsIsUnambiguouslyIndexSignature() {
    this.next(); // Skip '{'
    return this.eat(types.name) && this.match(types.colon);
  }

  tsTryParseIndexSignature(node) {
    if (!(this.match(types.bracketL) && this.tsLookAhead(this.tsIsUnambiguouslyIndexSignature.bind(this)))) {
      return undefined;
    }

    this.expect(types.bracketL);
    const id = this.parseIdentifier();
    this.expect(types.colon);
    id.typeAnnotation = this.tsParseTypeAnnotation( /* eatColon */false);
    this.expect(types.bracketR);
    node.parameters = [id];

    const type = this.tsTryParseTypeAnnotation();
    if (type) node.typeAnnotation = type;
    this.tsParseTypeMemberSemicolon();
    return this.finishNode(node, "TSIndexSignature");
  }

  tsParsePropertyOrMethodSignature(node, readonly) {
    this.parsePropertyName(node);
    if (this.eat(types.question)) node.optional = true;
    const nodeAny = node;

    if (!readonly && (this.match(types.parenL) || this.isRelational("<"))) {
      const method = nodeAny;
      this.tsFillSignature(types.colon, method);
      this.tsParseTypeMemberSemicolon();
      return this.finishNode(method, "TSMethodSignature");
    } else {
      const property = nodeAny;
      if (readonly) property.readonly = true;
      const type = this.tsTryParseTypeAnnotation();
      if (type) property.typeAnnotation = type;
      this.tsParseTypeMemberSemicolon();
      return this.finishNode(property, "TSPropertySignature");
    }
  }

  tsParseTypeMember() {
    if (this.match(types.parenL) || this.isRelational("<")) {
      return this.tsParseSignatureMember("TSCallSignatureDeclaration");
    }
    if (this.match(types._new) && this.tsLookAhead(this.tsIsStartOfConstructSignature.bind(this))) {
      return this.tsParseSignatureMember("TSConstructSignatureDeclaration");
    }
    // Instead of fullStart, we create a node here.
    const node = this.startNode();
    const readonly = !!this.tsParseModifier(["readonly"]);

    const idx = this.tsTryParseIndexSignature(node);
    if (idx) {
      if (readonly) node.readonly = true;
      return idx;
    }
    return this.tsParsePropertyOrMethodSignature(node, readonly);
  }

  tsIsStartOfConstructSignature() {
    this.next();
    return this.match(types.parenL) || this.isRelational("<");
  }

  tsParseTypeLiteral() {
    const node = this.startNode();
    node.members = this.tsParseObjectTypeMembers();
    return this.finishNode(node, "TSTypeLiteral");
  }

  tsParseObjectTypeMembers() {
    this.expect(types.braceL);
    const members = this.tsParseList("TypeMembers", this.tsParseTypeMember.bind(this));
    this.expect(types.braceR);
    return members;
  }

  tsIsStartOfMappedType() {
    this.next();
    if (this.isContextual("readonly")) {
      this.next();
    }
    if (!this.match(types.bracketL)) {
      return false;
    }
    this.next();
    if (!this.tsIsIdentifier()) {
      return false;
    }
    this.next();
    return this.match(types._in);
  }

  tsParseMappedTypeParameter() {
    const node = this.startNode();
    node.name = this.parseIdentifierName(node.start);
    this.expect(types._in);
    node.constraint = this.tsParseType();
    return this.finishNode(node, "TypeParameter");
  }

  tsParseMappedType() {
    const node = this.startNode();

    this.expect(types.braceL);
    if (this.eatContextual("readonly")) {
      node.readonly = true;
    }
    this.expect(types.bracketL);
    node.typeParameter = this.tsParseMappedTypeParameter();
    this.expect(types.bracketR);
    if (this.eat(types.question)) {
      node.optional = true;
    }
    node.typeAnnotation = this.tsTryParseType();
    this.semicolon();
    this.expect(types.braceR);

    return this.finishNode(node, "TSMappedType");
  }

  tsParseTupleType() {
    const node = this.startNode();
    node.elementTypes = this.tsParseBracketedList("TupleElementTypes", this.tsParseType.bind(this),
    /* bracket */true,
    /* skipFirstToken */false);
    return this.finishNode(node, "TSTupleType");
  }

  tsParseParenthesizedType() {
    const node = this.startNode();
    this.expect(types.parenL);
    node.typeAnnotation = this.tsParseType();
    this.expect(types.parenR);
    return this.finishNode(node, "TSParenthesizedType");
  }

  tsParseFunctionOrConstructorType(type) {
    const node = this.startNode();
    if (type === "TSConstructorType") {
      this.expect(types._new);
    }
    this.tsFillSignature(types.arrow, node);
    return this.finishNode(node, type);
  }

  tsParseLiteralTypeNode() {
    const node = this.startNode();
    node.literal = (() => {
      switch (this.state.type) {
        case types.num:
          return this.parseLiteral(this.state.value, "NumericLiteral");
        case types.string:
          return this.parseLiteral(this.state.value, "StringLiteral");
        case types._true:
        case types._false:
          return this.parseBooleanLiteral();
        default:
          throw this.unexpected();
      }
    })();
    return this.finishNode(node, "TSLiteralType");
  }

  tsParseNonArrayType() {
    switch (this.state.type) {
      case types.name:
      case types._void:
      case types._null:
        const type = this.match(types._void) ? "TSVoidKeyword" : this.match(types._null) ? "TSNullKeyword" : keywordTypeFromName(this.state.value);
        if (type !== undefined && this.lookahead().type !== types.dot) {
          const node = this.startNode();
          this.next();
          return this.finishNode(node, type);
        }
        return this.tsParseTypeReference();
      case types.string:
      case types.num:
      case types._true:
      case types._false:
        return this.tsParseLiteralTypeNode();
      case types.plusMin:
        if (this.state.value === "-") {
          const node = this.startNode();
          this.next();
          if (!this.match(types.num)) {
            throw this.unexpected();
          }
          node.literal = this.parseLiteral(-this.state.value, "NumericLiteral", node.start, node.loc.start);
          return this.finishNode(node, "TSLiteralType");
        }
        break;
      case types._this:
        const thisKeyword = this.tsParseThisTypeNode();
        if (this.isContextual("is") && !this.hasPrecedingLineBreak()) {
          return this.tsParseThisTypePredicate(thisKeyword);
        } else {
          return thisKeyword;
        }
      case types._typeof:
        return this.tsParseTypeQuery();
      case types.braceL:
        return this.tsLookAhead(this.tsIsStartOfMappedType.bind(this)) ? this.tsParseMappedType() : this.tsParseTypeLiteral();
      case types.bracketL:
        return this.tsParseTupleType();
      case types.parenL:
        return this.tsParseParenthesizedType();
    }

    throw this.unexpected();
  }

  tsParseArrayTypeOrHigher() {
    let type = this.tsParseNonArrayType();
    while (!this.hasPrecedingLineBreak() && this.eat(types.bracketL)) {
      if (this.match(types.bracketR)) {
        const node = this.startNodeAtNode(type);
        node.elementType = type;
        this.expect(types.bracketR);
        type = this.finishNode(node, "TSArrayType");
      } else {
        const node = this.startNodeAtNode(type);
        node.objectType = type;
        node.indexType = this.tsParseType();
        this.expect(types.bracketR);
        type = this.finishNode(node, "TSIndexedAccessType");
      }
    }
    return type;
  }

  tsParseTypeOperator(operator) {
    const node = this.startNode();
    this.expectContextual(operator);
    node.operator = operator;
    node.typeAnnotation = this.tsParseTypeOperatorOrHigher();
    return this.finishNode(node, "TSTypeOperator");
  }

  tsParseTypeOperatorOrHigher() {
    if (this.isContextual("keyof")) {
      return this.tsParseTypeOperator("keyof");
    }
    return this.tsParseArrayTypeOrHigher();
  }

  tsParseUnionOrIntersectionType(kind, parseConstituentType, operator) {
    this.eat(operator);
    let type = parseConstituentType();
    if (this.match(operator)) {
      const types$$1 = [type];
      while (this.eat(operator)) {
        types$$1.push(parseConstituentType());
      }
      const node = this.startNodeAtNode(type);
      node.types = types$$1;
      type = this.finishNode(node, kind);
    }
    return type;
  }

  tsParseIntersectionTypeOrHigher() {
    return this.tsParseUnionOrIntersectionType("TSIntersectionType", this.tsParseTypeOperatorOrHigher.bind(this), types.bitwiseAND);
  }

  tsParseUnionTypeOrHigher() {
    return this.tsParseUnionOrIntersectionType("TSUnionType", this.tsParseIntersectionTypeOrHigher.bind(this), types.bitwiseOR);
  }

  tsIsStartOfFunctionType() {
    if (this.isRelational("<")) {
      return true;
    }
    return this.match(types.parenL) && this.tsLookAhead(this.tsIsUnambiguouslyStartOfFunctionType.bind(this));
  }

  tsSkipParameterStart() {
    if (this.match(types.name) || this.match(types._this)) {
      this.next();
      return true;
    }
    return false;
  }

  tsIsUnambiguouslyStartOfFunctionType() {
    this.next();
    if (this.match(types.parenR) || this.match(types.ellipsis)) {
      // ( )
      // ( ...
      return true;
    }
    if (this.tsSkipParameterStart()) {
      if (this.match(types.colon) || this.match(types.comma) || this.match(types.question) || this.match(types.eq)) {
        // ( xxx :
        // ( xxx ,
        // ( xxx ?
        // ( xxx =
        return true;
      }
      if (this.match(types.parenR)) {
        this.next();
        if (this.match(types.arrow)) {
          // ( xxx ) =>
          return true;
        }
      }
    }
    return false;
  }

  tsParseTypeOrTypePredicateAnnotation(returnToken) {
    const t = this.startNode();
    this.expect(returnToken);

    const typePredicateVariable = this.tsIsIdentifier() && this.tsTryParse(this.tsParseTypePredicatePrefix.bind(this));

    if (!typePredicateVariable) {
      return this.tsParseTypeAnnotation( /* eatColon */false, t);
    }

    const type = this.tsParseTypeAnnotation( /* eatColon */false);

    const node = this.startNodeAtNode(typePredicateVariable);
    node.parameterName = typePredicateVariable;
    node.typeAnnotation = type;
    t.typeAnnotation = this.finishNode(node, "TSTypePredicate");
    return this.finishNode(t, "TypeAnnotation");
  }

  tsTryParseTypeOrTypePredicateAnnotation() {
    return this.match(types.colon) ? this.tsParseTypeOrTypePredicateAnnotation(types.colon) : undefined;
  }

  tsTryParseTypeAnnotation() {
    return this.match(types.colon) ? this.tsParseTypeAnnotation() : undefined;
  }

  tsTryParseType() {
    return this.eat(types.colon) ? this.tsParseType() : undefined;
  }

  tsParseTypePredicatePrefix() {
    const id = this.parseIdentifier();
    if (this.isContextual("is") && !this.hasPrecedingLineBreak()) {
      this.next();
      return id;
    }
  }

  tsParseTypeAnnotation(eatColon = true, t = this.startNode()) {
    if (eatColon) this.expect(types.colon);
    t.typeAnnotation = this.tsParseType();
    return this.finishNode(t, "TypeAnnotation");
  }

  tsParseType() {
    // Need to set `state.inType` so that we don't parse JSX in a type context.
    const oldInType = this.state.inType;
    this.state.inType = true;
    try {
      if (this.tsIsStartOfFunctionType()) {
        return this.tsParseFunctionOrConstructorType("TSFunctionType");
      }
      if (this.match(types._new)) {
        // As in `new () => Date`
        return this.tsParseFunctionOrConstructorType("TSConstructorType");
      }
      return this.tsParseUnionTypeOrHigher();
    } finally {
      this.state.inType = oldInType;
    }
  }

  tsParseTypeAssertion() {
    const node = this.startNode();
    node.typeAnnotation = this.tsParseType();
    this.expectRelational(">");
    node.expression = this.parseMaybeUnary();
    return this.finishNode(node, "TSTypeAssertion");
  }

  tsTryParseTypeArgumentsInExpression() {
    return this.tsTryParseAndCatch(() => {
      const res = this.startNode();
      this.expectRelational("<");
      const typeArguments = this.tsParseDelimitedList("TypeParametersOrArguments", this.tsParseType.bind(this));
      this.expectRelational(">");
      res.params = typeArguments;
      this.finishNode(res, "TypeParameterInstantiation");
      this.expect(types.parenL);
      return res;
    });
  }

  tsParseHeritageClause() {
    return this.tsParseDelimitedList("HeritageClauseElement", this.tsParseExpressionWithTypeArguments.bind(this));
  }

  tsParseExpressionWithTypeArguments() {
    const node = this.startNode();
    // Note: TS uses parseLeftHandSideExpressionOrHigher,
    // then has grammar errors later if it's not an EntityName.
    node.expression = this.tsParseEntityName( /* allowReservedWords */false);
    if (this.isRelational("<")) {
      node.typeParameters = this.tsParseTypeArguments();
    }

    return this.finishNode(node, "TSExpressionWithTypeArguments");
  }

  tsParseInterfaceDeclaration(node) {
    node.id = this.parseIdentifier();
    node.typeParameters = this.tsTryParseTypeParameters();
    if (this.eat(types._extends)) {
      node.extends = this.tsParseHeritageClause();
    }
    const body = this.startNode();
    body.body = this.tsParseObjectTypeMembers();
    node.body = this.finishNode(body, "TSInterfaceBody");
    return this.finishNode(node, "TSInterfaceDeclaration");
  }

  tsParseTypeAliasDeclaration(node) {
    node.id = this.parseIdentifier();
    node.typeParameters = this.tsTryParseTypeParameters();
    this.expect(types.eq);
    node.typeAnnotation = this.tsParseType();
    this.semicolon();
    return this.finishNode(node, "TSTypeAliasDeclaration");
  }

  tsParseEnumMember() {
    const node = this.startNode();
    // Computed property names are grammar errors in an enum, so accept just string literal or identifier.
    node.id = this.match(types.string) ? this.parseLiteral(this.state.value, "StringLiteral") : this.parseIdentifier( /* liberal */true);
    if (this.eat(types.eq)) {
      node.initializer = this.parseMaybeAssign();
    }
    return this.finishNode(node, "TSEnumMember");
  }

  tsParseEnumDeclaration(node, isConst) {
    if (isConst) node.const = true;
    node.id = this.parseIdentifier();
    this.expect(types.braceL);
    node.members = this.tsParseDelimitedList("EnumMembers", this.tsParseEnumMember.bind(this));
    this.expect(types.braceR);
    return this.finishNode(node, "TSEnumDeclaration");
  }

  tsParseModuleBlock() {
    const node = this.startNode();
    this.expect(types.braceL);
    // Inside of a module block is considered "top-level", meaning it can have imports and exports.
    this.parseBlockOrModuleBlockBody(node.body = [],
    /* directives */undefined,
    /* topLevel */true,
    /* end */types.braceR);
    return this.finishNode(node, "TSModuleBlock");
  }

  tsParseModuleOrNamespaceDeclaration(node) {
    node.id = this.parseIdentifier();
    if (this.eat(types.dot)) {
      const inner = this.startNode();
      this.tsParseModuleOrNamespaceDeclaration(inner);
      node.body = inner;
    } else {
      node.body = this.tsParseModuleBlock();
    }
    return this.finishNode(node, "TSModuleDeclaration");
  }

  tsParseAmbientExternalModuleDeclaration(node) {
    if (this.isContextual("global")) {
      node.global = true;
      node.id = this.parseIdentifier();
    } else if (this.match(types.string)) {
      node.id = this.parseLiteral(this.state.value, "StringLiteral");
    } else {
      this.unexpected();
    }

    if (this.match(types.braceL)) {
      node.body = this.tsParseModuleBlock();
    } else {
      this.semicolon();
    }

    return this.finishNode(node, "TSModuleDeclaration");
  }

  tsParseImportEqualsDeclaration(node, isExport) {
    node.isExport = isExport || false;
    node.id = this.parseIdentifier();
    this.expect(types.eq);
    node.moduleReference = this.tsParseModuleReference();
    this.semicolon();
    return this.finishNode(node, "TSImportEqualsDeclaration");
  }

  tsIsExternalModuleReference() {
    return this.isContextual("require") && this.lookahead().type === types.parenL;
  }

  tsParseModuleReference() {
    return this.tsIsExternalModuleReference() ? this.tsParseExternalModuleReference() : this.tsParseEntityName( /* allowReservedWords */false);
  }

  tsParseExternalModuleReference() {
    const node = this.startNode();
    this.expectContextual("require");
    this.expect(types.parenL);
    if (!this.match(types.string)) {
      throw this.unexpected();
    }
    node.expression = this.parseLiteral(this.state.value, "StringLiteral");
    this.expect(types.parenR);
    return this.finishNode(node, "TSExternalModuleReference");
  }

  // Utilities

  tsLookAhead(f) {
    const state = this.state.clone();
    const res = f();
    this.state = state;
    return res;
  }

  tsTryParseAndCatch(f) {
    const state = this.state.clone();
    try {
      return f();
    } catch (e) {
      if (e instanceof SyntaxError) {
        this.state = state;
        return undefined;
      }
      throw e;
    }
  }

  tsTryParse(f) {
    const state = this.state.clone();
    const result = f();
    if (result !== undefined && result !== false) {
      return result;
    } else {
      this.state = state;
      return undefined;
    }
  }

  nodeWithSamePosition(original, type) {
    const node = this.startNodeAtNode(original);
    node.type = type;
    node.end = original.end;
    node.loc.end = original.loc.end;

    if (original.leadingComments) node.leadingComments = original.leadingComments;
    if (original.trailingComments) node.trailingComments = original.trailingComments;
    if (original.innerComments) node.innerComments = original.innerComments;

    return node;
  }

  tsTryParseDeclare(nany) {
    switch (this.state.type) {
      case types._function:
        this.next();
        return this.parseFunction(nany, /* isStatement */true);
      case types._class:
        return this.parseClass(nany,
        /* isStatement */true,
        /* optionalId */false);
      case types._const:
        if (this.match(types._const) && this.lookaheadIsContextual("enum")) {
          // `const enum = 0;` not allowed because "enum" is a strict mode reserved word.
          this.expect(types._const);
          this.expectContextual("enum");
          return this.tsParseEnumDeclaration(nany, /* isConst */true);
        }
      // falls through
      case types._var:
      case types._let:
        return this.parseVarStatement(nany, this.state.type);
      case types.name:
        const value = this.state.value;
        if (value === "global") {
          return this.tsParseAmbientExternalModuleDeclaration(nany);
        } else {
          return this.tsParseDeclaration(nany, value, /* next */true);
        }
    }
  }

  lookaheadIsContextual(name) {
    const l = this.lookahead();
    return l.type === types.name && l.value === name;
  }

  // Note: this won't be called unless the keyword is allowed in `shouldParseExportDeclaration`.
  tsTryParseExportDeclaration() {
    return this.tsParseDeclaration(this.startNode(), this.state.value,
    /* next */true);
  }

  tsParseExpressionStatement(node, expr) {
    switch (expr.name) {
      case "declare":
        const declaration = this.tsTryParseDeclare(node);
        if (declaration) {
          declaration.declare = true;
          return declaration;
        }
        break;

      case "global":
        // `global { }` (with no `declare`) may appear inside an ambient module declaration.
        // Would like to use tsParseAmbientExternalModuleDeclaration here, but already ran past "global".
        if (this.match(types.braceL)) {
          const mod = node;
          mod.global = true;
          mod.id = expr;
          mod.body = this.tsParseModuleBlock();
          return this.finishNode(mod, "TSModuleDeclaration");
        }
        break;

      default:
        return this.tsParseDeclaration(node, expr.name, /* next */false);
    }
  }

  // Common to tsTryParseDeclare, tsTryParseExportDeclaration, and tsParseExpressionStatement.
  tsParseDeclaration(node, value, next) {
    switch (value) {
      case "abstract":
        if (next || this.match(types._class)) {
          const cls = node;
          cls.abstract = true;
          if (next) this.next();
          return this.parseClass(cls,
          /* isStatement */true,
          /* optionalId */false);
        }
        break;

      case "enum":
        if (next || this.match(types.name)) {
          if (next) this.next();
          return this.tsParseEnumDeclaration(node, /* isConst */false);
        }
        break;

      case "interface":
        if (next || this.match(types.name)) {
          if (next) this.next();
          return this.tsParseInterfaceDeclaration(node);
        }
        break;

      case "module":
        if (next) this.next();
        if (this.match(types.string)) {
          return this.tsParseAmbientExternalModuleDeclaration(node);
        } else if (next || this.match(types.name)) {
          return this.tsParseModuleOrNamespaceDeclaration(node);
        }
        break;

      case "namespace":
        if (next || this.match(types.name)) {
          if (next) this.next();
          return this.tsParseModuleOrNamespaceDeclaration(node);
        }
        break;

      case "type":
        if (next || this.match(types.name)) {
          if (next) this.next();
          return this.tsParseTypeAliasDeclaration(node);
        }
        break;
    }
  }

  tsTryParseGenericAsyncArrowFunction(startPos, startLoc) {
    const res = this.tsTryParseAndCatch(() => {
      const node = this.startNodeAt(startPos, startLoc);
      this.expectRelational("<");
      node.typeParameters = this.tsParseTypeParameters();
      // Don't use overloaded parseFunctionParams which would look for "<" again.
      super.parseFunctionParams(node);
      node.returnType = this.tsTryParseTypeOrTypePredicateAnnotation();
      this.expect(types.arrow);
      return node;
    });

    if (!res) {
      return undefined;
    }

    res.id = null;
    res.generator = false;
    res.expression = true; // May be set again by parseFunctionBody.
    res.async = true;
    this.parseFunctionBody(res, true);
    return this.finishNode(res, "ArrowFunctionExpression");
  }

  tsParseTypeArguments() {
    const node = this.startNode();
    this.expectRelational("<");
    node.params = this.tsParseDelimitedList("TypeParametersOrArguments", this.tsParseType.bind(this));
    this.expectRelational(">");
    return this.finishNode(node, "TypeParameterInstantiation");
  }

  // ======================================================
  // OVERRIDES
  // ======================================================

  parseAssignableListItem(allowModifiers, decorators) {
    let accessibility;
    let readonly = false;
    if (allowModifiers) {
      accessibility = this.parseAccessModifier();
      readonly = !!this.tsParseModifier(["readonly"]);
    }

    const left = this.parseMaybeDefault();
    this.parseAssignableListItemTypes(left);
    const elt = this.parseMaybeDefault(left.start, left.loc.start, left);
    if (accessibility || readonly) {
      const pp = this.startNodeAtNode(elt);
      if (decorators.length) {
        pp.decorators = decorators;
      }
      if (accessibility) pp.accessibility = accessibility;
      if (readonly) pp.readonly = readonly;
      if (elt.type !== "Identifier" && elt.type !== "AssignmentPattern") {
        throw this.raise(pp.start, "A parameter property may not be declared using a binding pattern.");
      }
      pp.parameter = elt;
      return this.finishNode(pp, "TSParameterProperty");
    } else {
      if (decorators.length) {
        left.decorators = decorators;
      }
      return elt;
    }
  }

  parseFunctionBodyAndFinish(node, type, allowExpressionBody) {
    // For arrow functions, `parseArrow` handles the return type itself.
    if (!allowExpressionBody && this.match(types.colon)) {
      node.returnType = this.tsParseTypeOrTypePredicateAnnotation(types.colon);
    }

    const bodilessType = type === "FunctionDeclaration" ? "TSDeclareFunction" : type === "ClassMethod" ? "TSDeclareMethod" : undefined;
    if (bodilessType && !this.match(types.braceL) && this.isLineTerminator()) {
      this.finishNode(node, bodilessType);
      return;
    }

    super.parseFunctionBodyAndFinish(node, type, allowExpressionBody);
  }

  parseSubscript(base, startPos, startLoc, noCalls, state) {
    if (this.eat(types.bang)) {
      const nonNullExpression = this.startNodeAt(startPos, startLoc);
      nonNullExpression.expression = base;
      return this.finishNode(nonNullExpression, "TSNonNullExpression");
    }

    if (!noCalls && this.isRelational("<")) {
      if (this.atPossibleAsync(base)) {
        // Almost certainly this is a generic async function `async <T>() => ...
        // But it might be a call with a type argument `async<T>();`
        const asyncArrowFn = this.tsTryParseGenericAsyncArrowFunction(startPos, startLoc);
        if (asyncArrowFn) {
          return asyncArrowFn;
        }
      }

      const node = this.startNodeAt(startPos, startLoc);
      node.callee = base;

      // May be passing type arguments. But may just be the `<` operator.
      const typeArguments = this.tsTryParseTypeArgumentsInExpression(); // Also eats the "("
      if (typeArguments) {
        // possibleAsync always false here, because we would have handled it above.
        // $FlowIgnore (won't be any undefined arguments)
        node.arguments = this.parseCallExpressionArguments(types.parenR,
        /* possibleAsync */false);
        node.typeParameters = typeArguments;
        return this.finishCallExpression(node);
      }
    }

    return super.parseSubscript(base, startPos, startLoc, noCalls, state);
  }

  parseNewArguments(node) {
    if (this.isRelational("<")) {
      // tsTryParseAndCatch is expensive, so avoid if not necessary.
      // 99% certain this is `new C<T>();`. But may be `new C < T;`, which is also legal.
      const typeParameters = this.tsTryParseAndCatch(() => {
        const args = this.tsParseTypeArguments();
        if (!this.match(types.parenL)) this.unexpected();
        return args;
      });
      if (typeParameters) {
        node.typeParameters = typeParameters;
      }
    }

    super.parseNewArguments(node);
  }

  parseExprOp(left, leftStartPos, leftStartLoc, minPrec, noIn) {
    if (nonNull(types._in.binop) > minPrec && !this.hasPrecedingLineBreak() && this.eatContextual("as")) {
      const node = this.startNodeAt(leftStartPos, leftStartLoc);
      node.expression = left;
      node.typeAnnotation = this.tsParseType();
      this.finishNode(node, "TSAsExpression");
      return this.parseExprOp(node, leftStartPos, leftStartLoc, minPrec, noIn);
    }

    return super.parseExprOp(left, leftStartPos, leftStartLoc, minPrec, noIn);
  }

  checkReservedWord(word, startLoc, checkKeywords,
  // eslint-disable-next-line no-unused-vars
  isBinding) {}
  // Don't bother checking for TypeScript code.
  // Strict mode words may be allowed as in `declare namespace N { const static: number; }`.
  // And we have a type checker anyway, so don't bother having the parser do it.


  /*
  Don't bother doing this check in TypeScript code because:
  1. We may have a nested export statement with the same name:
  export const x = 0;
  export namespace N {
    export const x = 1;
  }
  2. We have a type checker to warn us about this sort of thing.
  */
  checkDuplicateExports() {}

  parseImport(node) {
    if (this.match(types.name) && this.lookahead().type === types.eq) {
      return this.tsParseImportEqualsDeclaration(node);
    }
    return super.parseImport(node);
  }

  parseExport(node) {
    if (this.match(types._import)) {
      // `export import A = B;`
      this.expect(types._import);
      return this.tsParseImportEqualsDeclaration(node, /* isExport */true);
    } else if (this.eat(types.eq)) {
      // `export = x;`
      const assign = node;
      assign.expression = this.parseExpression();
      this.semicolon();
      return this.finishNode(assign, "TSExportAssignment");
    } else if (this.eatContextual("as")) {
      // `export as namespace A;`
      const decl = node;
      // See `parseNamespaceExportDeclaration` in TypeScript's own parser
      this.expectContextual("namespace");
      decl.id = this.parseIdentifier();
      this.semicolon();
      return this.finishNode(decl, "TSNamespaceExportDeclaration");
    } else {
      return super.parseExport(node);
    }
  }

  parseStatementContent(declaration, topLevel) {
    if (this.state.type === types._const) {
      const ahead = this.lookahead();
      if (ahead.type === types.name && ahead.value === "enum") {
        const node = this.startNode();
        this.expect(types._const);
        this.expectContextual("enum");
        return this.tsParseEnumDeclaration(node, /* isConst */true);
      }
    }
    return super.parseStatementContent(declaration, topLevel);
  }

  parseAccessModifier() {
    return this.tsParseModifier(["public", "protected", "private"]);
  }

  parseClassMember(classBody, member, state) {
    const accessibility = this.parseAccessModifier();
    if (accessibility) member.accessibility = accessibility;

    super.parseClassMember(classBody, member, state);
  }

  parseClassMemberWithIsStatic(classBody, member, state, isStatic) {
    const methodOrProp = member;
    const prop = member;
    const propOrIdx = member;

    let abstract = false,
        readonly = false;

    const mod = this.tsParseModifier(["abstract", "readonly"]);
    switch (mod) {
      case "readonly":
        readonly = true;
        abstract = !!this.tsParseModifier(["abstract"]);
        break;
      case "abstract":
        abstract = true;
        readonly = !!this.tsParseModifier(["readonly"]);
        break;
    }

    if (abstract) methodOrProp.abstract = true;
    if (readonly) propOrIdx.readonly = true;

    if (!abstract && !isStatic && !methodOrProp.accessibility) {
      const idx = this.tsTryParseIndexSignature(member);
      if (idx) {
        classBody.body.push(idx);
        return;
      }
    }

    if (readonly) {
      // Must be a property (if not an index signature).
      methodOrProp.static = isStatic;
      this.parseClassPropertyName(prop);
      this.parsePostMemberNameModifiers(methodOrProp);
      this.pushClassProperty(classBody, prop);
      return;
    }

    super.parseClassMemberWithIsStatic(classBody, member, state, isStatic);
  }

  parsePostMemberNameModifiers(methodOrProp) {
    const optional = this.eat(types.question);
    if (optional) methodOrProp.optional = true;
  }

  // Note: The reason we do this in `parseExpressionStatement` and not `parseStatement`
  // is that e.g. `type()` is valid JS, so we must try parsing that first.
  // If it's really a type, we will parse `type` as the statement, and can correct it here
  // by parsing the rest.
  parseExpressionStatement(node, expr) {
    const decl = expr.type === "Identifier" ? this.tsParseExpressionStatement(node, expr) : undefined;
    return decl || super.parseExpressionStatement(node, expr);
  }

  // export type
  // Should be true for anything parsed by `tsTryParseExportDeclaration`.
  shouldParseExportDeclaration() {
    if (this.match(types.name)) {
      switch (this.state.value) {
        case "abstract":
        case "declare":
        case "enum":
        case "interface":
        case "module":
        case "namespace":
        case "type":
          return true;
      }
    }
    return super.shouldParseExportDeclaration();
  }

  // An apparent conditional expression could actually be an optional parameter in an arrow function.
  parseConditional(expr, noIn, startPos, startLoc, refNeedsArrowPos) {
    // only do the expensive clone if there is a question mark
    // and if we come from inside parens
    if (!refNeedsArrowPos || !this.match(types.question)) {
      return super.parseConditional(expr, noIn, startPos, startLoc, refNeedsArrowPos);
    }

    const state = this.state.clone();
    try {
      return super.parseConditional(expr, noIn, startPos, startLoc);
    } catch (err) {
      if (!(err instanceof SyntaxError)) {
        // istanbul ignore next: no such error is expected
        throw err;
      }

      this.state = state;
      refNeedsArrowPos.start = err.pos || this.state.start;
      return expr;
    }
  }

  // Note: These "type casts" are *not* valid TS expressions.
  // But we parse them here and change them when completing the arrow function.
  parseParenItem(node, startPos, startLoc) {
    node = super.parseParenItem(node, startPos, startLoc);
    if (this.eat(types.question)) {
      node.optional = true;
    }

    if (this.match(types.colon)) {
      const typeCastNode = this.startNodeAt(startPos, startLoc);
      typeCastNode.expression = node;
      typeCastNode.typeAnnotation = this.tsParseTypeAnnotation();

      return this.finishNode(typeCastNode, "TypeCastExpression");
    }

    return node;
  }

  parseExportDeclaration(node) {
    // "export declare" is equivalent to just "export".
    const isDeclare = this.eatContextual("declare");

    let declaration;
    if (this.match(types.name)) {
      declaration = this.tsTryParseExportDeclaration();
    }
    if (!declaration) {
      declaration = super.parseExportDeclaration(node);
    }

    if (declaration && isDeclare) {
      declaration.declare = true;
    }

    return declaration;
  }

  parseClassId(node, isStatement, optionalId) {
    if ((!isStatement || optionalId) && this.isContextual("implements")) {
      return;
    }

    super.parseClassId(...arguments);
    const typeParameters = this.tsTryParseTypeParameters();
    if (typeParameters) node.typeParameters = typeParameters;
  }

  parseClassProperty(node) {
    const type = this.tsTryParseTypeAnnotation();
    if (type) node.typeAnnotation = type;
    return super.parseClassProperty(node);
  }

  parseClassMethod(classBody, method, isGenerator, isAsync, isConstructor) {
    const typeParameters = this.tsTryParseTypeParameters();
    if (typeParameters) method.typeParameters = typeParameters;
    super.parseClassMethod(classBody, method, isGenerator, isAsync, isConstructor);
  }

  parseClassSuper(node) {
    super.parseClassSuper(node);
    if (node.superClass && this.isRelational("<")) {
      node.superTypeParameters = this.tsParseTypeArguments();
    }
    if (this.eatContextual("implements")) {
      node.implements = this.tsParseHeritageClause();
    }
  }

  parseObjPropValue(prop, ...args) {
    if (this.isRelational("<")) {
      throw new Error("TODO");
    }

    super.parseObjPropValue(prop, ...args);
  }

  parseFunctionParams(node) {
    const typeParameters = this.tsTryParseTypeParameters();
    if (typeParameters) node.typeParameters = typeParameters;
    super.parseFunctionParams(node);
  }

  // `let x: number;`
  parseVarHead(decl) {
    super.parseVarHead(decl);
    const type = this.tsTryParseTypeAnnotation();
    if (type) {
      decl.id.typeAnnotation = type;
      this.finishNode(decl.id, decl.id.type); // set end position to end of type
    }
  }

  // parse the return type of an async arrow function - let foo = (async (): number => {});
  parseAsyncArrowFromCallExpression(node, call) {
    if (this.match(types.colon)) {
      node.returnType = this.tsParseTypeAnnotation();
    }
    return super.parseAsyncArrowFromCallExpression(node, call);
  }

  parseMaybeAssign(...args) {
    // Note: When the JSX plugin is on, type assertions (`<T> x`) aren't valid syntax.

    let jsxError;

    if (this.match(types.jsxTagStart)) {
      const context = this.curContext();
      assert(context === types$1.j_oTag);
      // Only time j_oTag is pushed is right after j_expr.
      assert(this.state.context[this.state.context.length - 2] === types$1.j_expr);

      // Prefer to parse JSX if possible. But may be an arrow fn.
      const state = this.state.clone();
      try {
        return super.parseMaybeAssign(...args);
      } catch (err) {
        if (!(err instanceof SyntaxError)) {
          // istanbul ignore next: no such error is expected
          throw err;
        }

        this.state = state;
        // Pop the context added by the jsxTagStart.
        assert(this.curContext() === types$1.j_oTag);
        this.state.context.pop();
        assert(this.curContext() === types$1.j_expr);
        this.state.context.pop();
        jsxError = err;
      }
    }

    if (jsxError === undefined && !this.isRelational("<")) {
      return super.parseMaybeAssign(...args);
    }

    // Either way, we're looking at a '<': tt.jsxTagStart or relational.

    let arrowExpression;
    let typeParameters;
    const state = this.state.clone();
    this.next(); // skip the jsx start
    try {
      // This is similar to TypeScript's `tryParseParenthesizedArrowFunctionExpression`.
      typeParameters = this.tsParseTypeParameters();
      arrowExpression = super.parseMaybeAssign(...args);
      if (arrowExpression.type !== "ArrowFunctionExpression") {
        this.unexpected(); // Go to the catch block (needs a SyntaxError).
      }
    } catch (err) {
      if (!(err instanceof SyntaxError)) {
        // istanbul ignore next: no such error is expected
        throw err;
      }

      if (jsxError) {
        throw jsxError;
      }

      // Try parsing a type cast instead of an arrow function.
      // This will never happen outside of JSX.
      // (Because in JSX the '<' should be a jsxTagStart and not a relational.
      assert(!this.hasPlugin("jsx"));
      // Parsing an arrow function failed, so try a type cast.
      this.state = state;
      // This will start with a type assertion (via parseMaybeUnary).
      // But don't directly call `this.tsParseTypeAssertion` because we want to handle any binary after it.
      return super.parseMaybeAssign(...args);
    }

    // Correct TypeScript code should have at least 1 type parameter, but don't crash on bad code.
    if (typeParameters && typeParameters.params.length !== 0) {
      this.resetStartLocationFromNode(arrowExpression, typeParameters.params[0]);
    }
    arrowExpression.typeParameters = typeParameters;
    return arrowExpression;
  }

  // Handle type assertions
  parseMaybeUnary(refShorthandDefaultPos) {
    if (!this.hasPlugin("jsx") && this.eatRelational("<")) {
      return this.tsParseTypeAssertion();
    } else {
      return super.parseMaybeUnary(refShorthandDefaultPos);
    }
  }

  parseArrow(node) {
    if (this.match(types.colon)) {
      // This is different from how the TS parser does it.
      // TS uses lookahead. Babylon parses it as a parenthesized expression and converts.
      const state = this.state.clone();
      try {
        const returnType = this.tsParseTypeOrTypePredicateAnnotation(types.colon);
        if (this.canInsertSemicolon()) this.unexpected();
        if (!this.match(types.arrow)) this.unexpected();
        node.returnType = returnType;
      } catch (err) {
        if (err instanceof SyntaxError) {
          this.state = state;
        } else {
          // istanbul ignore next: no such error is expected
          throw err;
        }
      }
    }

    return super.parseArrow(node);
  }

  // Allow type annotations inside of a parameter list.
  parseAssignableListItemTypes(param) {
    if (this.eat(types.question)) {
      if (param.type !== "Identifier") {
        throw this.raise(param.start, "A binding pattern parameter cannot be optional in an implementation signature.");
      }

      param.optional = true;
    }
    const type = this.tsTryParseTypeAnnotation();
    if (type) param.typeAnnotation = type;
    return this.finishNode(param, param.type);
  }

  toAssignable(node, isBinding, contextDescription) {
    switch (node.type) {
      case "TypeCastExpression":
        return super.toAssignable(this.typeCastToParameter(node), isBinding, contextDescription);
      case "TSParameterProperty":
        return super.toAssignable(node, isBinding, contextDescription);
      default:
        return super.toAssignable(node, isBinding, contextDescription);
    }
  }

  checkLVal(expr, isBinding, checkClashes, contextDescription) {
    switch (expr.type) {
      case "TypeCastExpression":
        // Allow "typecasts" to appear on the left of assignment expressions,
        // because it may be in an arrow function.
        // e.g. `const f = (foo: number = 0) => foo;`
        return;
      case "TSParameterProperty":
        this.checkLVal(expr.parameter, isBinding, checkClashes, "parameter property");
        return;
      default:
        super.checkLVal(expr, isBinding, checkClashes, contextDescription);
        return;
    }
  }

  parseBindingAtom() {
    switch (this.state.type) {
      case types._this:
        // "this" may be the name of a parameter, so allow it.
        return this.parseIdentifier( /* liberal */true);
      default:
        return super.parseBindingAtom();
    }
  }

  // === === === === === === === === === === === === === === === ===
  // Note: All below methods are duplicates of something in flow.js.
  // Not sure what the best way to combine these is.
  // === === === === === === === === === === === === === === === ===

  isClassMethod() {
    return this.isRelational("<") || super.isClassMethod();
  }

  isClassProperty() {
    return this.match(types.colon) || super.isClassProperty();
  }

  parseMaybeDefault(...args) {
    const node = super.parseMaybeDefault(...args);

    if (node.type === "AssignmentPattern" && node.typeAnnotation && node.right.start < node.typeAnnotation.start) {
      this.raise(node.typeAnnotation.start, "Type annotations must come before default assignments, " + "e.g. instead of `age = 25: number` use `age: number = 25`");
    }

    return node;
  }

  // ensure that inside types, we bypass the jsx parser plugin
  readToken(code) {
    if (this.state.inType && (code === 62 || code === 60)) {
      return this.finishOp(types.relational, 1);
    } else {
      return super.readToken(code);
    }
  }

  toAssignableList(exprList, isBinding, contextDescription) {
    for (let i = 0; i < exprList.length; i++) {
      const expr = exprList[i];
      if (expr && expr.type === "TypeCastExpression") {
        exprList[i] = this.typeCastToParameter(expr);
      }
    }
    return super.toAssignableList(exprList, isBinding, contextDescription);
  }

  typeCastToParameter(node) {
    node.expression.typeAnnotation = node.typeAnnotation;

    return this.finishNodeAt(node.expression, node.expression.type, node.typeAnnotation.end, node.typeAnnotation.loc.end);
  }

  toReferencedList(exprList) {
    for (let i = 0; i < exprList.length; i++) {
      const expr = exprList[i];
      if (expr && expr._exprListItem && expr.type === "TypeCastExpression") {
        this.raise(expr.start, "Did not expect a type annotation here.");
      }
    }

    return exprList;
  }

  shouldParseArrow() {
    return this.match(types.colon) || super.shouldParseArrow();
  }

  shouldParseAsyncArrow() {
    return this.match(types.colon) || super.shouldParseAsyncArrow();
  }
});

plugins.estree = estreePlugin;
plugins.flow = flowPlugin;
plugins.jsx = jsxPlugin;
plugins.typescript = typescriptPlugin;

function parse(input, options) {
  return getParser(options, input).parse();
}

function parseExpression(input, options) {
  const parser = getParser(options, input);
  if (parser.options.strictMode) {
    parser.state.strict = true;
  }
  return parser.getExpression();
}

function getParser(options, input) {
  const cls = options && options.plugins ? getParserClass(options.plugins) : Parser;
  return new cls(options, input);
}

const parserClassCache = {};

/** Get a Parser class with plugins applied. */
function getParserClass(pluginsFromOptions) {
  if (pluginsFromOptions.indexOf("decorators") >= 0 && pluginsFromOptions.indexOf("decorators2") >= 0) {
    throw new Error("Cannot use decorators and decorators2 plugin together");
  }

  // Filter out just the plugins that have an actual mixin associated with them.
  let pluginList = pluginsFromOptions.filter(p => p === "estree" || p === "flow" || p === "jsx" || p === "typescript");

  if (pluginList.indexOf("flow") >= 0) {
    // ensure flow plugin loads last
    pluginList = pluginList.filter(plugin => plugin !== "flow");
    pluginList.push("flow");
  }

  if (pluginList.indexOf("flow") >= 0 && pluginList.indexOf("typescript") >= 0) {
    throw new Error("Cannot combine flow and typescript plugins.");
  }

  if (pluginList.indexOf("typescript") >= 0) {
    // ensure typescript plugin loads last
    pluginList = pluginList.filter(plugin => plugin !== "typescript");
    pluginList.push("typescript");
  }

  if (pluginList.indexOf("estree") >= 0) {
    // ensure estree plugin loads first
    pluginList = pluginList.filter(plugin => plugin !== "estree");
    pluginList.unshift("estree");
  }

  const key = pluginList.join("/");
  let cls = parserClassCache[key];
  if (!cls) {
    cls = Parser;
    for (const plugin of pluginList) {
      cls = plugins[plugin](cls);
    }
    parserClassCache[key] = cls;
  }
  return cls;
}

exports.parse = parse;
exports.parseExpression = parseExpression;
exports.tokTypes = types;
