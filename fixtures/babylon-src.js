// @flow
import type { Options } from "./options";
import Parser, { plugins } from "./parser";
import "./parser/util";
import "./parser/statement";
import "./parser/lval";
import "./parser/expression";
import "./parser/node";
import "./parser/location";
import "./parser/comments";
import { types as tokTypes } from "./tokenizer/types";
import "./tokenizer";
import "./tokenizer/context";
import type { Expression, File } from "./types";
import estreePlugin from "./plugins/estree";
import flowPlugin from "./plugins/flow";
import jsxPlugin from "./plugins/jsx";
import typescriptPlugin from "./plugins/typescript";
plugins.estree = estreePlugin;
plugins.flow = flowPlugin;
plugins.jsx = jsxPlugin;
plugins.typescript = typescriptPlugin;
export function parse(input: string, options?: Options): File {
  return getParser(options, input).parse();
}
export function parseExpression(input: string, options?: Options): Expression {
  const parser = getParser(options, input);

  if (parser.options.strictMode) {
    parser.state.strict = true;
  }

  return parser.getExpression();
}
export { tokTypes };

function getParser(options: ?Options, input: string): Parser {
  const cls = options && options.plugins ? getParserClass(options.plugins) : Parser;
  return new cls(options, input);
}

const parserClassCache: {
  [key: string]: Class<Parser>
} = {};
/** Get a Parser class with plugins applied. */

