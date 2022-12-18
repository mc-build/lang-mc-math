const mathjs = require("mathjs");
const mc = require("!lang/mc");
const config = require("!config/mc-math");
const CompilerError = require("!errors/CompilerError");
class ScoreConstant {
  constructor(value) {
    this.value = Math.floor(value);
    this.name = "#" + this.value;
    this.objective = config.constScoreboard;
    this.isConst = true;
  }
  build(arr, temp, write) {
    if (write) {
      arr.push(
        `load{\nscoreboard players set ${this.name} ${this.objective} ${this.value}\n}`
      );
    }
    return {
      o: `${this.name} ${this.objective}`,
      v: this.value,
      clean: true,
      useSet: true,
    };
  }
  static eval(a, op, b) {
    let res = null;
    switch (op) {
      case "+":
        res = a.value + b.value;
        break;
      case "-":
        res = a.value - b.value;
        break;
      case "*":
        res = a.value * b.value;
        break;
      case "/":
        res = a.value / b.value;
        break;
      case "<":
        res = Math.min(a.value, b.value);
        break;
      case ">":
        res = Math.max(a.value, b.value);
        break;
      case "%":
        res = a.value % b.value;
        break;
      case "-=":
      case "+=":
      case "/=":
      case "*=":
      case "%=":
      case "=":
        throw new Error("invalid operation");
    }
    return new ScoreConstant(res | 0);
  }
}
class ScoreHolder {
  constructor(name, objective, macroopts = null) {
    this.name = name;
    this.objective = objective;
    this.macro = macroopts;
    this.clean = true;
  }
  build(arr, temp) {
    if (this.macro) {
      this.getMacro(arr, temp);
    }
    return {
      o: `${this.name} ${this.objective}`,
      clean: this.clean,
      useSet: false,
    };
  }
  getMacro(arr, temp) {
    const objectives = this.macro.args.map((_) => _.build(arr, temp, true));
    arr.push(
      `macro ${this.macro.name} ${this.name} ${this.objective} ${objectives
        .map((_) => _.o)
        .join(" ")}`
    );
  }
}
class Op {
  constructor(left, right, op) {
    this.left = left;
    this.right = right;
    this.op = op;
    this.isOp = true;
    if (Op.reversableOps.includes(this.op) && this.left.isConst) {
      [this.left, this.right] = [this.right, this.left];
    }
    if (this.left.isConst && this.right.isConst) {
      this.isOp = false;
      Object.assign(this, ScoreConstant.eval(this.left, this.op, this.right));
    }
  }
  optimize() {}
  static reversableOps = ["+", "*", "<", ">"];
  static transforms = {
    "%": "%=",
    "*": "*=",
    "+": "+=",
    "-": "-=",
    "/": "/=",
    "<": "<",
    ">": ">",
    "=": "=",
    "%=": "%=",
    "*=": "*=",
    "-=": "-=",
    "+=": "+=",
    "/=": "/=",
  };
  static optimizableOps = ["-", "+", "-=", "+=", "=", "<", ">"];
  static executionOrder = [
    ["=", "%", "%=", "<", ">", "*", "*="],
    ["/", "/="],
    ["+", "+=", "-", "-="],
  ];
  static getPriority(op) {
    return Op.executionOrder[
      Op.executionOrder.find((list) => list.includes(op))
    ];
  }
  get priority() {
    return Op.getPriority(this.op);
  }
  canBeOptimize() {
    return this.right.isConst && Op.optimizableOps.includes(this.op);
  }
  build(arr = [], temp) {
    if (this.isConst) {
      return {
        o: `${this.name} ${this.objective}`,
        v: this.value,
        clean: true,
        useSet: true,
      };
    }
    this.optimize();
    let my = [];
    let left = this.left.build(arr, temp);
    if (left.clean && !this.op.includes("=")) {
      let new_left = { o: `${temp()} ${config.tempScoreboard}`, clean: false };
      if (left.useSet) {
        my.push(`scoreboard players set ${new_left.o} ${left.v}`);
      } else {
        my.push(`scoreboard players operation ${new_left.o} = ${left.o}`);
      }
      left = new_left;
    } else if (this.left instanceof ScoreConstant) {
      this.left.build(arr, temp, true);
    }
    if (this.canBeOptimize()) {
      let op = "add",
        invert = "remove";
      let value = this.right.value;
      let use = null;
      switch (this.op) {
        case "-=":
        case "-":
          op = "remove";
          invert = "add";
          break;
        case "=":
          use = op = invert = "set";
          break;
      }
      if (value < 0) {
        use = invert;
        value *= -1;
      } else if (value > 0) {
        use = op;
      }
      if (use) {
        my.push(`scoreboard players ${use} ${left.o} ${value}`);
      } else if (this.left instanceof ScoreHolder) {
        return this.left.build();
      }
    } else {
      let right = this.right.build(arr, temp, true).o;
      if (this.op !== "=" || right !== left.o) {
        my.push(
          `scoreboard players operation ${left.o} ${
            Op.transforms[this.op]
          } ${right}`
        );
      }
    }
    arr.push(...my);
    return left;
  }
}
const operations = ["+", "-", "/", "*", "%", "="];
const punctuation = ["(", ")", ...operations, ","];
function isNumber(part) {
  return /^-*[0-9]+(\.[0-9]+)?$/.test(part);
}
function fixup(parts) {
  let res = [];
  for (let i = 0; i < parts.length - 1; i++) {
    if (
      !punctuation.includes(parts[i]) &&
      !punctuation.includes(parts[i + 1])
    ) {
      res.push(new ScoreHolder(parts[i], parts[i + 1]));
      i++;
    } else {
      res.push(parts[i]);
    }
  }
  if (punctuation.includes(parts[parts.length - 1])) {
    res.push(parts[parts.length - 1]);
  } else if (isNumber(parts[parts.length - 1])) {
    res.push(new ScoreConstant(parts[parts.length - 1]));
  }
  return res;
}
function parse(parts, str) {
  const res = [];
  let id = 0;
  let sid = 0;
  const parts2 = fixup(parts);
  const lookup = new Map();
  let mid = 0;
  let selfRef = false;
  function itterate(node) {
    switch (node.type) {
      case "ParenthesisNode":
        return itterate(node.content);
      case "OperatorNode":
        return new Op(itterate(node.args[0]), itterate(node.args[1]), node.op);
      case "SymbolNode":
        if (node.name === "$$0") {
          selfRef = true;
        }
        return lookup.get(node.name);
      case "FunctionNode":
        const name = node.fn.name;
        const args = node.args.map(itterate);
        return new ScoreHolder("m_" + mid++, config.tempScoreboard, {
          name,
          args,
        });
      case "ConstantNode": {
        return new ScoreConstant(node.value);
      }
      default:
        console.log(node.type, node);
    }
  }
  let eq = parts2
    .map((part) => {
      if (typeof part === "string") {
        return part;
      } else {
        const _id = "$$" + id++;
        lookup.set(_id, part);
        return _id;
      }
    })
    .join(" ");
  /**
   * @type {ScoreHolder | false}
   */
  let equals = false;
  if (eq.startsWith("$$0 =")) {
    equals = lookup.get("$$0");
    eq = eq.substr(6);
  }
  const mjstree = mathjs.simplify(mathjs.parse(eq));
  let tree = itterate(mjstree);
  if (equals !== false) {
    equals.clean = false;
    tree = new Op(equals, tree, "=");
  }
  tree.build(res, () => sid++);
  return [
    `load{\nscoreboard objectives add ${config.tempScoreboard} dummy\nscoreboard objectives add ${config.constScoreboard} dummy\n}`,
    ...res,
  ];
}
module.exports = (api) => {
  const transpiler = mc.transpiler;
  const GenericConsumer = transpiler.consumer.Generic;
  GenericConsumer.addAction({
    match: ({ token }) => token.startsWith("eq"),
    exec(file, tokens, func) {
      const expr = tokens.shift().token.substr(2).trim();
      try {
        const parts = expr
          .replace(/([=()+\-*%/,])/g, " $1 ")
          .split(" ")
          .filter(Boolean);
        const commands = parse(parts, expr);
        const res = mc.transpiler.tokenize(commands.join("\n"));
        tokens.unshift(...res);
      } catch (e) {
        throw new CompilerError(`invalid equation '${expr}'`);
      }
    },
  });
  return { exported: {} };
};