function getParserClass(pluginsFromOptions: $ReadOnlyArray<string>): Class<Parser> {
  if (pluginsFromOptions.indexOf("decorators") >= 0 && pluginsFromOptions.indexOf("decorators2") >= 0) {
    throw new Error("Cannot use decorators and decorators2 plugin together");
  } // Filter out just the plugins that have an actual mixin associated with them.


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
// @flow
// A second optional argument can be given to further configure
// the parser process. These options are recognized:
export type Options = {
  sourceType: "script" | "module",
  sourceFilename?: string,
  startLine: number,
  allowReturnOutsideFunction: boolean,
  allowImportExportEverywhere: boolean,
  allowSuperOutsideMethod: boolean,
  plugins: $ReadOnlyArray<string>,
  strictMode: ?boolean,
  ranges: boolean,
  tokens: boolean,
};
export const defaultOptions: Options = {
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
}; // Interpret and default an options object

export function getOptions(opts: ?Options): Options {
  const options: any = {};

  for (const key in defaultOptions) {
    options[key] = opts && key in opts ? opts[key] : defaultOptions[key];
  }

  return options;
}
// @flow
import type { Options } from "../options";
import { reservedWords } from "../util/identifier";
import type State from "../tokenizer/state";
export default class BaseParser {
  // Properties set by constructor in index.js
  options: Options;
  inModule: boolean;
  plugins: {
    [key: string]: boolean
  };
  filename: ?string; // Initialized by Tokenizer

  state: State;
  input: string;

  isReservedWord(word: string): boolean {
    if (word === "await") {
      return this.inModule;
    } else {
      return reservedWords[6](word);
    }
  }

  hasPlugin(name: string): boolean {
    return !!this.plugins[name];
  }

}
/* eslint max-len: 0 */
// @flow

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
import BaseParser from "./base";
import type { Comment, Node } from "../types";

function last<T>(stack: $ReadOnlyArray<T>): T {
  return stack[stack.length - 1];
}

export default class CommentsParser extends BaseParser {
  addComment(comment: Comment): void {
    if (this.filename) comment.loc.filename = this.filename;
    this.state.trailingComments.push(comment);
    this.state.leadingComments.push(comment);
  }

  processComment(node: Node): void {
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
    } // Eating the stack.


    if (stack.length > 0 && last(stack).start >= node.start) {
      firstChild = stack.pop();
    }

    while (stack.length > 0 && last(stack).start >= node.start) {
      lastChild = stack.pop();
    }

    if (!lastChild && firstChild) lastChild = firstChild; // Attach comments that follow a trailing comma on the last
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
        } // Split the array based on the location of the first comment
        // that comes after the node. Keep in mind that this could
        // result in an empty array, and if so, the array must be
        // deleted.


        const leadingComments = this.state.leadingComments.slice(0, i);
        node.leadingComments = leadingComments.length === 0 ? null : leadingComments; // Similarly, trailing comments are attached later. The variable
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
/* eslint max-len: 0 */
// @flow
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
import { types as tt, type TokenType } from "../tokenizer/types";
import * as N from "../types";
import LValParser from "./lval";
import { reservedWords } from "../util/identifier";
import type { Pos, Position } from "../util/location";
export default class ExpressionParser extends LValParser {
  // Forward-declaration: defined in statement.js
  +parseBlock: (allowDirectives?: boolean) => N.BlockStatement;
  +parseClass: (node: N.Class, isStatement: boolean, optionalId?: boolean) => N.Class;
  +parseDecorators: (allowExport?: boolean) => void;
  +parseFunction: <T: N.NormalFunction>(node: T, isStatement: boolean, allowExpressionBody?: boolean, isAsync?: boolean, optionalId?: boolean) => T;
  +takeDecorators: (node: N.HasDecorators) => void; // Check if property name clashes with already added.
  // Object/class getters and setters are not allowed to clash —
  // either with each other or with an init property — and in
  // strict mode, init properties are also not allowed to be repeated.

  checkPropClash(prop: N.ObjectMember, propHash: {
    [key: string]: boolean
  }): void {
    if (prop.computed || prop.kind) return;
    const key = prop.key; // It is either an Identifier or a String/NumericLiteral

    const name = key.type === "Identifier" ? key.name : String(key.value);

    if (name === "__proto__") {
      if (propHash.proto) this.raise(key.start, "Redefinition of __proto__ property");
      propHash.proto = true;
    }
  } // Convenience method to parse an Expression only


  getExpression(): N.Expression {
    this.nextToken();
    const expr = this.parseExpression();

    if (!this.match(tt.eof)) {
      this.unexpected();
    }

    expr.comments = this.state.comments;
    return expr;
  } // ### Expression parsing
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


  parseExpression(noIn?: boolean, refShorthandDefaultPos?: Pos): N.Expression {
    const startPos = this.state.start;
    const startLoc = this.state.startLoc;
    const expr = this.parseMaybeAssign(noIn, refShorthandDefaultPos);

    if (this.match(tt.comma)) {
      const node = this.startNodeAt(startPos, startLoc);
      node.expressions = [expr];

      while (this.eat(tt.comma)) {
        node.expressions.push(this.parseMaybeAssign(noIn, refShorthandDefaultPos));
      }

      this.toReferencedList(node.expressions);
      return this.finishNode(node, "SequenceExpression");
    }

    return expr;
  } // Parse an assignment expression. This includes applications of
  // operators like `+=`.


  parseMaybeAssign(noIn?: ?boolean, refShorthandDefaultPos?: ?Pos, afterLeftParse?: Function, refNeedsArrowPos?: ?Pos): N.Expression {
    const startPos = this.state.start;
    const startLoc = this.state.startLoc;

    if (this.match(tt._yield) && this.state.inGenerator) {
      let left = this.parseYield();
      if (afterLeftParse) left = afterLeftParse.call(this, left, startPos, startLoc);
      return left;
    }

    let failOnShorthandAssign;

    if (refShorthandDefaultPos) {
      failOnShorthandAssign = false;
    } else {
      refShorthandDefaultPos = {
        start: 0
      };
      failOnShorthandAssign = true;
    }

    if (this.match(tt.parenL) || this.match(tt.name)) {
      this.state.potentialArrowAt = this.state.start;
    }

    let left = this.parseMaybeConditional(noIn, refShorthandDefaultPos, refNeedsArrowPos);
    if (afterLeftParse) left = afterLeftParse.call(this, left, startPos, startLoc);

    if (this.state.type.isAssign) {
      const node = this.startNodeAt(startPos, startLoc);
      node.operator = this.state.value;
      node.left = this.match(tt.eq) ? this.toAssignable(left, undefined, "assignment expression") : left;
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
  } // Parse a ternary conditional (`?:`) operator.


  parseMaybeConditional(noIn: ?boolean, refShorthandDefaultPos: Pos, refNeedsArrowPos?: ?Pos): N.Expression {
    const startPos = this.state.start;
    const startLoc = this.state.startLoc;
    const expr = this.parseExprOps(noIn, refShorthandDefaultPos);
    if (refShorthandDefaultPos && refShorthandDefaultPos.start) return expr;
    return this.parseConditional(expr, noIn, startPos, startLoc, refNeedsArrowPos);
  }

  parseConditional(expr: N.Expression, noIn: ?boolean, startPos: number, startLoc: Position, // FIXME: Disabling this for now since can't seem to get it to play nicely
  refNeedsArrowPos?: ?Pos): N.Expression {
    if (this.eat(tt.question)) {
      const node = this.startNodeAt(startPos, startLoc);
      node.test = expr;
      node.consequent = this.parseMaybeAssign();
      this.expect(tt.colon);
      node.alternate = this.parseMaybeAssign(noIn);
      return this.finishNode(node, "ConditionalExpression");
    }

    return expr;
  } // Start the precedence parser.


  parseExprOps(noIn: ?boolean, refShorthandDefaultPos: Pos): N.Expression {
    const startPos = this.state.start;
    const startLoc = this.state.startLoc;
    const expr = this.parseMaybeUnary(refShorthandDefaultPos);

    if (refShorthandDefaultPos && refShorthandDefaultPos.start) {
      return expr;
    } else {
      return this.parseExprOp(expr, startPos, startLoc, -1, noIn);
    }
  } // Parse binary operators with the operator precedence parsing
  // algorithm. `left` is the left-hand side of the operator.
  // `minPrec` provides context that allows the function to stop and
  // defer further parser to one of its callers when it encounters an
  // operator that has a lower precedence than the set it is parsing.


  parseExprOp(left: N.Expression, leftStartPos: number, leftStartLoc: Position, minPrec: number, noIn: ?boolean): N.Expression {
    const prec = this.state.type.binop;

    if (prec != null && (!noIn || !this.match(tt._in))) {
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
        this.finishNode(node, op === tt.logicalOR || op === tt.logicalAND ? "LogicalExpression" : "BinaryExpression");
        return this.parseExprOp(node, leftStartPos, leftStartLoc, minPrec, noIn);
      }
    }

    return left;
  } // Parse unary operators, both prefix and postfix.


  parseMaybeUnary(refShorthandDefaultPos: ?Pos): N.Expression {
    if (this.state.type.prefix) {
      const node = this.startNode();
      const update = this.match(tt.incDec);
      node.operator = this.state.value;
      node.prefix = true;
      this.next();
      const argType = this.state.type;
      node.argument = this.parseMaybeUnary();
      this.addExtra(node, "parenthesizedArgument", argType === tt.parenL && (!node.argument.extra || !node.argument.extra.parenthesized));

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
  } // Parse call, dot, and `[]`-subscript expressions.


  parseExprSubscripts(refShorthandDefaultPos: ?Pos): N.Expression {
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

  parseSubscripts(base: N.Expression, startPos: number, startLoc: Position, noCalls?: ?boolean): N.Expression {
    const state = {
      stop: false
    };

    do {
      base = this.parseSubscript(base, startPos, startLoc, noCalls, state);
    } while (!state.stop);

    return base;
  }
  /** @param state Set 'state.stop = true' to indicate that we should stop parsing subscripts. */


  parseSubscript(base: N.Expression, startPos: number, startLoc: Position, noCalls: ?boolean, state: {
    stop: boolean
  }): N.Expression {
    if (!noCalls && this.eat(tt.doubleColon)) {
      const node = this.startNodeAt(startPos, startLoc);
      node.object = base;
      node.callee = this.parseNoCallExpr();
      state.stop = true;
      return this.parseSubscripts(this.finishNode(node, "BindExpression"), startPos, startLoc, noCalls);
    } else if (this.match(tt.questionDot)) {
      if (!this.hasPlugin("optionalChaining")) {
        this.raise(startPos, "You can only use optional-chaining when the 'optionalChaining' plugin is enabled.");
      }

      if (noCalls && this.lookahead().type == tt.parenL) {
        state.stop = true;
        return base;
      }

      this.next();
      const node = this.startNodeAt(startPos, startLoc);

      if (this.eat(tt.bracketL)) {
        node.object = base;
        node.property = this.parseExpression();
        node.computed = true;
        node.optional = true;
        this.expect(tt.bracketR);
        return this.finishNode(node, "MemberExpression");
      } else if (this.eat(tt.parenL)) {
        const possibleAsync = this.atPossibleAsync(base);
        node.callee = base;
        node.arguments = this.parseCallExpressionArguments(tt.parenR, possibleAsync);
        node.optional = true;
        return this.finishNode(node, "CallExpression");
      } else {
        node.object = base;
        node.property = this.parseIdentifier(true);
        node.computed = false;
        node.optional = true;
        return this.finishNode(node, "MemberExpression");
      }
    } else if (this.eat(tt.dot)) {
      const node = this.startNodeAt(startPos, startLoc);
      node.object = base;
      node.property = this.hasPlugin("classPrivateProperties") ? this.parseMaybePrivateName() : this.parseIdentifier(true);
      node.computed = false;
      return this.finishNode(node, "MemberExpression");
    } else if (this.eat(tt.bracketL)) {
      const node = this.startNodeAt(startPos, startLoc);
      node.object = base;
      node.property = this.parseExpression();
      node.computed = true;
      this.expect(tt.bracketR);
      return this.finishNode(node, "MemberExpression");
    } else if (!noCalls && this.match(tt.parenL)) {
      const possibleAsync = this.atPossibleAsync(base);
      this.next();
      const node = this.startNodeAt(startPos, startLoc);
      node.callee = base;
      node.arguments = this.parseCallExpressionArguments(tt.parenR, possibleAsync);
      this.finishCallExpression(node);

      if (possibleAsync && this.shouldParseAsyncArrow()) {
        state.stop = true;
        return this.parseAsyncArrowFromCallExpression(this.startNodeAt(startPos, startLoc), node);
      } else {
        this.toReferencedList(node.arguments);
      }

      return node;
    } else if (this.match(tt.backQuote)) {
      const node = this.startNodeAt(startPos, startLoc);
      node.tag = base;
      node.quasi = this.parseTemplate(true);
      return this.finishNode(node, "TaggedTemplateExpression");
    } else {
      state.stop = true;
      return base;
    }
  }

  atPossibleAsync(base: N.Expression): boolean {
    return this.state.potentialArrowAt === base.start && base.type === "Identifier" && base.name === "async" && !this.canInsertSemicolon();
  }

  finishCallExpression(node: N.CallExpression): N.CallExpression {
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

  parseCallExpressionArguments(close: TokenType, possibleAsyncArrow: boolean): $ReadOnlyArray<?N.Expression> {
    const elts = [];
    let innerParenStart;
    let first = true;

    while (!this.eat(close)) {
      if (first) {
        first = false;
      } else {
        this.expect(tt.comma);
        if (this.eat(close)) break;
      } // we need to make sure that if this is an async arrow functions, that we don't allow inner parens inside the params


      if (this.match(tt.parenL) && !innerParenStart) {
        innerParenStart = this.state.start;
      }

      elts.push(this.parseExprListItem(false, possibleAsyncArrow ? {
        start: 0
      } : undefined, possibleAsyncArrow ? {
        start: 0
      } : undefined));
    } // we found an async arrow function so let's not allow any inner parens


    if (possibleAsyncArrow && innerParenStart && this.shouldParseAsyncArrow()) {
      this.unexpected();
    }

    return elts;
  }

  shouldParseAsyncArrow(): boolean {
    return this.match(tt.arrow);
  }

  parseAsyncArrowFromCallExpression(node: N.ArrowFunctionExpression, call: N.CallExpression): N.ArrowFunctionExpression {
    this.expect(tt.arrow);
    return this.parseArrowExpression(node, call.arguments, true);
  } // Parse a no-call expression (like argument of `new` or `::` operators).


  parseNoCallExpr(): N.Expression {
    const startPos = this.state.start;
    const startLoc = this.state.startLoc;
    return this.parseSubscripts(this.parseExprAtom(), startPos, startLoc, true);
  } // Parse an atomic expression — either a single token that is an
  // expression, an expression started by a keyword like `function` or
  // `new`, or an expression wrapped in punctuation like `()`, `[]`,
  // or `{}`.


  parseExprAtom(refShorthandDefaultPos?: ?Pos): N.Expression {
    const canBeArrow = this.state.potentialArrowAt === this.state.start;
    let node;

    switch (this.state.type) {
      case tt._super:
        if (!this.state.inMethod && !this.state.inClassProperty && !this.options.allowSuperOutsideMethod) {
          this.raise(this.state.start, "'super' outside of function or class");
        }

        node = this.startNode();
        this.next();

        if (!this.match(tt.parenL) && !this.match(tt.bracketL) && !this.match(tt.dot)) {
          this.unexpected();
        }

        if (this.match(tt.parenL) && this.state.inMethod !== "constructor" && !this.options.allowSuperOutsideMethod) {
          this.raise(node.start, "super() is only valid inside a class constructor. Make sure the method name is spelled exactly as 'constructor'.");
        }

        return this.finishNode(node, "Super");

      case tt._import:
        if (this.hasPlugin("importMeta") && this.lookahead().type === tt.dot) {
          return this.parseImportMetaProperty();
        }

        if (!this.hasPlugin("dynamicImport")) this.unexpected();
        node = this.startNode();
        this.next();

        if (!this.match(tt.parenL)) {
          this.unexpected(null, tt.parenL);
        }

        return this.finishNode(node, "Import");

      case tt._this:
        node = this.startNode();
        this.next();
        return this.finishNode(node, "ThisExpression");

      case tt._yield:
        if (this.state.inGenerator) this.unexpected();

      case tt.name:
        node = this.startNode();
        const allowAwait = this.state.value === "await" && this.state.inAsync;
        const allowYield = this.shouldAllowYieldIdentifier();
        const id = this.parseIdentifier(allowAwait || allowYield);

        if (id.name === "await") {
          if (this.state.inAsync || this.inModule) {
            return this.parseAwait(node);
          }
        } else if (id.name === "async" && this.match(tt._function) && !this.canInsertSemicolon()) {
          this.next();
          return this.parseFunction(node, false, false, true);
        } else if (canBeArrow && id.name === "async" && this.match(tt.name)) {
          const params = [this.parseIdentifier()];
          this.expect(tt.arrow); // let foo = bar => {};

          return this.parseArrowExpression(node, params, true);
        }

        if (canBeArrow && !this.canInsertSemicolon() && this.eat(tt.arrow)) {
          return this.parseArrowExpression(node, [id]);
        }

        return id;

      case tt._do:
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

      case tt.regexp:
        const value = this.state.value;
        node = this.parseLiteral(value.value, "RegExpLiteral");
        node.pattern = value.pattern;
        node.flags = value.flags;
        return node;

      case tt.num:
        return this.parseLiteral(this.state.value, "NumericLiteral");

      case tt.bigint:
        return this.parseLiteral(this.state.value, "BigIntLiteral");

      case tt.string:
        return this.parseLiteral(this.state.value, "StringLiteral");

      case tt._null:
        node = this.startNode();
        this.next();
        return this.finishNode(node, "NullLiteral");

      case tt._true:
      case tt._false:
        return this.parseBooleanLiteral();

      case tt.parenL:
        return this.parseParenAndDistinguishExpression(canBeArrow);

      case tt.bracketL:
        node = this.startNode();
        this.next();
        node.elements = this.parseExprList(tt.bracketR, true, refShorthandDefaultPos);
        this.toReferencedList(node.elements);
        return this.finishNode(node, "ArrayExpression");

      case tt.braceL:
        return this.parseObj(false, refShorthandDefaultPos);

      case tt._function:
        return this.parseFunctionExpression();

      case tt.at:
        this.parseDecorators();

      case tt._class:
        node = this.startNode();
        this.takeDecorators(node);
        return this.parseClass(node, false);

      case tt.hash:
        if (this.hasPlugin("classPrivateProperties")) {
          return this.parseMaybePrivateName();
        } else {
          throw this.unexpected();
        }

      case tt._new:
        return this.parseNew();

      case tt.backQuote:
        return this.parseTemplate(false);

      case tt.doubleColon:
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

  parseBooleanLiteral(): N.BooleanLiteral {
    const node = this.startNode();
    node.value = this.match(tt._true);
    this.next();
    return this.finishNode(node, "BooleanLiteral");
  }

  parseMaybePrivateName(): N.PrivateName | N.Identifier {
    const isPrivate = this.eat(tt.hash);

    if (isPrivate) {
      const node = this.startNode();
      node.name = this.parseIdentifier(true);
      return this.finishNode(node, "PrivateName");
    } else {
      return this.parseIdentifier(true);
    }
  }

  parseFunctionExpression(): N.FunctionExpression | N.MetaProperty {
    const node = this.startNode();
    const meta = this.parseIdentifier(true);

    if (this.state.inGenerator && this.hasPlugin("functionSent") && this.eat(tt.dot)) {
      return this.parseMetaProperty(node, meta, "sent");
    }

    return this.parseFunction(node, false);
  }

  parseMetaProperty(node: N.MetaProperty, meta: N.Identifier, propertyName: string): N.MetaProperty {
    node.meta = meta;
    node.property = this.parseIdentifier(true);

    if (node.property.name !== propertyName) {
      this.raise(node.property.start, `The only valid meta property for ${meta.name} is ${meta.name}.${propertyName}`);
    }

    return this.finishNode(node, "MetaProperty");
  }

  parseImportMetaProperty(): N.MetaProperty {
    const node = this.startNode();
    const id = this.parseIdentifier(true);
    this.expect(tt.dot);

    if (!this.inModule) {
      this.raise(id.start, `import.meta may appear only with 'sourceType: "module"'`);
    }

    return this.parseMetaProperty(node, id, "meta");
  }

  parseLiteral<T: N.Literal>(value: any, type:
  /*T["kind"]*/
  string, startPos?: number, startLoc?: Position): T {
    startPos = startPos || this.state.start;
    startLoc = startLoc || this.state.startLoc;
    const node = this.startNodeAt(startPos, startLoc);
    this.addExtra(node, "rawValue", value);
    this.addExtra(node, "raw", this.input.slice(startPos, this.state.end));
    node.value = value;
    this.next();
    return this.finishNode(node, type);
  }

  parseParenExpression(): N.Expression {
    this.expect(tt.parenL);
    const val = this.parseExpression();
    this.expect(tt.parenR);
    return val;
  }

  parseParenAndDistinguishExpression(canBeArrow: boolean): N.Expression {
    const startPos = this.state.start;
    const startLoc = this.state.startLoc;
    let val;
    this.expect(tt.parenL);
    const innerStartPos = this.state.start;
    const innerStartLoc = this.state.startLoc;
    const exprList = [];
    const refShorthandDefaultPos = {
      start: 0
    };
    const refNeedsArrowPos = {
      start: 0
    };
    let first = true;
    let spreadStart;
    let optionalCommaStart;

    while (!this.match(tt.parenR)) {
      if (first) {
        first = false;
      } else {
        this.expect(tt.comma, refNeedsArrowPos.start || null);

        if (this.match(tt.parenR)) {
          optionalCommaStart = this.state.start;
          break;
        }
      }

      if (this.match(tt.ellipsis)) {
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
    this.expect(tt.parenR);
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

  shouldParseArrow(): boolean {
    return !this.canInsertSemicolon();
  }

  parseArrow(node: N.ArrowFunctionExpression): ?N.ArrowFunctionExpression {
    if (this.eat(tt.arrow)) {
      return node;
    }
  }

  parseParenItem(node: N.Expression, startPos: number, // eslint-disable-next-line no-unused-vars
  startLoc: Position): N.Expression {
    return node;
  } // New's precedence is slightly tricky. It must allow its argument
  // to be a `[]` or dot subscript expression, but not a call — at
  // least, not without wrapping it in parentheses. Thus, it uses the


  parseNew(): N.NewExpression | N.MetaProperty {
    const node = this.startNode();
    const meta = this.parseIdentifier(true);

    if (this.eat(tt.dot)) {
      const metaProp = this.parseMetaProperty(node, meta, "target");

      if (!this.state.inFunction) {
        this.raise(metaProp.property.start, "new.target can only be used in functions");
      }

      return metaProp;
    }

    node.callee = this.parseNoCallExpr();
    if (this.eat(tt.questionDot)) node.optional = true;
    this.parseNewArguments(node);
    return this.finishNode(node, "NewExpression");
  }

  parseNewArguments(node: N.NewExpression): void {
    if (this.eat(tt.parenL)) {
      const args = this.parseExprList(tt.parenR);
      this.toReferencedList(args); // $FlowFixMe (parseExprList should be all non-null in this case)

      node.arguments = args;
    } else {
      node.arguments = [];
    }
  } // Parse template expression.


  parseTemplateElement(isTagged: boolean): N.TemplateElement {
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
    elem.tail = this.match(tt.backQuote);
    return this.finishNode(elem, "TemplateElement");
  }

  parseTemplate(isTagged: boolean): N.TemplateLiteral {
    const node = this.startNode();
    this.next();
    node.expressions = [];
    let curElt = this.parseTemplateElement(isTagged);
    node.quasis = [curElt];

    while (!curElt.tail) {
      this.expect(tt.dollarBraceL);
      node.expressions.push(this.parseExpression());
      this.expect(tt.braceR);
      node.quasis.push(curElt = this.parseTemplateElement(isTagged));
    }

    this.next();
    return this.finishNode(node, "TemplateLiteral");
  } // Parse an object literal or binding pattern.


  parseObj<T: N.ObjectPattern | N.ObjectExpression>(isPattern: boolean, refShorthandDefaultPos?: ?Pos): T {
    let decorators = [];
    const propHash = Object.create(null);
    let first = true;
    const node = this.startNode();
    node.properties = [];
    this.next();
    let firstRestLocation = null;

    while (!this.eat(tt.braceR)) {
      if (first) {
        first = false;
      } else {
        this.expect(tt.comma);
        if (this.eat(tt.braceR)) break;
      }

      if (this.match(tt.at)) {
        if (this.hasPlugin("decorators2")) {
          this.raise(this.state.start, "Stage 2 decorators disallow object literal property decorators");
        } else {
          // we needn't check if decorators (stage 0) plugin is enabled since it's checked by
          // the call to this.parseDecorator
          while (this.match(tt.at)) {
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

      if (this.hasPlugin("objectRestSpread") && this.match(tt.ellipsis)) {
        prop = this.parseSpread(isPattern ? {
          start: 0
        } : undefined);
        prop.type = isPattern ? "RestElement" : "SpreadElement";
        if (isPattern) this.toAssignable(prop.argument, true, "object pattern");
        node.properties.push(prop);

        if (isPattern) {
          const position = this.state.start;

          if (firstRestLocation !== null) {
            this.unexpected(firstRestLocation, "Cannot have multiple rest elements when destructuring");
          } else if (this.eat(tt.braceR)) {
            break;
          } else if (this.match(tt.comma) && this.lookahead().type === tt.braceR) {
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
        isGenerator = this.eat(tt.star);
      }

      if (!isPattern && this.isContextual("async")) {
        if (isGenerator) this.unexpected();
        const asyncId = this.parseIdentifier();

        if (this.match(tt.colon) || this.match(tt.parenL) || this.match(tt.braceR) || this.match(tt.eq) || this.match(tt.comma)) {
          prop.key = asyncId;
          prop.computed = false;
        } else {
          isAsync = true;
          if (this.hasPlugin("asyncGenerators")) isGenerator = this.eat(tt.star);
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

  isGetterOrSetterMethod(prop: N.ObjectMethod, isPattern: boolean): boolean {
    return !isPattern && !prop.computed && prop.key.type === "Identifier" && (prop.key.name === "get" || prop.key.name === "set") && (this.match(tt.string) || // get "string"() {}
    this.match(tt.num) || // get 1() {}
    this.match(tt.bracketL) || // get ["string"]() {}
    this.match(tt.name) || // get foo() {}
    !!this.state.type.keyword) // get debugger() {}
    ;
  } // get methods aren't allowed to have any parameters
  // set methods must have exactly 1 parameter


  checkGetterSetterParamCount(method: N.ObjectMethod | N.ClassMethod): void {
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

  parseObjectMethod(prop: N.ObjectMethod, isGenerator: boolean, isAsync: boolean, isPattern: boolean): ?N.ObjectMethod {
    if (isAsync || isGenerator || this.match(tt.parenL)) {
      if (isPattern) this.unexpected();
      prop.kind = "method";
      prop.method = true;
      return this.parseMethod(prop, isGenerator, isAsync,
      /* isConstructor */
      false, "ObjectMethod");
    }

    if (this.isGetterOrSetterMethod(prop, isPattern)) {
      if (isGenerator || isAsync) this.unexpected();
      prop.kind = prop.key.name;
      this.parsePropertyName(prop);
      this.parseMethod(prop,
      /* isGenerator */
      false,
      /* isAsync */
      false,
      /* isConstructor */
      false, "ObjectMethod");
      this.checkGetterSetterParamCount(prop);
      return prop;
    }
  }

  parseObjectProperty(prop: N.ObjectProperty, startPos: ?number, startLoc: ?Position, isPattern: boolean, refShorthandDefaultPos: ?Pos): ?N.ObjectProperty {
    prop.shorthand = false;

    if (this.eat(tt.colon)) {
      prop.value = isPattern ? this.parseMaybeDefault(this.state.start, this.state.startLoc) : this.parseMaybeAssign(false, refShorthandDefaultPos);
      return this.finishNode(prop, "ObjectProperty");
    }

    if (!prop.computed && prop.key.type === "Identifier") {
      this.checkReservedWord(prop.key.name, prop.key.start, true, true);

      if (isPattern) {
        prop.value = this.parseMaybeDefault(startPos, startLoc, prop.key.__clone());
      } else if (this.match(tt.eq) && refShorthandDefaultPos) {
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

  parseObjPropValue(prop: any, startPos: ?number, startLoc: ?Position, isGenerator: boolean, isAsync: boolean, isPattern: boolean, refShorthandDefaultPos: ?Pos): void {
    const node = this.parseObjectMethod(prop, isGenerator, isAsync, isPattern) || this.parseObjectProperty(prop, startPos, startLoc, isPattern, refShorthandDefaultPos);
    if (!node) this.unexpected(); // $FlowFixMe

    return node;
  }

  parsePropertyName(prop: N.ObjectOrClassMember | N.TsNamedTypeElementBase): N.Expression {
    if (this.eat(tt.bracketL)) {
      prop.computed = true;
      prop.key = this.parseMaybeAssign();
      this.expect(tt.bracketR);
    } else {
      prop.computed = false;
      const oldInPropertyName = this.state.inPropertyName;
      this.state.inPropertyName = true;
      prop.key = this.match(tt.num) || this.match(tt.string) ? this.parseExprAtom() : this.parseIdentifier(true);
      this.state.inPropertyName = oldInPropertyName;
    }

    return prop.key;
  } // Initialize empty function node.


  initFunction(node: N.BodilessFunctionOrMethodBase, isAsync: ?boolean): void {
    node.id = null;
    node.generator = false;
    node.expression = false;
    node.async = !!isAsync;
  } // Parse object or class method.


  parseMethod<T: N.MethodLike>(node: T, isGenerator: boolean, isAsync: boolean, isConstructor: boolean, type: string): T {
    const oldInMethod = this.state.inMethod;
    this.state.inMethod = node.kind || true;
    this.initFunction(node, isAsync);
    this.expect(tt.parenL);
    const allowModifiers = isConstructor; // For TypeScript parameter properties

    node.params = this.parseBindingList(tt.parenR,
    /* allowEmpty */
    false, allowModifiers);
    node.generator = !!isGenerator;
    this.parseFunctionBodyAndFinish(node, type);
    this.state.inMethod = oldInMethod;
    return node;
  } // Parse arrow function expression with given parameters.


  parseArrowExpression(node: N.ArrowFunctionExpression, params: N.Expression[], isAsync?: boolean): N.ArrowFunctionExpression {
    this.initFunction(node, isAsync);
    node.params = this.toAssignableList(params, true, "arrow function parameters");
    this.parseFunctionBody(node, true);
    return this.finishNode(node, "ArrowFunctionExpression");
  }

  isStrictBody(node: {
    body: N.BlockStatement
  }, isExpression: ?boolean): boolean {
    if (!isExpression && node.body.directives.length) {
      for (const directive of node.body.directives) {
        if (directive.value.value === "use strict") {
          return true;
        }
      }
    }

    return false;
  }

  parseFunctionBodyAndFinish(node: N.BodilessFunctionOrMethodBase, type: string, allowExpressionBody?: boolean): void {
    // $FlowIgnore (node is not bodiless if we get here)
    this.parseFunctionBody(node, allowExpressionBody);
    this.finishNode(node, type);
  } // Parse function body and check parameters.


  parseFunctionBody(node: N.Function, allowExpression: ?boolean): void {
    const isExpression = allowExpression && !this.match(tt.braceL);
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

    this.state.inAsync = oldInAsync; // If this is a strict mode function, verify that argument names
    // are not repeated, and it does not try to bind the words `eval`
    // or `arguments`.

    const isStrict = this.isStrictBody(node, isExpression); // Also check when allowExpression === true for arrow functions

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
  } // Parses a comma-separated list of expressions, and returns them as
  // an array. `close` is the token type that ends the list, and
  // `allowEmpty` can be turned on to allow subsequent commas with
  // nothing in between them to be parsed as `null` (which is needed
  // for array literals).


  parseExprList(close: TokenType, allowEmpty?: boolean, refShorthandDefaultPos?: ?Pos): $ReadOnlyArray<?N.Expression> {
    const elts = [];
    let first = true;

    while (!this.eat(close)) {
      if (first) {
        first = false;
      } else {
        this.expect(tt.comma);
        if (this.eat(close)) break;
      }

      elts.push(this.parseExprListItem(allowEmpty, refShorthandDefaultPos));
    }

    return elts;
  }

  parseExprListItem(allowEmpty: ?boolean, refShorthandDefaultPos: ?Pos, refNeedsArrowPos: ?Pos): ?N.Expression {
    let elt;

    if (allowEmpty && this.match(tt.comma)) {
      elt = null;
    } else if (this.match(tt.ellipsis)) {
      elt = this.parseSpread(refShorthandDefaultPos);
    } else {
      elt = this.parseMaybeAssign(false, refShorthandDefaultPos, this.parseParenItem, refNeedsArrowPos);
    }

    return elt;
  } // Parse the next token as an identifier. If `liberal` is true (used
  // when parsing properties), it will also convert keywords into
  // identifiers.


  parseIdentifier(liberal?: boolean): N.Identifier {
    const node = this.startNode();
    const name = this.parseIdentifierName(node.start, liberal);
    node.name = name;
    node.loc.identifierName = name;
    return this.finishNode(node, "Identifier");
  }

  parseIdentifierName(pos: number, liberal?: boolean): string {
    if (!liberal) {
      this.checkReservedWord(this.state.value, this.state.start, !!this.state.type.keyword, false);
    }

    let name: string;

    if (this.match(tt.name)) {
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

  checkReservedWord(word: string, startLoc: number, checkKeywords: boolean, isBinding: boolean): void {
    if (this.isReservedWord(word) || checkKeywords && this.isKeyword(word)) {
      this.raise(startLoc, word + " is a reserved word");
    }

    if (this.state.strict && (reservedWords.strict(word) || isBinding && reservedWords.strictBind(word))) {
      this.raise(startLoc, word + " is a reserved word in strict mode");
    }
  } // Parses await expression inside async function.


  parseAwait(node: N.AwaitExpression): N.AwaitExpression {
    // istanbul ignore next: this condition is checked at the call site so won't be hit here
    if (!this.state.inAsync) {
      this.unexpected();
    }

    if (this.match(tt.star)) {
      this.raise(node.start, "await* has been removed from the async functions proposal. Use Promise.all() instead.");
    }

    node.argument = this.parseMaybeUnary();
    return this.finishNode(node, "AwaitExpression");
  } // Parses yield expression inside generator.


  parseYield(): N.YieldExpression {
    const node = this.startNode();
    this.next();

    if (this.match(tt.semi) || this.canInsertSemicolon() || !this.match(tt.star) && !this.state.type.startsExpr) {
      node.delegate = false;
      node.argument = null;
    } else {
      node.delegate = this.eat(tt.star);
      node.argument = this.parseMaybeAssign();
    }

    return this.finishNode(node, "YieldExpression");
  }

}
// @flow
import type { Options } from "../options";
import type { File } from "../types";
import { getOptions } from "../options";
import StatementParser from "./statement";
export const plugins: {
  [name: string]: (superClass: Class<Parser>) => Class<Parser>
} = {};
export default class Parser extends StatementParser {
  constructor(options: ?Options, input: string) {
    options = getOptions(options);
    super(options, input);
    this.options = options;
    this.inModule = this.options.sourceType === "module";
    this.input = input;
    this.plugins = pluginsMap(this.options.plugins);
    this.filename = options.sourceFilename; // If enabled, skip leading hashbang line.

    if (this.state.pos === 0 && this.input[0] === "#" && this.input[1] === "!") {
      this.skipLineComment(2);
    }
  }

  parse(): File {
    const file = this.startNode();
    const program = this.startNode();
    this.nextToken();
    return this.parseTopLevel(file, program);
  }

}

function pluginsMap(pluginList: $ReadOnlyArray<string>): {
  [key: string]: boolean
} {
  const pluginMap = {};

  for (const name of pluginList) {
    pluginMap[name] = true;
  }

  return pluginMap;
}
// @flow
import { getLineInfo } from "../util/location";
import CommentsParser from "./comments"; // This function is used to raise exceptions on parse errors. It
// takes an offset integer (into the current `input`) to indicate
// the location of the error, attaches the position to the end
// of the error message, and then raises a `SyntaxError` with that
// message.

export default class LocationParser extends CommentsParser {
  raise(pos: number, message: string): empty {
    const loc = getLineInfo(this.input, pos);
    message += ` (${loc.line}:${loc.column})`; // $FlowIgnore

    const err: SyntaxError & {
      pos: number,
      loc: Position,
    } = new SyntaxError(message);
    err.pos = pos;
    err.loc = loc;
    throw err;
  }

}
// @flow
import { types as tt, type TokenType } from "../tokenizer/types";
import type { TSParameterProperty, Decorator, Expression, Identifier, Node, ObjectExpression, ObjectPattern, Pattern, RestElement, SpreadElement } from "../types";
import type { Pos, Position } from "../util/location";
import { NodeUtils } from "./node";
export default class LValParser extends NodeUtils {
  // Forward-declaration: defined in expression.js
  +checkReservedWord: (word: string, startLoc: number, checkKeywords: boolean, isBinding: boolean) => void;
  +parseIdentifier: (liberal?: boolean) => Identifier;
  +parseMaybeAssign: (noIn?: ?boolean, refShorthandDefaultPos?: ?Pos, afterLeftParse?: Function, refNeedsArrowPos?: ?Pos) => Expression;
  +parseObj: <T: ObjectPattern | ObjectExpression>(isPattern: boolean, refShorthandDefaultPos?: ?Pos) => T; // Forward-declaration: defined in statement.js

  +parseDecorator: () => Decorator; // Convert existing expression atom to assignable pattern
  // if possible.

  toAssignable(node: Node, isBinding: ?boolean, contextDescription: string): Node {
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
            const message = "Invalid left-hand side" + (contextDescription ? " in " + contextDescription :
            /* istanbul ignore next */
            "expression");
            this.raise(node.start, message);
          }
      }
    }

    return node;
  } // Convert list of expression atoms to binding list.


  toAssignableList(exprList: Expression[], isBinding: ?boolean, contextDescription: string): $ReadOnlyArray<Pattern> {
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
  } // Convert list of expression atoms to a list of


  toReferencedList(exprList: $ReadOnlyArray<?Expression>): $ReadOnlyArray<?Expression> {
    return exprList;
  } // Parses spread element.


  parseSpread<T: RestElement | SpreadElement>(refShorthandDefaultPos: ?Pos): T {
    const node = this.startNode();
    this.next();
    node.argument = this.parseMaybeAssign(false, refShorthandDefaultPos);
    return this.finishNode(node, "SpreadElement");
  }

  parseRest(): RestElement {
    const node = this.startNode();
    this.next();
    node.argument = this.parseBindingAtom();
    return this.finishNode(node, "RestElement");
  }

  shouldAllowYieldIdentifier(): boolean {
    return this.match(tt._yield) && !this.state.strict && !this.state.inGenerator;
  }

  parseBindingIdentifier(): Identifier {
    return this.parseIdentifier(this.shouldAllowYieldIdentifier());
  } // Parses lvalue (assignable) atom.


  parseBindingAtom(): Pattern {
    switch (this.state.type) {
      case tt._yield:
      case tt.name:
        return this.parseBindingIdentifier();

      case tt.bracketL:
        const node = this.startNode();
        this.next();
        node.elements = this.parseBindingList(tt.bracketR, true);
        return this.finishNode(node, "ArrayPattern");

      case tt.braceL:
        return this.parseObj(true);

      default:
        throw this.unexpected();
    }
  }

  parseBindingList(close: TokenType, allowEmpty?: boolean, allowModifiers?: boolean): $ReadOnlyArray<Pattern | TSParameterProperty> {
    const elts: Array<Pattern | TSParameterProperty> = [];
    let first = true;

    while (!this.eat(close)) {
      if (first) {
        first = false;
      } else {
        this.expect(tt.comma);
      }

      if (allowEmpty && this.match(tt.comma)) {
        // $FlowFixMe This method returns `$ReadOnlyArray<?Pattern>` if `allowEmpty` is set.
        elts.push(null);
      } else if (this.eat(close)) {
        break;
      } else if (this.match(tt.ellipsis)) {
        elts.push(this.parseAssignableListItemTypes(this.parseRest()));
        this.expect(close);
        break;
      } else {
        const decorators = [];

        if (this.match(tt.at) && this.hasPlugin("decorators2")) {
          this.raise(this.state.start, "Stage 2 decorators cannot be used to decorate parameters");
        }

        while (this.match(tt.at)) {
          decorators.push(this.parseDecorator());
        }

        elts.push(this.parseAssignableListItem(allowModifiers, decorators));
      }
    }

    return elts;
  }

  parseAssignableListItem(allowModifiers: ?boolean, decorators: Decorator[]): Pattern | TSParameterProperty {
    const left = this.parseMaybeDefault();
    this.parseAssignableListItemTypes(left);
    const elt = this.parseMaybeDefault(left.start, left.loc.start, left);

    if (decorators.length) {
      left.decorators = decorators;
    }

    return elt;
  }

  parseAssignableListItemTypes(param: Pattern): Pattern {
    return param;
  } // Parses assignment pattern around given atom if possible.


  parseMaybeDefault(startPos?: ?number, startLoc?: ?Position, left?: ?Pattern): Pattern {
    startLoc = startLoc || this.state.startLoc;
    startPos = startPos || this.state.start;
    left = left || this.parseBindingAtom();
    if (!this.eat(tt.eq)) return left;
    const node = this.startNodeAt(startPos, startLoc);
    node.left = left;
    node.right = this.parseMaybeAssign();
    return this.finishNode(node, "AssignmentPattern");
  } // Verify that a node is an lval — something that can be assigned
  // to.


  checkLVal(expr: Expression, isBinding: ?boolean, checkClashes: ?{
    [key: string]: boolean
  }, contextDescription: string): void {
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
          const message = (isBinding ?
          /* istanbul ignore next */
          "Binding invalid" : "Invalid") + " left-hand side" + (contextDescription ? " in " + contextDescription :
          /* istanbul ignore next */
          "expression");
          this.raise(expr.start, message);
        }
    }
  }

}
// @flow
import Parser from "./index";
import UtilParser from "./util";
import type { SourceLocation, Position } from "../util/location";
import type { Comment, Node as NodeType, NodeBase } from "../types"; // Start an AST node, attaching a start offset.

const commentKeys = ["leadingComments", "trailingComments", "innerComments"];

class Node implements NodeBase {
  constructor(parser: Parser, pos: number, loc: Position) {
    this.type = "";
    this.start = pos;
    this.end = 0;
    this.loc = {
      start: loc,
      // $FlowIgnore (may start as null, but initialized later)
      end: undefined
    };
    if (parser && parser.options.ranges) this.range = [pos, 0]; // $FlowIgnore (only add if option is enabled)

    if (parser && parser.filename) this.loc.filename = parser.filename;
  }

  type: string;
  start: number;
  end: number;
  loc: SourceLocation;
  range: [number, number];
  leadingComments: ?Array<Comment>;
  trailingComments: ?Array<Comment>;
  innerComments: ?Array<Comment>;
  extra: {
    [key: string]: any
  };

  __clone(): this {
    // $FlowIgnore
    const node2: any = new Node();

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

export class NodeUtils extends UtilParser {
  startNode<T: NodeType>(): T {
    // $FlowIgnore
    return new Node(this, this.state.start, this.state.startLoc);
  }

  startNodeAt<T: NodeType>(pos: number, loc: Position): T {
    // $FlowIgnore
    return new Node(this, pos, loc);
  }
  /** Start a new node with a previous node's location. */


  startNodeAtNode<T: NodeType>(type: NodeType): T {
    return this.startNodeAt(type.start, type.loc.start);
  } // Finish an AST node, adding `type` and `end` properties.


  finishNode<T: NodeType>(node: T, type: string): T {
    return this.finishNodeAt(node, type, this.state.lastTokEnd, this.state.lastTokEndLoc);
  } // Finish node at given position


  finishNodeAt<T: NodeType>(node: T, type: string, pos: number, loc: Position): T {
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


  resetStartLocationFromNode(node: NodeBase, locationNode: NodeBase): void {
    node.start = locationNode.start;
    node.loc.start = locationNode.loc.start;
    if (this.options.ranges) node.range[0] = locationNode.range[0];
  }

}
/* eslint max-len: 0 */
// @flow
import * as N from "../types";
import { types as tt, type TokenType } from "../tokenizer/types";
import ExpressionParser from "./expression";
import type { Position } from "../util/location";
import { lineBreak } from "../util/whitespace"; // Reused empty array added for node fields that are always empty.

const empty = [];
const loopLabel = {
  kind: "loop"
},
      switchLabel = {
  kind: "switch"
};
export default class StatementParser extends ExpressionParser {
  // ### Statement parsing
  // Parse a program. Initializes the parser, reads any number of
  // statements, and wraps them in a Program node.  Optionally takes a
  // `program` argument.  If present, the statements will be appended
  // to its body instead of creating a new node.
  parseTopLevel(file: N.File, program: N.Program): N.File {
    program.sourceType = this.options.sourceType;
    this.parseBlockBody(program, true, true, tt.eof);
    file.program = this.finishNode(program, "Program");
    file.comments = this.state.comments;
    if (this.options.tokens) file.tokens = this.state.tokens;
    return this.finishNode(file, "File");
  } // TODO


  stmtToDirective(stmt: N.Statement): N.Directive {
    const expr = stmt.expression;
    const directiveLiteral = this.startNodeAt(expr.start, expr.loc.start);
    const directive = this.startNodeAt(stmt.start, stmt.loc.start);
    const raw = this.input.slice(expr.start, expr.end);
    const val = directiveLiteral.value = raw.slice(1, -1); // remove quotes

    this.addExtra(directiveLiteral, "raw", raw);
    this.addExtra(directiveLiteral, "rawValue", val);
    directive.value = this.finishNodeAt(directiveLiteral, "DirectiveLiteral", expr.end, expr.loc.end);
    return this.finishNodeAt(directive, "Directive", stmt.end, stmt.loc.end);
  } // Parse a single statement.
  //
  // If expecting a statement and finding a slash operator, parse a
  // regular expression literal. This is to handle cases like
  // `if (foo) /blah/.exec(foo)`, where looking at the previous token
  // does not help.


  parseStatement(declaration: boolean, topLevel?: boolean): N.Statement {
    if (this.match(tt.at)) {
      this.parseDecorators(true);
    }

    return this.parseStatementContent(declaration, topLevel);
  }

  parseStatementContent(declaration: boolean, topLevel: ?boolean): N.Statement {
    const starttype = this.state.type;
    const node = this.startNode(); // Most types of statements are recognized by the keyword they
    // start with. Many are trivial to parse, some require a bit of
    // complexity.

    switch (starttype) {
      case tt._break:
      case tt._continue:
        // $FlowFixMe
        return this.parseBreakContinueStatement(node, starttype.keyword);

      case tt._debugger:
        return this.parseDebuggerStatement(node);

      case tt._do:
        return this.parseDoStatement(node);

      case tt._for:
        return this.parseForStatement(node);

      case tt._function:
        if (this.lookahead().type === tt.dot) break;
        if (!declaration) this.unexpected();
        return this.parseFunctionStatement(node);

      case tt._class:
        if (!declaration) this.unexpected();
        return this.parseClass(node, true);

      case tt._if:
        return this.parseIfStatement(node);

      case tt._return:
        return this.parseReturnStatement(node);

      case tt._switch:
        return this.parseSwitchStatement(node);

      case tt._throw:
        return this.parseThrowStatement(node);

      case tt._try:
        return this.parseTryStatement(node);

      case tt._let:
      case tt._const:
        if (!declaration) this.unexpected();
      // NOTE: falls through to _var

      case tt._var:
        return this.parseVarStatement(node, starttype);

      case tt._while:
        return this.parseWhileStatement(node);

      case tt._with:
        return this.parseWithStatement(node);

      case tt.braceL:
        return this.parseBlock();

      case tt.semi:
        return this.parseEmptyStatement(node);

      case tt._export:
      case tt._import:
        if (this.hasPlugin("dynamicImport") && this.lookahead().type === tt.parenL || this.hasPlugin("importMeta") && this.lookahead().type === tt.dot) break;

        if (!this.options.allowImportExportEverywhere) {
          if (!topLevel) {
            this.raise(this.state.start, "'import' and 'export' may only appear at the top level");
          }

          if (!this.inModule) {
            this.raise(this.state.start, `'import' and 'export' may appear only with 'sourceType: "module"'`);
          }
        }

        this.next();

        if (starttype == tt._import) {
          return this.parseImport(node);
        } else {
          return this.parseExport(node);
        }

      case tt.name:
        if (this.state.value === "async") {
          // peek ahead and see if next token is a function
          const state = this.state.clone();
          this.next();

          if (this.match(tt._function) && !this.canInsertSemicolon()) {
            this.expect(tt._function);
            return this.parseFunction(node, true, false, true);
          } else {
            this.state = state;
          }
        }

    } // If the statement does not start with a statement keyword or a
    // brace, it's an ExpressionStatement or LabeledStatement. We
    // simply start parsing an expression, and afterwards, if the
    // next token is a colon and the expression was a simple
    // Identifier node, we switch to interpreting it as a label.


    const maybeName = this.state.value;
    const expr = this.parseExpression();

    if (starttype === tt.name && expr.type === "Identifier" && this.eat(tt.colon)) {
      return this.parseLabeledStatement(node, maybeName, expr);
    } else {
      return this.parseExpressionStatement(node, expr);
    }
  }

  takeDecorators(node: N.HasDecorators): void {
    const decorators = this.state.decoratorStack[this.state.decoratorStack.length - 1];

    if (decorators.length) {
      node.decorators = decorators;

      if (this.hasPlugin("decorators2")) {
        this.resetStartLocationFromNode(node, decorators[0]);
      }

      this.state.decoratorStack[this.state.decoratorStack.length - 1] = [];
    }
  }

  parseDecorators(allowExport?: boolean): void {
    if (this.hasPlugin("decorators2")) {
      allowExport = false;
    }

    const currentContextDecorators = this.state.decoratorStack[this.state.decoratorStack.length - 1];

    while (this.match(tt.at)) {
      const decorator = this.parseDecorator();
      currentContextDecorators.push(decorator);
    }

    if (this.match(tt._export)) {
      if (allowExport) {
        return;
      } else {
        this.raise(this.state.start, "Using the export keyword between a decorator and a class is not allowed. Please use `export @dec class` instead");
      }
    }

    if (!this.match(tt._class)) {
      this.raise(this.state.start, "Leading decorators must be attached to a class declaration");
    }
  }

  parseDecorator(): N.Decorator {
    if (!(this.hasPlugin("decorators") || this.hasPlugin("decorators2"))) {
      this.unexpected();
    }

    const node = this.startNode();
    this.next();

    if (this.hasPlugin("decorators2")) {
      const startPos = this.state.start;
      const startLoc = this.state.startLoc;
      let expr = this.parseIdentifier(false);

      while (this.eat(tt.dot)) {
        const node = this.startNodeAt(startPos, startLoc);
        node.object = expr;
        node.property = this.parseIdentifier(true);
        node.computed = false;
        expr = this.finishNode(node, "MemberExpression");
      }

      if (this.eat(tt.parenL)) {
        const node = this.startNodeAt(startPos, startLoc);
        node.callee = expr; // Every time a decorator class expression is evaluated, a new empty array is pushed onto the stack
        // So that the decorators of any nested class expressions will be dealt with separately

        this.state.decoratorStack.push([]);
        node.arguments = this.parseCallExpressionArguments(tt.parenR, false);
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

  parseBreakContinueStatement(node: N.BreakStatement | N.ContinueStatement, keyword: string): N.BreakStatement | N.ContinueStatement {
    const isBreak = keyword === "break";
    this.next();

    if (this.isLineTerminator()) {
      node.label = null;
    } else if (!this.match(tt.name)) {
      this.unexpected();
    } else {
      node.label = this.parseIdentifier();
      this.semicolon();
    } // Verify that there is an actual destination to break or
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

  parseDebuggerStatement(node: N.DebuggerStatement): N.DebuggerStatement {
    this.next();
    this.semicolon();
    return this.finishNode(node, "DebuggerStatement");
  }

  parseDoStatement(node: N.DoWhileStatement): N.DoWhileStatement {
    this.next();
    this.state.labels.push(loopLabel);
    node.body = this.parseStatement(false);
    this.state.labels.pop();
    this.expect(tt._while);
    node.test = this.parseParenExpression();
    this.eat(tt.semi);
    return this.finishNode(node, "DoWhileStatement");
  } // Disambiguating between a `for` and a `for`/`in` or `for`/`of`
  // loop is non-trivial. Basically, we have to parse the init `var`
  // statement or expression, disallowing the `in` operator (see
  // the second parameter to `parseExpression`), and then check
  // whether the next token is `in` or `of`. When there is no init
  // part (semicolon immediately after the opening parenthesis), it
  // is a regular `for` loop.


  parseForStatement(node: N.Node): N.ForLike {
    this.next();
    this.state.labels.push(loopLabel);
    let forAwait = false;

    if (this.hasPlugin("asyncGenerators") && this.state.inAsync && this.isContextual("await")) {
      forAwait = true;
      this.next();
    }

    this.expect(tt.parenL);

    if (this.match(tt.semi)) {
      if (forAwait) {
        this.unexpected();
      }

      return this.parseFor(node, null);
    }

    if (this.match(tt._var) || this.match(tt._let) || this.match(tt._const)) {
      const init = this.startNode();
      const varKind = this.state.type;
      this.next();
      this.parseVar(init, true, varKind);
      this.finishNode(init, "VariableDeclaration");

      if (this.match(tt._in) || this.isContextual("of")) {
        if (init.declarations.length === 1 && !init.declarations[0].init) {
          return this.parseForIn(node, init, forAwait);
        }
      }

      if (forAwait) {
        this.unexpected();
      }

      return this.parseFor(node, init);
    }

    const refShorthandDefaultPos = {
      start: 0
    };
    const init = this.parseExpression(true, refShorthandDefaultPos);

    if (this.match(tt._in) || this.isContextual("of")) {
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

  parseFunctionStatement(node: N.FunctionDeclaration): N.FunctionDeclaration {
    this.next();
    return this.parseFunction(node, true);
  }

  parseIfStatement(node: N.IfStatement): N.IfStatement {
    this.next();
    node.test = this.parseParenExpression();
    node.consequent = this.parseStatement(false);
    node.alternate = this.eat(tt._else) ? this.parseStatement(false) : null;
    return this.finishNode(node, "IfStatement");
  }

  parseReturnStatement(node: N.ReturnStatement): N.ReturnStatement {
    if (!this.state.inFunction && !this.options.allowReturnOutsideFunction) {
      this.raise(this.state.start, "'return' outside of function");
    }

    this.next(); // In `return` (and `break`/`continue`), the keywords with
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

  parseSwitchStatement(node: N.SwitchStatement): N.SwitchStatement {
    this.next();
    node.discriminant = this.parseParenExpression();
    const cases = node.cases = [];
    this.expect(tt.braceL);
    this.state.labels.push(switchLabel); // Statements under must be grouped (by label) in SwitchCase
    // nodes. `cur` is used to keep the node that we are currently
    // adding statements to.

    let cur;

    for (let sawDefault; !this.match(tt.braceR);) {
      if (this.match(tt._case) || this.match(tt._default)) {
        const isCase = this.match(tt._case);
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

        this.expect(tt.colon);
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

  parseThrowStatement(node: N.ThrowStatement): N.ThrowStatement {
    this.next();
    if (lineBreak.test(this.input.slice(this.state.lastTokEnd, this.state.start))) this.raise(this.state.lastTokEnd, "Illegal newline after throw");
    node.argument = this.parseExpression();
    this.semicolon();
    return this.finishNode(node, "ThrowStatement");
  }

  parseTryStatement(node: N.TryStatement): N.TryStatement {
    this.next();
    node.block = this.parseBlock();
    node.handler = null;

    if (this.match(tt._catch)) {
      const clause = this.startNode();
      this.next();
      this.expect(tt.parenL);
      clause.param = this.parseBindingAtom();
      this.checkLVal(clause.param, true, Object.create(null), "catch clause");
      this.expect(tt.parenR);
      clause.body = this.parseBlock();
      node.handler = this.finishNode(clause, "CatchClause");
    }

    node.guardedHandlers = empty;
    node.finalizer = this.eat(tt._finally) ? this.parseBlock() : null;

    if (!node.handler && !node.finalizer) {
      this.raise(node.start, "Missing catch or finally clause");
    }

    return this.finishNode(node, "TryStatement");
  }

  parseVarStatement(node: N.VariableDeclaration, kind: TokenType): N.VariableDeclaration {
    this.next();
    this.parseVar(node, false, kind);
    this.semicolon();
    return this.finishNode(node, "VariableDeclaration");
  }

  parseWhileStatement(node: N.WhileStatement): N.WhileStatement {
    this.next();
    node.test = this.parseParenExpression();
    this.state.labels.push(loopLabel);
    node.body = this.parseStatement(false);
    this.state.labels.pop();
    return this.finishNode(node, "WhileStatement");
  }

  parseWithStatement(node: N.WithStatement): N.WithStatement {
    if (this.state.strict) this.raise(this.state.start, "'with' in strict mode");
    this.next();
    node.object = this.parseParenExpression();
    node.body = this.parseStatement(false);
    return this.finishNode(node, "WithStatement");
  }

  parseEmptyStatement(node: N.EmptyStatement): N.EmptyStatement {
    this.next();
    return this.finishNode(node, "EmptyStatement");
  }

  parseLabeledStatement(node: N.LabeledStatement, maybeName: string, expr: N.Identifier): N.LabeledStatement {
    for (const label of this.state.labels) {
      if (label.name === maybeName) {
        this.raise(expr.start, `Label '${maybeName}' is already declared`);
      }
    }

    const kind = this.state.type.isLoop ? "loop" : this.match(tt._switch) ? "switch" : null;

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

  parseExpressionStatement(node: N.ExpressionStatement, expr: N.Expression): N.ExpressionStatement {
    node.expression = expr;
    this.semicolon();
    return this.finishNode(node, "ExpressionStatement");
  } // Parse a semicolon-enclosed block of statements, handling `"use
  // strict"` declarations when `allowStrict` is true (used for
  // function bodies).


  parseBlock(allowDirectives?: boolean): N.BlockStatement {
    const node = this.startNode();
    this.expect(tt.braceL);
    this.parseBlockBody(node, allowDirectives, false, tt.braceR);
    return this.finishNode(node, "BlockStatement");
  }

  isValidDirective(stmt: N.Statement): boolean {
    return stmt.type === "ExpressionStatement" && stmt.expression.type === "StringLiteral" && !stmt.expression.extra.parenthesized;
  }

  parseBlockBody(node: N.BlockStatementLike, allowDirectives: ?boolean, topLevel: boolean, end: TokenType): void {
    const body = node.body = [];
    const directives = node.directives = [];
    this.parseBlockOrModuleBlockBody(body, allowDirectives ? directives : undefined, topLevel, end);
  } // Undefined directives means that directives are not allowed.


  parseBlockOrModuleBlockBody(body: N.Statement[], directives: ?N.Directive[], topLevel: boolean, end: TokenType): void {
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
  } // Parse a regular `for` loop. The disambiguation code in
  // `parseStatement` will already have parsed the init statement or
  // expression.


  parseFor(node: N.ForStatement, init: ?N.VariableDeclaration | N.Expression): N.ForStatement {
    node.init = init;
    this.expect(tt.semi);
    node.test = this.match(tt.semi) ? null : this.parseExpression();
    this.expect(tt.semi);
    node.update = this.match(tt.parenR) ? null : this.parseExpression();
    this.expect(tt.parenR);
    node.body = this.parseStatement(false);
    this.state.labels.pop();
    return this.finishNode(node, "ForStatement");
  } // Parse a `for`/`in` and `for`/`of` loop, which are almost
  // same from parser's perspective.


  parseForIn(node: N.ForInOf, init: N.VariableDeclaration, forAwait: boolean): N.ForInOf {
    const type = this.match(tt._in) ? "ForInStatement" : "ForOfStatement";

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
    this.expect(tt.parenR);
    node.body = this.parseStatement(false);
    this.state.labels.pop();
    return this.finishNode(node, type);
  } // Parse a list of variable declarations.


  parseVar(node: N.VariableDeclaration, isFor: boolean, kind: TokenType): N.VariableDeclaration {
    const declarations = node.declarations = []; // $FlowFixMe

    node.kind = kind.keyword;

    for (;;) {
      const decl = this.startNode();
      this.parseVarHead(decl);

      if (this.eat(tt.eq)) {
        decl.init = this.parseMaybeAssign(isFor);
      } else {
        if (kind === tt._const && !(this.match(tt._in) || this.isContextual("of"))) {
          // `const` with no initializer is allowed in TypeScript. It could be a declaration `const x: number;`.
          if (!this.hasPlugin("typescript")) {
            this.unexpected();
          }
        } else if (decl.id.type !== "Identifier" && !(isFor && (this.match(tt._in) || this.isContextual("of")))) {
          this.raise(this.state.lastTokEnd, "Complex binding patterns require an initialization value");
        }

        decl.init = null;
      }

      declarations.push(this.finishNode(decl, "VariableDeclarator"));
      if (!this.eat(tt.comma)) break;
    }

    return node;
  }

  parseVarHead(decl: N.VariableDeclarator): void {
    decl.id = this.parseBindingAtom();
    this.checkLVal(decl.id, true, undefined, "variable declaration");
  } // Parse a function declaration or literal (depending on the
  // `isStatement` parameter).


  parseFunction<T: N.NormalFunction>(node: T, isStatement: boolean, allowExpressionBody?: boolean, isAsync?: boolean, optionalId?: boolean): T {
    const oldInMethod = this.state.inMethod;
    this.state.inMethod = false;
    this.initFunction(node, isAsync);

    if (this.match(tt.star)) {
      if (node.async && !this.hasPlugin("asyncGenerators")) {
        this.unexpected();
      } else {
        node.generator = true;
        this.next();
      }
    }

    if (isStatement && !optionalId && !this.match(tt.name) && !this.match(tt._yield)) {
      this.unexpected();
    }

    if (this.match(tt.name) || this.match(tt._yield)) {
      node.id = this.parseBindingIdentifier();
    }

    this.parseFunctionParams(node);
    this.parseFunctionBodyAndFinish(node, isStatement ? "FunctionDeclaration" : "FunctionExpression", allowExpressionBody);
    this.state.inMethod = oldInMethod;
    return node;
  }

  parseFunctionParams(node: N.Function): void {
    this.expect(tt.parenL);
    node.params = this.parseBindingList(tt.parenR);
  } // Parse a class declaration or literal (depending on the
  // `isStatement` parameter).


  parseClass<T: N.Class>(node: T, isStatement:
  /* T === ClassDeclaration */
  boolean, optionalId?: boolean): T {
    this.next();
    this.takeDecorators(node);
    this.parseClassId(node, isStatement, optionalId);
    this.parseClassSuper(node);
    this.parseClassBody(node);
    return this.finishNode(node, isStatement ? "ClassDeclaration" : "ClassExpression");
  }

  isClassProperty(): boolean {
    return this.match(tt.eq) || this.match(tt.semi) || this.match(tt.braceR);
  }

  isClassMethod(): boolean {
    return this.match(tt.parenL);
  }

  isNonstaticConstructor(method: N.ClassMethod | N.ClassProperty): boolean {
    return !method.computed && !method.static && (method.key.name === "constructor" || // Identifier
    method.key.value === "constructor") // Literal
    ;
  }

  parseClassBody(node: N.Class): void {
    // class bodies are implicitly strict
    const oldStrict = this.state.strict;
    this.state.strict = true;
    this.state.classLevel++;
    const state = {
      hadConstructor: false
    };
    let decorators: N.Decorator[] = [];
    const classBody: N.ClassBody = this.startNode();
    classBody.body = [];
    this.expect(tt.braceL);

    while (!this.eat(tt.braceR)) {
      if (this.eat(tt.semi)) {
        if (decorators.length > 0) {
          this.raise(this.state.lastTokEnd, "Decorators must not be followed by a semicolon");
        }

        continue;
      }

      if (this.match(tt.at)) {
        decorators.push(this.parseDecorator());
        continue;
      }

      const member = this.startNode(); // steal the decorators if there are any

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

  parseClassMember(classBody: N.ClassBody, member: N.ClassMember, state: {
    hadConstructor: boolean
  }): void {
    // Use the appropriate variable to represent `member` once a more specific type is known.
    const memberAny: any = member;
    const method: N.ClassMethod = memberAny;
    const prop: N.ClassProperty = memberAny;
    let isStatic = false;

    if (this.match(tt.name) && this.state.value === "static") {
      const key = this.parseIdentifier(true); // eats 'static'

      if (this.isClassMethod()) {
        // a method named 'static'
        method.kind = "method";
        method.computed = false;
        method.key = key;
        method.static = false;
        this.parseClassMethod(classBody, method, false, false,
        /* isConstructor */
        false);
        return;
      } else if (this.isClassProperty()) {
        // a property named 'static'
        prop.computed = false;
        prop.key = key;
        prop.static = false;
        classBody.body.push(this.parseClassProperty(prop));
        return;
      } // otherwise something static


      isStatic = true;
    }

    if (this.hasPlugin("classPrivateProperties") && this.match(tt.hash)) {
      // Private property
      this.next();
      const privateProp: N.ClassPrivateProperty = memberAny;
      privateProp.key = this.parseIdentifier(true);
      privateProp.static = isStatic;
      classBody.body.push(this.parsePrivateClassProperty(privateProp));
      return;
    }

    this.parseClassMemberWithIsStatic(classBody, member, state, isStatic);
  }

  parseClassMemberWithIsStatic(classBody: N.ClassBody, member: N.ClassMember, state: {
    hadConstructor: boolean
  }, isStatic: boolean) {
    const memberAny: any = member;
    const methodOrProp: N.ClassMethod | N.ClassProperty = memberAny;
    const method: N.ClassMethod = memberAny;
    const prop: N.ClassProperty = memberAny;
    methodOrProp.static = isStatic;

    if (this.eat(tt.star)) {
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
      /* isConstructor */
      false);
      return;
    }

    const isSimple = this.match(tt.name);
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
        } // TypeScript allows multiple overloaded constructor declarations.


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
      const isGenerator = this.hasPlugin("asyncGenerators") && this.eat(tt.star);
      method.kind = "method";
      this.parsePropertyName(method);

      if (this.isNonstaticConstructor(method)) {
        this.raise(method.key.start, "Constructor can't be an async function");
      }

      this.parseClassMethod(classBody, method, isGenerator, true,
      /* isConstructor */
      false);
    } else if (isSimple && (key.name === "get" || key.name === "set") && !(this.isLineTerminator() && this.match(tt.star))) {
      // `get\n*` is an uninitialized property named 'get' followed by a generator.
      // a getter or setter
      method.kind = key.name;
      this.parsePropertyName(method);

      if (this.isNonstaticConstructor(method)) {
        this.raise(method.key.start, "Constructor can't have get/set modifier");
      }

      this.parseClassMethod(classBody, method, false, false,
      /* isConstructor */
      false);
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

  parseClassPropertyName(methodOrProp: N.ClassMethod | N.ClassProperty): N.Expression {
    const key = this.parsePropertyName(methodOrProp);

    if (!methodOrProp.computed && methodOrProp.static && (methodOrProp.key.name === "prototype" || methodOrProp.key.value === "prototype")) {
      this.raise(methodOrProp.key.start, "Classes may not have static property named prototype");
    }

    return key;
  }

  pushClassProperty(classBody: N.ClassBody, prop: N.ClassProperty) {
    if (this.isNonstaticConstructor(prop)) {
      this.raise(prop.key.start, "Classes may not have a non-static field named 'constructor'");
    }

    classBody.body.push(this.parseClassProperty(prop));
  } // Overridden in typescript.js


  parsePostMemberNameModifiers( // eslint-disable-next-line no-unused-vars
  methodOrProp: N.ClassMethod | N.ClassProperty): void {} // Overridden in typescript.js


  parseAccessModifier(): ?N.Accessibility {
    return undefined;
  }

  parsePrivateClassProperty(node: N.ClassPrivateProperty): N.ClassPrivateProperty {
    this.state.inClassProperty = true;

    if (this.match(tt.eq)) {
      this.next();
      node.value = this.parseMaybeAssign();
    } else {
      node.value = null;
    }

    this.semicolon();
    this.state.inClassProperty = false;
    return this.finishNode(node, "ClassPrivateProperty");
  }

  parseClassProperty(node: N.ClassProperty): N.ClassProperty {
    const hasPlugin = this.hasPlugin("classProperties") || this.hasPlugin("typescript");
    const noPluginMsg = "You can only use Class Properties when the 'classProperties' plugin is enabled.";

    if (!node.typeAnnotation && !hasPlugin) {
      this.raise(node.start, noPluginMsg);
    }

    this.state.inClassProperty = true;

    if (this.match(tt.eq)) {
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

  parseClassMethod(classBody: N.ClassBody, method: N.ClassMethod, isGenerator: boolean, isAsync: boolean, isConstructor: boolean): void {
    classBody.body.push(this.parseMethod(method, isGenerator, isAsync, isConstructor, "ClassMethod"));
  }

  parseClassId(node: N.Class, isStatement: boolean, optionalId: ?boolean): void {
    if (this.match(tt.name)) {
      node.id = this.parseIdentifier();
    } else {
      if (optionalId || !isStatement) {
        node.id = null;
      } else {
        this.unexpected(null, "A class name is required");
      }
    }
  }

  parseClassSuper(node: N.Class): void {
    node.superClass = this.eat(tt._extends) ? this.parseExprSubscripts() : null;
  } // Parses module export declaration.
  // TODO: better type. Node is an N.AnyExport.


  parseExport(node: N.Node): N.Node {
    // export * from '...'
    if (this.shouldParseExportStar()) {
      this.parseExportStar(node, this.hasPlugin("exportExtensions"));
      if (node.type === "ExportAllDeclaration") return node;
    } else if (this.hasPlugin("exportExtensions") && this.isExportDefaultSpecifier()) {
      const specifier = this.startNode();
      specifier.exported = this.parseIdentifier(true);
      const specifiers = [this.finishNode(specifier, "ExportDefaultSpecifier")];
      node.specifiers = specifiers;

      if (this.match(tt.comma) && this.lookahead().type === tt.star) {
        this.expect(tt.comma);
        const specifier = this.startNode();
        this.expect(tt.star);
        this.expectContextual("as");
        specifier.exported = this.parseIdentifier();
        specifiers.push(this.finishNode(specifier, "ExportNamespaceSpecifier"));
      } else {
        this.parseExportSpecifiersMaybe(node);
      }

      this.parseExportFrom(node, true);
    } else if (this.eat(tt._default)) {
      // export default ...
      let expr = this.startNode();
      let needsSemi = false;

      if (this.eat(tt._function)) {
        expr = this.parseFunction(expr, true, false, false, true);
      } else if (this.isContextual("async") && this.lookahead().type === tt._function) {
        // async function declaration
        this.eatContextual("async");
        this.eat(tt._function);
        expr = this.parseFunction(expr, true, false, true, true);
      } else if (this.match(tt._class)) {
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
  } // eslint-disable-next-line no-unused-vars


  parseExportDeclaration(node: N.ExportNamedDeclaration): ?N.Declaration {
    return this.parseStatement(true);
  }

  isExportDefaultSpecifier(): boolean {
    if (this.match(tt.name)) {
      return this.state.value !== "async";
    }

    if (!this.match(tt._default)) {
      return false;
    }

    const lookahead = this.lookahead();
    return lookahead.type === tt.comma || lookahead.type === tt.name && lookahead.value === "from";
  }

  parseExportSpecifiersMaybe(node: N.ExportNamedDeclaration): void {
    if (this.eat(tt.comma)) {
      node.specifiers = node.specifiers.concat(this.parseExportSpecifiers());
    }
  }

  parseExportFrom(node: N.ExportNamedDeclaration, expect?: boolean): void {
    if (this.eatContextual("from")) {
      node.source = this.match(tt.string) ? this.parseExprAtom() : this.unexpected();
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

  shouldParseExportStar(): boolean {
    return this.match(tt.star);
  }

  parseExportStar(node: N.ExportNamedDeclaration, allowNamed: boolean): void {
    this.expect(tt.star);

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

  shouldParseExportDeclaration(): boolean {
    return this.state.type.keyword === "var" || this.state.type.keyword === "const" || this.state.type.keyword === "let" || this.state.type.keyword === "function" || this.state.type.keyword === "class" || this.isContextual("async");
  }

  checkExport(node: N.ExportNamedDeclaration, checkNames: ?boolean, isDefault?: boolean): void {
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

  checkDeclaration(node: N.Pattern): void {
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

  checkDuplicateExports(node: N.Identifier | N.ExportNamedDeclaration | N.ExportSpecifier, name: string): void {
    if (this.state.exportedIdentifiers.indexOf(name) > -1) {
      this.raiseDuplicateExportError(node, name);
    }

    this.state.exportedIdentifiers.push(name);
  }

  raiseDuplicateExportError(node: N.Identifier | N.ExportNamedDeclaration | N.ExportSpecifier, name: string): empty {
    throw this.raise(node.start, name === "default" ? "Only one default export allowed per module." : `\`${name}\` has already been exported. Exported identifiers must be unique.`);
  } // Parses a comma-separated list of module exports.


  parseExportSpecifiers(): Array<N.ExportSpecifier> {
    const nodes = [];
    let first = true;
    let needsFrom; // export { x, y as z } [from '...']

    this.expect(tt.braceL);

    while (!this.eat(tt.braceR)) {
      if (first) {
        first = false;
      } else {
        this.expect(tt.comma);
        if (this.eat(tt.braceR)) break;
      }

      const isDefault = this.match(tt._default);
      if (isDefault && !needsFrom) needsFrom = true;
      const node = this.startNode();
      node.local = this.parseIdentifier(isDefault);
      node.exported = this.eatContextual("as") ? this.parseIdentifier(true) : node.local.__clone();
      nodes.push(this.finishNode(node, "ExportSpecifier"));
    } // https://github.com/ember-cli/ember-cli/pull/3739


    if (needsFrom && !this.isContextual("from")) {
      this.unexpected();
    }

    return nodes;
  } // Parses import declaration.


  parseImport(node: N.Node): N.ImportDeclaration | N.TsImportEqualsDeclaration {
    // import '...'
    if (this.match(tt.string)) {
      node.specifiers = [];
      node.source = this.parseExprAtom();
    } else {
      node.specifiers = [];
      this.parseImportSpecifiers(node);
      this.expectContextual("from");
      node.source = this.match(tt.string) ? this.parseExprAtom() : this.unexpected();
    }

    this.semicolon();
    return this.finishNode(node, "ImportDeclaration");
  } // Parses a comma-separated list of module imports.


  parseImportSpecifiers(node: N.ImportDeclaration): void {
    let first = true;

    if (this.match(tt.name)) {
      // import defaultObj, { x, y as z } from '...'
      const startPos = this.state.start;
      const startLoc = this.state.startLoc;
      node.specifiers.push(this.parseImportSpecifierDefault(this.parseIdentifier(), startPos, startLoc));
      if (!this.eat(tt.comma)) return;
    }

    if (this.match(tt.star)) {
      const specifier = this.startNode();
      this.next();
      this.expectContextual("as");
      specifier.local = this.parseIdentifier();
      this.checkLVal(specifier.local, true, undefined, "import namespace specifier");
      node.specifiers.push(this.finishNode(specifier, "ImportNamespaceSpecifier"));
      return;
    }

    this.expect(tt.braceL);

    while (!this.eat(tt.braceR)) {
      if (first) {
        first = false;
      } else {
        // Detect an attempt to deep destructure
        if (this.eat(tt.colon)) {
          this.unexpected(null, "ES2015 named imports do not destructure. Use another statement for destructuring after the import.");
        }

        this.expect(tt.comma);
        if (this.eat(tt.braceR)) break;
      }

      this.parseImportSpecifier(node);
    }
  }

  parseImportSpecifier(node: N.ImportDeclaration): void {
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

  parseImportSpecifierDefault(id: N.Identifier, startPos: number, startLoc: Position): N.ImportDefaultSpecifier {
    const node = this.startNodeAt(startPos, startLoc);
    node.local = id;
    this.checkLVal(node.local, true, undefined, "default import specifier");
    return this.finishNode(node, "ImportDefaultSpecifier");
  }

}
// @flow
import { types as tt, type TokenType } from "../tokenizer/types";
import Tokenizer from "../tokenizer";
import type { Node } from "../types";
import { lineBreak } from "../util/whitespace"; // ## Parser utilities

export default class UtilParser extends Tokenizer {
  // TODO
  addExtra(node: Node, key: string, val: any): void {
    if (!node) return;
    const extra = node.extra = node.extra || {};
    extra[key] = val;
  } // TODO


  isRelational(op: "<" | ">"): boolean {
    return this.match(tt.relational) && this.state.value === op;
  } // TODO


  expectRelational(op: "<" | ">"): void {
    if (this.isRelational(op)) {
      this.next();
    } else {
      this.unexpected(null, tt.relational);
    }
  } // eat() for relational operators.


  eatRelational(op: "<" | ">"): boolean {
    if (this.isRelational(op)) {
      this.next();
      return true;
    }

    return false;
  } // Tests whether parsed token is a contextual keyword.


  isContextual(name: string): boolean {
    return this.match(tt.name) && this.state.value === name;
  } // Consumes contextual keyword if possible.


  eatContextual(name: string): boolean {
    return this.state.value === name && this.eat(tt.name);
  } // Asserts that following token is given contextual keyword.


  expectContextual(name: string, message?: string): void {
    if (!this.eatContextual(name)) this.unexpected(null, message);
  } // Test whether a semicolon can be inserted at the current position.


  canInsertSemicolon(): boolean {
    return this.match(tt.eof) || this.match(tt.braceR) || this.hasPrecedingLineBreak();
  }

  hasPrecedingLineBreak(): boolean {
    return lineBreak.test(this.input.slice(this.state.lastTokEnd, this.state.start));
  } // TODO


  isLineTerminator(): boolean {
    return this.eat(tt.semi) || this.canInsertSemicolon();
  } // Consume a semicolon, or, failing that, see if we are allowed to
  // pretend that there is a semicolon at this position.


  semicolon(): void {
    if (!this.isLineTerminator()) this.unexpected(null, tt.semi);
  } // Expect a token of a given type. If found, consume it, otherwise,
  // raise an unexpected token error at given pos.


  expect(type: TokenType, pos?: ?number): void {
    this.eat(type) || this.unexpected(pos, type);
  } // Raise an unexpected token error. Can take the expected token type
  // instead of a message string.


  unexpected(pos: ?number, messageOrType: string | TokenType = "Unexpected token"): empty {
    if (typeof messageOrType !== "string") {
      messageOrType = `Unexpected token, expected ${messageOrType.label}`;
    }

    throw this.raise(pos != null ? pos : this.state.start, messageOrType);
  }

}
// @flow
import { types as tt, TokenType } from "../tokenizer/types";
import type Parser from "../parser";
import * as N from "../types";
import type { Pos, Position } from "../util/location";

function isSimpleProperty(node: N.Node): boolean {
  return node != null && node.type === "Property" && node.kind === "init" && node.method === false;
}

export default ((superClass: Class<Parser>): Class<Parser> => class extends superClass {
  estreeParseRegExpLiteral({
    pattern,
    flags
  }: N.RegExpLiteral): N.Node {
    let regex = null;

    try {
      regex = new RegExp(pattern, flags);
    } catch (e) {// In environments that don't support these flags value will
      // be null as the regex can't be represented natively.
    }

    const node = this.estreeParseLiteral(regex);
    node.regex = {
      pattern,
      flags
    };
    return node;
  }

  estreeParseLiteral(value: any): N.Node {
    return this.parseLiteral(value, "Literal");
  }

  directiveToStmt(directive: N.Directive): N.ExpressionStatement {
    const directiveLiteral = directive.value;
    const stmt = this.startNodeAt(directive.start, directive.loc.start);
    const expression = this.startNodeAt(directiveLiteral.start, directiveLiteral.loc.start);
    expression.value = directiveLiteral.value;
    expression.raw = directiveLiteral.extra.raw;
    stmt.expression = this.finishNodeAt(expression, "Literal", directiveLiteral.end, directiveLiteral.loc.end);
    stmt.directive = directiveLiteral.extra.raw.slice(1, -1);
    return this.finishNodeAt(stmt, "ExpressionStatement", directive.end, directive.loc.end);
  } // ==================================
  // Overrides
  // ==================================


  checkDeclaration(node: N.Pattern): void {
    if (isSimpleProperty(node)) {
      // $FlowFixMe
      this.checkDeclaration(node.value);
    } else {
      super.checkDeclaration(node);
    }
  }

  checkGetterSetterParamCount(prop: N.ObjectMethod | N.ClassMethod): void {
    const paramCount = prop.kind === "get" ? 0 : 1; // $FlowFixMe (prop.value present for ObjectMethod, but for ClassMethod should use prop.params?)

    if (prop.value.params.length !== paramCount) {
      const start = prop.start;

      if (prop.kind === "get") {
        this.raise(start, "getter should have no params");
      } else {
        this.raise(start, "setter should have exactly one param");
      }
    }
  }

  checkLVal(expr: N.Expression, isBinding: ?boolean, checkClashes: ?{
    [key: string]: boolean
  }, contextDescription: string): void {
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

  checkPropClash(prop: N.ObjectMember, propHash: {
    [key: string]: boolean
  }): void {
    if (prop.computed || !isSimpleProperty(prop)) return;
    const key = prop.key; // It is either an Identifier or a String/NumericLiteral

    const name = key.type === "Identifier" ? key.name : String(key.value);

    if (name === "__proto__") {
      if (propHash.proto) this.raise(key.start, "Redefinition of __proto__ property");
      propHash.proto = true;
    }
  }

  isStrictBody(node: {
    body: N.BlockStatement
  }, isExpression: ?boolean): boolean {
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

  isValidDirective(stmt: N.Statement): boolean {
    return stmt.type === "ExpressionStatement" && stmt.expression.type === "Literal" && typeof stmt.expression.value === "string" && (!stmt.expression.extra || !stmt.expression.extra.parenthesized);
  }

  stmtToDirective(stmt: N.Statement): N.Directive {
    const directive = super.stmtToDirective(stmt);
    const value = stmt.expression.value; // Reset value to the actual value as in estree mode we want
    // the stmt to have the real value and not the raw value

    directive.value.value = value;
    return directive;
  }

  parseBlockBody(node: N.BlockStatementLike, allowDirectives: ?boolean, topLevel: boolean, end: TokenType): void {
    super.parseBlockBody(node, allowDirectives, topLevel, end);
    const directiveStatements = node.directives.map(d => this.directiveToStmt(d));
    node.body = directiveStatements.concat(node.body);
    delete node.directives;
  }

  parseClassMethod(classBody: N.ClassBody, method: N.ClassMethod, isGenerator: boolean, isAsync: boolean, isConstructor: boolean): void {
    this.parseMethod(method, isGenerator, isAsync, isConstructor, "MethodDefinition");

    if (method.typeParameters) {
      // $FlowIgnore
      method.value.typeParameters = method.typeParameters;
      delete method.typeParameters;
    }

    classBody.body.push(method);
  }

  parseExprAtom(refShorthandDefaultPos?: ?Pos): N.Expression {
    switch (this.state.type) {
      case tt.regexp:
        return this.estreeParseRegExpLiteral(this.state.value);

      case tt.num:
      case tt.string:
        return this.estreeParseLiteral(this.state.value);

      case tt._null:
        return this.estreeParseLiteral(null);

      case tt._true:
        return this.estreeParseLiteral(true);

      case tt._false:
        return this.estreeParseLiteral(false);

      default:
        return super.parseExprAtom(refShorthandDefaultPos);
    }
  }

  parseLiteral<T: N.Literal>(value: any, type:
  /*T["kind"]*/
  string, startPos?: number, startLoc?: Position): T {
    const node = super.parseLiteral(value, type, startPos, startLoc);
    node.raw = node.extra.raw;
    delete node.extra;
    return node;
  }

  parseMethod<T: N.MethodLike>(node: T, isGenerator: boolean, isAsync: boolean, isConstructor: boolean, type: string): T {
    let funcNode = this.startNode();
    funcNode.kind = node.kind; // provide kind, so super method correctly sets state

    funcNode = super.parseMethod(funcNode, isGenerator, isAsync, isConstructor, "FunctionExpression");
    delete funcNode.kind; // $FlowIgnore

    node.value = funcNode;
    return this.finishNode(node, type);
  }

  parseObjectMethod(prop: N.ObjectMethod, isGenerator: boolean, isAsync: boolean, isPattern: boolean): ?N.ObjectMethod {
    const node: N.EstreeProperty = (super.parseObjectMethod(prop, isGenerator, isAsync, isPattern): any);

    if (node) {
      node.type = "Property";
      if (node.kind === "method") node.kind = "init";
      node.shorthand = false;
    }

    return (node: any);
  }

  parseObjectProperty(prop: N.ObjectProperty, startPos: ?number, startLoc: ?Position, isPattern: boolean, refShorthandDefaultPos: ?Pos): ?N.ObjectProperty {
    const node: N.EstreeProperty = (super.parseObjectProperty(prop, startPos, startLoc, isPattern, refShorthandDefaultPos): any);

    if (node) {
      node.kind = "init";
      node.type = "Property";
    }

    return (node: any);
  }

  toAssignable(node: N.Node, isBinding: ?boolean, contextDescription: string): N.Node {
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
// @flow
import type Parser from "../parser";
import { types as tt, type TokenType } from "../tokenizer/types";
import * as N from "../types";
import type { Pos, Position } from "../util/location";
const primitiveTypes = ["any", "mixed", "empty", "bool", "boolean", "number", "string", "void", "null"];

function isEsModuleType(bodyElement: N.Node): boolean {
  return bodyElement.type === "DeclareExportAllDeclaration" || bodyElement.type === "DeclareExportDeclaration" && (!bodyElement.declaration || bodyElement.declaration.type !== "TypeAlias" && bodyElement.declaration.type !== "InterfaceDeclaration");
}

const exportSuggestions = {
  const: "declare export var",
  let: "declare export var",
  type: "export type",
  interface: "export interface"
};
export default ((superClass: Class<Parser>): Class<Parser> => class extends superClass {
  flowParseTypeInitialiser(tok?: TokenType): N.FlowType {
    const oldInType = this.state.inType;
    this.state.inType = true;
    this.expect(tok || tt.colon);
    const type = this.flowParseType();
    this.state.inType = oldInType;
    return type;
  }

  flowParsePredicate(): N.FlowType {
    const node = this.startNode();
    const moduloLoc = this.state.startLoc;
    const moduloPos = this.state.start;
    this.expect(tt.modulo);
    const checksLoc = this.state.startLoc;
    this.expectContextual("checks"); // Force '%' and 'checks' to be adjacent

    if (moduloLoc.line !== checksLoc.line || moduloLoc.column !== checksLoc.column - 1) {
      this.raise(moduloPos, "Spaces between ´%´ and ´checks´ are not allowed here.");
    }

    if (this.eat(tt.parenL)) {
      node.value = this.parseExpression();
      this.expect(tt.parenR);
      return this.finishNode(node, "DeclaredPredicate");
    } else {
      return this.finishNode(node, "InferredPredicate");
    }
  }

  flowParseTypeAndPredicateInitialiser(): [?N.FlowType, ?N.FlowPredicate] {
    const oldInType = this.state.inType;
    this.state.inType = true;
    this.expect(tt.colon);
    let type = null;
    let predicate = null;

    if (this.match(tt.modulo)) {
      this.state.inType = oldInType;
      predicate = this.flowParsePredicate();
    } else {
      type = this.flowParseType();
      this.state.inType = oldInType;

      if (this.match(tt.modulo)) {
        predicate = this.flowParsePredicate();
      }
    }

    return [type, predicate];
  }

  flowParseDeclareClass(node: N.FlowDeclareClass): N.FlowDeclareClass {
    this.next();
    this.flowParseInterfaceish(node);
    return this.finishNode(node, "DeclareClass");
  }

  flowParseDeclareFunction(node: N.FlowDeclareFunction): N.FlowDeclareFunction {
    this.next();
    const id = node.id = this.parseIdentifier();
    const typeNode = this.startNode();
    const typeContainer = this.startNode();

    if (this.isRelational("<")) {
      typeNode.typeParameters = this.flowParseTypeParameterDeclaration();
    } else {
      typeNode.typeParameters = null;
    }

    this.expect(tt.parenL);
    const tmp = this.flowParseFunctionTypeParams();
    typeNode.params = tmp.params;
    typeNode.rest = tmp.rest;
    this.expect(tt.parenR);
    [// $FlowFixMe (destructuring not supported yet)
    typeNode.returnType, // $FlowFixMe (destructuring not supported yet)
    node.predicate] = this.flowParseTypeAndPredicateInitialiser();
    typeContainer.typeAnnotation = this.finishNode(typeNode, "FunctionTypeAnnotation");
    id.typeAnnotation = this.finishNode(typeContainer, "TypeAnnotation");
    this.finishNode(id, id.type);
    this.semicolon();
    return this.finishNode(node, "DeclareFunction");
  }

  flowParseDeclare(node: N.FlowDeclare, insideModule?: boolean): N.FlowDeclare {
    if (this.match(tt._class)) {
      return this.flowParseDeclareClass(node);
    } else if (this.match(tt._function)) {
      return this.flowParseDeclareFunction(node);
    } else if (this.match(tt._var)) {
      return this.flowParseDeclareVariable(node);
    } else if (this.isContextual("module")) {
      if (this.lookahead().type === tt.dot) {
        return this.flowParseDeclareModuleExports(node);
      } else {
        if (insideModule) this.unexpected(null, "`declare module` cannot be used inside another `declare module`");
        return this.flowParseDeclareModule(node);
      }
    } else if (this.isContextual("type")) {
      return this.flowParseDeclareTypeAlias(node);
    } else if (this.isContextual("interface")) {
      return this.flowParseDeclareInterface(node);
    } else if (this.match(tt._export)) {
      return this.flowParseDeclareExportDeclaration(node, insideModule);
    } else {
      throw this.unexpected();
    }
  }

  flowParseDeclareVariable(node: N.FlowDeclareVariable): N.FlowDeclareVariable {
    this.next();
    node.id = this.flowParseTypeAnnotatableIdentifier();
    this.semicolon();
    return this.finishNode(node, "DeclareVariable");
  }

  flowParseDeclareModule(node: N.FlowDeclareModule): N.FlowDeclareModule {
    this.next();

    if (this.match(tt.string)) {
      node.id = this.parseExprAtom();
    } else {
      node.id = this.parseIdentifier();
    }

    const bodyNode = node.body = this.startNode();
    const body = bodyNode.body = [];
    this.expect(tt.braceL);

    while (!this.match(tt.braceR)) {
      let bodyNode = this.startNode();

      if (this.match(tt._import)) {
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

    this.expect(tt.braceR);
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

  flowParseDeclareExportDeclaration(node: N.FlowDeclareExportDeclaration, insideModule: ?boolean): N.FlowDeclareExportDeclaration {
    this.expect(tt._export);

    if (this.eat(tt._default)) {
      if (this.match(tt._function) || this.match(tt._class)) {
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
      if (this.match(tt._const) || this.match(tt._let) || (this.isContextual("type") || this.isContextual("interface")) && !insideModule) {
        const label = this.state.value;
        const suggestion = exportSuggestions[label];
        this.unexpected(this.state.start, `\`declare export ${label}\` is not supported. Use \`${suggestion}\` instead`);
      }

      if (this.match(tt._var) || // declare export var ...
      this.match(tt._function) || // declare export function ...
      this.match(tt._class) // declare export class ...
      ) {
          node.declaration = this.flowParseDeclare(this.startNode());
          node.default = false;
          return this.finishNode(node, "DeclareExportDeclaration");
        } else if (this.match(tt.star) || // declare export * from ''
      this.match(tt.braceL) || // declare export {} ...
      this.isContextual("interface") || // declare export interface ...
      this.isContextual("type") // declare export type ...
      ) {
          node = this.parseExport(node);

          if (node.type === "ExportNamedDeclaration") {
            // flow does not support the ExportNamedDeclaration
            // $FlowIgnore
            node.type = "ExportDeclaration"; // $FlowFixMe

            node.default = false;
            delete node.exportKind;
          } // $FlowIgnore


          node.type = "Declare" + node.type;
          return node;
        }
    }

    throw this.unexpected();
  }

  flowParseDeclareModuleExports(node: N.FlowDeclareModuleExports): N.FlowDeclareModuleExports {
    this.expectContextual("module");
    this.expect(tt.dot);
    this.expectContextual("exports");
    node.typeAnnotation = this.flowParseTypeAnnotation();
    this.semicolon();
    return this.finishNode(node, "DeclareModuleExports");
  }

  flowParseDeclareTypeAlias(node: N.FlowDeclareTypeAlias): N.FlowDeclareTypeAlias {
    this.next();
    this.flowParseTypeAlias(node);
    return this.finishNode(node, "DeclareTypeAlias");
  }

  flowParseDeclareInterface(node: N.FlowDeclareInterface): N.FlowDeclareInterface {
    this.next();
    this.flowParseInterfaceish(node);
    return this.finishNode(node, "DeclareInterface");
  } // Interfaces


  flowParseInterfaceish(node: N.FlowDeclare): void {
    node.id = this.parseIdentifier();

    if (this.isRelational("<")) {
      node.typeParameters = this.flowParseTypeParameterDeclaration();
    } else {
      node.typeParameters = null;
    }

    node.extends = [];
    node.mixins = [];

    if (this.eat(tt._extends)) {
      do {
        node.extends.push(this.flowParseInterfaceExtends());
      } while (this.eat(tt.comma));
    }

    if (this.isContextual("mixins")) {
      this.next();

      do {
        node.mixins.push(this.flowParseInterfaceExtends());
      } while (this.eat(tt.comma));
    }

    node.body = this.flowParseObjectType(true, false, false);
  }

  flowParseInterfaceExtends(): N.FlowInterfaceExtends {
    const node = this.startNode();
    node.id = this.flowParseQualifiedTypeIdentifier();

    if (this.isRelational("<")) {
      node.typeParameters = this.flowParseTypeParameterInstantiation();
    } else {
      node.typeParameters = null;
    }

    return this.finishNode(node, "InterfaceExtends");
  }

  flowParseInterface(node: N.FlowInterface): N.FlowInterface {
    this.flowParseInterfaceish(node);
    return this.finishNode(node, "InterfaceDeclaration");
  }

  flowParseRestrictedIdentifier(liberal?: boolean): N.Identifier {
    if (primitiveTypes.indexOf(this.state.value) > -1) {
      this.raise(this.state.start, `Cannot overwrite primitive type ${this.state.value}`);
    }

    return this.parseIdentifier(liberal);
  } // Type aliases


  flowParseTypeAlias(node: N.FlowTypeAlias): N.FlowTypeAlias {
    node.id = this.flowParseRestrictedIdentifier();

    if (this.isRelational("<")) {
      node.typeParameters = this.flowParseTypeParameterDeclaration();
    } else {
      node.typeParameters = null;
    }

    node.right = this.flowParseTypeInitialiser(tt.eq);
    this.semicolon();
    return this.finishNode(node, "TypeAlias");
  } // Type annotations


  flowParseTypeParameter(): N.TypeParameter {
    const node = this.startNode();
    const variance = this.flowParseVariance();
    const ident = this.flowParseTypeAnnotatableIdentifier();
    node.name = ident.name;
    node.variance = variance;
    node.bound = ident.typeAnnotation;

    if (this.match(tt.eq)) {
      this.eat(tt.eq);
      node.default = this.flowParseType();
    }

    return this.finishNode(node, "TypeParameter");
  }

  flowParseTypeParameterDeclaration(): N.TypeParameterDeclaration {
    const oldInType = this.state.inType;
    const node = this.startNode();
    node.params = [];
    this.state.inType = true; // istanbul ignore else: this condition is already checked at all call sites

    if (this.isRelational("<") || this.match(tt.jsxTagStart)) {
      this.next();
    } else {
      this.unexpected();
    }

    do {
      node.params.push(this.flowParseTypeParameter());

      if (!this.isRelational(">")) {
        this.expect(tt.comma);
      }
    } while (!this.isRelational(">"));

    this.expectRelational(">");
    this.state.inType = oldInType;
    return this.finishNode(node, "TypeParameterDeclaration");
  }

  flowParseTypeParameterInstantiation(): N.TypeParameterInstantiation {
    const node = this.startNode();
    const oldInType = this.state.inType;
    node.params = [];
    this.state.inType = true;
    this.expectRelational("<");

    while (!this.isRelational(">")) {
      node.params.push(this.flowParseType());

      if (!this.isRelational(">")) {
        this.expect(tt.comma);
      }
    }

    this.expectRelational(">");
    this.state.inType = oldInType;
    return this.finishNode(node, "TypeParameterInstantiation");
  }

  flowParseObjectPropertyKey(): N.Expression {
    return this.match(tt.num) || this.match(tt.string) ? this.parseExprAtom() : this.parseIdentifier(true);
  }

  flowParseObjectTypeIndexer(node: N.FlowObjectTypeIndexer, isStatic: boolean, variance: ?N.FlowVariance): N.FlowObjectTypeIndexer {
    node.static = isStatic;
    this.expect(tt.bracketL);

    if (this.lookahead().type === tt.colon) {
      node.id = this.flowParseObjectPropertyKey();
      node.key = this.flowParseTypeInitialiser();
    } else {
      node.id = null;
      node.key = this.flowParseType();
    }

    this.expect(tt.bracketR);
    node.value = this.flowParseTypeInitialiser();
    node.variance = variance;
    return this.finishNode(node, "ObjectTypeIndexer");
  }

  flowParseObjectTypeMethodish(node: N.FlowFunctionTypeAnnotation): N.FlowFunctionTypeAnnotation {
    node.params = [];
    node.rest = null;
    node.typeParameters = null;

    if (this.isRelational("<")) {
      node.typeParameters = this.flowParseTypeParameterDeclaration();
    }

    this.expect(tt.parenL);

    while (!this.match(tt.parenR) && !this.match(tt.ellipsis)) {
      node.params.push(this.flowParseFunctionTypeParam());

      if (!this.match(tt.parenR)) {
        this.expect(tt.comma);
      }
    }

    if (this.eat(tt.ellipsis)) {
      node.rest = this.flowParseFunctionTypeParam();
    }

    this.expect(tt.parenR);
    node.returnType = this.flowParseTypeInitialiser();
    return this.finishNode(node, "FunctionTypeAnnotation");
  }

  flowParseObjectTypeCallProperty(node: N.FlowObjectTypeCallProperty, isStatic: boolean): N.FlowObjectTypeCallProperty {
    const valueNode = this.startNode();
    node.static = isStatic;
    node.value = this.flowParseObjectTypeMethodish(valueNode);
    return this.finishNode(node, "ObjectTypeCallProperty");
  }

  flowParseObjectType(allowStatic: boolean, allowExact: boolean, allowSpread: boolean): N.FlowObjectTypeAnnotation {
    const oldInType = this.state.inType;
    this.state.inType = true;
    const nodeStart = this.startNode();
    nodeStart.callProperties = [];
    nodeStart.properties = [];
    nodeStart.indexers = [];
    let endDelim;
    let exact;

    if (allowExact && this.match(tt.braceBarL)) {
      this.expect(tt.braceBarL);
      endDelim = tt.braceBarR;
      exact = true;
    } else {
      this.expect(tt.braceL);
      endDelim = tt.braceR;
      exact = false;
    }

    nodeStart.exact = exact;

    while (!this.match(endDelim)) {
      let isStatic = false;
      const node = this.startNode();

      if (allowStatic && this.isContextual("static") && this.lookahead().type !== tt.colon) {
        this.next();
        isStatic = true;
      }

      const variance = this.flowParseVariance();

      if (this.match(tt.bracketL)) {
        nodeStart.indexers.push(this.flowParseObjectTypeIndexer(node, isStatic, variance));
      } else if (this.match(tt.parenL) || this.isRelational("<")) {
        if (variance) {
          this.unexpected(variance.start);
        }

        nodeStart.callProperties.push(this.flowParseObjectTypeCallProperty(node, isStatic));
      } else {
        let kind = "init";

        if (this.isContextual("get") || this.isContextual("set")) {
          const lookahead = this.lookahead();

          if (lookahead.type === tt.name || lookahead.type === tt.string || lookahead.type === tt.num) {
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

  flowParseObjectTypeProperty(node: N.FlowObjectTypeProperty | N.FlowObjectTypeSpreadProperty, isStatic: boolean, variance: ?N.FlowVariance, kind: string, allowSpread: boolean): N.FlowObjectTypeProperty | N.FlowObjectTypeSpreadProperty {
    if (this.match(tt.ellipsis)) {
      if (!allowSpread) {
        this.unexpected(null, "Spread operator cannot appear in class or interface definitions");
      }

      if (variance) {
        this.unexpected(variance.start, "Spread properties cannot have variance");
      }

      this.expect(tt.ellipsis);
      node.argument = this.flowParseType();
      return this.finishNode(node, "ObjectTypeSpreadProperty");
    } else {
      node.key = this.flowParseObjectPropertyKey();
      node.static = isStatic;
      node.kind = kind;
      let optional = false;

      if (this.isRelational("<") || this.match(tt.parenL)) {
        // This is a method property
        if (variance) {
          this.unexpected(variance.start);
        }

        node.value = this.flowParseObjectTypeMethodish(this.startNodeAt(node.start, node.loc.start));
        if (kind === "get" || kind === "set") this.flowCheckGetterSetterParamCount(node);
      } else {
        if (kind !== "init") this.unexpected();

        if (this.eat(tt.question)) {
          optional = true;
        }

        node.value = this.flowParseTypeInitialiser();
        node.variance = variance;
      }

      node.optional = optional;
      return this.finishNode(node, "ObjectTypeProperty");
    }
  } // This is similar to checkGetterSetterParamCount, but as
  // babylon uses non estree properties we cannot reuse it here


  flowCheckGetterSetterParamCount(property: N.FlowObjectTypeProperty | N.FlowObjectTypeSpreadProperty): void {
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

  flowObjectTypeSemicolon(): void {
    if (!this.eat(tt.semi) && !this.eat(tt.comma) && !this.match(tt.braceR) && !this.match(tt.braceBarR)) {
      this.unexpected();
    }
  }

  flowParseQualifiedTypeIdentifier(startPos?: number, startLoc?: Position, id?: N.Identifier): N.FlowQualifiedTypeIdentifier {
    startPos = startPos || this.state.start;
    startLoc = startLoc || this.state.startLoc;
    let node = id || this.parseIdentifier();

    while (this.eat(tt.dot)) {
      const node2 = this.startNodeAt(startPos, startLoc);
      node2.qualification = node;
      node2.id = this.parseIdentifier();
      node = this.finishNode(node2, "QualifiedTypeIdentifier");
    }

    return node;
  }

  flowParseGenericType(startPos: number, startLoc: Position, id: N.Identifier): N.FlowGenericTypeAnnotation {
    const node = this.startNodeAt(startPos, startLoc);
    node.typeParameters = null;
    node.id = this.flowParseQualifiedTypeIdentifier(startPos, startLoc, id);

    if (this.isRelational("<")) {
      node.typeParameters = this.flowParseTypeParameterInstantiation();
    }

    return this.finishNode(node, "GenericTypeAnnotation");
  }

  flowParseTypeofType(): N.FlowTypeofTypeAnnotation {
    const node = this.startNode();
    this.expect(tt._typeof);
    node.argument = this.flowParsePrimaryType();
    return this.finishNode(node, "TypeofTypeAnnotation");
  }

  flowParseTupleType(): N.FlowTupleTypeAnnotation {
    const node = this.startNode();
    node.types = [];
    this.expect(tt.bracketL); // We allow trailing commas

    while (this.state.pos < this.input.length && !this.match(tt.bracketR)) {
      node.types.push(this.flowParseType());
      if (this.match(tt.bracketR)) break;
      this.expect(tt.comma);
    }

    this.expect(tt.bracketR);
    return this.finishNode(node, "TupleTypeAnnotation");
  }

  flowParseFunctionTypeParam(): N.FlowFunctionTypeParam {
    let name = null;
    let optional = false;
    let typeAnnotation = null;
    const node = this.startNode();
    const lh = this.lookahead();

    if (lh.type === tt.colon || lh.type === tt.question) {
      name = this.parseIdentifier();

      if (this.eat(tt.question)) {
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

  reinterpretTypeAsFunctionTypeParam(type: N.FlowType): N.FlowFunctionTypeParam {
    const node = this.startNodeAt(type.start, type.loc.start);
    node.name = null;
    node.optional = false;
    node.typeAnnotation = type;
    return this.finishNode(node, "FunctionTypeParam");
  }

  flowParseFunctionTypeParams(params: N.FlowFunctionTypeParam[] = []): {
    params: N.FlowFunctionTypeParam[],
    rest: ?N.FlowFunctionTypeParam,
  } {
    let rest: ?N.FlowFunctionTypeParam = null;

    while (!this.match(tt.parenR) && !this.match(tt.ellipsis)) {
      params.push(this.flowParseFunctionTypeParam());

      if (!this.match(tt.parenR)) {
        this.expect(tt.comma);
      }
    }

    if (this.eat(tt.ellipsis)) {
      rest = this.flowParseFunctionTypeParam();
    }

    return {
      params,
      rest
    };
  }

  flowIdentToTypeAnnotation(startPos: number, startLoc: Position, node: N.FlowTypeAnnotation, id: N.Identifier): N.FlowTypeAnnotation {
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
  } // The parsing of types roughly parallels the parsing of expressions, and
  // primary types are kind of like primary expressions...they're the
  // primitives with which other types are constructed.


  flowParsePrimaryType(): N.FlowTypeAnnotation {
    const startPos = this.state.start;
    const startLoc = this.state.startLoc;
    const node = this.startNode();
    let tmp;
    let type;
    let isGroupedType = false;
    const oldNoAnonFunctionType = this.state.noAnonFunctionType;

    switch (this.state.type) {
      case tt.name:
        return this.flowIdentToTypeAnnotation(startPos, startLoc, node, this.parseIdentifier());

      case tt.braceL:
        return this.flowParseObjectType(false, false, true);

      case tt.braceBarL:
        return this.flowParseObjectType(false, true, true);

      case tt.bracketL:
        return this.flowParseTupleType();

      case tt.relational:
        if (this.state.value === "<") {
          node.typeParameters = this.flowParseTypeParameterDeclaration();
          this.expect(tt.parenL);
          tmp = this.flowParseFunctionTypeParams();
          node.params = tmp.params;
          node.rest = tmp.rest;
          this.expect(tt.parenR);
          this.expect(tt.arrow);
          node.returnType = this.flowParseType();
          return this.finishNode(node, "FunctionTypeAnnotation");
        }

        break;

      case tt.parenL:
        this.next(); // Check to see if this is actually a grouped type

        if (!this.match(tt.parenR) && !this.match(tt.ellipsis)) {
          if (this.match(tt.name)) {
            const token = this.lookahead().type;
            isGroupedType = token !== tt.question && token !== tt.colon;
          } else {
            isGroupedType = true;
          }
        }

        if (isGroupedType) {
          this.state.noAnonFunctionType = false;
          type = this.flowParseType();
          this.state.noAnonFunctionType = oldNoAnonFunctionType; // A `,` or a `) =>` means this is an anonymous function type

          if (this.state.noAnonFunctionType || !(this.match(tt.comma) || this.match(tt.parenR) && this.lookahead().type === tt.arrow)) {
            this.expect(tt.parenR);
            return type;
          } else {
            // Eat a comma if there is one
            this.eat(tt.comma);
          }
        }

        if (type) {
          tmp = this.flowParseFunctionTypeParams([this.reinterpretTypeAsFunctionTypeParam(type)]);
        } else {
          tmp = this.flowParseFunctionTypeParams();
        }

        node.params = tmp.params;
        node.rest = tmp.rest;
        this.expect(tt.parenR);
        this.expect(tt.arrow);
        node.returnType = this.flowParseType();
        node.typeParameters = null;
        return this.finishNode(node, "FunctionTypeAnnotation");

      case tt.string:
        return this.parseLiteral(this.state.value, "StringLiteralTypeAnnotation");

      case tt._true:
      case tt._false:
        node.value = this.match(tt._true);
        this.next();
        return this.finishNode(node, "BooleanLiteralTypeAnnotation");

      case tt.plusMin:
        if (this.state.value === "-") {
          this.next();
          if (!this.match(tt.num)) this.unexpected(null, "Unexpected token, expected number");
          return this.parseLiteral(-this.state.value, "NumberLiteralTypeAnnotation", node.start, node.loc.start);
        }

        this.unexpected();

      case tt.num:
        return this.parseLiteral(this.state.value, "NumberLiteralTypeAnnotation");

      case tt._null:
        node.value = this.match(tt._null);
        this.next();
        return this.finishNode(node, "NullLiteralTypeAnnotation");

      case tt._this:
        node.value = this.match(tt._this);
        this.next();
        return this.finishNode(node, "ThisTypeAnnotation");

      case tt.star:
        this.next();
        return this.finishNode(node, "ExistsTypeAnnotation");

      default:
        if (this.state.type.keyword === "typeof") {
          return this.flowParseTypeofType();
        }

    }

    throw this.unexpected();
  }

  flowParsePostfixType(): N.FlowTypeAnnotation {
    const startPos = this.state.start,
          startLoc = this.state.startLoc;
    let type = this.flowParsePrimaryType();

    while (!this.canInsertSemicolon() && this.match(tt.bracketL)) {
      const node = this.startNodeAt(startPos, startLoc);
      node.elementType = type;
      this.expect(tt.bracketL);
      this.expect(tt.bracketR);
      type = this.finishNode(node, "ArrayTypeAnnotation");
    }

    return type;
  }

  flowParsePrefixType(): N.FlowTypeAnnotation {
    const node = this.startNode();

    if (this.eat(tt.question)) {
      node.typeAnnotation = this.flowParsePrefixType();
      return this.finishNode(node, "NullableTypeAnnotation");
    } else {
      return this.flowParsePostfixType();
    }
  }

  flowParseAnonFunctionWithoutParens(): N.FlowTypeAnnotation {
    const param = this.flowParsePrefixType();

    if (!this.state.noAnonFunctionType && this.eat(tt.arrow)) {
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

  flowParseIntersectionType(): N.FlowTypeAnnotation {
    const node = this.startNode();
    this.eat(tt.bitwiseAND);
    const type = this.flowParseAnonFunctionWithoutParens();
    node.types = [type];

    while (this.eat(tt.bitwiseAND)) {
      node.types.push(this.flowParseAnonFunctionWithoutParens());
    }

    return node.types.length === 1 ? type : this.finishNode(node, "IntersectionTypeAnnotation");
  }

  flowParseUnionType(): N.FlowTypeAnnotation {
    const node = this.startNode();
    this.eat(tt.bitwiseOR);
    const type = this.flowParseIntersectionType();
    node.types = [type];

    while (this.eat(tt.bitwiseOR)) {
      node.types.push(this.flowParseIntersectionType());
    }

    return node.types.length === 1 ? type : this.finishNode(node, "UnionTypeAnnotation");
  }

  flowParseType(): N.FlowTypeAnnotation {
    const oldInType = this.state.inType;
    this.state.inType = true;
    const type = this.flowParseUnionType();
    this.state.inType = oldInType; // noAnonFunctionType is true when parsing an arrow function

    this.state.exprAllowed = this.state.noAnonFunctionType;
    return type;
  }

  flowParseTypeAnnotation(): N.FlowTypeAnnotation {
    const node = this.startNode();
    node.typeAnnotation = this.flowParseTypeInitialiser();
    return this.finishNode(node, "TypeAnnotation");
  }

  flowParseTypeAnnotatableIdentifier(): N.Identifier {
    const ident = this.flowParseRestrictedIdentifier();

    if (this.match(tt.colon)) {
      ident.typeAnnotation = this.flowParseTypeAnnotation();
      this.finishNode(ident, ident.type);
    }

    return ident;
  }

  typeCastToParameter(node: N.Node): N.Node {
    node.expression.typeAnnotation = node.typeAnnotation;
    return this.finishNodeAt(node.expression, node.expression.type, node.typeAnnotation.end, node.typeAnnotation.loc.end);
  }

  flowParseVariance(): ?N.FlowVariance {
    let variance = null;

    if (this.match(tt.plusMin)) {
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
  } // ==================================
  // Overrides
  // ==================================


  parseFunctionBodyAndFinish(node: N.BodilessFunctionOrMethodBase, type: string, allowExpressionBody?: boolean): void {
    // For arrow functions, `parseArrow` handles the return type itself.
    if (!allowExpressionBody && this.match(tt.colon)) {
      const typeNode = this.startNode();
      [// $FlowFixMe (destructuring not supported yet)
      typeNode.typeAnnotation, // $FlowFixMe (destructuring not supported yet)
      node.predicate] = this.flowParseTypeAndPredicateInitialiser();
      node.returnType = typeNode.typeAnnotation ? this.finishNode(typeNode, "TypeAnnotation") : null;
    }

    super.parseFunctionBodyAndFinish(node, type, allowExpressionBody);
  } // interfaces


  parseStatement(declaration: boolean, topLevel?: boolean): N.Statement {
    // strict mode handling of `interface` since it's a reserved word
    if (this.state.strict && this.match(tt.name) && this.state.value === "interface") {
      const node = this.startNode();
      this.next();
      return this.flowParseInterface(node);
    } else {
      return super.parseStatement(declaration, topLevel);
    }
  } // declares, interfaces and type aliases


  parseExpressionStatement(node: N.ExpressionStatement, expr: N.Expression): N.ExpressionStatement {
    if (expr.type === "Identifier") {
      if (expr.name === "declare") {
        if (this.match(tt._class) || this.match(tt.name) || this.match(tt._function) || this.match(tt._var) || this.match(tt._export)) {
          return this.flowParseDeclare(node);
        }
      } else if (this.match(tt.name)) {
        if (expr.name === "interface") {
          return this.flowParseInterface(node);
        } else if (expr.name === "type") {
          return this.flowParseTypeAlias(node);
        }
      }
    }

    return super.parseExpressionStatement(node, expr);
  } // export type


  shouldParseExportDeclaration(): boolean {
    return this.isContextual("type") || this.isContextual("interface") || super.shouldParseExportDeclaration();
  }

  isExportDefaultSpecifier(): boolean {
    if (this.match(tt.name) && (this.state.value === "type" || this.state.value === "interface")) {
      return false;
    }

    return super.isExportDefaultSpecifier();
  }

  parseConditional(expr: N.Expression, noIn: ?boolean, startPos: number, startLoc: Position, refNeedsArrowPos?: ?Pos): N.Expression {
    // only do the expensive clone if there is a question mark
    // and if we come from inside parens
    if (refNeedsArrowPos && this.match(tt.question)) {
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

  parseParenItem(node: N.Expression, startPos: number, startLoc: Position): N.Expression {
    node = super.parseParenItem(node, startPos, startLoc);

    if (this.eat(tt.question)) {
      node.optional = true;
    }

    if (this.match(tt.colon)) {
      const typeCastNode = this.startNodeAt(startPos, startLoc);
      typeCastNode.expression = node;
      typeCastNode.typeAnnotation = this.flowParseTypeAnnotation();
      return this.finishNode(typeCastNode, "TypeCastExpression");
    }

    return node;
  }

  parseExport(node: N.ExportNamedDeclaration): N.ExportNamedDeclaration {
    node = super.parseExport(node);

    if (node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") {
      node.exportKind = node.exportKind || "value";
    }

    return node;
  }

  parseExportDeclaration(node: N.ExportNamedDeclaration): ?N.Declaration {
    if (this.isContextual("type")) {
      node.exportKind = "type";
      const declarationNode = this.startNode();
      this.next();

      if (this.match(tt.braceL)) {
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

  shouldParseExportStar(): boolean {
    return super.shouldParseExportStar() || this.isContextual("type") && this.lookahead().type === tt.star;
  }

  parseExportStar(node: N.ExportNamedDeclaration, allowNamed: boolean): void {
    if (this.eatContextual("type")) {
      node.exportKind = "type";
      allowNamed = false;
    }

    return super.parseExportStar(node, allowNamed);
  }

  parseClassId(node: N.Class, isStatement: boolean, optionalId: ?boolean) {
    super.parseClassId(node, isStatement, optionalId);

    if (this.isRelational("<")) {
      node.typeParameters = this.flowParseTypeParameterDeclaration();
    }
  } // don't consider `void` to be a keyword as then it'll use the void token type
  // and set startExpr


  isKeyword(name: string): boolean {
    if (this.state.inType && name === "void") {
      return false;
    } else {
      return super.isKeyword(name);
    }
  } // ensure that inside flow types, we bypass the jsx parser plugin


  readToken(code: number): void {
    if (this.state.inType && (code === 62 || code === 60)) {
      return this.finishOp(tt.relational, 1);
    } else {
      return super.readToken(code);
    }
  }

  toAssignable(node: N.Node, isBinding: ?boolean, contextDescription: string): N.Node {
    if (node.type === "TypeCastExpression") {
      return super.toAssignable(this.typeCastToParameter(node), isBinding, contextDescription);
    } else {
      return super.toAssignable(node, isBinding, contextDescription);
    }
  } // turn type casts that we found in function parameter head into type annotated params


  toAssignableList(exprList: N.Expression[], isBinding: ?boolean, contextDescription: string): $ReadOnlyArray<N.Pattern> {
    for (let i = 0; i < exprList.length; i++) {
      const expr = exprList[i];

      if (expr && expr.type === "TypeCastExpression") {
        exprList[i] = this.typeCastToParameter(expr);
      }
    }

    return super.toAssignableList(exprList, isBinding, contextDescription);
  } // this is a list of nodes, from something like a call expression, we need to filter the
  // type casts that we've found that are illegal in this context


  toReferencedList(exprList: $ReadOnlyArray<?N.Expression>): $ReadOnlyArray<?N.Expression> {
    for (let i = 0; i < exprList.length; i++) {
      const expr = exprList[i];

      if (expr && expr._exprListItem && expr.type === "TypeCastExpression") {
        this.raise(expr.start, "Unexpected type cast");
      }
    }

    return exprList;
  } // parse an item inside a expression list eg. `(NODE, NODE)` where NODE represents
  // the position where this function is called


  parseExprListItem(allowEmpty: ?boolean, refShorthandDefaultPos: ?Pos, refNeedsArrowPos: ?Pos): ?N.Expression {
    const container = this.startNode();
    const node = super.parseExprListItem(allowEmpty, refShorthandDefaultPos, refNeedsArrowPos);

    if (this.match(tt.colon)) {
      container._exprListItem = true;
      container.expression = node;
      container.typeAnnotation = this.flowParseTypeAnnotation();
      return this.finishNode(container, "TypeCastExpression");
    } else {
      return node;
    }
  }

  checkLVal(expr: N.Expression, isBinding: ?boolean, checkClashes: ?{
    [key: string]: boolean
  }, contextDescription: string): void {
    if (expr.type !== "TypeCastExpression") {
      return super.checkLVal(expr, isBinding, checkClashes, contextDescription);
    }
  } // parse class property type annotations


  parseClassProperty(node: N.ClassProperty): N.ClassProperty {
    if (this.match(tt.colon)) {
      node.typeAnnotation = this.flowParseTypeAnnotation();
    }

    return super.parseClassProperty(node);
  } // determine whether or not we're currently in the position where a class method would appear


  isClassMethod(): boolean {
    return this.isRelational("<") || super.isClassMethod();
  } // determine whether or not we're currently in the position where a class property would appear


  isClassProperty(): boolean {
    return this.match(tt.colon) || super.isClassProperty();
  }

  isNonstaticConstructor(method: N.ClassMethod | N.ClassProperty): boolean {
    return !this.match(tt.colon) && super.isNonstaticConstructor(method);
  } // parse type parameters for class methods


  parseClassMethod(classBody: N.ClassBody, method: N.ClassMethod, isGenerator: boolean, isAsync: boolean, isConstructor: boolean): void {
    if (method.variance) {
      this.unexpected(method.variance.start);
    }

    delete method.variance;

    if (this.isRelational("<")) {
      method.typeParameters = this.flowParseTypeParameterDeclaration();
    }

    super.parseClassMethod(classBody, method, isGenerator, isAsync, isConstructor);
  } // parse a the super class type parameters and implements


  parseClassSuper(node: N.Class): void {
    super.parseClassSuper(node);

    if (node.superClass && this.isRelational("<")) {
      node.superTypeParameters = this.flowParseTypeParameterInstantiation();
    }

    if (this.isContextual("implements")) {
      this.next();
      const implemented: N.FlowClassImplements[] = node.implements = [];

      do {
        const node = this.startNode();
        node.id = this.parseIdentifier();

        if (this.isRelational("<")) {
          node.typeParameters = this.flowParseTypeParameterInstantiation();
        } else {
          node.typeParameters = null;
        }

        implemented.push(this.finishNode(node, "ClassImplements"));
      } while (this.eat(tt.comma));
    }
  }

  parsePropertyName(node: N.ObjectOrClassMember | N.TsNamedTypeElementBase): N.Identifier {
    const variance = this.flowParseVariance();
    const key = super.parsePropertyName(node); // $FlowIgnore ("variance" not defined on TsNamedTypeElementBase)

    node.variance = variance;
    return key;
  } // parse type parameters for object method shorthand


  parseObjPropValue(prop: N.ObjectMember, startPos: ?number, startLoc: ?Position, isGenerator: boolean, isAsync: boolean, isPattern: boolean, refShorthandDefaultPos: ?Pos): void {
    if (prop.variance) {
      this.unexpected(prop.variance.start);
    }

    delete prop.variance;
    let typeParameters; // method shorthand

    if (this.isRelational("<")) {
      typeParameters = this.flowParseTypeParameterDeclaration();
      if (!this.match(tt.parenL)) this.unexpected();
    }

    super.parseObjPropValue(prop, startPos, startLoc, isGenerator, isAsync, isPattern, refShorthandDefaultPos); // add typeParameters if we found them

    if (typeParameters) {
      // $FlowFixMe (trying to set '.typeParameters' on an expression)
      (prop.value || prop).typeParameters = typeParameters;
    }
  }

  parseAssignableListItemTypes(param: N.Pattern): N.Pattern {
    if (this.eat(tt.question)) {
      if (param.type !== "Identifier") {
        throw this.raise(param.start, "A binding pattern parameter cannot be optional in an implementation signature.");
      }

      param.optional = true;
    }

    if (this.match(tt.colon)) {
      param.typeAnnotation = this.flowParseTypeAnnotation();
    }

    this.finishNode(param, param.type);
    return param;
  }

  parseMaybeDefault(startPos?: ?number, startLoc?: ?Position, left?: ?N.Pattern): N.Pattern {
    const node = super.parseMaybeDefault(startPos, startLoc, left);

    if (node.type === "AssignmentPattern" && node.typeAnnotation && node.right.start < node.typeAnnotation.start) {
      this.raise(node.typeAnnotation.start, "Type annotations must come before default assignments, e.g. instead of `age = 25: number` use `age: number = 25`");
    }

    return node;
  } // parse typeof and type imports


  parseImportSpecifiers(node: N.ImportDeclaration): void {
    node.importKind = "value";
    let kind = null;

    if (this.match(tt._typeof)) {
      kind = "typeof";
    } else if (this.isContextual("type")) {
      kind = "type";
    }

    if (kind) {
      const lh = this.lookahead();

      if (lh.type === tt.name && lh.value !== "from" || lh.type === tt.braceL || lh.type === tt.star) {
        this.next();
        node.importKind = kind;
      }
    }

    super.parseImportSpecifiers(node);
  } // parse import-type/typeof shorthand


  parseImportSpecifier(node: N.ImportDeclaration): void {
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

      if (specifierTypeKind !== null && !this.match(tt.name) && !this.state.type.keyword) {
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
    } else if (specifierTypeKind !== null && (this.match(tt.name) || this.state.type.keyword)) {
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
  } // parse function type parameters - function foo<T>() {}


  parseFunctionParams(node: N.Function): void {
    if (this.isRelational("<")) {
      node.typeParameters = this.flowParseTypeParameterDeclaration();
    }

    super.parseFunctionParams(node);
  } // parse flow type annotations on variable declarator heads - let foo: string = bar


  parseVarHead(decl: N.VariableDeclarator): void {
    super.parseVarHead(decl);

    if (this.match(tt.colon)) {
      decl.id.typeAnnotation = this.flowParseTypeAnnotation();
      this.finishNode(decl.id, decl.id.type);
    }
  } // parse the return type of an async arrow function - let foo = (async (): number => {});


  parseAsyncArrowFromCallExpression(node: N.ArrowFunctionExpression, call: N.CallExpression): N.ArrowFunctionExpression {
    if (this.match(tt.colon)) {
      const oldNoAnonFunctionType = this.state.noAnonFunctionType;
      this.state.noAnonFunctionType = true;
      node.returnType = this.flowParseTypeAnnotation();
      this.state.noAnonFunctionType = oldNoAnonFunctionType;
    }

    return super.parseAsyncArrowFromCallExpression(node, call);
  } // todo description


  shouldParseAsyncArrow(): boolean {
    return this.match(tt.colon) || super.shouldParseAsyncArrow();
  } // We need to support type parameter declarations for arrow functions. This
  // is tricky. There are three situations we need to handle
  //
  // 1. This is either JSX or an arrow function. We'll try JSX first. If that
  //    fails, we'll try an arrow function. If that fails, we'll throw the JSX
  //    error.
  // 2. This is an arrow function. We'll parse the type parameter declaration,
  //    parse the rest, make sure the rest is an arrow function, and go from
  //    there
  // 3. This is neither. Just call the super method


  parseMaybeAssign(noIn?: ?boolean, refShorthandDefaultPos?: ?Pos, afterLeftParse?: Function, refNeedsArrowPos?: ?Pos): N.Expression {
    let jsxError = null;

    if (tt.jsxTagStart && this.match(tt.jsxTagStart)) {
      const state = this.state.clone();

      try {
        return super.parseMaybeAssign(noIn, refShorthandDefaultPos, afterLeftParse, refNeedsArrowPos);
      } catch (err) {
        if (err instanceof SyntaxError) {
          this.state = state; // Remove `tc.j_expr` and `tc.j_oTag` from context added
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
  } // handle return types for arrow functions


  parseArrow(node: N.ArrowFunctionExpression): ?N.ArrowFunctionExpression {
    if (this.match(tt.colon)) {
      const state = this.state.clone();

      try {
        const oldNoAnonFunctionType = this.state.noAnonFunctionType;
        this.state.noAnonFunctionType = true;
        const typeNode = this.startNode();
        [// $FlowFixMe (destructuring not supported yet)
        typeNode.typeAnnotation, // $FlowFixMe (destructuring not supported yet)
        node.predicate] = this.flowParseTypeAndPredicateInitialiser();
        this.state.noAnonFunctionType = oldNoAnonFunctionType;
        if (this.canInsertSemicolon()) this.unexpected();
        if (!this.match(tt.arrow)) this.unexpected(); // assign after it is clear it is an arrow

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

  shouldParseArrow(): boolean {
    return this.match(tt.colon) || super.shouldParseArrow();
  }

});
// @flow
import XHTMLEntities from "./xhtml";
import type Parser from "../../parser";
import { TokenType, types as tt } from "../../tokenizer/types";
import { TokContext, types as tc } from "../../tokenizer/context";
import * as N from "../../types";
import { isIdentifierChar, isIdentifierStart } from "../../util/identifier";
import type { Pos, Position } from "../../util/location";
import { isNewLine } from "../../util/whitespace";
const HEX_NUMBER = /^[\da-fA-F]+$/;
const DECIMAL_NUMBER = /^\d+$/;
tc.j_oTag = new TokContext("<tag", false);
tc.j_cTag = new TokContext("</tag", false);
tc.j_expr = new TokContext("<tag>...</tag>", true, true);
tt.jsxName = new TokenType("jsxName");
tt.jsxText = new TokenType("jsxText", {
  beforeExpr: true
});
tt.jsxTagStart = new TokenType("jsxTagStart", {
  startsExpr: true
});
tt.jsxTagEnd = new TokenType("jsxTagEnd");

tt.jsxTagStart.updateContext = function () {
  this.state.context.push(tc.j_expr); // treat as beginning of JSX expression

  this.state.context.push(tc.j_oTag); // start opening tag context

  this.state.exprAllowed = false;
};

tt.jsxTagEnd.updateContext = function (prevType) {
  const out = this.state.context.pop();

  if (out === tc.j_oTag && prevType === tt.slash || out === tc.j_cTag) {
    this.state.context.pop();
    this.state.exprAllowed = this.curContext() === tc.j_expr;
  } else {
    this.state.exprAllowed = true;
  }
}; // Transforms JSX element name to string.


function getQualifiedJSXName(object: N.JSXIdentifier | N.JSXNamespacedName | N.JSXMemberExpression): string {
  if (object.type === "JSXIdentifier") {
    return object.name;
  }

  if (object.type === "JSXNamespacedName") {
    return object.namespace.name + ":" + object.name.name;
  }

  if (object.type === "JSXMemberExpression") {
    return getQualifiedJSXName(object.object) + "." + getQualifiedJSXName(object.property);
  } // istanbul ignore next


  throw new Error("Node had unexpected type: " + object.type);
}

export default ((superClass: Class<Parser>): Class<Parser> => class extends superClass {
  // Reads inline JSX contents token.
  jsxReadToken(): void {
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
              return this.finishToken(tt.jsxTagStart);
            }

            return this.getTokenFromCode(ch);
          }

          out += this.input.slice(chunkStart, this.state.pos);
          return this.finishToken(tt.jsxText, out);

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

  jsxReadNewLine(normalizeCRLF: boolean): string {
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

  jsxReadString(quote: number): void {
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
    return this.finishToken(tt.string, out);
  }

  jsxReadEntity(): string {
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
          entity = XHTMLEntities[str];
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
  } // Read a JSX identifier (valid tag or attribute name).
  //
  // Optimized version since JSX identifiers can"t contain
  // escape characters and so can be read as single slice.
  // Also assumes that first character was already checked
  // by isIdentifierStart in readToken.


  jsxReadWord(): void {
    let ch;
    const start = this.state.pos;

    do {
      ch = this.input.charCodeAt(++this.state.pos);
    } while (isIdentifierChar(ch) || ch === 45); // "-"


    return this.finishToken(tt.jsxName, this.input.slice(start, this.state.pos));
  } // Parse next token as JSX identifier


  jsxParseIdentifier(): N.JSXIdentifier {
    const node = this.startNode();

    if (this.match(tt.jsxName)) {
      node.name = this.state.value;
    } else if (this.state.type.keyword) {
      node.name = this.state.type.keyword;
    } else {
      this.unexpected();
    }

    this.next();
    return this.finishNode(node, "JSXIdentifier");
  } // Parse namespaced identifier.


  jsxParseNamespacedName(): N.JSXNamespacedName {
    const startPos = this.state.start;
    const startLoc = this.state.startLoc;
    const name = this.jsxParseIdentifier();
    if (!this.eat(tt.colon)) return name;
    const node = this.startNodeAt(startPos, startLoc);
    node.namespace = name;
    node.name = this.jsxParseIdentifier();
    return this.finishNode(node, "JSXNamespacedName");
  } // Parses element name in any form - namespaced, member
  // or single identifier.


  jsxParseElementName(): N.JSXNamespacedName | N.JSXMemberExpression {
    const startPos = this.state.start;
    const startLoc = this.state.startLoc;
    let node = this.jsxParseNamespacedName();

    while (this.eat(tt.dot)) {
      const newNode = this.startNodeAt(startPos, startLoc);
      newNode.object = node;
      newNode.property = this.jsxParseIdentifier();
      node = this.finishNode(newNode, "JSXMemberExpression");
    }

    return node;
  } // Parses any type of JSX attribute value.


  jsxParseAttributeValue(): N.Expression {
    let node;

    switch (this.state.type) {
      case tt.braceL:
        node = this.jsxParseExpressionContainer();

        if (node.expression.type === "JSXEmptyExpression") {
          throw this.raise(node.start, "JSX attributes must only be assigned a non-empty expression");
        } else {
          return node;
        }

      case tt.jsxTagStart:
      case tt.string:
        return this.parseExprAtom();

      default:
        throw this.raise(this.state.start, "JSX value should be either an expression or a quoted JSX text");
    }
  } // JSXEmptyExpression is unique type since it doesn't actually parse anything,
  // and so it should start at the end of last read token (left brace) and finish
  // at the beginning of the next one (right brace).


  jsxParseEmptyExpression(): N.JSXEmptyExpression {
    const node = this.startNodeAt(this.state.lastTokEnd, this.state.lastTokEndLoc);
    return this.finishNodeAt(node, "JSXEmptyExpression", this.state.start, this.state.startLoc);
  } // Parse JSX spread child


  jsxParseSpreadChild(): N.JSXSpreadChild {
    const node = this.startNode();
    this.expect(tt.braceL);
    this.expect(tt.ellipsis);
    node.expression = this.parseExpression();
    this.expect(tt.braceR);
    return this.finishNode(node, "JSXSpreadChild");
  } // Parses JSX expression enclosed into curly brackets.


  jsxParseExpressionContainer(): N.JSXExpressionContainer {
    const node = this.startNode();
    this.next();

    if (this.match(tt.braceR)) {
      node.expression = this.jsxParseEmptyExpression();
    } else {
      node.expression = this.parseExpression();
    }

    this.expect(tt.braceR);
    return this.finishNode(node, "JSXExpressionContainer");
  } // Parses following JSX attribute name-value pair.


  jsxParseAttribute(): N.JSXAttribute {
    const node = this.startNode();

    if (this.eat(tt.braceL)) {
      this.expect(tt.ellipsis);
      node.argument = this.parseMaybeAssign();
      this.expect(tt.braceR);
      return this.finishNode(node, "JSXSpreadAttribute");
    }

    node.name = this.jsxParseNamespacedName();
    node.value = this.eat(tt.eq) ? this.jsxParseAttributeValue() : null;
    return this.finishNode(node, "JSXAttribute");
  } // Parses JSX opening tag starting after "<".


  jsxParseOpeningElementAt(startPos: number, startLoc: Position): N.JSXOpeningElement {
    const node = this.startNodeAt(startPos, startLoc);
    node.attributes = [];
    node.name = this.jsxParseElementName();

    while (!this.match(tt.slash) && !this.match(tt.jsxTagEnd)) {
      node.attributes.push(this.jsxParseAttribute());
    }

    node.selfClosing = this.eat(tt.slash);
    this.expect(tt.jsxTagEnd);
    return this.finishNode(node, "JSXOpeningElement");
  } // Parses JSX closing tag starting after "</".


  jsxParseClosingElementAt(startPos: number, startLoc: Position): N.JSXClosingElement {
    const node = this.startNodeAt(startPos, startLoc);
    node.name = this.jsxParseElementName();
    this.expect(tt.jsxTagEnd);
    return this.finishNode(node, "JSXClosingElement");
  } // Parses entire JSX element, including it"s opening tag
  // (starting after "<"), attributes, contents and closing tag.


  jsxParseElementAt(startPos: number, startLoc: Position): N.JSXElement {
    const node = this.startNodeAt(startPos, startLoc);
    const children = [];
    const openingElement = this.jsxParseOpeningElementAt(startPos, startLoc);
    let closingElement = null;

    if (!openingElement.selfClosing) {
      contents: for (;;) {
        switch (this.state.type) {
          case tt.jsxTagStart:
            startPos = this.state.start;
            startLoc = this.state.startLoc;
            this.next();

            if (this.eat(tt.slash)) {
              closingElement = this.jsxParseClosingElementAt(startPos, startLoc);
              break contents;
            }

            children.push(this.jsxParseElementAt(startPos, startLoc));
            break;

          case tt.jsxText:
            children.push(this.parseExprAtom());
            break;

          case tt.braceL:
            if (this.lookahead().type === tt.ellipsis) {
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

      if ( // $FlowIgnore
      getQualifiedJSXName(closingElement.name) !== getQualifiedJSXName(openingElement.name)) {
        this.raise( // $FlowIgnore
        closingElement.start, "Expected corresponding JSX closing tag for <" + getQualifiedJSXName(openingElement.name) + ">");
      }
    }

    node.openingElement = openingElement;
    node.closingElement = closingElement;
    node.children = children;

    if (this.match(tt.relational) && this.state.value === "<") {
      this.raise(this.state.start, "Adjacent JSX elements must be wrapped in an enclosing tag");
    }

    return this.finishNode(node, "JSXElement");
  } // Parses entire JSX element from current position.


  jsxParseElement(): N.JSXElement {
    const startPos = this.state.start;
    const startLoc = this.state.startLoc;
    this.next();
    return this.jsxParseElementAt(startPos, startLoc);
  } // ==================================
  // Overrides
  // ==================================


  parseExprAtom(refShortHandDefaultPos: ?Pos): N.Expression {
    if (this.match(tt.jsxText)) {
      return this.parseLiteral(this.state.value, "JSXText");
    } else if (this.match(tt.jsxTagStart)) {
      return this.jsxParseElement();
    } else {
      return super.parseExprAtom(refShortHandDefaultPos);
    }
  }

  readToken(code: number): void {
    if (this.state.inPropertyName) return super.readToken(code);
    const context = this.curContext();

    if (context === tc.j_expr) {
      return this.jsxReadToken();
    }

    if (context === tc.j_oTag || context === tc.j_cTag) {
      if (isIdentifierStart(code)) {
        return this.jsxReadWord();
      }

      if (code === 62) {
        ++this.state.pos;
        return this.finishToken(tt.jsxTagEnd);
      }

      if ((code === 34 || code === 39) && context === tc.j_oTag) {
        return this.jsxReadString(code);
      }
    }

    if (code === 60 && this.state.exprAllowed) {
      ++this.state.pos;
      return this.finishToken(tt.jsxTagStart);
    }

    return super.readToken(code);
  }

  updateContext(prevType: TokenType): void {
    if (this.match(tt.braceL)) {
      const curContext = this.curContext();

      if (curContext === tc.j_oTag) {
        this.state.context.push(tc.braceExpression);
      } else if (curContext === tc.j_expr) {
        this.state.context.push(tc.templateQuasi);
      } else {
        super.updateContext(prevType);
      }

      this.state.exprAllowed = true;
    } else if (this.match(tt.slash) && prevType === tt.jsxTagStart) {
      this.state.context.length -= 2; // do not consider JSX expr -> JSX open tag -> ... anymore

      this.state.context.push(tc.j_cTag); // reconsider as closing tag context

      this.state.exprAllowed = false;
    } else {
      return super.updateContext(prevType);
    }
  }

});
// @flow
const entities: {
  [name: string]: string
} = {
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
export default entities;
// @flow
import type { TokenType } from "../tokenizer/types";
import { types as tt } from "../tokenizer/types";
import { types as ct } from "../tokenizer/context";
import * as N from "../types";
import type { Pos, Position } from "../util/location";
import Parser from "../parser";
type TsModifier = "readonly" | "abstract" | "static" | "public" | "private" | "protected";

function nonNull<T>(x: ?T): T {
  if (x == null) {
    // $FlowIgnore
    throw new Error(`Unexpected ${x} value.`);
  }

  return x;
}

function assert(x: boolean): void {
  if (!x) {
    throw new Error("Assert fail");
  }
}

type ParsingContext = "EnumMembers" | "HeritageClauseElement" | "TupleElementTypes" | "TypeMembers" | "TypeParametersOrArguments"; // Doesn't handle "void" or "null" because those are keywords, not identifiers.

function keywordTypeFromName(value: string): N.TsKeywordTypeType | typeof undefined {
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

export default ((superClass: Class<Parser>): Class<Parser> => class extends superClass {
  tsIsIdentifier(): boolean {
    // TODO: actually a bit more complex in TypeScript, but shouldn't matter.
    // See https://github.com/Microsoft/TypeScript/issues/15008
    return this.match(tt.name);
  }

  tsNextTokenCanFollowModifier() {
    // Note: TypeScript's implementation is much more complicated because
    // more things are considered modifiers there.
    // This implementation only handles modifiers not handled by babylon itself. And "static".
    // TODO: Would be nice to avoid lookahead. Want a hasLineBreakUpNext() method...
    this.next();
    return !this.hasPrecedingLineBreak() && !this.match(tt.parenL) && !this.match(tt.colon) && !this.match(tt.eq) && !this.match(tt.question);
  }
  /** Parses a modifier matching one the given modifier names. */


  tsParseModifier<T: TsModifier>(allowedModifiers: T[]): ?T {
    if (!this.match(tt.name)) {
      return undefined;
    }

    const modifier = this.state.value;

    if (allowedModifiers.indexOf(modifier) !== -1 && this.tsTryParse(this.tsNextTokenCanFollowModifier.bind(this))) {
      return modifier;
    }

    return undefined;
  }

  tsIsListTerminator(kind: ParsingContext): boolean {
    switch (kind) {
      case "EnumMembers":
      case "TypeMembers":
        return this.match(tt.braceR);

      case "HeritageClauseElement":
        return this.match(tt.braceL);

      case "TupleElementTypes":
        return this.match(tt.bracketR);

      case "TypeParametersOrArguments":
        return this.isRelational(">");
    }

    throw new Error("Unreachable");
  }

  tsParseList<T: N.Node>(kind: ParsingContext, parseElement: () => T): T[] {
    const result: T[] = [];

    while (!this.tsIsListTerminator(kind)) {
      // Skipping "parseListElement" from the TS source since that's just for error handling.
      result.push(parseElement());
    }

    return result;
  }

  tsParseDelimitedList<T: N.Node>(kind: ParsingContext, parseElement: () => T): T[] {
    return nonNull(this.tsParseDelimitedListWorker(kind, parseElement,
    /* expectSuccess */
    true));
  }

  tsTryParseDelimitedList<T: N.Node>(kind: ParsingContext, parseElement: () => ?T): ?T[] {
    return this.tsParseDelimitedListWorker(kind, parseElement,
    /* expectSuccess */
    false);
  }
  /**
  * If !expectSuccess, returns undefined instead of failing to parse.
  * If expectSuccess, parseElement should always return a defined value.
  */


  tsParseDelimitedListWorker<T: N.Node>(kind: ParsingContext, parseElement: () => ?T, expectSuccess: boolean): ?T[] {
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

      if (this.eat(tt.comma)) {
        continue;
      }

      if (this.tsIsListTerminator(kind)) {
        break;
      }

      if (expectSuccess) {
        // This will fail with an error about a missing comma
        this.expect(tt.comma);
      }

      return undefined;
    }

    return result;
  }

  tsParseBracketedList<T: N.Node>(kind: ParsingContext, parseElement: () => T, bracket: boolean, skipFirstToken: boolean): T[] {
    if (!skipFirstToken) {
      if (bracket) {
        this.expect(tt.bracketL);
      } else {
        this.expectRelational("<");
      }
    }

    const result = this.tsParseDelimitedList(kind, parseElement);

    if (bracket) {
      this.expect(tt.bracketR);
    } else {
      this.expectRelational(">");
    }

    return result;
  }

  tsParseEntityName(allowReservedWords: boolean): N.TsEntityName {
    let entity: N.TsEntityName = this.parseIdentifier();

    while (this.eat(tt.dot)) {
      const node: N.TsQualifiedName = this.startNodeAtNode(entity);
      node.left = entity;
      node.right = this.parseIdentifier(allowReservedWords);
      entity = this.finishNode(node, "TSQualifiedName");
    }

    return entity;
  }

  tsParseTypeReference(): N.TsTypeReference {
    const node: N.TsTypeReference = this.startNode();
    node.typeName = this.tsParseEntityName(
    /* allowReservedWords */
    false);

    if (!this.hasPrecedingLineBreak() && this.isRelational("<")) {
      node.typeParameters = this.tsParseTypeArguments();
    }

    return this.finishNode(node, "TSTypeReference");
  }

  tsParseThisTypePredicate(lhs: N.TsThisType): N.TsTypePredicate {
    this.next();
    const node: N.TsTypePredicate = this.startNode();
    node.parameterName = lhs;
    node.typeAnnotation = this.tsParseTypeAnnotation(
    /* eatColon */
    false);
    return this.finishNode(node, "TSTypePredicate");
  }

  tsParseThisTypeNode(): N.TsThisType {
    const node: N.TsThisType = this.startNode();
    this.next();
    return this.finishNode(node, "TSThisType");
  }

  tsParseTypeQuery(): N.TsTypeQuery {
    const node: N.TsTypeQuery = this.startNode();
    this.expect(tt._typeof);
    node.exprName = this.tsParseEntityName(
    /* allowReservedWords */
    true);
    return this.finishNode(node, "TSTypeQuery");
  }

  tsParseTypeParameter(): N.TypeParameter {
    const node: N.TypeParameter = this.startNode();
    node.name = this.parseIdentifierName(node.start);

    if (this.eat(tt._extends)) {
      node.constraint = this.tsParseType();
    }

    if (this.eat(tt.eq)) {
      node.default = this.tsParseType();
    }

    return this.finishNode(node, "TypeParameter");
  }

  tsTryParseTypeParameters(): ?N.TypeParameterDeclaration {
    if (this.eatRelational("<")) {
      return this.tsParseTypeParameters();
    }
  }

  tsParseTypeParameters(): N.TypeParameterDeclaration {
    const node: N.TypeParameterDeclaration = this.startNode();
    node.params = this.tsParseBracketedList("TypeParametersOrArguments", this.tsParseTypeParameter.bind(this),
    /* bracket */
    false,
    /* skipFirstToken */
    true);
    return this.finishNode(node, "TypeParameterDeclaration");
  } // Note: In TypeScript implementation we must provide `yieldContext` and `awaitContext`,
  // but here it's always false, because this is only used for types.


  tsFillSignature(returnToken: TokenType, signature: N.TsSignatureDeclaration): void {
    // Arrow fns *must* have return token (`=>`). Normal functions can omit it.
    const returnTokenRequired = returnToken === tt.arrow;
    signature.typeParameters = this.tsTryParseTypeParameters();
    this.expect(tt.parenL);
    signature.parameters = this.tsParseBindingListForSignature();

    if (returnTokenRequired) {
      signature.typeAnnotation = this.tsParseTypeOrTypePredicateAnnotation(returnToken);
    } else if (this.match(returnToken)) {
      signature.typeAnnotation = this.tsParseTypeOrTypePredicateAnnotation(returnToken);
    }
  }

  tsParseBindingListForSignature(): $ReadOnlyArray<N.Identifier | N.RestElement> {
    return this.parseBindingList(tt.parenR).map(pattern => {
      if (pattern.type !== "Identifier" && pattern.type !== "RestElement") {
        throw this.unexpected(pattern.start, "Name in a signature must be an Identifier.");
      }

      return pattern;
    });
  }

  tsParseTypeMemberSemicolon(): void {
    if (!this.eat(tt.comma)) {
      this.semicolon();
    }
  }

  tsParseSignatureMember(kind: "TSCallSignatureDeclaration" | "TSConstructSignatureDeclaration"): N.TsCallSignatureDeclaration | N.TsConstructSignatureDeclaration {
    const node: N.TsCallSignatureDeclaration | N.TsConstructSignatureDeclaration = this.startNode();

    if (kind === "TSConstructSignatureDeclaration") {
      this.expect(tt._new);
    }

    this.tsFillSignature(tt.colon, node);
    this.tsParseTypeMemberSemicolon();
    return this.finishNode(node, kind);
  }

  tsIsUnambiguouslyIndexSignature() {
    this.next(); // Skip '{'

    return this.eat(tt.name) && this.match(tt.colon);
  }

  tsTryParseIndexSignature(node: N.TsIndexSignature): ?N.TsIndexSignature {
    if (!(this.match(tt.bracketL) && this.tsLookAhead(this.tsIsUnambiguouslyIndexSignature.bind(this)))) {
      return undefined;
    }

    this.expect(tt.bracketL);
    const id = this.parseIdentifier();
    this.expect(tt.colon);
    id.typeAnnotation = this.tsParseTypeAnnotation(
    /* eatColon */
    false);
    this.expect(tt.bracketR);
    node.parameters = [id];
    const type = this.tsTryParseTypeAnnotation();
    if (type) node.typeAnnotation = type;
    this.tsParseTypeMemberSemicolon();
    return this.finishNode(node, "TSIndexSignature");
  }

  tsParsePropertyOrMethodSignature(node: N.TsPropertySignature | N.TsMethodSignature, readonly: boolean): N.TsPropertySignature | N.TsMethodSignature {
    this.parsePropertyName(node);
    if (this.eat(tt.question)) node.optional = true;
    const nodeAny: any = node;

    if (!readonly && (this.match(tt.parenL) || this.isRelational("<"))) {
      const method: N.TsMethodSignature = nodeAny;
      this.tsFillSignature(tt.colon, method);
      this.tsParseTypeMemberSemicolon();
      return this.finishNode(method, "TSMethodSignature");
    } else {
      const property: N.TsPropertySignature = nodeAny;
      if (readonly) property.readonly = true;
      const type = this.tsTryParseTypeAnnotation();
      if (type) property.typeAnnotation = type;
      this.tsParseTypeMemberSemicolon();
      return this.finishNode(property, "TSPropertySignature");
    }
  }

  tsParseTypeMember(): N.TsTypeElement {
    if (this.match(tt.parenL) || this.isRelational("<")) {
      return this.tsParseSignatureMember("TSCallSignatureDeclaration");
    }

    if (this.match(tt._new) && this.tsLookAhead(this.tsIsStartOfConstructSignature.bind(this))) {
      return this.tsParseSignatureMember("TSConstructSignatureDeclaration");
    } // Instead of fullStart, we create a node here.


    const node: any = this.startNode();
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
    return this.match(tt.parenL) || this.isRelational("<");
  }

  tsParseTypeLiteral(): N.TsTypeLiteral {
    const node: N.TsTypeLiteral = this.startNode();
    node.members = this.tsParseObjectTypeMembers();
    return this.finishNode(node, "TSTypeLiteral");
  }

  tsParseObjectTypeMembers(): $ReadOnlyArray<N.TsTypeElement> {
    this.expect(tt.braceL);
    const members = this.tsParseList("TypeMembers", this.tsParseTypeMember.bind(this));
    this.expect(tt.braceR);
    return members;
  }

  tsIsStartOfMappedType(): boolean {
    this.next();

    if (this.isContextual("readonly")) {
      this.next();
    }

    if (!this.match(tt.bracketL)) {
      return false;
    }

    this.next();

    if (!this.tsIsIdentifier()) {
      return false;
    }

    this.next();
    return this.match(tt._in);
  }

  tsParseMappedTypeParameter(): N.TypeParameter {
    const node: N.TypeParameter = this.startNode();
    node.name = this.parseIdentifierName(node.start);
    this.expect(tt._in);
    node.constraint = this.tsParseType();
    return this.finishNode(node, "TypeParameter");
  }

  tsParseMappedType(): N.TsMappedType {
    const node: N.TsMappedType = this.startNode();
    this.expect(tt.braceL);

    if (this.eatContextual("readonly")) {
      node.readonly = true;
    }

    this.expect(tt.bracketL);
    node.typeParameter = this.tsParseMappedTypeParameter();
    this.expect(tt.bracketR);

    if (this.eat(tt.question)) {
      node.optional = true;
    }

    node.typeAnnotation = this.tsTryParseType();
    this.semicolon();
    this.expect(tt.braceR);
    return this.finishNode(node, "TSMappedType");
  }

  tsParseTupleType(): N.TsTupleType {
    const node: N.TsTupleType = this.startNode();
    node.elementTypes = this.tsParseBracketedList("TupleElementTypes", this.tsParseType.bind(this),
    /* bracket */
    true,
    /* skipFirstToken */
    false);
    return this.finishNode(node, "TSTupleType");
  }

  tsParseParenthesizedType(): N.TsParenthesizedType {
    const node = this.startNode();
    this.expect(tt.parenL);
    node.typeAnnotation = this.tsParseType();
    this.expect(tt.parenR);
    return this.finishNode(node, "TSParenthesizedType");
  }

  tsParseFunctionOrConstructorType(type: "TSFunctionType" | "TSConstructorType"): N.TsFunctionOrConstructorType {
    const node: N.TsFunctionOrConstructorType = this.startNode();

    if (type === "TSConstructorType") {
      this.expect(tt._new);
    }

    this.tsFillSignature(tt.arrow, node);
    return this.finishNode(node, type);
  }

  tsParseLiteralTypeNode(): N.TsLiteralType {
    const node: N.TsLiteralType = this.startNode();

    node.literal = (() => {
      switch (this.state.type) {
        case tt.num:
          return this.parseLiteral(this.state.value, "NumericLiteral");

        case tt.string:
          return this.parseLiteral(this.state.value, "StringLiteral");

        case tt._true:
        case tt._false:
          return this.parseBooleanLiteral();

        default:
          throw this.unexpected();
      }
    })();

    return this.finishNode(node, "TSLiteralType");
  }

  tsParseNonArrayType(): N.TsType {
    switch (this.state.type) {
      case tt.name:
      case tt._void:
      case tt._null:
        const type = this.match(tt._void) ? "TSVoidKeyword" : this.match(tt._null) ? "TSNullKeyword" : keywordTypeFromName(this.state.value);

        if (type !== undefined && this.lookahead().type !== tt.dot) {
          const node: N.TsKeywordType = this.startNode();
          this.next();
          return this.finishNode(node, type);
        }

        return this.tsParseTypeReference();

      case tt.string:
      case tt.num:
      case tt._true:
      case tt._false:
        return this.tsParseLiteralTypeNode();

      case tt.plusMin:
        if (this.state.value === "-") {
          const node: N.TsLiteralType = this.startNode();
          this.next();

          if (!this.match(tt.num)) {
            throw this.unexpected();
          }

          node.literal = this.parseLiteral(-this.state.value, "NumericLiteral", node.start, node.loc.start);
          return this.finishNode(node, "TSLiteralType");
        }

        break;

      case tt._this:
        const thisKeyword = this.tsParseThisTypeNode();

        if (this.isContextual("is") && !this.hasPrecedingLineBreak()) {
          return this.tsParseThisTypePredicate(thisKeyword);
        } else {
          return thisKeyword;
        }

      case tt._typeof:
        return this.tsParseTypeQuery();

      case tt.braceL:
        return this.tsLookAhead(this.tsIsStartOfMappedType.bind(this)) ? this.tsParseMappedType() : this.tsParseTypeLiteral();

      case tt.bracketL:
        return this.tsParseTupleType();

      case tt.parenL:
        return this.tsParseParenthesizedType();
    }

    throw this.unexpected();
  }

  tsParseArrayTypeOrHigher(): N.TsType {
    let type = this.tsParseNonArrayType();

    while (!this.hasPrecedingLineBreak() && this.eat(tt.bracketL)) {
      if (this.match(tt.bracketR)) {
        const node: N.TsArrayType = this.startNodeAtNode(type);
        node.elementType = type;
        this.expect(tt.bracketR);
        type = this.finishNode(node, "TSArrayType");
      } else {
        const node: N.TsIndexedAccessType = this.startNodeAtNode(type);
        node.objectType = type;
        node.indexType = this.tsParseType();
        this.expect(tt.bracketR);
        type = this.finishNode(node, "TSIndexedAccessType");
      }
    }

    return type;
  }

  tsParseTypeOperator(operator: "keyof"): N.TsTypeOperator {
    const node = this.startNode();
    this.expectContextual(operator);
    node.operator = operator;
    node.typeAnnotation = this.tsParseTypeOperatorOrHigher();
    return this.finishNode(node, "TSTypeOperator");
  }

  tsParseTypeOperatorOrHigher(): N.TsType {
    if (this.isContextual("keyof")) {
      return this.tsParseTypeOperator("keyof");
    }

    return this.tsParseArrayTypeOrHigher();
  }

  tsParseUnionOrIntersectionType(kind: "TSUnionType" | "TSIntersectionType", parseConstituentType: () => N.TsType, operator: TokenType): N.TsType {
    this.eat(operator);
    let type = parseConstituentType();

    if (this.match(operator)) {
      const types = [type];

      while (this.eat(operator)) {
        types.push(parseConstituentType());
      }

      const node: N.TsUnionType | N.TsIntersectionType = this.startNodeAtNode(type);
      node.types = types;
      type = this.finishNode(node, kind);
    }

    return type;
  }

  tsParseIntersectionTypeOrHigher(): N.TsType {
    return this.tsParseUnionOrIntersectionType("TSIntersectionType", this.tsParseTypeOperatorOrHigher.bind(this), tt.bitwiseAND);
  }

  tsParseUnionTypeOrHigher() {
    return this.tsParseUnionOrIntersectionType("TSUnionType", this.tsParseIntersectionTypeOrHigher.bind(this), tt.bitwiseOR);
  }

  tsIsStartOfFunctionType() {
    if (this.isRelational("<")) {
      return true;
    }

    return this.match(tt.parenL) && this.tsLookAhead(this.tsIsUnambiguouslyStartOfFunctionType.bind(this));
  }

  tsSkipParameterStart(): boolean {
    if (this.match(tt.name) || this.match(tt._this)) {
      this.next();
      return true;
    }

    return false;
  }

  tsIsUnambiguouslyStartOfFunctionType(): boolean {
    this.next();

    if (this.match(tt.parenR) || this.match(tt.ellipsis)) {
      // ( )
      // ( ...
      return true;
    }

    if (this.tsSkipParameterStart()) {
      if (this.match(tt.colon) || this.match(tt.comma) || this.match(tt.question) || this.match(tt.eq)) {
        // ( xxx :
        // ( xxx ,
        // ( xxx ?
        // ( xxx =
        return true;
      }

      if (this.match(tt.parenR)) {
        this.next();

        if (this.match(tt.arrow)) {
          // ( xxx ) =>
          return true;
        }
      }
    }

    return false;
  }

  tsParseTypeOrTypePredicateAnnotation(returnToken: TokenType): N.TypeAnnotation {
    const t: N.TypeAnnotation = this.startNode();
    this.expect(returnToken);
    const typePredicateVariable = this.tsIsIdentifier() && this.tsTryParse(this.tsParseTypePredicatePrefix.bind(this));

    if (!typePredicateVariable) {
      return this.tsParseTypeAnnotation(
      /* eatColon */
      false, t);
    }

    const type = this.tsParseTypeAnnotation(
    /* eatColon */
    false);
    const node: N.TsTypePredicate = this.startNodeAtNode(typePredicateVariable);
    node.parameterName = typePredicateVariable;
    node.typeAnnotation = type;
    t.typeAnnotation = this.finishNode(node, "TSTypePredicate");
    return this.finishNode(t, "TypeAnnotation");
  }

  tsTryParseTypeOrTypePredicateAnnotation(): ?N.TypeAnnotation {
    return this.match(tt.colon) ? this.tsParseTypeOrTypePredicateAnnotation(tt.colon) : undefined;
  }

  tsTryParseTypeAnnotation(): ?N.TypeAnnotation {
    return this.match(tt.colon) ? this.tsParseTypeAnnotation() : undefined;
  }

  tsTryParseType(): ?N.TsType {
    return this.eat(tt.colon) ? this.tsParseType() : undefined;
  }

  tsParseTypePredicatePrefix(): ?N.Identifier {
    const id = this.parseIdentifier();

    if (this.isContextual("is") && !this.hasPrecedingLineBreak()) {
      this.next();
      return id;
    }
  }

  tsParseTypeAnnotation(eatColon = true, t: N.TypeAnnotation = this.startNode()): N.TypeAnnotation {
    if (eatColon) this.expect(tt.colon);
    t.typeAnnotation = this.tsParseType();
    return this.finishNode(t, "TypeAnnotation");
  }

  tsParseType(): N.TsType {
    // Need to set `state.inType` so that we don't parse JSX in a type context.
    const oldInType = this.state.inType;
    this.state.inType = true;

    try {
      if (this.tsIsStartOfFunctionType()) {
        return this.tsParseFunctionOrConstructorType("TSFunctionType");
      }

      if (this.match(tt._new)) {
        // As in `new () => Date`
        return this.tsParseFunctionOrConstructorType("TSConstructorType");
      }

      return this.tsParseUnionTypeOrHigher();
    } finally {
      this.state.inType = oldInType;
    }
  }

  tsParseTypeAssertion(): N.TsTypeAssertion {
    const node: N.TsTypeAssertion = this.startNode();
    node.typeAnnotation = this.tsParseType();
    this.expectRelational(">");
    node.expression = this.parseMaybeUnary();
    return this.finishNode(node, "TSTypeAssertion");
  }

  tsTryParseTypeArgumentsInExpression(): ?N.TypeParameterInstantiation {
    return this.tsTryParseAndCatch(() => {
      const res: N.TypeParameterInstantiation = this.startNode();
      this.expectRelational("<");
      const typeArguments = this.tsParseDelimitedList("TypeParametersOrArguments", this.tsParseType.bind(this));
      this.expectRelational(">");
      res.params = typeArguments;
      this.finishNode(res, "TypeParameterInstantiation");
      this.expect(tt.parenL);
      return res;
    });
  }

  tsParseHeritageClause(): $ReadOnlyArray<N.TsExpressionWithTypeArguments> {
    return this.tsParseDelimitedList("HeritageClauseElement", this.tsParseExpressionWithTypeArguments.bind(this));
  }

  tsParseExpressionWithTypeArguments(): N.TsExpressionWithTypeArguments {
    const node: N.TsExpressionWithTypeArguments = this.startNode(); // Note: TS uses parseLeftHandSideExpressionOrHigher,
    // then has grammar errors later if it's not an EntityName.

    node.expression = this.tsParseEntityName(
    /* allowReservedWords */
    false);

    if (this.isRelational("<")) {
      node.typeParameters = this.tsParseTypeArguments();
    }

    return this.finishNode(node, "TSExpressionWithTypeArguments");
  }

  tsParseInterfaceDeclaration(node: N.TsInterfaceDeclaration): N.TsInterfaceDeclaration {
    node.id = this.parseIdentifier();
    node.typeParameters = this.tsTryParseTypeParameters();

    if (this.eat(tt._extends)) {
      node.extends = this.tsParseHeritageClause();
    }

    const body: N.TSInterfaceBody = this.startNode();
    body.body = this.tsParseObjectTypeMembers();
    node.body = this.finishNode(body, "TSInterfaceBody");
    return this.finishNode(node, "TSInterfaceDeclaration");
  }

  tsParseTypeAliasDeclaration(node: N.TsTypeAliasDeclaration): N.TsTypeAliasDeclaration {
    node.id = this.parseIdentifier();
    node.typeParameters = this.tsTryParseTypeParameters();
    this.expect(tt.eq);
    node.typeAnnotation = this.tsParseType();
    this.semicolon();
    return this.finishNode(node, "TSTypeAliasDeclaration");
  }

  tsParseEnumMember(): N.TsEnumMember {
    const node: N.TsEnumMember = this.startNode(); // Computed property names are grammar errors in an enum, so accept just string literal or identifier.

    node.id = this.match(tt.string) ? this.parseLiteral(this.state.value, "StringLiteral") : this.parseIdentifier(
    /* liberal */
    true);

    if (this.eat(tt.eq)) {
      node.initializer = this.parseMaybeAssign();
    }

    return this.finishNode(node, "TSEnumMember");
  }

  tsParseEnumDeclaration(node: N.TsEnumDeclaration, isConst: boolean): N.TsEnumDeclaration {
    if (isConst) node.const = true;
    node.id = this.parseIdentifier();
    this.expect(tt.braceL);
    node.members = this.tsParseDelimitedList("EnumMembers", this.tsParseEnumMember.bind(this));
    this.expect(tt.braceR);
    return this.finishNode(node, "TSEnumDeclaration");
  }

  tsParseModuleBlock(): N.TsModuleBlock {
    const node: N.TsModuleBlock = this.startNode();
    this.expect(tt.braceL); // Inside of a module block is considered "top-level", meaning it can have imports and exports.

    this.parseBlockOrModuleBlockBody(node.body = [],
    /* directives */
    undefined,
    /* topLevel */
    true,
    /* end */
    tt.braceR);
    return this.finishNode(node, "TSModuleBlock");
  }

  tsParseModuleOrNamespaceDeclaration(node: N.TsModuleDeclaration): N.TsModuleDeclaration {
    node.id = this.parseIdentifier();

    if (this.eat(tt.dot)) {
      const inner = this.startNode();
      this.tsParseModuleOrNamespaceDeclaration(inner);
      node.body = inner;
    } else {
      node.body = this.tsParseModuleBlock();
    }

    return this.finishNode(node, "TSModuleDeclaration");
  }

  tsParseAmbientExternalModuleDeclaration(node: N.TsModuleDeclaration): N.TsModuleDeclaration {
    if (this.isContextual("global")) {
      node.global = true;
      node.id = this.parseIdentifier();
    } else if (this.match(tt.string)) {
      node.id = this.parseLiteral(this.state.value, "StringLiteral");
    } else {
      this.unexpected();
    }

    if (this.match(tt.braceL)) {
      node.body = this.tsParseModuleBlock();
    } else {
      this.semicolon();
    }

    return this.finishNode(node, "TSModuleDeclaration");
  }

  tsParseImportEqualsDeclaration(node: N.TsImportEqualsDeclaration, isExport?: boolean): N.TsImportEqualsDeclaration {
    node.isExport = isExport || false;
    node.id = this.parseIdentifier();
    this.expect(tt.eq);
    node.moduleReference = this.tsParseModuleReference();
    this.semicolon();
    return this.finishNode(node, "TSImportEqualsDeclaration");
  }

  tsIsExternalModuleReference(): boolean {
    return this.isContextual("require") && this.lookahead().type === tt.parenL;
  }

  tsParseModuleReference(): N.TsModuleReference {
    return this.tsIsExternalModuleReference() ? this.tsParseExternalModuleReference() : this.tsParseEntityName(
    /* allowReservedWords */
    false);
  }

  tsParseExternalModuleReference(): N.TsExternalModuleReference {
    const node: N.TsExternalModuleReference = this.startNode();
    this.expectContextual("require");
    this.expect(tt.parenL);

    if (!this.match(tt.string)) {
      throw this.unexpected();
    }

    node.expression = this.parseLiteral(this.state.value, "StringLiteral");
    this.expect(tt.parenR);
    return this.finishNode(node, "TSExternalModuleReference");
  } // Utilities


  tsLookAhead<T>(f: () => T): T {
    const state = this.state.clone();
    const res = f();
    this.state = state;
    return res;
  }

  tsTryParseAndCatch<T>(f: () => T): ?T {
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

  tsTryParse<T>(f: () => ?T): ?T {
    const state = this.state.clone();
    const result = f();

    if (result !== undefined && result !== false) {
      return result;
    } else {
      this.state = state;
      return undefined;
    }
  }

  nodeWithSamePosition<T: N.Node>(original: N.Node, type: string): T {
    const node = this.startNodeAtNode(original);
    node.type = type;
    node.end = original.end;
    node.loc.end = original.loc.end;
    if (original.leadingComments) node.leadingComments = original.leadingComments;
    if (original.trailingComments) node.trailingComments = original.trailingComments;
    if (original.innerComments) node.innerComments = original.innerComments;
    return node;
  }

  tsTryParseDeclare(nany: any): ?N.Declaration {
    switch (this.state.type) {
      case tt._function:
        this.next();
        return this.parseFunction(nany,
        /* isStatement */
        true);

      case tt._class:
        return this.parseClass(nany,
        /* isStatement */
        true,
        /* optionalId */
        false);

      case tt._const:
        if (this.match(tt._const) && this.lookaheadIsContextual("enum")) {
          // `const enum = 0;` not allowed because "enum" is a strict mode reserved word.
          this.expect(tt._const);
          this.expectContextual("enum");
          return this.tsParseEnumDeclaration(nany,
          /* isConst */
          true);
        }

      // falls through

      case tt._var:
      case tt._let:
        return this.parseVarStatement(nany, this.state.type);

      case tt.name:
        const value = this.state.value;

        if (value === "global") {
          return this.tsParseAmbientExternalModuleDeclaration(nany);
        } else {
          return this.tsParseDeclaration(nany, value,
          /* next */
          true);
        }

    }
  }

  lookaheadIsContextual(name: string): boolean {
    const l = this.lookahead();
    return l.type === tt.name && l.value === name;
  } // Note: this won't be called unless the keyword is allowed in `shouldParseExportDeclaration`.


  tsTryParseExportDeclaration(): ?N.Declaration {
    return this.tsParseDeclaration(this.startNode(), this.state.value,
    /* next */
    true);
  }

  tsParseExpressionStatement(node: any, expr: N.Identifier): ?N.Declaration {
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
        if (this.match(tt.braceL)) {
          const mod: N.TsModuleDeclaration = node;
          mod.global = true;
          mod.id = expr;
          mod.body = this.tsParseModuleBlock();
          return this.finishNode(mod, "TSModuleDeclaration");
        }

        break;

      default:
        return this.tsParseDeclaration(node, expr.name,
        /* next */
        false);
    }
  } // Common to tsTryParseDeclare, tsTryParseExportDeclaration, and tsParseExpressionStatement.


  tsParseDeclaration(node: any, value: string, next: boolean): ?N.Declaration {
    switch (value) {
      case "abstract":
        if (next || this.match(tt._class)) {
          const cls: N.ClassDeclaration = node;
          cls.abstract = true;
          if (next) this.next();
          return this.parseClass(cls,
          /* isStatement */
          true,
          /* optionalId */
          false);
        }

        break;

      case "enum":
        if (next || this.match(tt.name)) {
          if (next) this.next();
          return this.tsParseEnumDeclaration(node,
          /* isConst */
          false);
        }

        break;

      case "interface":
        if (next || this.match(tt.name)) {
          if (next) this.next();
          return this.tsParseInterfaceDeclaration(node);
        }

        break;

      case "module":
        if (next) this.next();

        if (this.match(tt.string)) {
          return this.tsParseAmbientExternalModuleDeclaration(node);
        } else if (next || this.match(tt.name)) {
          return this.tsParseModuleOrNamespaceDeclaration(node);
        }

        break;

      case "namespace":
        if (next || this.match(tt.name)) {
          if (next) this.next();
          return this.tsParseModuleOrNamespaceDeclaration(node);
        }

        break;

      case "type":
        if (next || this.match(tt.name)) {
          if (next) this.next();
          return this.tsParseTypeAliasDeclaration(node);
        }

        break;
    }
  }

  tsTryParseGenericAsyncArrowFunction(startPos: number, startLoc: Position): ?N.ArrowFunctionExpression {
    const res: ?N.ArrowFunctionExpression = this.tsTryParseAndCatch(() => {
      const node: N.ArrowFunctionExpression = this.startNodeAt(startPos, startLoc);
      this.expectRelational("<");
      node.typeParameters = this.tsParseTypeParameters(); // Don't use overloaded parseFunctionParams which would look for "<" again.

      super.parseFunctionParams(node);
      node.returnType = this.tsTryParseTypeOrTypePredicateAnnotation();
      this.expect(tt.arrow);
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

  tsParseTypeArguments(): N.TypeParameterInstantiation {
    const node = this.startNode();
    this.expectRelational("<");
    node.params = this.tsParseDelimitedList("TypeParametersOrArguments", this.tsParseType.bind(this));
    this.expectRelational(">");
    return this.finishNode(node, "TypeParameterInstantiation");
  } // ======================================================
  // OVERRIDES
  // ======================================================


  parseAssignableListItem(allowModifiers: ?boolean, decorators: N.Decorator[]): N.Pattern | N.TSParameterProperty {
    let accessibility: ?N.Accessibility;
    let readonly = false;

    if (allowModifiers) {
      accessibility = this.parseAccessModifier();
      readonly = !!this.tsParseModifier(["readonly"]);
    }

    const left = this.parseMaybeDefault();
    this.parseAssignableListItemTypes(left);
    const elt = this.parseMaybeDefault(left.start, left.loc.start, left);

    if (accessibility || readonly) {
      const pp: N.TSParameterProperty = this.startNodeAtNode(elt);

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

  parseFunctionBodyAndFinish(node: N.BodilessFunctionOrMethodBase, type: string, allowExpressionBody?: boolean): void {
    // For arrow functions, `parseArrow` handles the return type itself.
    if (!allowExpressionBody && this.match(tt.colon)) {
      node.returnType = this.tsParseTypeOrTypePredicateAnnotation(tt.colon);
    }

    const bodilessType = type === "FunctionDeclaration" ? "TSDeclareFunction" : type === "ClassMethod" ? "TSDeclareMethod" : undefined;

    if (bodilessType && !this.match(tt.braceL) && this.isLineTerminator()) {
      this.finishNode(node, bodilessType);
      return;
    }

    super.parseFunctionBodyAndFinish(node, type, allowExpressionBody);
  }

  parseSubscript(base: N.Expression, startPos: number, startLoc: Position, noCalls: ?boolean, state: {
    stop: boolean
  }): N.Expression {
    if (this.eat(tt.bang)) {
      const nonNullExpression: N.TsNonNullExpression = this.startNodeAt(startPos, startLoc);
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

      const node: N.CallExpression = this.startNodeAt(startPos, startLoc);
      node.callee = base; // May be passing type arguments. But may just be the `<` operator.

      const typeArguments = this.tsTryParseTypeArgumentsInExpression(); // Also eats the "("

      if (typeArguments) {
        // possibleAsync always false here, because we would have handled it above.
        // $FlowIgnore (won't be any undefined arguments)
        node.arguments = this.parseCallExpressionArguments(tt.parenR,
        /* possibleAsync */
        false);
        node.typeParameters = typeArguments;
        return this.finishCallExpression(node);
      }
    }

    return super.parseSubscript(base, startPos, startLoc, noCalls, state);
  }

  parseNewArguments(node: N.NewExpression): void {
    if (this.isRelational("<")) {
      // tsTryParseAndCatch is expensive, so avoid if not necessary.
      // 99% certain this is `new C<T>();`. But may be `new C < T;`, which is also legal.
      const typeParameters = this.tsTryParseAndCatch(() => {
        const args = this.tsParseTypeArguments();
        if (!this.match(tt.parenL)) this.unexpected();
        return args;
      });

      if (typeParameters) {
        node.typeParameters = typeParameters;
      }
    }

    super.parseNewArguments(node);
  }

  parseExprOp(left: N.Expression, leftStartPos: number, leftStartLoc: Position, minPrec: number, noIn: ?boolean) {
    if (nonNull(tt._in.binop) > minPrec && !this.hasPrecedingLineBreak() && this.eatContextual("as")) {
      const node: N.TsAsExpression = this.startNodeAt(leftStartPos, leftStartLoc);
      node.expression = left;
      node.typeAnnotation = this.tsParseType();
      this.finishNode(node, "TSAsExpression");
      return this.parseExprOp(node, leftStartPos, leftStartLoc, minPrec, noIn);
    }

    return super.parseExprOp(left, leftStartPos, leftStartLoc, minPrec, noIn);
  }

  checkReservedWord(word: string, startLoc: number, checkKeywords: boolean, // eslint-disable-next-line no-unused-vars
  isBinding: boolean): void {} // Don't bother checking for TypeScript code.
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

  parseImport(node: N.Node): N.ImportDeclaration | N.TsImportEqualsDeclaration {
    if (this.match(tt.name) && this.lookahead().type === tt.eq) {
      return this.tsParseImportEqualsDeclaration(node);
    }

    return super.parseImport(node);
  }

  parseExport(node: N.Node): N.Node {
    if (this.match(tt._import)) {
      // `export import A = B;`
      this.expect(tt._import);
      return this.tsParseImportEqualsDeclaration(node,
      /* isExport */
      true);
    } else if (this.eat(tt.eq)) {
      // `export = x;`
      const assign: N.TsExportAssignment = node;
      assign.expression = this.parseExpression();
      this.semicolon();
      return this.finishNode(assign, "TSExportAssignment");
    } else if (this.eatContextual("as")) {
      // `export as namespace A;`
      const decl: N.TsNamespaceExportDeclaration = node; // See `parseNamespaceExportDeclaration` in TypeScript's own parser

      this.expectContextual("namespace");
      decl.id = this.parseIdentifier();
      this.semicolon();
      return this.finishNode(decl, "TSNamespaceExportDeclaration");
    } else {
      return super.parseExport(node);
    }
  }

  parseStatementContent(declaration: boolean, topLevel: ?boolean): N.Statement {
    if (this.state.type === tt._const) {
      const ahead = this.lookahead();

      if (ahead.type === tt.name && ahead.value === "enum") {
        const node: N.TsEnumDeclaration = this.startNode();
        this.expect(tt._const);
        this.expectContextual("enum");
        return this.tsParseEnumDeclaration(node,
        /* isConst */
        true);
      }
    }

    return super.parseStatementContent(declaration, topLevel);
  }

  parseAccessModifier(): ?N.Accessibility {
    return this.tsParseModifier(["public", "protected", "private"]);
  }

  parseClassMember(classBody: N.ClassBody, member: any, state: {
    hadConstructor: boolean
  }): void {
    const accessibility = this.parseAccessModifier();
    if (accessibility) member.accessibility = accessibility;
    super.parseClassMember(classBody, member, state);
  }

  parseClassMemberWithIsStatic(classBody: N.ClassBody, member: any, state: {
    hadConstructor: boolean
  }, isStatic: boolean): void {
    const methodOrProp: N.ClassMethod | N.ClassProperty = member;
    const prop: N.ClassProperty = member;
    const propOrIdx: N.ClassProperty | N.TsIndexSignature = member;
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

  parsePostMemberNameModifiers(methodOrProp: N.ClassMethod | N.ClassProperty): void {
    const optional = this.eat(tt.question);
    if (optional) methodOrProp.optional = true;
  } // Note: The reason we do this in `parseExpressionStatement` and not `parseStatement`
  // is that e.g. `type()` is valid JS, so we must try parsing that first.
  // If it's really a type, we will parse `type` as the statement, and can correct it here
  // by parsing the rest.


  parseExpressionStatement(node: N.ExpressionStatement, expr: N.Expression): N.Statement {
    const decl = expr.type === "Identifier" ? this.tsParseExpressionStatement(node, expr) : undefined;
    return decl || super.parseExpressionStatement(node, expr);
  } // export type
  // Should be true for anything parsed by `tsTryParseExportDeclaration`.


  shouldParseExportDeclaration(): boolean {
    if (this.match(tt.name)) {
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
  } // An apparent conditional expression could actually be an optional parameter in an arrow function.


  parseConditional(expr: N.Expression, noIn: ?boolean, startPos: number, startLoc: Position, refNeedsArrowPos?: ?Pos): N.Expression {
    // only do the expensive clone if there is a question mark
    // and if we come from inside parens
    if (!refNeedsArrowPos || !this.match(tt.question)) {
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
  } // Note: These "type casts" are *not* valid TS expressions.
  // But we parse them here and change them when completing the arrow function.


  parseParenItem(node: N.Expression, startPos: number, startLoc: Position): N.Expression {
    node = super.parseParenItem(node, startPos, startLoc);

    if (this.eat(tt.question)) {
      node.optional = true;
    }

    if (this.match(tt.colon)) {
      const typeCastNode: N.TypeCastExpression = this.startNodeAt(startPos, startLoc);
      typeCastNode.expression = node;
      typeCastNode.typeAnnotation = this.tsParseTypeAnnotation();
      return this.finishNode(typeCastNode, "TypeCastExpression");
    }

    return node;
  }

  parseExportDeclaration(node: N.ExportNamedDeclaration): ?N.Declaration {
    // "export declare" is equivalent to just "export".
    const isDeclare = this.eatContextual("declare");
    let declaration: ?N.Declaration;

    if (this.match(tt.name)) {
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

  parseClassId(node: N.Class, isStatement: boolean, optionalId: ?boolean): void {
    if ((!isStatement || optionalId) && this.isContextual("implements")) {
      return;
    }

    super.parseClassId(...arguments);
    const typeParameters = this.tsTryParseTypeParameters();
    if (typeParameters) node.typeParameters = typeParameters;
  }

  parseClassProperty(node: N.ClassProperty): N.ClassProperty {
    const type = this.tsTryParseTypeAnnotation();
    if (type) node.typeAnnotation = type;
    return super.parseClassProperty(node);
  }

  parseClassMethod(classBody: N.ClassBody, method: N.ClassMethod, isGenerator: boolean, isAsync: boolean, isConstructor: boolean): void {
    const typeParameters = this.tsTryParseTypeParameters();
    if (typeParameters) method.typeParameters = typeParameters;
    super.parseClassMethod(classBody, method, isGenerator, isAsync, isConstructor);
  }

  parseClassSuper(node: N.Class): void {
    super.parseClassSuper(node);

    if (node.superClass && this.isRelational("<")) {
      node.superTypeParameters = this.tsParseTypeArguments();
    }

    if (this.eatContextual("implements")) {
      node.implements = this.tsParseHeritageClause();
    }
  }

  parseObjPropValue(prop: N.ObjectMember, ...args): void {
    if (this.isRelational("<")) {
      throw new Error("TODO");
    }

    super.parseObjPropValue(prop, ...args);
  }

  parseFunctionParams(node: N.Function): void {
    const typeParameters = this.tsTryParseTypeParameters();
    if (typeParameters) node.typeParameters = typeParameters;
    super.parseFunctionParams(node);
  } // `let x: number;`


  parseVarHead(decl: N.VariableDeclarator): void {
    super.parseVarHead(decl);
    const type = this.tsTryParseTypeAnnotation();

    if (type) {
      decl.id.typeAnnotation = type;
      this.finishNode(decl.id, decl.id.type); // set end position to end of type
    }
  } // parse the return type of an async arrow function - let foo = (async (): number => {});


  parseAsyncArrowFromCallExpression(node: N.ArrowFunctionExpression, call: N.CallExpression): N.ArrowFunctionExpression {
    if (this.match(tt.colon)) {
      node.returnType = this.tsParseTypeAnnotation();
    }

    return super.parseAsyncArrowFromCallExpression(node, call);
  }

  parseMaybeAssign(...args): N.Expression {
    // Note: When the JSX plugin is on, type assertions (`<T> x`) aren't valid syntax.
    let jsxError: ?SyntaxError;

    if (this.match(tt.jsxTagStart)) {
      const context = this.curContext();
      assert(context === ct.j_oTag); // Only time j_oTag is pushed is right after j_expr.

      assert(this.state.context[this.state.context.length - 2] === ct.j_expr); // Prefer to parse JSX if possible. But may be an arrow fn.

      const state = this.state.clone();

      try {
        return super.parseMaybeAssign(...args);
      } catch (err) {
        if (!(err instanceof SyntaxError)) {
          // istanbul ignore next: no such error is expected
          throw err;
        }

        this.state = state; // Pop the context added by the jsxTagStart.

        assert(this.curContext() === ct.j_oTag);
        this.state.context.pop();
        assert(this.curContext() === ct.j_expr);
        this.state.context.pop();
        jsxError = err;
      }
    }

    if (jsxError === undefined && !this.isRelational("<")) {
      return super.parseMaybeAssign(...args);
    } // Either way, we're looking at a '<': tt.jsxTagStart or relational.


    let arrowExpression;
    let typeParameters: N.TypeParameterDeclaration;
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
      } // Try parsing a type cast instead of an arrow function.
      // This will never happen outside of JSX.
      // (Because in JSX the '<' should be a jsxTagStart and not a relational.


      assert(!this.hasPlugin("jsx")); // Parsing an arrow function failed, so try a type cast.

      this.state = state; // This will start with a type assertion (via parseMaybeUnary).
      // But don't directly call `this.tsParseTypeAssertion` because we want to handle any binary after it.

      return super.parseMaybeAssign(...args);
    } // Correct TypeScript code should have at least 1 type parameter, but don't crash on bad code.


    if (typeParameters && typeParameters.params.length !== 0) {
      this.resetStartLocationFromNode(arrowExpression, typeParameters.params[0]);
    }

    arrowExpression.typeParameters = typeParameters;
    return arrowExpression;
  } // Handle type assertions


  parseMaybeUnary(refShorthandDefaultPos?: ?Pos): N.Expression {
    if (!this.hasPlugin("jsx") && this.eatRelational("<")) {
      return this.tsParseTypeAssertion();
    } else {
      return super.parseMaybeUnary(refShorthandDefaultPos);
    }
  }

  parseArrow(node: N.ArrowFunctionExpression): ?N.ArrowFunctionExpression {
    if (this.match(tt.colon)) {
      // This is different from how the TS parser does it.
      // TS uses lookahead. Babylon parses it as a parenthesized expression and converts.
      const state = this.state.clone();

      try {
        const returnType = this.tsParseTypeOrTypePredicateAnnotation(tt.colon);
        if (this.canInsertSemicolon()) this.unexpected();
        if (!this.match(tt.arrow)) this.unexpected();
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
  } // Allow type annotations inside of a parameter list.


  parseAssignableListItemTypes(param: N.Pattern) {
    if (this.eat(tt.question)) {
      if (param.type !== "Identifier") {
        throw this.raise(param.start, "A binding pattern parameter cannot be optional in an implementation signature.");
      }

      param.optional = true;
    }

    const type = this.tsTryParseTypeAnnotation();
    if (type) param.typeAnnotation = type;
    return this.finishNode(param, param.type);
  }

  toAssignable(node: N.Node, isBinding: ?boolean, contextDescription: string): N.Node {
    switch (node.type) {
      case "TypeCastExpression":
        return super.toAssignable(this.typeCastToParameter(node), isBinding, contextDescription);

      case "TSParameterProperty":
        return super.toAssignable(node, isBinding, contextDescription);

      default:
        return super.toAssignable(node, isBinding, contextDescription);
    }
  }

  checkLVal(expr: N.Expression, isBinding: ?boolean, checkClashes: ?{
    [key: string]: boolean
  }, contextDescription: string): void {
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

  parseBindingAtom(): N.Pattern {
    switch (this.state.type) {
      case tt._this:
        // "this" may be the name of a parameter, so allow it.
        return this.parseIdentifier(
        /* liberal */
        true);

      default:
        return super.parseBindingAtom();
    }
  } // === === === === === === === === === === === === === === === ===
  // Note: All below methods are duplicates of something in flow.js.
  // Not sure what the best way to combine these is.
  // === === === === === === === === === === === === === === === ===


  isClassMethod(): boolean {
    return this.isRelational("<") || super.isClassMethod();
  }

  isClassProperty(): boolean {
    return this.match(tt.colon) || super.isClassProperty();
  }

  parseMaybeDefault(...args): N.Pattern {
    const node = super.parseMaybeDefault(...args);

    if (node.type === "AssignmentPattern" && node.typeAnnotation && node.right.start < node.typeAnnotation.start) {
      this.raise(node.typeAnnotation.start, "Type annotations must come before default assignments, " + "e.g. instead of `age = 25: number` use `age: number = 25`");
    }

    return node;
  } // ensure that inside types, we bypass the jsx parser plugin


  readToken(code: number): void {
    if (this.state.inType && (code === 62 || code === 60)) {
      return this.finishOp(tt.relational, 1);
    } else {
      return super.readToken(code);
    }
  }

  toAssignableList(exprList: N.Expression[], isBinding: ?boolean, contextDescription: string): $ReadOnlyArray<N.Pattern> {
    for (let i = 0; i < exprList.length; i++) {
      const expr = exprList[i];

      if (expr && expr.type === "TypeCastExpression") {
        exprList[i] = this.typeCastToParameter(expr);
      }
    }

    return super.toAssignableList(exprList, isBinding, contextDescription);
  }

  typeCastToParameter(node: N.TypeCastExpression): N.Node {
    node.expression.typeAnnotation = node.typeAnnotation;
    return this.finishNodeAt(node.expression, node.expression.type, node.typeAnnotation.end, node.typeAnnotation.loc.end);
  }

  toReferencedList(exprList: $ReadOnlyArray<?N.Expression>): $ReadOnlyArray<?N.Expression> {
    for (let i = 0; i < exprList.length; i++) {
      const expr = exprList[i];

      if (expr && expr._exprListItem && expr.type === "TypeCastExpression") {
        this.raise(expr.start, "Did not expect a type annotation here.");
      }
    }

    return exprList;
  }

  shouldParseArrow() {
    return this.match(tt.colon) || super.shouldParseArrow();
  }

  shouldParseAsyncArrow(): boolean {
    return this.match(tt.colon) || super.shouldParseAsyncArrow();
  }

});
// @flow
// The algorithm used to determine whether a regexp can appear at a
// given point in the program is loosely based on sweet.js' approach.
// See https://github.com/mozilla/sweet.js/wiki/design
import { types as tt } from "./types";
import { lineBreak } from "../util/whitespace";
export class TokContext {
  constructor(token: string, isExpr?: boolean, preserveSpace?: boolean, override?: Function) // Takes a Tokenizer as a this-parameter, and returns void.
  {
    this.token = token;
    this.isExpr = !!isExpr;
    this.preserveSpace = !!preserveSpace;
    this.override = override;
  }

  token: string;
  isExpr: boolean;
  preserveSpace: boolean;
  override: ?Function;
}
export const types: {
  [key: string]: TokContext
} = {
  braceStatement: new TokContext("{", false),
  braceExpression: new TokContext("{", true),
  templateQuasi: new TokContext("${", true),
  parenStatement: new TokContext("(", false),
  parenExpression: new TokContext("(", true),
  template: new TokContext("`", true, true, p => p.readTmplToken()),
  functionExpression: new TokContext("function", true)
}; // Token-specific context update code

tt.parenR.updateContext = tt.braceR.updateContext = function () {
  if (this.state.context.length === 1) {
    this.state.exprAllowed = true;
    return;
  }

  const out = this.state.context.pop();

  if (out === types.braceStatement && this.curContext() === types.functionExpression) {
    this.state.context.pop();
    this.state.exprAllowed = false;
  } else if (out === types.templateQuasi) {
    this.state.exprAllowed = true;
  } else {
    this.state.exprAllowed = !out.isExpr;
  }
};

tt.name.updateContext = function (prevType) {
  this.state.exprAllowed = false;

  if (prevType === tt._let || prevType === tt._const || prevType === tt._var) {
    if (lineBreak.test(this.input.slice(this.state.end))) {
      this.state.exprAllowed = true;
    }
  }
};

tt.braceL.updateContext = function (prevType) {
  this.state.context.push(this.braceIsBlock(prevType) ? types.braceStatement : types.braceExpression);
  this.state.exprAllowed = true;
};

tt.dollarBraceL.updateContext = function () {
  this.state.context.push(types.templateQuasi);
  this.state.exprAllowed = true;
};

tt.parenL.updateContext = function (prevType) {
  const statementParens = prevType === tt._if || prevType === tt._for || prevType === tt._with || prevType === tt._while;
  this.state.context.push(statementParens ? types.parenStatement : types.parenExpression);
  this.state.exprAllowed = true;
};

tt.incDec.updateContext = function () {// tokExprAllowed stays unchanged
};

tt._function.updateContext = function () {
  if (this.curContext() !== types.braceStatement) {
    this.state.context.push(types.functionExpression);
  }

  this.state.exprAllowed = false;
};

tt.backQuote.updateContext = function () {
  if (this.curContext() === types.template) {
    this.state.context.pop();
  } else {
    this.state.context.push(types.template);
  }

  this.state.exprAllowed = false;
};
/* eslint max-len: 0 */
// @flow
import type { Options } from "../options";
import type { Position, SourceLocation } from "../util/location";
import { isIdentifierStart, isIdentifierChar, isKeyword } from "../util/identifier";
import { types as tt, keywords as keywordTypes, type TokenType } from "./types";
import { type TokContext, types as ct } from "./context";
import LocationParser from "../parser/location";
import { lineBreak, lineBreakG, isNewLine, nonASCIIwhitespace } from "../util/whitespace";
import State from "./state"; // The following character codes are forbidden from being
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
}; // Object type used to represent tokens. Note that normally, tokens
// simply exist as properties on the parser object. This is only
// used for the onToken callback and the external tokenizer.

export class Token {
  constructor(state: State) {
    this.type = state.type;
    this.value = state.value;
    this.start = state.start;
    this.end = state.end;
    this.loc = {
      start: state.startLoc,
      end: state.endLoc
    };
  }

  type: TokenType;
  value: any;
  start: number;
  end: number;
  loc: SourceLocation;
} // ## Tokenizer

function codePointToString(code: number): string {
  // UTF-16 Decoding
  if (code <= 0xffff) {
    return String.fromCharCode(code);
  } else {
    return String.fromCharCode((code - 0x10000 >> 10) + 0xd800, (code - 0x10000 & 1023) + 0xdc00);
  }
}

export default class Tokenizer extends LocationParser {
  // Forward-declarations
  // parser/util.js
  +unexpected: (pos?: ?number, messageOrType?: string | TokenType) => empty;
  isLookahead: boolean;

  constructor(options: Options, input: string) {
    super();
    this.state = new State();
    this.state.init(options, input);
    this.isLookahead = false;
  } // Move to the next token


  next(): void {
    if (this.options.tokens && !this.isLookahead) {
      this.state.tokens.push(new Token(this.state));
    }

    this.state.lastTokEnd = this.state.end;
    this.state.lastTokStart = this.state.start;
    this.state.lastTokEndLoc = this.state.endLoc;
    this.state.lastTokStartLoc = this.state.startLoc;
    this.nextToken();
  } // TODO


  eat(type: TokenType): boolean {
    if (this.match(type)) {
      this.next();
      return true;
    } else {
      return false;
    }
  } // TODO


  match(type: TokenType): boolean {
    return this.state.type === type;
  } // TODO


  isKeyword(word: string): boolean {
    return isKeyword(word);
  } // TODO


  lookahead(): State {
    const old = this.state;
    this.state = old.clone(true);
    this.isLookahead = true;
    this.next();
    this.isLookahead = false;
    const curr = this.state;
    this.state = old;
    return curr;
  } // Toggle strict mode. Re-reads the next number or string to please
  // pedantic tests (`"use strict"; 010;` should fail).


  setStrict(strict: boolean): void {
    this.state.strict = strict;
    if (!this.match(tt.num) && !this.match(tt.string)) return;
    this.state.pos = this.state.start;

    while (this.state.pos < this.state.lineStart) {
      this.state.lineStart = this.input.lastIndexOf("\n", this.state.lineStart - 2) + 1;
      --this.state.curLine;
    }

    this.nextToken();
  }

  curContext(): TokContext {
    return this.state.context[this.state.context.length - 1];
  } // Read a single token, updating the parser object's token-related
  // properties.


  nextToken(): void {
    const curContext = this.curContext();
    if (!curContext || !curContext.preserveSpace) this.skipSpace();
    this.state.containsOctal = false;
    this.state.octalPosition = null;
    this.state.start = this.state.pos;
    this.state.startLoc = this.state.curPosition();
    if (this.state.pos >= this.input.length) return this.finishToken(tt.eof);

    if (curContext.override) {
      return curContext.override(this);
    } else {
      return this.readToken(this.fullCharCodeAtPos());
    }
  }

  readToken(code: number): void {
    // Identifier or keyword. '\uXXXX' sequences are allowed in
    // identifiers, so '\' also dispatches to that.
    if (isIdentifierStart(code) || code === 92
    /* '\' */
    ) {
        return this.readWord();
      } else {
      return this.getTokenFromCode(code);
    }
  }

  fullCharCodeAtPos(): number {
    const code = this.input.charCodeAt(this.state.pos);
    if (code <= 0xd7ff || code >= 0xe000) return code;
    const next = this.input.charCodeAt(this.state.pos + 1);
    return (code << 10) + next - 0x35fdc00;
  }

  pushComment(block: boolean, text: string, start: number, end: number, startLoc: Position, endLoc: Position): void {
    const comment = {
      type: block ? "CommentBlock" : "CommentLine",
      value: text,
      start: start,
      end: end,
      loc: {
        start: startLoc,
        end: endLoc
      }
    };

    if (!this.isLookahead) {
      if (this.options.tokens) this.state.tokens.push(comment);
      this.state.comments.push(comment);
      this.addComment(comment);
    }
  }

  skipBlockComment(): void {
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

  skipLineComment(startSkip: number): void {
    const start = this.state.pos;
    const startLoc = this.state.curPosition();
    let ch = this.input.charCodeAt(this.state.pos += startSkip);

    if (this.state.pos < this.input.length) {
      while (ch !== 10 && ch !== 13 && ch !== 8232 && ch !== 8233 && ++this.state.pos < this.input.length) {
        ch = this.input.charCodeAt(this.state.pos);
      }
    }

    this.pushComment(false, this.input.slice(start + startSkip, this.state.pos), start, this.state.pos, startLoc, this.state.curPosition());
  } // Called at the start of the parse and after every token. Skips
  // whitespace and comments, and.


  skipSpace(): void {
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
  } // Called at the end of every token. Sets `end`, `val`, and
  // maintains `context` and `exprAllowed`, and skips the space after
  // the token, so that the next one's `start` will point at the
  // right position.


  finishToken(type: TokenType, val: any): void {
    this.state.end = this.state.pos;
    this.state.endLoc = this.state.curPosition();
    const prevType = this.state.type;
    this.state.type = type;
    this.state.value = val;
    this.updateContext(prevType);
  } // ### Token reading
  // This is the function that is called to fetch the next token. It
  // is somewhat obscure, because it works in character codes rather
  // than characters, and because operator parsing has been inlined
  // into it.
  //
  // All in the name of speed.
  //


  readToken_dot(): void {
    const next = this.input.charCodeAt(this.state.pos + 1);

    if (next >= 48 && next <= 57) {
      return this.readNumber(true);
    }

    const next2 = this.input.charCodeAt(this.state.pos + 2);

    if (next === 46 && next2 === 46) {
      // 46 = dot '.'
      this.state.pos += 3;
      return this.finishToken(tt.ellipsis);
    } else {
      ++this.state.pos;
      return this.finishToken(tt.dot);
    }
  }

  readToken_slash(): void {
    // '/'
    if (this.state.exprAllowed) {
      ++this.state.pos;
      return this.readRegexp();
    }

    const next = this.input.charCodeAt(this.state.pos + 1);

    if (next === 61) {
      return this.finishOp(tt.assign, 2);
    } else {
      return this.finishOp(tt.slash, 1);
    }
  }

  readToken_mult_modulo(code: number): void {
    // '%*'
    let type = code === 42 ? tt.star : tt.modulo;
    let width = 1;
    let next = this.input.charCodeAt(this.state.pos + 1); // Exponentiation operator **

    if (code === 42 && next === 42) {
      width++;
      next = this.input.charCodeAt(this.state.pos + 2);
      type = tt.exponent;
    }

    if (next === 61) {
      width++;
      type = tt.assign;
    }

    return this.finishOp(type, width);
  }

  readToken_pipe_amp(code: number): void {
    // '|&'
    const next = this.input.charCodeAt(this.state.pos + 1);
    if (next === code) return this.finishOp(code === 124 ? tt.logicalOR : tt.logicalAND, 2);
    if (next === 61) return this.finishOp(tt.assign, 2);
    if (code === 124 && next === 125 && this.hasPlugin("flow")) return this.finishOp(tt.braceBarR, 2);
    return this.finishOp(code === 124 ? tt.bitwiseOR : tt.bitwiseAND, 1);
  }

  readToken_caret(): void {
    // '^'
    const next = this.input.charCodeAt(this.state.pos + 1);

    if (next === 61) {
      return this.finishOp(tt.assign, 2);
    } else {
      return this.finishOp(tt.bitwiseXOR, 1);
    }
  }

  readToken_plus_min(code: number): void {
    // '+-'
    const next = this.input.charCodeAt(this.state.pos + 1);

    if (next === code) {
      if (next === 45 && !this.inModule && this.input.charCodeAt(this.state.pos + 2) === 62 && lineBreak.test(this.input.slice(this.state.lastTokEnd, this.state.pos))) {
        // A `-->` line comment
        this.skipLineComment(3);
        this.skipSpace();
        return this.nextToken();
      }

      return this.finishOp(tt.incDec, 2);
    }

    if (next === 61) {
      return this.finishOp(tt.assign, 2);
    } else {
      return this.finishOp(tt.plusMin, 1);
    }
  }

  readToken_lt_gt(code: number): void {
    // '<>'
    const next = this.input.charCodeAt(this.state.pos + 1);
    let size = 1;

    if (next === code) {
      size = code === 62 && this.input.charCodeAt(this.state.pos + 2) === 62 ? 3 : 2;
      if (this.input.charCodeAt(this.state.pos + size) === 61) return this.finishOp(tt.assign, size + 1);
      return this.finishOp(tt.bitShift, size);
    }

    if (next === 33 && code === 60 && !this.inModule && this.input.charCodeAt(this.state.pos + 2) === 45 && this.input.charCodeAt(this.state.pos + 3) === 45) {
      // `<!--`, an XML-style comment that should be interpreted as a line comment
      this.skipLineComment(4);
      this.skipSpace();
      return this.nextToken();
    }

    if (next === 61) {
      // <= | >=
      size = 2;
    }

    return this.finishOp(tt.relational, size);
  }

  readToken_eq_excl(code: number): void {
    // '=!'
    const next = this.input.charCodeAt(this.state.pos + 1);
    if (next === 61) return this.finishOp(tt.equality, this.input.charCodeAt(this.state.pos + 2) === 61 ? 3 : 2);

    if (code === 61 && next === 62) {
      // '=>'
      this.state.pos += 2;
      return this.finishToken(tt.arrow);
    }

    return this.finishOp(code === 61 ? tt.eq : tt.bang, 1);
  }

  readToken_question() {
    // '?'
    const next = this.input.charCodeAt(this.state.pos + 1);
    const next2 = this.input.charCodeAt(this.state.pos + 2);

    if (next === 46 && !(next2 >= 48 && next2 <= 57)) {
      // '.' not followed by a number
      this.state.pos += 2;
      return this.finishToken(tt.questionDot);
    } else {
      ++this.state.pos;
      return this.finishToken(tt.question);
    }
  }

  getTokenFromCode(code: number): void {
    switch (code) {
      case 35:
        // '#'
        if (this.hasPlugin("classPrivateProperties") && this.state.classLevel > 0) {
          ++this.state.pos;
          return this.finishToken(tt.hash);
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
        return this.finishToken(tt.parenL);

      case 41:
        ++this.state.pos;
        return this.finishToken(tt.parenR);

      case 59:
        ++this.state.pos;
        return this.finishToken(tt.semi);

      case 44:
        ++this.state.pos;
        return this.finishToken(tt.comma);

      case 91:
        ++this.state.pos;
        return this.finishToken(tt.bracketL);

      case 93:
        ++this.state.pos;
        return this.finishToken(tt.bracketR);

      case 123:
        if (this.hasPlugin("flow") && this.input.charCodeAt(this.state.pos + 1) === 124) {
          return this.finishOp(tt.braceBarL, 2);
        } else {
          ++this.state.pos;
          return this.finishToken(tt.braceL);
        }

      case 125:
        ++this.state.pos;
        return this.finishToken(tt.braceR);

      case 58:
        if (this.hasPlugin("functionBind") && this.input.charCodeAt(this.state.pos + 1) === 58) {
          return this.finishOp(tt.doubleColon, 2);
        } else {
          ++this.state.pos;
          return this.finishToken(tt.colon);
        }

      case 63:
        return this.readToken_question();

      case 64:
        ++this.state.pos;
        return this.finishToken(tt.at);

      case 96:
        // '`'
        ++this.state.pos;
        return this.finishToken(tt.backQuote);

      case 48:
        // '0'
        const next = this.input.charCodeAt(this.state.pos + 1);
        if (next === 120 || next === 88) return this.readRadixNumber(16); // '0x', '0X' - hex number

        if (next === 111 || next === 79) return this.readRadixNumber(8); // '0o', '0O' - octal number

        if (next === 98 || next === 66) return this.readRadixNumber(2);
      // '0b', '0B' - binary number
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
        return this.finishOp(tt.tilde, 1);
    }

    this.raise(this.state.pos, `Unexpected character '${codePointToString(code)}'`);
  }

  finishOp(type: TokenType, size: number): void {
    const str = this.input.slice(this.state.pos, this.state.pos + size);
    this.state.pos += size;
    return this.finishToken(type, str);
  }

  readRegexp(): void {
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
    ++this.state.pos; // Need to use `readWord1` because '\uXXXX' sequences are allowed
    // here (don't ask).

    const mods = this.readWord1();

    if (mods) {
      const validFlags = /^[gmsiyu]*$/;
      if (!validFlags.test(mods)) this.raise(start, "Invalid regular expression flag");
    }

    return this.finishToken(tt.regexp, {
      pattern: content,
      flags: mods
    });
  } // Read an integer in the given radix. Return null if zero digits
  // were read, the integer value otherwise. When `len` is given, this
  // will return `null` unless the integer has exactly `len` digits.


  readInt(radix: number, len?: number): number | null {
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
          } // Ignore this _ character


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

  readRadixNumber(radix: number): void {
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
      return this.finishToken(tt.bigint, str);
    }

    return this.finishToken(tt.num, val);
  } // Read an integer, octal integer, or floating-point number.


  readNumber(startsWithDot: boolean): void {
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

    if (isIdentifierStart(this.fullCharCodeAtPos())) this.raise(this.state.pos, "Identifier directly after number"); // remove "_" for numeric literal separator, and "n" for BigInts

    const str = this.input.slice(start, this.state.pos).replace(/[_n]/g, "");

    if (isBigInt) {
      return this.finishToken(tt.bigint, str);
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

    return this.finishToken(tt.num, val);
  } // Read a string value, interpreting backslash-escapes.


  readCodePoint(throwOnInvalid: boolean): number | null {
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

  readString(quote: number): void {
    let out = "",
        chunkStart = ++this.state.pos;

    for (;;) {
      if (this.state.pos >= this.input.length) this.raise(this.state.start, "Unterminated string constant");
      const ch = this.input.charCodeAt(this.state.pos);
      if (ch === quote) break;

      if (ch === 92) {
        // '\'
        out += this.input.slice(chunkStart, this.state.pos); // $FlowFixMe

        out += this.readEscapedChar(false);
        chunkStart = this.state.pos;
      } else {
        if (isNewLine(ch)) this.raise(this.state.start, "Unterminated string constant");
        ++this.state.pos;
      }
    }

    out += this.input.slice(chunkStart, this.state.pos++);
    return this.finishToken(tt.string, out);
  } // Reads template string tokens.


  readTmplToken(): void {
    let out = "",
        chunkStart = this.state.pos,
        containsInvalid = false;

    for (;;) {
      if (this.state.pos >= this.input.length) this.raise(this.state.start, "Unterminated template");
      const ch = this.input.charCodeAt(this.state.pos);

      if (ch === 96 || ch === 36 && this.input.charCodeAt(this.state.pos + 1) === 123) {
        // '`', '${'
        if (this.state.pos === this.state.start && this.match(tt.template)) {
          if (ch === 36) {
            this.state.pos += 2;
            return this.finishToken(tt.dollarBraceL);
          } else {
            ++this.state.pos;
            return this.finishToken(tt.backQuote);
          }
        }

        out += this.input.slice(chunkStart, this.state.pos);
        return this.finishToken(tt.template, containsInvalid ? null : out);
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
  } // Used to read escaped characters


  readEscapedChar(inTemplate: boolean): string | null {
    const throwOnInvalid = !inTemplate;
    const ch = this.input.charCodeAt(++this.state.pos);
    ++this.state.pos;

    switch (ch) {
      case 110:
        return "\n";
      // 'n' -> '\n'

      case 114:
        return "\r";
      // 'r' -> '\r'

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
        return "\t";
      // 't' -> '\t'

      case 98:
        return "\b";
      // 'b' -> '\b'

      case 118:
        return "\u000b";
      // 'v' -> '\u000b'

      case 102:
        return "\f";
      // 'f' -> '\f'

      case 13:
        if (this.input.charCodeAt(this.state.pos) === 10) ++this.state.pos;
      // '\r\n'

      case 10:
        // ' \n'
        this.state.lineStart = this.state.pos;
        ++this.state.curLine;
        return "";

      default:
        if (ch >= 48 && ch <= 55) {
          const codePos = this.state.pos - 1; // $FlowFixMe

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
  } // Used to read character escape sequences ('\x', '\u').


  readHexChar(len: number, throwOnInvalid: boolean): number | null {
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
  } // Read an identifier, and return it as a string. Sets `this.state.containsEsc`
  // to whether the word contained a '\u' escape.
  //
  // Incrementally adds only escaped chars, adding other chunks as-is
  // as a micro-optimization.


  readWord1(): string {
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
        const esc = this.readCodePoint(true); // $FlowFixMe (thinks esc may be null, but throwOnInvalid is true)

        if (!(first ? isIdentifierStart : isIdentifierChar)(esc, true)) {
          this.raise(escStart, "Invalid Unicode escape");
        } // $FlowFixMe


        word += codePointToString(esc);
        chunkStart = this.state.pos;
      } else {
        break;
      }

      first = false;
    }

    return word + this.input.slice(chunkStart, this.state.pos);
  } // Read an identifier or keyword token. Will check for reserved
  // words when necessary.


  readWord(): void {
    const word = this.readWord1();
    let type = tt.name;

    if (!this.state.containsEsc && this.isKeyword(word)) {
      type = keywordTypes[word];
    }

    return this.finishToken(type, word);
  }

  braceIsBlock(prevType: TokenType): boolean {
    if (prevType === tt.colon) {
      const parent = this.curContext();

      if (parent === ct.braceStatement || parent === ct.braceExpression) {
        return !parent.isExpr;
      }
    }

    if (prevType === tt._return) {
      return lineBreak.test(this.input.slice(this.state.lastTokEnd, this.state.start));
    }

    if (prevType === tt._else || prevType === tt.semi || prevType === tt.eof || prevType === tt.parenR) {
      return true;
    }

    if (prevType === tt.braceL) {
      return this.curContext() === ct.braceStatement;
    }

    if (prevType === tt.relational) {
      // `class C<T> { ... }`
      return true;
    }

    return !this.state.exprAllowed;
  }

  updateContext(prevType: TokenType): void {
    const type = this.state.type;
    let update;

    if (type.keyword && (prevType === tt.dot || prevType === tt.questionDot)) {
      this.state.exprAllowed = false;
    } else if (update = type.updateContext) {
      update.call(this, prevType);
    } else {
      this.state.exprAllowed = type.beforeExpr;
    }
  }

}
// @flow
import type { Options } from "../options";
import * as N from "../types";
import type { Position } from "../util/location";
import { types as ct, type TokContext } from "./context";
import type { Token } from "./index";
import { types as tt, type TokenType } from "./types";
export default class State {
  init(options: Options, input: string): void {
    this.strict = options.strictMode === false ? false : options.sourceType === "module";
    this.input = input;
    this.potentialArrowAt = -1; // eslint-disable-next-line max-len

    this.inMethod = this.inFunction = this.inGenerator = this.inAsync = this.inPropertyName = this.inType = this.inClassProperty = this.noAnonFunctionType = false;
    this.classLevel = 0;
    this.labels = [];
    this.decoratorStack = [[]];
    this.tokens = [];
    this.comments = [];
    this.trailingComments = [];
    this.leadingComments = [];
    this.commentStack = []; // $FlowIgnore

    this.commentPreviousNode = null;
    this.pos = this.lineStart = 0;
    this.curLine = options.startLine;
    this.type = tt.eof;
    this.value = null;
    this.start = this.end = this.pos;
    this.startLoc = this.endLoc = this.curPosition(); // $FlowIgnore

    this.lastTokEndLoc = this.lastTokStartLoc = null;
    this.lastTokStart = this.lastTokEnd = this.pos;
    this.context = [ct.braceStatement];
    this.exprAllowed = true;
    this.containsEsc = this.containsOctal = false;
    this.octalPosition = null;
    this.invalidTemplateEscapePosition = null;
    this.exportedIdentifiers = [];
  } // TODO


  strict: boolean; // TODO

  input: string; // Used to signify the start of a potential arrow function

  potentialArrowAt: number; // Flags to track whether we are in a function, a generator.

  inFunction: boolean;
  inGenerator: boolean;
  inMethod: boolean | N.MethodKind;
  inAsync: boolean;
  inType: boolean;
  noAnonFunctionType: boolean;
  inPropertyName: boolean;
  inClassProperty: boolean; // Check whether we are in a (nested) class or not.

  classLevel: number; // Labels in scope.

  labels: Array<{
    kind: ?"loop" | "switch",
    statementStart?: number,
  }>; // Leading decorators. Last element of the stack represents the decorators in current context.
  // Supports nesting of decorators, e.g. @foo(@bar class inner {}) class outer {}
  // where @foo belongs to the outer class and @bar to the inner

  decoratorStack: Array<Array<N.Decorator>>; // Token store.

  tokens: Array<Token | N.Comment>; // Comment store.

  comments: Array<N.Comment>; // Comment attachment store

  trailingComments: Array<N.Comment>;
  leadingComments: Array<N.Comment>;
  commentStack: Array<{
    start: number,
    leadingComments: ?Array<N.Comment>,
    trailingComments: ?Array<N.Comment>,
  }>;
  commentPreviousNode: N.Node; // The current position of the tokenizer in the input.

  pos: number;
  lineStart: number;
  curLine: number; // Properties of the current token:
  // Its type

  type: TokenType; // For tokens that include more information than their type, the value

  value: any; // Its start and end offset

  start: number;
  end: number; // And, if locations are used, the {line, column} object
  // corresponding to those offsets

  startLoc: Position;
  endLoc: Position; // Position information for the previous token

  lastTokEndLoc: Position;
  lastTokStartLoc: Position;
  lastTokStart: number;
  lastTokEnd: number; // The context stack is used to superficially track syntactic
  // context to predict whether a regular expression is allowed in a
  // given position.

  context: Array<TokContext>;
  exprAllowed: boolean; // Used to signal to callers of `readWord1` whether the word
  // contained any escape sequences. This is needed because words with
  // escape sequences must not be interpreted as keywords.

  containsEsc: boolean; // TODO

  containsOctal: boolean;
  octalPosition: ?number; // Names of exports store. `default` is stored as a name for both
  // `export default foo;` and `export { foo as default };`.

  exportedIdentifiers: Array<string>;
  invalidTemplateEscapePosition: ?number;

  curPosition(): Position {
    return {
      line: this.curLine,
      column: this.pos - this.lineStart
    };
  }

  clone(skipArrays?: boolean): State {
    const state = new State();

    for (const key in this) {
      // $FlowIgnore
      let val = this[key];

      if ((!skipArrays || key === "context") && Array.isArray(val)) {
        val = val.slice();
      } // $FlowIgnore


      state[key] = val;
    }

    return state;
  }

}
// @flow
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
type TokenOptions = {
  keyword?: string,
  beforeExpr?: boolean,
  startsExpr?: boolean,
  rightAssociative?: boolean,
  isLoop?: boolean,
  isAssign?: boolean,
  prefix?: boolean,
  postfix?: boolean,
  binop?: ?number,
};
export class TokenType {
  label: string;
  keyword: ?string;
  beforeExpr: boolean;
  startsExpr: boolean;
  rightAssociative: boolean;
  isLoop: boolean;
  isAssign: boolean;
  prefix: boolean;
  postfix: boolean;
  binop: ?number;
  updateContext: ?(prevType: TokenType) => void;

  constructor(label: string, conf: TokenOptions = {}) {
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
  constructor(name: string, options: TokenOptions = {}) {
    options.keyword = name;
    super(name, options);
  }

}

export class BinopTokenType extends TokenType {
  constructor(name: string, prec: number) {
    super(name, {
      beforeExpr,
      binop: prec
    });
  }

}
export const types: {
  [name: string]: TokenType
} = {
  num: new TokenType("num", {
    startsExpr
  }),
  bigint: new TokenType("bigint", {
    startsExpr
  }),
  regexp: new TokenType("regexp", {
    startsExpr
  }),
  string: new TokenType("string", {
    startsExpr
  }),
  name: new TokenType("name", {
    startsExpr
  }),
  eof: new TokenType("eof"),
  // Punctuation token types.
  bracketL: new TokenType("[", {
    beforeExpr,
    startsExpr
  }),
  bracketR: new TokenType("]"),
  braceL: new TokenType("{", {
    beforeExpr,
    startsExpr
  }),
  braceBarL: new TokenType("{|", {
    beforeExpr,
    startsExpr
  }),
  braceR: new TokenType("}"),
  braceBarR: new TokenType("|}"),
  parenL: new TokenType("(", {
    beforeExpr,
    startsExpr
  }),
  parenR: new TokenType(")"),
  comma: new TokenType(",", {
    beforeExpr
  }),
  semi: new TokenType(";", {
    beforeExpr
  }),
  colon: new TokenType(":", {
    beforeExpr
  }),
  doubleColon: new TokenType("::", {
    beforeExpr
  }),
  dot: new TokenType("."),
  question: new TokenType("?", {
    beforeExpr
  }),
  questionDot: new TokenType("?."),
  arrow: new TokenType("=>", {
    beforeExpr
  }),
  template: new TokenType("template"),
  ellipsis: new TokenType("...", {
    beforeExpr
  }),
  backQuote: new TokenType("`", {
    startsExpr
  }),
  dollarBraceL: new TokenType("${", {
    beforeExpr,
    startsExpr
  }),
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
  eq: new TokenType("=", {
    beforeExpr,
    isAssign
  }),
  assign: new TokenType("_=", {
    beforeExpr,
    isAssign
  }),
  incDec: new TokenType("++/--", {
    prefix,
    postfix,
    startsExpr
  }),
  bang: new TokenType("!", {
    beforeExpr,
    prefix,
    startsExpr
  }),
  tilde: new TokenType("~", {
    beforeExpr,
    prefix,
    startsExpr
  }),
  logicalOR: new BinopTokenType("||", 1),
  logicalAND: new BinopTokenType("&&", 2),
  bitwiseOR: new BinopTokenType("|", 3),
  bitwiseXOR: new BinopTokenType("^", 4),
  bitwiseAND: new BinopTokenType("&", 5),
  equality: new BinopTokenType("==/!=", 6),
  relational: new BinopTokenType("</>", 7),
  bitShift: new BinopTokenType("<</>>", 8),
  plusMin: new TokenType("+/-", {
    beforeExpr,
    binop: 9,
    prefix,
    startsExpr
  }),
  modulo: new BinopTokenType("%", 10),
  star: new BinopTokenType("*", 10),
  slash: new BinopTokenType("/", 10),
  exponent: new TokenType("**", {
    beforeExpr,
    binop: 11,
    rightAssociative: true
  })
};
export const keywords = {
  break: new KeywordTokenType("break"),
  case: new KeywordTokenType("case", {
    beforeExpr
  }),
  catch: new KeywordTokenType("catch"),
  continue: new KeywordTokenType("continue"),
  debugger: new KeywordTokenType("debugger"),
  default: new KeywordTokenType("default", {
    beforeExpr
  }),
  do: new KeywordTokenType("do", {
    isLoop,
    beforeExpr
  }),
  else: new KeywordTokenType("else", {
    beforeExpr
  }),
  finally: new KeywordTokenType("finally"),
  for: new KeywordTokenType("for", {
    isLoop
  }),
  function: new KeywordTokenType("function", {
    startsExpr
  }),
  if: new KeywordTokenType("if"),
  return: new KeywordTokenType("return", {
    beforeExpr
  }),
  switch: new KeywordTokenType("switch"),
  throw: new KeywordTokenType("throw", {
    beforeExpr
  }),
  try: new KeywordTokenType("try"),
  var: new KeywordTokenType("var"),
  let: new KeywordTokenType("let"),
  const: new KeywordTokenType("const"),
  while: new KeywordTokenType("while", {
    isLoop
  }),
  with: new KeywordTokenType("with"),
  new: new KeywordTokenType("new", {
    beforeExpr,
    startsExpr
  }),
  this: new KeywordTokenType("this", {
    startsExpr
  }),
  super: new KeywordTokenType("super", {
    startsExpr
  }),
  class: new KeywordTokenType("class"),
  extends: new KeywordTokenType("extends", {
    beforeExpr
  }),
  export: new KeywordTokenType("export"),
  import: new KeywordTokenType("import", {
    startsExpr
  }),
  yield: new KeywordTokenType("yield", {
    beforeExpr,
    startsExpr
  }),
  null: new KeywordTokenType("null", {
    startsExpr
  }),
  true: new KeywordTokenType("true", {
    startsExpr
  }),
  false: new KeywordTokenType("false", {
    startsExpr
  }),
  in: new KeywordTokenType("in", {
    beforeExpr,
    binop: 7
  }),
  instanceof: new KeywordTokenType("instanceof", {
    beforeExpr,
    binop: 7
  }),
  typeof: new KeywordTokenType("typeof", {
    beforeExpr,
    prefix,
    startsExpr
  }),
  void: new KeywordTokenType("void", {
    beforeExpr,
    prefix,
    startsExpr
  }),
  delete: new KeywordTokenType("delete", {
    beforeExpr,
    prefix,
    startsExpr
  })
}; // Map keyword names to token types.

Object.keys(keywords).forEach(name => {
  types["_" + name] = keywords[name];
});
// @flow
import type { Token } from "./tokenizer";
import type { SourceLocation } from "./util/location";
/*
 * If making any changes to the AST, update:
 * - This repository:
 *   - This file
 *   - `ast` directory
 * - Babel repository:
 *   - packages/babel-types/src/definitions
 *   - packages/babel-generators/src/generators
 */

export type Comment = {
  type: "CommentBlock" | "CommentLine",
  value: string,
  start: number,
  end: number,
  loc: SourceLocation,
};
export interface NodeBase {
  start: number,
  end: number,
  loc: SourceLocation,
  range: [number, number],
  leadingComments?: ?Array<Comment>,
  trailingComments?: ?Array<Comment>,
  innerComments?: ?Array<Comment>,
  extra: {
    [key: string]: any
  },
} // Using a union type for `Node` makes type-checking too slow.
// Instead, add an index signature to allow a Node to be treated as anything.

export type Node = NodeBase & {
  [key: string]: any
};
export type Expression = Node;
export type Statement = Node;
export type Pattern = Identifier | ObjectPattern | ArrayPattern | RestElement | AssignmentPattern;
export type Declaration = VariableDeclaration | ClassDeclaration | FunctionDeclaration | TsInterfaceDeclaration | TsTypeAliasDeclaration | TsEnumDeclaration | TsModuleDeclaration;
export type DeclarationBase = NodeBase & {
  // TypeScript allows declarations to be prefixed by `declare`.
  //TODO: a FunctionDeclaration is never "declare", because it's a TSDeclareFunction instead.
  declare?: true
}; // TODO: Not in spec

export type HasDecorators = NodeBase & {
  decorators?: $ReadOnlyArray<Decorator>
};
export type Identifier = PatternBase & {
  type: "Identifier",
  name: string,
  __clone: () => Identifier,
  // TypeScript only. Used in case of an optional parameter.
  optional?: ?true,
};
export type PrivateName = NodeBase & {
  type: "PrivateName",
  name: string,
}; // Literals

export type Literal = RegExpLiteral | NullLiteral | StringLiteral | BooleanLiteral | NumericLiteral;
export type RegExpLiteral = NodeBase & {
  type: "RegExpLiteral",
  pattern: string,
  flags: RegExp$flags,
};
export type NullLiteral = NodeBase & {
  type: "NullLiteral"
};
export type StringLiteral = NodeBase & {
  type: "StringLiteral",
  value: string,
};
export type BooleanLiteral = NodeBase & {
  type: "BooleanLiteral",
  value: boolean,
};
export type NumericLiteral = NodeBase & {
  type: "NumericLiteral",
  value: number,
};
export type BigIntLiteral = NodeBase & {
  type: "BigIntLiteral",
  value: number,
}; // Programs

export type BlockStatementLike = Program | BlockStatement;
export type File = NodeBase & {
  type: "File",
  program: Program,
  comments: $ReadOnlyArray<Comment>,
  tokens: $ReadOnlyArray<Token | Comment>,
};
export type Program = NodeBase & {
  type: "Program",
  sourceType: "script" | "module",
  body: Array<Statement | ModuleDeclaration>,
  // TODO: $ReadOnlyArray
  directives: $ReadOnlyArray<Directive>,
}; // Functions

export type Function = NormalFunction | ArrowFunctionExpression | ObjectMethod | ClassMethod;
export type NormalFunction = FunctionDeclaration | FunctionExpression;
export type BodilessFunctionOrMethodBase = HasDecorators & {
  // TODO: Remove this. Should not assign "id" to methods.
  // https://github.com/babel/babylon/issues/535
  id: ?Identifier,
  params: $ReadOnlyArray<Pattern | TSParameterProperty>,
  body: BlockStatement,
  generator: boolean,
  async: boolean,
  // TODO: All not in spec
  expression: boolean,
  typeParameters?: ?TypeParameterDeclaration,
  returnType?: ?TypeAnnotation,
};
export type BodilessFunctionBase = BodilessFunctionOrMethodBase & {
  id: ?Identifier
};
export type FunctionBase = BodilessFunctionBase & {
  body: BlockStatement
}; // Statements

export type ExpressionStatement = NodeBase & {
  type: "ExpressionStatement",
  expression: Expression,
};
export type BlockStatement = NodeBase & {
  type: "BlockStatement",
  body: Array<Statement>,
  // TODO: $ReadOnlyArray
  directives: $ReadOnlyArray<Directive>,
};
export type EmptyStatement = NodeBase & {
  type: "EmptyStatement"
};
export type DebuggerStatement = NodeBase & {
  type: "DebuggerStatement"
};
export type WithStatement = NodeBase & {
  type: "WithStatement",
  object: Expression,
  body: Statement,
};
export type ReturnStatement = NodeBase & {
  type: "ReturnStatement",
  argument: ?Expression,
};
export type LabeledStatement = NodeBase & {
  type: "LabeledStatement",
  label: Identifier,
  body: Statement,
};
export type BreakStatement = NodeBase & {
  type: "BreakStatement",
  label: ?Identifier,
};
export type ContinueStatement = NodeBase & {
  type: "ContinueStatement",
  label: ?Identifier,
}; // Choice

export type IfStatement = NodeBase & {
  type: "IfStatement",
  test: Expression,
  consequent: Statement,
  alternate: ?Statement,
};
export type SwitchStatement = NodeBase & {
  type: "SwitchStatement",
  discriminant: Expression,
  cases: $ReadOnlyArray<SwitchCase>,
};
export type SwitchCase = NodeBase & {
  type: "SwitchCase",
  test: ?Expression,
  consequent: $ReadOnlyArray<Statement>,
}; // Exceptions

export type ThrowStatement = NodeBase & {
  type: "ThrowStatement",
  argument: Expression,
};
export type TryStatement = NodeBase & {
  type: "TryStatement",
  block: BlockStatement,
  handler: CatchClause | null,
  finalizer: BlockStatement | null,
  guardedHandlers: $ReadOnlyArray<empty>,
};
export type CatchClause = NodeBase & {
  type: "CatchClause",
  param: Pattern,
  body: BlockStatement,
}; // Loops

export type WhileStatement = NodeBase & {
  type: "WhileStatement",
  test: Expression,
  body: Statement,
};
export type DoWhileStatement = NodeBase & {
  type: "DoWhileStatement",
  body: Statement,
  test: Expression,
};
export type ForLike = ForStatement | ForInOf;
export type ForStatement = NodeBase & {
  type: "ForStatement",
  init: ?VariableDeclaration | Expression,
  test: ?Expression,
  update: ?Expression,
  body: Statement,
};
export type ForInOf = ForInStatement | ForOfStatement;
export type ForInOfBase = NodeBase & {
  type: "ForInStatement",
  left: VariableDeclaration | Expression,
  right: Expression,
  body: Statement,
};
export type ForInStatement = ForInOfBase & {
  type: "ForInStatement",
  // TODO: Shouldn't be here, but have to declare it because it's assigned to a ForInOf unconditionally.
  await: boolean,
};
export type ForOfStatement = ForInOfBase & {
  type: "ForOfStatement",
  await: boolean,
}; // Declarations

export type OptFunctionDeclaration = FunctionBase & DeclarationBase & {
  type: "FunctionDeclaration"
};
export type FunctionDeclaration = OptFunctionDeclaration & {
  id: Identifier
};
export type VariableDeclaration = DeclarationBase & HasDecorators & {
  type: "VariableDeclaration",
  declarations: $ReadOnlyArray<VariableDeclarator>,
  kind: "var" | "let" | "const",
};
export type VariableDeclarator = NodeBase & {
  type: "VariableDeclarator",
  id: Pattern,
  init: ?Expression,
}; // Misc

export type Decorator = NodeBase & {
  type: "Decorator",
  expression: Expression,
};
export type Directive = NodeBase & {
  type: "Directive",
  value: DirectiveLiteral,
};
export type DirectiveLiteral = StringLiteral & {
  type: "DirectiveLiteral"
}; // Expressions

export type Super = NodeBase & {
  type: "Super"
};
export type Import = NodeBase & {
  type: "Import"
};
export type ThisExpression = NodeBase & {
  type: "ThisExpression"
};
export type ArrowFunctionExpression = FunctionBase & {
  type: "ArrowFunctionExpression",
  body: BlockStatement | Expression,
};
export type YieldExpression = NodeBase & {
  type: "YieldExpression",
  argument: ?Expression,
  delegate: boolean,
};
export type AwaitExpression = NodeBase & {
  type: "AwaitExpression",
  argument: ?Expression,
};
export type ArrayExpression = NodeBase & {
  type: "ArrayExpression",
  elements: $ReadOnlyArray<?Expression | SpreadElement>,
};
export type ObjectExpression = NodeBase & {
  type: "ObjectExpression",
  properties: $ReadOnlyArray<ObjectProperty | ObjectMethod | SpreadElement>,
};
export type ObjectOrClassMember = ClassMethod | ClassProperty | ObjectMember;
export type ObjectMember = ObjectProperty | ObjectMethod;
export type ObjectMemberBase = NodeBase & {
  key: Expression,
  computed: boolean,
  value: Expression,
  decorators: $ReadOnlyArray<Decorator>,
  kind?: "get" | "set" | "method",
  method: boolean,
  // TODO: Not in spec
  variance?: ?FlowVariance,
};
export type ObjectProperty = ObjectMemberBase & {
  type: "ObjectProperty",
  shorthand: boolean,
};
export type ObjectMethod = ObjectMemberBase & MethodBase & {
  type: "ObjectMethod",
  kind: "get" | "set" | "method",
};
export type FunctionExpression = MethodBase & {
  kind?: void,
  // never set
  type: "FunctionExpression",
}; // Unary operations

export type UnaryExpression = NodeBase & {
  type: "UnaryExpression",
  operator: UnaryOperator,
  prefix: boolean,
  argument: Expression,
};
export type UnaryOperator = "-" | "+" | "!" | "~" | "typeof" | "void" | "delete";
export type UpdateExpression = NodeBase & {
  type: "UpdateExpression",
  operator: UpdateOperator,
  argument: Expression,
  prefix: boolean,
};
export type UpdateOperator = "++" | "--"; // Binary operations

export type BinaryExpression = NodeBase & {
  type: "BinaryExpression",
  operator: BinaryOperator,
  left: Expression,
  right: Expression,
};
export type BinaryOperator = "==" | "!=" | "===" | "!==" | "<" | "<=" | ">" | ">=" | "<<" | ">>" | ">>>" | "+" | "-" | "*" | "/" | "%" | "|" | "^" | "&" | "in" | "instanceof";
export type AssignmentExpression = NodeBase & {
  type: "AssignmentExpression",
  operator: AssignmentOperator,
  left: Pattern | Expression,
  right: Expression,
};
export type AssignmentOperator = "=" | "+=" | "-=" | "*=" | "/=" | "%=" | "<<=" | ">>=" | ">>>=" | "|=" | "^=" | "&=";
export type LogicalExpression = NodeBase & {
  type: "LogicalExpression",
  operator: LogicalOperator,
  left: Expression,
  right: Expression,
};
export type LogicalOperator = "||" | "&&";
export type SpreadElement = NodeBase & {
  type: "SpreadElement",
  argument: Expression,
};
export type MemberExpression = NodeBase & {
  type: "MemberExpression",
  object: Expression | Super,
  property: Expression,
  computed: boolean,
};
export type BindExpression = NodeBase & {
  type: "BindExpression",
  object: $ReadOnlyArray<?Expression>,
  callee: $ReadOnlyArray<Expression>,
};
export type ConditionalExpression = NodeBase & {
  type: "ConditionalExpression",
  test: Expression,
  alternate: Expression,
  consequent: Expression,
};
export type CallOrNewBase = NodeBase & {
  callee: Expression | Super | Import,
  arguments: Array<Expression | SpreadElement>,
  // TODO: $ReadOnlyArray
  typeParameters?: ?TypeParameterInstantiation,
};
export type CallExpression = CallOrNewBase & {
  type: "CallExpression"
};
export type NewExpression = CallOrNewBase & {
  type: "NewExpression",
  optional?: boolean,
};
export type SequenceExpression = NodeBase & {
  type: "SequenceExpression",
  expressions: $ReadOnlyArray<Expression>,
}; // Template Literals

export type TemplateLiteral = NodeBase & {
  type: "TemplateLiteral",
  quasis: $ReadOnlyArray<TemplateElement>,
  expressions: $ReadOnlyArray<Expression>,
};
export type TaggedTmplateExpression = NodeBase & {
  type: "TaggedTemplateExpression",
  tag: Expression,
  quasi: TemplateLiteral,
};
export type TemplateElement = NodeBase & {
  type: "TemplateElement",
  tail: boolean,
  value: {
    cooked: string,
    raw: string,
  },
}; // Patterns
// TypeScript access modifiers

export type Accessibility = "public" | "protected" | "private";
export type PatternBase = HasDecorators & {
  // TODO: All not in spec
  // Flow/TypeScript only:
  typeAnnotation?: ?TypeAnnotation
};
export type AssignmentProperty = ObjectProperty & {
  value: Pattern
};
export type ObjectPattern = PatternBase & {
  type: "ObjectPattern",
  properties: $ReadOnlyArray<AssignmentProperty | RestElement>,
};
export type ArrayPattern = PatternBase & {
  type: "ArrayPattern",
  elements: $ReadOnlyArray<?Pattern>,
};
export type RestElement = PatternBase & {
  type: "RestElement",
  argument: Pattern,
};
export type AssignmentPattern = PatternBase & {
  type: "AssignmentPattern",
  left: Pattern,
  right: Expression,
}; // Classes

export type Class = ClassDeclaration | ClassExpression;
export type ClassBase = HasDecorators & {
  id: ?Identifier,
  superClass: ?Expression,
  body: ClassBody,
  decorators: $ReadOnlyArray<Decorator>,
  // TODO: All not in spec
  typeParameters?: ?TypeParameterDeclaration,
  superTypeParameters?: ?TypeParameterInstantiation,
  implements?: ?$ReadOnlyArray<TsExpressionWithTypeArguments> | $ReadOnlyArray<FlowClassImplements>,
};
export type ClassBody = NodeBase & {
  type: "ClassBody",
  body: Array<ClassMember>,
};
export type ClassMemberBase = NodeBase & HasDecorators & {
  static: boolean,
  computed: boolean,
  // TypeScript only:
  accessibility?: ?Accessibility,
  abstract?: ?true,
  optional?: ?true,
};
export type ClassMember = ClassMethod | ClassProperty | ClassPrivateProperty | TsIndexSignature;
export type MethodLike = ObjectMethod | FunctionExpression | ClassMethod | TSDeclareMethod;
export type MethodBase = FunctionBase & {
  +kind: MethodKind
};
export type MethodKind = "constructor" | "method" | "get" | "set";
export type ClassMethodOrDeclareMethodCommon = ClassMemberBase & {
  type: "ClassMethod",
  key: Expression,
  kind: MethodKind,
  static: boolean,
  decorators: $ReadOnlyArray<Decorator>,
};
export type ClassMethod = MethodBase & ClassMethodOrDeclareMethodCommon & {
  variance?: ?FlowVariance
};
export type ClassProperty = ClassMemberBase & {
  type: "ClassProperty",
  key: Expression,
  value: ?Expression,
  // TODO: Not in spec that this is nullable.
  typeAnnotation?: ?TypeAnnotation,
  // TODO: Not in spec
  variance?: ?FlowVariance,
  // TODO: Not in spec
  // TypeScript only: (TODO: Not in spec)
  readonly?: true,
};
export type ClassPrivateProperty = NodeBase & {
  type: "ClassPrivateProperty",
  key: Identifier,
  value: ?Expression,
  // TODO: Not in spec that this is nullable.
  static: boolean,
};
export type OptClassDeclaration = ClassBase & DeclarationBase & HasDecorators & {
  type: "ClassDeclaration",
  // TypeScript only
  abstract?: ?true,
};
export type ClassDeclaration = OptClassDeclaration & {
  id: Identifier
};
export type ClassExpression = ClassBase & {
  type: "ClassExpression"
};
export type MetaProperty = NodeBase & {
  type: "MetaProperty",
  meta: Identifier,
  property: Identifier,
}; // Modules

export type ModuleDeclaration = AnyImport | AnyExport;
export type AnyImport = ImportDeclaration | TsImportEqualsDeclaration;
export type AnyExport = ExportNamedDeclaration | ExportDefaultDeclaration | ExportAllDeclaration | TsExportAssignment;
export type ModuleSpecifier = NodeBase & {
  local: Identifier
}; // Imports

export type ImportDeclaration = NodeBase & {
  type: "ImportDeclaration",
  // TODO: $ReadOnlyArray
  specifiers: Array<ImportSpecifier | ImportDefaultSpecifier | ImportNamespaceSpecifier>,
  source: Literal,
  importKind?: "type" | "typeof" | "value",
};
export type ImportSpecifier = ModuleSpecifier & {
  type: "ImportSpecifier",
  imported: Identifier,
};
export type ImportDefaultSpecifier = ModuleSpecifier & {
  type: "ImportDefaultSpecifier"
};
export type ImportNamespaceSpecifier = ModuleSpecifier & {
  type: "ImportNamespaceSpecifier"
}; // Exports

export type ExportNamedDeclaration = NodeBase & {
  type: "ExportNamedDeclaration",
  declaration: ?Declaration,
  specifiers: $ReadOnlyArray<ExportSpecifier>,
  source: ?Literal,
  exportKind?: "type" | "value",
};
export type ExportSpecifier = NodeBase & {
  type: "ExportSpecifier",
  exported: Identifier,
};
export type ExportDefaultDeclaration = NodeBase & {
  type: "ExportDefaultDeclaration",
  declaration: OptFunctionDeclaration | OptTSDeclareFunction | OptClassDeclaration | Expression,
};
export type ExportAllDeclaration = NodeBase & {
  type: "ExportAllDeclaration",
  source: Literal,
  exportKind?: "type" | "value",
}; // JSX (TODO: Not in spec)

export type JSXIdentifier = Node;
export type JSXNamespacedName = Node;
export type JSXMemberExpression = Node;
export type JSXEmptyExpression = Node;
export type JSXSpreadChild = Node;
export type JSXExpressionContainer = Node;
export type JSXAttribute = Node;
export type JSXOpeningElement = Node;
export type JSXClosingElement = Node;
export type JSXElement = Node; // Flow/TypeScript common (TODO: Not in spec)

export type TypeAnnotation = NodeBase & {
  type: "TypeAnnotation",
  typeAnnotation: TsType | FlowTypeAnnotation,
};
export type TypeParameterDeclaration = NodeBase & {
  type: "TypeParameterDeclaration",
  params: $ReadOnlyArray<TypeParameter>,
};
export type TypeParameter = NodeBase & {
  type: "TypeParameter",
  name: string,
  constraint?: TsType,
  default?: TsType,
};
export type TypeParameterInstantiation = NodeBase & {
  type: "TypeParameterInstantiation",
  params: $ReadOnlyArray<TsType> | $ReadOnlyArray<FlowType>,
}; // Flow (TODO: Not in spec)

export type TypeCastExpression = NodeBase & {
  type: "TypeCastExpression",
  expression: Expression,
  typeAnnotation: TypeAnnotation,
};
export type FlowType = Node;
export type FlowPredicate = Node;
export type FlowDeclare = Node;
export type FlowDeclareClass = Node;
export type FlowDeclareExportDeclaration = Node;
export type FlowDeclareFunction = Node;
export type FlowDeclareVariable = Node;
export type FlowDeclareModule = Node;
export type FlowDeclareModuleExports = Node;
export type FlowDeclareTypeAlias = Node;
export type FlowDeclareInterface = Node;
export type FlowInterface = Node;
export type FlowInterfaceExtends = Node;
export type FlowTypeAlias = Node;
export type FlowObjectTypeIndexer = Node;
export type FlowFunctionTypeAnnotation = Node;
export type FlowObjectTypeProperty = Node;
export type FlowObjectTypeSpreadProperty = Node;
export type FlowObjectTypeCallProperty = Node;
export type FlowObjectTypeAnnotation = Node;
export type FlowQualifiedTypeIdentifier = Node;
export type FlowGenericTypeAnnotation = Node;
export type FlowTypeofTypeAnnotation = Node;
export type FlowTupleTypeAnnotation = Node;
export type FlowFunctionTypeParam = Node;
export type FlowTypeAnnotation = Node;
export type FlowVariance = Node;
export type FlowClassImplements = Node; // estree

export type EstreeProperty = NodeBase & {
  type: "Property",
  shorthand: boolean,
  key: Expression,
  computed: boolean,
  value: Expression,
  decorators: $ReadOnlyArray<Decorator>,
  kind?: "get" | "set" | "init",
  variance?: ?FlowVariance,
}; // === === === ===
// TypeScript
// === === === ===
// Note: A type named `TsFoo` is based on TypeScript's `FooNode` type,
// defined in https://github.com/Microsoft/TypeScript/blob/master/src/compiler/types.ts
// Differences:
// * Change `NodeArray<T>` to just `$ReadOnlyArray<T>`.
// * Don't give nodes a "modifiers" list; use boolean flags instead,
//   and only allow modifiers that are not considered errors.
// * A property named `type` must be renamed to `typeAnnotation` to avoid conflict with the node's type.
// * Sometimes TypeScript allows to parse something which will be a grammar error later;
//   in babylon these cause exceptions, so the AST format is stricter.
// ================
// Misc
// ================

export type TSParameterProperty = HasDecorators & {
  // Note: This has decorators instead of its parameter.
  type: "TSParameterProperty",
  // At least one of `accessibility` or `readonly` must be set.
  accessibility?: ?Accessibility,
  readonly?: ?true,
  parameter: Identifier | AssignmentPattern,
};
export type OptTSDeclareFunction = BodilessFunctionBase & DeclarationBase & {
  type: "TSDeclareFunction"
};
export type TSDeclareFunction = OptTSDeclareFunction & {
  id: Identifier
};
export type TSDeclareMethod = BodilessFunctionOrMethodBase & ClassMethodOrDeclareMethodCommon & {
  type: "TSDeclareMethod",
  +kind: MethodKind,
};
export type TsQualifiedName = NodeBase & {
  type: "TSQualifiedName",
  left: TsEntityName,
  right: Identifier,
};
export type TsEntityName = Identifier | TsQualifiedName;
export type TsSignatureDeclaration = TsCallSignatureDeclaration | TsConstructSignatureDeclaration | TsMethodSignature | TsFunctionType | TsConstructorType;
export type TsSignatureDeclarationOrIndexSignatureBase = NodeBase & {
  // Not using TypeScript's "ParameterDeclaration" here, since it's inconsistent with regular functions.
  parameters: $ReadOnlyArray<Identifier | RestElement>,
  typeAnnotation: ?TypeAnnotation,
};
export type TsSignatureDeclarationBase = TsSignatureDeclarationOrIndexSignatureBase & {
  typeParameters: ?TypeParameterDeclaration
}; // ================
// TypeScript type members (for type literal / interface / class)
// ================

export type TsTypeElement = TsCallSignatureDeclaration | TsConstructSignatureDeclaration | TsPropertySignature | TsMethodSignature | TsIndexSignature;
export type TsCallSignatureDeclaration = TsSignatureDeclarationBase & {
  type: "TSCallSignatureDeclaration"
};
export type TsConstructSignatureDeclaration = TsSignatureDeclarationBase & {
  type: "TSConstructSignature"
};
export type TsNamedTypeElementBase = NodeBase & {
  // Not using TypeScript's `PropertyName` here since we don't have a `ComputedPropertyName` node type.
  // This is usually an Identifier but may be e.g. `Symbol.iterator` if `computed` is true.
  key: Expression,
  computed: boolean,
  optional?: true,
};
export type TsPropertySignature = TsNamedTypeElementBase & {
  type: "TSPropertySignature",
  readonly?: true,
  typeAnnotation?: TypeAnnotation,
  initializer?: Expression,
};
export type TsMethodSignature = TsSignatureDeclarationBase & TsNamedTypeElementBase & {
  type: "TSMethodSignature"
}; // *Not* a ClassMemberBase: Can't have accessibility, can't be abstract, can't be optional.

export type TsIndexSignature = TsSignatureDeclarationOrIndexSignatureBase & {
  readonly?: true,
  type: "TSIndexSignature",
}; // ================
// TypeScript types
// ================

export type TsType = TsKeywordType | TsThisType | TsFunctionOrConstructorType | TsTypeReference | TsTypeQuery | TsTypeLiteral | TsArrayType | TsTupleType | TsUnionOrIntersectionType | TsParenthesizedType | TsTypeOperator | TsIndexedAccessType | TsMappedType | TsLiteralType // TODO: This probably shouldn't be included here.
| TsTypePredicate;
export type TsTypeBase = NodeBase;
export type TsKeywordTypeType = "TSAnyKeyword" | "TSNumberKeyword" | "TSObjectKeyword" | "TSBooleanKeyword" | "TSStringKeyword" | "TSSymbolKeyword" | "TSVoidKeyword" | "TSUndefinedKeyword" | "TSNullKeyword" | "TSNeverKeyword";
export type TsKeywordType = TsTypeBase & {
  type: TsKeywordTypeType
};
export type TsThisType = TsTypeBase & {
  type: "TSThisType"
};
export type TsFunctionOrConstructorType = TsFunctionType | TsConstructorType;
export type TsFunctionType = TsTypeBase & TsSignatureDeclarationBase & {
  type: "TSFunctionType",
  typeAnnotation: TypeAnnotation,
};
export type TsConstructorType = TsTypeBase & TsSignatureDeclarationBase & {
  type: "TSConstructorType",
  typeAnnotation: TypeAnnotation,
};
export type TsTypeReference = TsTypeBase & {
  type: "TSTypeReference",
  typeName: TsEntityName,
  typeParameters?: TypeParameterInstantiation,
};
export type TsTypePredicate = TsTypeBase & {
  type: "TSTypePredicate",
  parameterName: Identifier | TsThisType,
  typeAnnotation: TypeAnnotation,
}; // `typeof` operator

export type TsTypeQuery = TsTypeBase & {
  type: "TSTypeQuery",
  exprName: TsEntityName,
};
export type TsTypeLiteral = TsTypeBase & {
  type: "TSTypeLiteral",
  members: $ReadOnlyArray<TsTypeElement>,
};
export type TsArrayType = TsTypeBase & {
  type: "TSArrayType",
  elementType: TsType,
};
export type TsTupleType = TsTypeBase & {
  type: "TSTupleType",
  elementTypes: $ReadOnlyArray<TsType>,
};
export type TsUnionOrIntersectionType = TsUnionType | TsIntersectionType;
export type TsUnionOrIntersectionTypeBase = TsTypeBase & {
  types: $ReadOnlyArray<TsType>
};
export type TsUnionType = TsUnionOrIntersectionTypeBase & {
  type: "TSUnionType"
};
export type TsIntersectionType = TsUnionOrIntersectionTypeBase & {
  type: "TSIntersectionType"
};
export type TsParenthesizedType = TsTypeBase & {
  type: "TSParenthesizedType",
  typeAnnotation: TsType,
};
export type TsTypeOperator = TsTypeBase & {
  type: "TSTypeOperator",
  operator: "keyof",
  typeAnnotation: TsType,
};
export type TsIndexedAccessType = TsTypeBase & {
  type: "TSIndexedAccessType",
  objectType: TsType,
  indexType: TsType,
};
export type TsMappedType = TsTypeBase & {
  type: "TSMappedType",
  readonly?: true,
  typeParameter: TypeParameter,
  optional?: true,
  typeAnnotation: ?TsType,
};
export type TsLiteralType = TsTypeBase & {
  type: "TSLiteralType",
  literal: NumericLiteral | StringLiteral | BooleanLiteral,
}; // ================
// TypeScript declarations
// ================

export type TsInterfaceDeclaration = DeclarationBase & {
  type: "TSInterfaceDeclaration",
  id: Identifier,
  typeParameters: ?TypeParameterDeclaration,
  // TS uses "heritageClauses", but want this to resemble ClassBase.
  extends?: $ReadOnlyArray<TsExpressionWithTypeArguments>,
  body: TSInterfaceBody,
};
export type TSInterfaceBody = NodeBase & {
  type: "TSInterfaceBody",
  body: $ReadOnlyArray<TsTypeElement>,
};
export type TsExpressionWithTypeArguments = TsTypeBase & {
  type: "TSExpressionWithTypeArguments",
  expression: TsEntityName,
  typeParameters?: TypeParameterInstantiation,
};
export type TsTypeAliasDeclaration = DeclarationBase & {
  type: "TSTypeAliasDeclaration",
  id: Identifier,
  typeParameters: ?TypeParameterDeclaration,
  typeAnnotation: TsType,
};
export type TsEnumDeclaration = DeclarationBase & {
  type: "TSEnumDeclaration",
  const?: true,
  id: Identifier,
  members: $ReadOnlyArray<TsEnumMember>,
};
export type TsEnumMember = NodeBase & {
  type: "TSEnumMemodulmber",
  id: Identifier | StringLiteral,
  initializer?: Expression,
};
export type TsModuleDeclaration = DeclarationBase & {
  type: "TSModuleDeclaration",
  global?: true,
  // In TypeScript, this is only available through `node.flags`.
  id: TsModuleName,
  body: TsNamespaceBody,
}; // `namespace A.B { }` is a namespace named `A` with another TsNamespaceDeclaration as its body.

export type TsNamespaceBody = TsModuleBlock | TsNamespaceDeclaration;
export type TsModuleBlock = NodeBase & {
  type: "TSModuleBlock",
  body: $ReadOnlyArray<Statement>,
};
export type TsNamespaceDeclaration = TsModuleDeclaration & {
  id: Identifier,
  body: TsNamespaceBody,
};
export type TsModuleName = Identifier | StringLiteral;
export type TsImportEqualsDeclaration = NodeBase & {
  type: "TSImportEqualsDeclaration",
  isExport: boolean,
  id: Identifier,
  moduleReference: TsModuleReference,
};
export type TsModuleReference = TsEntityName | TsExternalModuleReference;
export type TsExternalModuleReference = NodeBase & {
  type: "TSExternalModuleReference",
  expression: StringLiteral,
}; // TypeScript's own parser uses ExportAssignment for both `export default` and `export =`.
// But for babylon, `export default` is an ExportDefaultDeclaration,
// so a TsExportAssignment is always `export =`.

export type TsExportAssignment = NodeBase & {
  type: "TSExportAssignment",
  expression: Expression,
};
export type TsNamespaceExportDeclaration = NodeBase & {
  type: "TSNamespaceExportDeclaration",
  id: Identifier,
}; // ================
// TypeScript expressions
// ================

export type TsTypeAssertionLikeBase = NodeBase & {
  expression: Expression,
  typeAnnotation: TsType,
};
export type TsAsExpression = TsTypeAssertionLikeBase & {
  type: "TSAsExpression"
};
export type TsTypeAssertion = TsTypeAssertionLikeBase & {
  type: "TSTypeAssertion",
  typeAnnotation: TsType,
  expression: Expression,
};
export type TsNonNullExpression = NodeBase & {
  type: "TSNonNullExpression",
  expression: Expression,
};
/* eslint max-len: 0 */
// @flow
// This is a trick taken from Esprima. It turns out that, on
// non-Chrome browsers, to check whether a string is in a set, a
// predicate containing a big ugly `switch` statement is faster than
// a regular expression, and on Chrome the two are about on par.
// This function uses `eval` (non-lexical) to produce such a
// predicate from a space-separated string of words.
//
// It starts by sorting the words by length.
function makePredicate(words: string): (str: string) => boolean {
  const wordsArr = words.split(" ");
  return function (str) {
    return wordsArr.indexOf(str) >= 0;
  };
} // Reserved word lists for various dialects of the language


export const reservedWords = {
  "6": makePredicate("enum await"),
  strict: makePredicate("implements interface let package private protected public static yield"),
  strictBind: makePredicate("eval arguments")
}; // And the keywords

export const isKeyword = makePredicate("break case catch continue debugger default do else finally for function if return switch throw try var while with null true false instanceof typeof void delete new in this let const class extends export import yield super"); // ## Character categories
// Big ugly regular expressions that match characters in the
// whitespace, identifier, and identifier-start categories. These
// are only applied when a character is found to actually have a
// code point above 128.
// Generated by `bin/generate-identifier-regex.js`.

let nonASCIIidentifierStartChars = "\xaa\xb5\xba\xc0-\xd6\xd8-\xf6\xf8-\u02c1\u02c6-\u02d1\u02e0-\u02e4\u02ec\u02ee\u0370-\u0374\u0376\u0377\u037a-\u037d\u037f\u0386\u0388-\u038a\u038c\u038e-\u03a1\u03a3-\u03f5\u03f7-\u0481\u048a-\u052f\u0531-\u0556\u0559\u0561-\u0587\u05d0-\u05ea\u05f0-\u05f2\u0620-\u064a\u066e\u066f\u0671-\u06d3\u06d5\u06e5\u06e6\u06ee\u06ef\u06fa-\u06fc\u06ff\u0710\u0712-\u072f\u074d-\u07a5\u07b1\u07ca-\u07ea\u07f4\u07f5\u07fa\u0800-\u0815\u081a\u0824\u0828\u0840-\u0858\u08a0-\u08b4\u08b6-\u08bd\u0904-\u0939\u093d\u0950\u0958-\u0961\u0971-\u0980\u0985-\u098c\u098f\u0990\u0993-\u09a8\u09aa-\u09b0\u09b2\u09b6-\u09b9\u09bd\u09ce\u09dc\u09dd\u09df-\u09e1\u09f0\u09f1\u0a05-\u0a0a\u0a0f\u0a10\u0a13-\u0a28\u0a2a-\u0a30\u0a32\u0a33\u0a35\u0a36\u0a38\u0a39\u0a59-\u0a5c\u0a5e\u0a72-\u0a74\u0a85-\u0a8d\u0a8f-\u0a91\u0a93-\u0aa8\u0aaa-\u0ab0\u0ab2\u0ab3\u0ab5-\u0ab9\u0abd\u0ad0\u0ae0\u0ae1\u0af9\u0b05-\u0b0c\u0b0f\u0b10\u0b13-\u0b28\u0b2a-\u0b30\u0b32\u0b33\u0b35-\u0b39\u0b3d\u0b5c\u0b5d\u0b5f-\u0b61\u0b71\u0b83\u0b85-\u0b8a\u0b8e-\u0b90\u0b92-\u0b95\u0b99\u0b9a\u0b9c\u0b9e\u0b9f\u0ba3\u0ba4\u0ba8-\u0baa\u0bae-\u0bb9\u0bd0\u0c05-\u0c0c\u0c0e-\u0c10\u0c12-\u0c28\u0c2a-\u0c39\u0c3d\u0c58-\u0c5a\u0c60\u0c61\u0c80\u0c85-\u0c8c\u0c8e-\u0c90\u0c92-\u0ca8\u0caa-\u0cb3\u0cb5-\u0cb9\u0cbd\u0cde\u0ce0\u0ce1\u0cf1\u0cf2\u0d05-\u0d0c\u0d0e-\u0d10\u0d12-\u0d3a\u0d3d\u0d4e\u0d54-\u0d56\u0d5f-\u0d61\u0d7a-\u0d7f\u0d85-\u0d96\u0d9a-\u0db1\u0db3-\u0dbb\u0dbd\u0dc0-\u0dc6\u0e01-\u0e30\u0e32\u0e33\u0e40-\u0e46\u0e81\u0e82\u0e84\u0e87\u0e88\u0e8a\u0e8d\u0e94-\u0e97\u0e99-\u0e9f\u0ea1-\u0ea3\u0ea5\u0ea7\u0eaa\u0eab\u0ead-\u0eb0\u0eb2\u0eb3\u0ebd\u0ec0-\u0ec4\u0ec6\u0edc-\u0edf\u0f00\u0f40-\u0f47\u0f49-\u0f6c\u0f88-\u0f8c\u1000-\u102a\u103f\u1050-\u1055\u105a-\u105d\u1061\u1065\u1066\u106e-\u1070\u1075-\u1081\u108e\u10a0-\u10c5\u10c7\u10cd\u10d0-\u10fa\u10fc-\u1248\u124a-\u124d\u1250-\u1256\u1258\u125a-\u125d\u1260-\u1288\u128a-\u128d\u1290-\u12b0\u12b2-\u12b5\u12b8-\u12be\u12c0\u12c2-\u12c5\u12c8-\u12d6\u12d8-\u1310\u1312-\u1315\u1318-\u135a\u1380-\u138f\u13a0-\u13f5\u13f8-\u13fd\u1401-\u166c\u166f-\u167f\u1681-\u169a\u16a0-\u16ea\u16ee-\u16f8\u1700-\u170c\u170e-\u1711\u1720-\u1731\u1740-\u1751\u1760-\u176c\u176e-\u1770\u1780-\u17b3\u17d7\u17dc\u1820-\u1877\u1880-\u18a8\u18aa\u18b0-\u18f5\u1900-\u191e\u1950-\u196d\u1970-\u1974\u1980-\u19ab\u19b0-\u19c9\u1a00-\u1a16\u1a20-\u1a54\u1aa7\u1b05-\u1b33\u1b45-\u1b4b\u1b83-\u1ba0\u1bae\u1baf\u1bba-\u1be5\u1c00-\u1c23\u1c4d-\u1c4f\u1c5a-\u1c7d\u1c80-\u1c88\u1ce9-\u1cec\u1cee-\u1cf1\u1cf5\u1cf6\u1d00-\u1dbf\u1e00-\u1f15\u1f18-\u1f1d\u1f20-\u1f45\u1f48-\u1f4d\u1f50-\u1f57\u1f59\u1f5b\u1f5d\u1f5f-\u1f7d\u1f80-\u1fb4\u1fb6-\u1fbc\u1fbe\u1fc2-\u1fc4\u1fc6-\u1fcc\u1fd0-\u1fd3\u1fd6-\u1fdb\u1fe0-\u1fec\u1ff2-\u1ff4\u1ff6-\u1ffc\u2071\u207f\u2090-\u209c\u2102\u2107\u210a-\u2113\u2115\u2118-\u211d\u2124\u2126\u2128\u212a-\u2139\u213c-\u213f\u2145-\u2149\u214e\u2160-\u2188\u2c00-\u2c2e\u2c30-\u2c5e\u2c60-\u2ce4\u2ceb-\u2cee\u2cf2\u2cf3\u2d00-\u2d25\u2d27\u2d2d\u2d30-\u2d67\u2d6f\u2d80-\u2d96\u2da0-\u2da6\u2da8-\u2dae\u2db0-\u2db6\u2db8-\u2dbe\u2dc0-\u2dc6\u2dc8-\u2dce\u2dd0-\u2dd6\u2dd8-\u2dde\u3005-\u3007\u3021-\u3029\u3031-\u3035\u3038-\u303c\u3041-\u3096\u309b-\u309f\u30a1-\u30fa\u30fc-\u30ff\u3105-\u312d\u3131-\u318e\u31a0-\u31ba\u31f0-\u31ff\u3400-\u4db5\u4e00-\u9fd5\ua000-\ua48c\ua4d0-\ua4fd\ua500-\ua60c\ua610-\ua61f\ua62a\ua62b\ua640-\ua66e\ua67f-\ua69d\ua6a0-\ua6ef\ua717-\ua71f\ua722-\ua788\ua78b-\ua7ae\ua7b0-\ua7b7\ua7f7-\ua801\ua803-\ua805\ua807-\ua80a\ua80c-\ua822\ua840-\ua873\ua882-\ua8b3\ua8f2-\ua8f7\ua8fb\ua8fd\ua90a-\ua925\ua930-\ua946\ua960-\ua97c\ua984-\ua9b2\ua9cf\ua9e0-\ua9e4\ua9e6-\ua9ef\ua9fa-\ua9fe\uaa00-\uaa28\uaa40-\uaa42\uaa44-\uaa4b\uaa60-\uaa76\uaa7a\uaa7e-\uaaaf\uaab1\uaab5\uaab6\uaab9-\uaabd\uaac0\uaac2\uaadb-\uaadd\uaae0-\uaaea\uaaf2-\uaaf4\uab01-\uab06\uab09-\uab0e\uab11-\uab16\uab20-\uab26\uab28-\uab2e\uab30-\uab5a\uab5c-\uab65\uab70-\uabe2\uac00-\ud7a3\ud7b0-\ud7c6\ud7cb-\ud7fb\uf900-\ufa6d\ufa70-\ufad9\ufb00-\ufb06\ufb13-\ufb17\ufb1d\ufb1f-\ufb28\ufb2a-\ufb36\ufb38-\ufb3c\ufb3e\ufb40\ufb41\ufb43\ufb44\ufb46-\ufbb1\ufbd3-\ufd3d\ufd50-\ufd8f\ufd92-\ufdc7\ufdf0-\ufdfb\ufe70-\ufe74\ufe76-\ufefc\uff21-\uff3a\uff41-\uff5a\uff66-\uffbe\uffc2-\uffc7\uffca-\uffcf\uffd2-\uffd7\uffda-\uffdc";
let nonASCIIidentifierChars = "\u200c\u200d\xb7\u0300-\u036f\u0387\u0483-\u0487\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7\u0610-\u061a\u064b-\u0669\u0670\u06d6-\u06dc\u06df-\u06e4\u06e7\u06e8\u06ea-\u06ed\u06f0-\u06f9\u0711\u0730-\u074a\u07a6-\u07b0\u07c0-\u07c9\u07eb-\u07f3\u0816-\u0819\u081b-\u0823\u0825-\u0827\u0829-\u082d\u0859-\u085b\u08d4-\u08e1\u08e3-\u0903\u093a-\u093c\u093e-\u094f\u0951-\u0957\u0962\u0963\u0966-\u096f\u0981-\u0983\u09bc\u09be-\u09c4\u09c7\u09c8\u09cb-\u09cd\u09d7\u09e2\u09e3\u09e6-\u09ef\u0a01-\u0a03\u0a3c\u0a3e-\u0a42\u0a47\u0a48\u0a4b-\u0a4d\u0a51\u0a66-\u0a71\u0a75\u0a81-\u0a83\u0abc\u0abe-\u0ac5\u0ac7-\u0ac9\u0acb-\u0acd\u0ae2\u0ae3\u0ae6-\u0aef\u0b01-\u0b03\u0b3c\u0b3e-\u0b44\u0b47\u0b48\u0b4b-\u0b4d\u0b56\u0b57\u0b62\u0b63\u0b66-\u0b6f\u0b82\u0bbe-\u0bc2\u0bc6-\u0bc8\u0bca-\u0bcd\u0bd7\u0be6-\u0bef\u0c00-\u0c03\u0c3e-\u0c44\u0c46-\u0c48\u0c4a-\u0c4d\u0c55\u0c56\u0c62\u0c63\u0c66-\u0c6f\u0c81-\u0c83\u0cbc\u0cbe-\u0cc4\u0cc6-\u0cc8\u0cca-\u0ccd\u0cd5\u0cd6\u0ce2\u0ce3\u0ce6-\u0cef\u0d01-\u0d03\u0d3e-\u0d44\u0d46-\u0d48\u0d4a-\u0d4d\u0d57\u0d62\u0d63\u0d66-\u0d6f\u0d82\u0d83\u0dca\u0dcf-\u0dd4\u0dd6\u0dd8-\u0ddf\u0de6-\u0def\u0df2\u0df3\u0e31\u0e34-\u0e3a\u0e47-\u0e4e\u0e50-\u0e59\u0eb1\u0eb4-\u0eb9\u0ebb\u0ebc\u0ec8-\u0ecd\u0ed0-\u0ed9\u0f18\u0f19\u0f20-\u0f29\u0f35\u0f37\u0f39\u0f3e\u0f3f\u0f71-\u0f84\u0f86\u0f87\u0f8d-\u0f97\u0f99-\u0fbc\u0fc6\u102b-\u103e\u1040-\u1049\u1056-\u1059\u105e-\u1060\u1062-\u1064\u1067-\u106d\u1071-\u1074\u1082-\u108d\u108f-\u109d\u135d-\u135f\u1369-\u1371\u1712-\u1714\u1732-\u1734\u1752\u1753\u1772\u1773\u17b4-\u17d3\u17dd\u17e0-\u17e9\u180b-\u180d\u1810-\u1819\u18a9\u1920-\u192b\u1930-\u193b\u1946-\u194f\u19d0-\u19da\u1a17-\u1a1b\u1a55-\u1a5e\u1a60-\u1a7c\u1a7f-\u1a89\u1a90-\u1a99\u1ab0-\u1abd\u1b00-\u1b04\u1b34-\u1b44\u1b50-\u1b59\u1b6b-\u1b73\u1b80-\u1b82\u1ba1-\u1bad\u1bb0-\u1bb9\u1be6-\u1bf3\u1c24-\u1c37\u1c40-\u1c49\u1c50-\u1c59\u1cd0-\u1cd2\u1cd4-\u1ce8\u1ced\u1cf2-\u1cf4\u1cf8\u1cf9\u1dc0-\u1df5\u1dfb-\u1dff\u203f\u2040\u2054\u20d0-\u20dc\u20e1\u20e5-\u20f0\u2cef-\u2cf1\u2d7f\u2de0-\u2dff\u302a-\u302f\u3099\u309a\ua620-\ua629\ua66f\ua674-\ua67d\ua69e\ua69f\ua6f0\ua6f1\ua802\ua806\ua80b\ua823-\ua827\ua880\ua881\ua8b4-\ua8c5\ua8d0-\ua8d9\ua8e0-\ua8f1\ua900-\ua909\ua926-\ua92d\ua947-\ua953\ua980-\ua983\ua9b3-\ua9c0\ua9d0-\ua9d9\ua9e5\ua9f0-\ua9f9\uaa29-\uaa36\uaa43\uaa4c\uaa4d\uaa50-\uaa59\uaa7b-\uaa7d\uaab0\uaab2-\uaab4\uaab7\uaab8\uaabe\uaabf\uaac1\uaaeb-\uaaef\uaaf5\uaaf6\uabe3-\uabea\uabec\uabed\uabf0-\uabf9\ufb1e\ufe00-\ufe0f\ufe20-\ufe2f\ufe33\ufe34\ufe4d-\ufe4f\uff10-\uff19\uff3f";
const nonASCIIidentifierStart = new RegExp("[" + nonASCIIidentifierStartChars + "]");
const nonASCIIidentifier = new RegExp("[" + nonASCIIidentifierStartChars + nonASCIIidentifierChars + "]");
nonASCIIidentifierStartChars = nonASCIIidentifierChars = null; // These are a run-length and offset encoded representation of the
// >0xffff code points that are a valid part of identifiers. The
// offset starts at 0x10000, and each pair of numbers represents an
// offset to the next range, and then a size of the range. They were
// generated by `bin/generate-identifier-regex.js`.
// eslint-disable-next-line comma-spacing

/* prettier-ignore */

const astralIdentifierStartCodes = [0, 11, 2, 25, 2, 18, 2, 1, 2, 14, 3, 13, 35, 122, 70, 52, 268, 28, 4, 48, 48, 31, 17, 26, 6, 37, 11, 29, 3, 35, 5, 7, 2, 4, 43, 157, 19, 35, 5, 35, 5, 39, 9, 51, 157, 310, 10, 21, 11, 7, 153, 5, 3, 0, 2, 43, 2, 1, 4, 0, 3, 22, 11, 22, 10, 30, 66, 18, 2, 1, 11, 21, 11, 25, 71, 55, 7, 1, 65, 0, 16, 3, 2, 2, 2, 26, 45, 28, 4, 28, 36, 7, 2, 27, 28, 53, 11, 21, 11, 18, 14, 17, 111, 72, 56, 50, 14, 50, 785, 52, 76, 44, 33, 24, 27, 35, 42, 34, 4, 0, 13, 47, 15, 3, 22, 0, 2, 0, 36, 17, 2, 24, 85, 6, 2, 0, 2, 3, 2, 14, 2, 9, 8, 46, 39, 7, 3, 1, 3, 21, 2, 6, 2, 1, 2, 4, 4, 0, 19, 0, 13, 4, 159, 52, 19, 3, 54, 47, 21, 1, 2, 0, 185, 46, 42, 3, 37, 47, 21, 0, 60, 42, 86, 25, 391, 63, 32, 0, 449, 56, 264, 8, 2, 36, 18, 0, 50, 29, 881, 921, 103, 110, 18, 195, 2749, 1070, 4050, 582, 8634, 568, 8, 30, 114, 29, 19, 47, 17, 3, 32, 20, 6, 18, 881, 68, 12, 0, 67, 12, 65, 0, 32, 6124, 20, 754, 9486, 1, 3071, 106, 6, 12, 4, 8, 8, 9, 5991, 84, 2, 70, 2, 1, 3, 0, 3, 1, 3, 3, 2, 11, 2, 0, 2, 6, 2, 64, 2, 3, 3, 7, 2, 6, 2, 27, 2, 3, 2, 4, 2, 0, 4, 6, 2, 339, 3, 24, 2, 24, 2, 30, 2, 24, 2, 30, 2, 24, 2, 30, 2, 24, 2, 30, 2, 24, 2, 7, 4149, 196, 60, 67, 1213, 3, 2, 26, 2, 1, 2, 0, 3, 0, 2, 9, 2, 3, 2, 0, 2, 0, 7, 0, 5, 0, 2, 0, 2, 0, 2, 2, 2, 1, 2, 0, 3, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 1, 2, 0, 3, 3, 2, 6, 2, 3, 2, 3, 2, 0, 2, 9, 2, 16, 6, 2, 2, 4, 2, 16, 4421, 42710, 42, 4148, 12, 221, 3, 5761, 10591, 541]; // eslint-disable-next-line comma-spacing

/* prettier-ignore */

const astralIdentifierCodes = [509, 0, 227, 0, 150, 4, 294, 9, 1368, 2, 2, 1, 6, 3, 41, 2, 5, 0, 166, 1, 1306, 2, 54, 14, 32, 9, 16, 3, 46, 10, 54, 9, 7, 2, 37, 13, 2, 9, 52, 0, 13, 2, 49, 13, 10, 2, 4, 9, 83, 11, 7, 0, 161, 11, 6, 9, 7, 3, 57, 0, 2, 6, 3, 1, 3, 2, 10, 0, 11, 1, 3, 6, 4, 4, 193, 17, 10, 9, 87, 19, 13, 9, 214, 6, 3, 8, 28, 1, 83, 16, 16, 9, 82, 12, 9, 9, 84, 14, 5, 9, 423, 9, 838, 7, 2, 7, 17, 9, 57, 21, 2, 13, 19882, 9, 135, 4, 60, 6, 26, 9, 1016, 45, 17, 3, 19723, 1, 5319, 4, 4, 5, 9, 7, 3, 6, 31, 3, 149, 2, 1418, 49, 513, 54, 5, 49, 9, 0, 15, 0, 23, 4, 2, 14, 1361, 6, 2, 16, 3, 6, 2, 1, 2, 4, 2214, 6, 110, 6, 6, 9, 792487, 239]; // This has a complexity linear to the value of the code. The
// assumption is that looking up astral identifier characters is
// rare.

function isInAstralSet(code: number, set: $ReadOnlyArray<number>): boolean {
  let pos = 0x10000;

  for (let i = 0; i < set.length; i += 2) {
    pos += set[i];
    if (pos > code) return false;
    pos += set[i + 1];
    if (pos >= code) return true;
  }

  return false;
} // Test whether a given character code starts an identifier.


export function isIdentifierStart(code: number): boolean {
  if (code < 65) return code === 36;
  if (code < 91) return true;
  if (code < 97) return code === 95;
  if (code < 123) return true;
  if (code <= 0xffff) return code >= 0xaa && nonASCIIidentifierStart.test(String.fromCharCode(code));
  return isInAstralSet(code, astralIdentifierStartCodes);
} // Test whether a given character is part of an identifier.

export function isIdentifierChar(code: number): boolean {
  if (code < 48) return code === 36;
  if (code < 58) return true;
  if (code < 65) return false;
  if (code < 91) return true;
  if (code < 97) return code === 95;
  if (code < 123) return true;
  if (code <= 0xffff) return code >= 0xaa && nonASCIIidentifier.test(String.fromCharCode(code));
  return isInAstralSet(code, astralIdentifierStartCodes) || isInAstralSet(code, astralIdentifierCodes);
}
// @flow
import { lineBreakG } from "./whitespace";
export type Pos = {
  start: number
}; // These are used when `options.locations` is on, for the
// `startLoc` and `endLoc` properties.

export type Position = {
  line: number,
  column: number,
};
export type SourceLocation = {
  start: Position,
  end: Position,
  filename?: string,
  identifierName?: string,
}; // The `getLineInfo` function is mostly useful when the
// `locations` option is off (for performance reasons) and you
// want to find the line/column position for a given character
// offset. `input` should be the code string that the offset refers
// into.

export function getLineInfo(input: string, offset: number): Position {
  for (let line = 1, cur = 0;;) {
    lineBreakG.lastIndex = cur;
    const match = lineBreakG.exec(input);

    if (match && match.index < offset) {
      ++line;
      cur = match.index + match[0].length;
    } else {
      return {
        line,
        column: offset - cur
      };
    }
  } // istanbul ignore next


  throw new Error("Unreachable");
}
// @flow
// Matches a whole line break (where CRLF is considered a single
// line break). Used to count lines.
export const lineBreak = /\r\n?|\n|\u2028|\u2029/;
export const lineBreakG = new RegExp(lineBreak.source, "g");
export function isNewLine(code: number): boolean {
  return code === 10 || code === 13 || code === 0x2028 || code === 0x2029;
}
export const nonASCIIwhitespace = /[\u1680\u180e\u2000-\u200a\u202f\u205f\u3000\ufeff]/;
