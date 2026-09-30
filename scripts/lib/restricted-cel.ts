/**
 * Restricted CEL 求值器 —— agent-models-config 生成期的 option map 静态求值。
 *
 * Vendored from zai-org/ZCode packages/model-option-map（Apache-2.0，@ v3.14.3
 * commit 29628c9）：tokenizer / parser / evaluator 语义逐位保留（含输入值断言、
 * null 原型对象键、结果递归冻结）；compiler 的进程级缓存与 merge-patch 运行时
 * 装配不含——本仓只在生成期对 `reasoningLevel` / `maxOutputTokens` 逐档单次
 * 求值（标准 docs/standards/agent-models-config.md §9）。
 *
 * 正交意图：
 *   [1] DSL 求值：map 源字符串 × 变量值 → JSON 对象（三元分派/参数名直传/
 *       布尔开关/算术，均可求值；成员访问与函数调用按上游语义拒绝）。
 * 妥协声明：无。
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type ModelOptionName = "reasoningLevel" | "maxOutputTokens";

export class RestrictedCelError extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(`${message} at offset ${offset}`);
    this.name = "RestrictedCelError";
  }
}

// ---------------------------------------------------------------- tokenizer

type TokenKind = "identifier" | "string" | "number" | "operator" | "punctuation" | "eof";

interface Token {
  readonly kind: TokenKind;
  readonly value: string;
  readonly offset: number;
  readonly end: number;
}

const DOUBLE_OPERATORS = new Set(["&&", "||", "==", "!=", "<=", ">="]);
const SINGLE_OPERATORS = new Set(["+", "-", "*", "/", "%", "!", "<", ">"]);
const PUNCTUATION = new Set(["{", "}", "[", "]", "(", ")", ",", ":", "?", "."]);

function tokenize(source: string): readonly Token[] {
  const tokens: Token[] = [];
  let offset = 0;
  while (offset < source.length) {
    const character = source[offset]!;
    if (/\s/u.test(character)) {
      offset += 1;
      continue;
    }
    if (character === "'" || character === '"') {
      const token = readString(source, offset, character);
      tokens.push(token);
      offset = token.end;
      continue;
    }
    if (/[0-9]/u.test(character)) {
      const token = readNumber(source, offset);
      tokens.push(token);
      offset = token.end;
      continue;
    }
    if (/[A-Za-z_]/u.test(character)) {
      let end = offset + 1;
      while (end < source.length && /[A-Za-z0-9_]/u.test(source[end]!)) end += 1;
      tokens.push({ kind: "identifier", value: source.slice(offset, end), offset, end });
      offset = end;
      continue;
    }
    const pair = source.slice(offset, offset + 2);
    if (DOUBLE_OPERATORS.has(pair)) {
      tokens.push({ kind: "operator", value: pair, offset, end: offset + 2 });
      offset += 2;
      continue;
    }
    if (SINGLE_OPERATORS.has(character)) {
      tokens.push({ kind: "operator", value: character, offset, end: offset + 1 });
      offset += 1;
      continue;
    }
    if (PUNCTUATION.has(character)) {
      tokens.push({ kind: "punctuation", value: character, offset, end: offset + 1 });
      offset += 1;
      continue;
    }
    throw new RestrictedCelError(`unsupported token ${JSON.stringify(character)}`, offset);
  }
  tokens.push({ kind: "eof", value: "", offset: source.length, end: source.length });
  return Object.freeze(tokens);
}

function readNumber(source: string, offset: number): Token {
  const match = /^(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(source.slice(offset));
  if (!match) throw new RestrictedCelError("invalid number literal", offset);
  return { kind: "number", value: match[0], offset, end: offset + match[0].length };
}

const SIMPLE_ESCAPES: Readonly<Record<string, string>> = Object.freeze({
  "'": "'",
  '"': '"',
  "\\": "\\",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
});

function readString(source: string, offset: number, quote: "'" | '"'): Token {
  let cursor = offset + 1;
  let value = "";
  while (cursor < source.length) {
    const character = source[cursor]!;
    if (character === quote) return { kind: "string", value, offset, end: cursor + 1 };
    if (character === "\n" || character === "\r") {
      throw new RestrictedCelError("unterminated string literal", offset);
    }
    if (character !== "\\") {
      value += character;
      cursor += 1;
      continue;
    }
    const escapeOffset = cursor;
    cursor += 1;
    const escaped = source[cursor];
    if (escaped === undefined)
      throw new RestrictedCelError("unterminated string escape", escapeOffset);
    const simple = SIMPLE_ESCAPES[escaped];
    if (simple !== undefined) {
      value += simple;
      cursor += 1;
      continue;
    }
    if (escaped === "u") {
      const digits = source.slice(cursor + 1, cursor + 5);
      if (!/^[0-9A-Fa-f]{4}$/u.test(digits)) {
        throw new RestrictedCelError("invalid unicode escape", escapeOffset);
      }
      value += String.fromCharCode(Number.parseInt(digits, 16));
      cursor += 5;
      continue;
    }
    throw new RestrictedCelError(`unsupported string escape \\${escaped}`, escapeOffset);
  }
  throw new RestrictedCelError("unterminated string literal", offset);
}

// ---------------------------------------------------------------- parser

type Expression =
  | { readonly type: "literal"; readonly value: string | number | boolean | null }
  | { readonly type: "input" }
  | { readonly type: "array"; readonly elements: readonly Expression[] }
  | {
      readonly type: "object";
      readonly entries: readonly { readonly key: string; readonly value: Expression }[];
    }
  | { readonly type: "unary"; readonly operator: "!" | "-" | "+"; readonly operand: Expression }
  | {
      readonly type: "binary";
      readonly operator: string;
      readonly left: Expression;
      readonly right: Expression;
    }
  | {
      readonly type: "conditional";
      readonly condition: Expression;
      readonly whenTrue: Expression;
      readonly whenFalse: Expression;
    };

function parse(tokens: readonly Token[], variableName: ModelOptionName): Expression {
  let index = 0;
  const current = (): Token => tokens[index] ?? tokens[tokens.length - 1]!;
  const advance = (): Token => {
    const token = current();
    if (token.kind !== "eof") index += 1;
    return token;
  };
  const consume = (value: string): boolean => {
    if (current().value !== value) return false;
    index += 1;
    return true;
  };
  const expect = (value: string): void => {
    if (current().value !== value) {
      throw new RestrictedCelError(`expected ${JSON.stringify(value)}`, current().offset);
    }
    index += 1;
  };

  const expression = parseConditional();
  const trailing = current();
  if (trailing.kind !== "eof") {
    if (trailing.value === ".") {
      throw new RestrictedCelError("member access is not supported", trailing.offset);
    }
    if (trailing.value === "(") {
      throw new RestrictedCelError("function calls are not supported", trailing.offset);
    }
    throw new RestrictedCelError(
      `unexpected token ${JSON.stringify(trailing.value)}`,
      trailing.offset,
    );
  }
  return expression;

  function parseConditional(): Expression {
    const condition = parseLogicalOr();
    if (!consume("?")) return condition;
    const whenTrue = parseConditional();
    expect(":");
    const whenFalse = parseConditional();
    return { type: "conditional", condition, whenTrue, whenFalse };
  }
  function parseLogicalOr(): Expression {
    return parseChain(parseLogicalAnd, new Set(["||"]));
  }
  function parseLogicalAnd(): Expression {
    return parseChain(parseEquality, new Set(["&&"]));
  }
  function parseEquality(): Expression {
    return parseChain(parseRelational, new Set(["==", "!="]));
  }
  function parseRelational(): Expression {
    return parseChain(parseAdditive, new Set(["<", "<=", ">", ">="]));
  }
  function parseAdditive(): Expression {
    return parseChain(parseMultiplicative, new Set(["+", "-"]));
  }
  function parseMultiplicative(): Expression {
    return parseChain(parseUnary, new Set(["*", "/", "%"]));
  }
  function parseChain(parseOperand: () => Expression, operators: ReadonlySet<string>): Expression {
    let parsed = parseOperand();
    while (current().kind === "operator" && operators.has(current().value)) {
      const operator = advance();
      parsed = { type: "binary", operator: operator.value, left: parsed, right: parseOperand() };
    }
    return parsed;
  }
  function parseUnary(): Expression {
    const token = current();
    if (
      token.kind === "operator" &&
      (token.value === "!" || token.value === "-" || token.value === "+")
    ) {
      advance();
      return { type: "unary", operator: token.value, operand: parseUnary() };
    }
    return parsePrimary();
  }
  function parsePrimary(): Expression {
    const token = advance();
    if (token.kind === "number") {
      const value = Number(token.value);
      if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
        throw new RestrictedCelError("number literal is not JSON-safe", token.offset);
      }
      return { type: "literal", value };
    }
    if (token.kind === "string") return { type: "literal", value: token.value };
    if (token.kind === "identifier") {
      if (current().value === "(") {
        throw new RestrictedCelError("function calls are not supported", current().offset);
      }
      if (token.value === variableName) return { type: "input" };
      if (token.value === "true" || token.value === "false") {
        return { type: "literal", value: token.value === "true" };
      }
      if (token.value === "null") return { type: "literal", value: null };
      throw new RestrictedCelError(
        `unknown identifier ${JSON.stringify(token.value)}`,
        token.offset,
      );
    }
    if (token.value === "(") {
      const inner = parseConditional();
      expect(")");
      return inner;
    }
    if (token.value === "[") return parseArray();
    if (token.value === "{") return parseObject();
    throw new RestrictedCelError(`unexpected token ${JSON.stringify(token.value)}`, token.offset);
  }
  function parseArray(): Expression {
    const elements: Expression[] = [];
    if (!consume("]")) {
      do elements.push(parseConditional());
      while (consume(","));
      expect("]");
    }
    return { type: "array", elements: Object.freeze(elements) };
  }
  function parseObject(): Expression {
    const entries: { key: string; value: Expression }[] = [];
    const keys = new Set<string>();
    if (!consume("}")) {
      do {
        const key = advance();
        if (key.kind !== "string") {
          throw new RestrictedCelError("object keys must be string literals", key.offset);
        }
        if (keys.has(key.value)) {
          throw new RestrictedCelError(
            `duplicate object key ${JSON.stringify(key.value)}`,
            key.offset,
          );
        }
        keys.add(key.value);
        expect(":");
        entries.push({ key: key.value, value: parseConditional() });
      } while (consume(","));
      expect("}");
    }
    return { type: "object", entries: Object.freeze(entries) };
  }
}

// ---------------------------------------------------------------- evaluator

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function evaluate(expression: Expression, input: string | number): JsonValue {
  switch (expression.type) {
    case "literal":
      return expression.value;
    case "input":
      return input;
    case "array":
      return expression.elements.map((element) => evaluate(element, input));
    case "object": {
      // 上游语义：null 原型 + defineProperty——`__proto__` 等键是普通数据键，
      // 不触发原型写入（B2 修复，对齐 evaluator.ts 的 Object.create(null) 路径）。
      const result: Record<string, JsonValue> = Object.create(null);
      for (const entry of expression.entries) {
        Object.defineProperty(result, entry.key, {
          configurable: true,
          enumerable: true,
          value: evaluate(entry.value, input),
          writable: true,
        });
      }
      return result as JsonObject;
    }
    case "unary":
      return evaluateUnary(expression.operator, evaluate(expression.operand, input));
    case "binary":
      return evaluateBinary(expression, input);
    case "conditional":
      return requireBoolean(evaluate(expression.condition, input))
        ? evaluate(expression.whenTrue, input)
        : evaluate(expression.whenFalse, input);
  }
}

function evaluateUnary(operator: string, operand: JsonValue): JsonValue {
  if (operator === "!") return !requireBoolean(operand);
  const number = requireNumber(operand);
  return assertNumber(operator === "-" ? -number : number);
}

function evaluateBinary(
  expression: Extract<Expression, { type: "binary" }>,
  input: string | number,
): JsonValue {
  const left = evaluate(expression.left, input);
  if (expression.operator === "&&") {
    return requireBoolean(left) ? requireBoolean(evaluate(expression.right, input)) : false;
  }
  if (expression.operator === "||") {
    return requireBoolean(left) ? true : requireBoolean(evaluate(expression.right, input));
  }
  const right = evaluate(expression.right, input);
  switch (expression.operator) {
    case "==":
      return jsonEquals(left, right);
    case "!=":
      return !jsonEquals(left, right);
    case "+":
      if (typeof left === "string" && typeof right === "string") return left + right;
      return assertNumber(requireNumber(left) + requireNumber(right));
    case "-":
      return assertNumber(requireNumber(left) - requireNumber(right));
    case "*":
      return assertNumber(requireNumber(left) * requireNumber(right));
    case "/":
      return assertNumber(requireNumber(left) / requireNumber(right));
    case "%":
      return assertNumber(requireNumber(left) % requireNumber(right));
    case "<":
    case "<=":
    case ">":
    case ">=":
      return compare(left, right, expression.operator);
    default:
      throw new RestrictedCelError(`unsupported operator ${expression.operator}`, 0);
  }
}

function compare(left: JsonValue, right: JsonValue, operator: string): boolean {
  if (typeof left !== typeof right || (typeof left !== "number" && typeof left !== "string")) {
    throw new RestrictedCelError(
      "comparison operands must have the same numeric or string type",
      0,
    );
  }
  const comparison =
    typeof left === "number" && typeof right === "number"
      ? left < right
        ? -1
        : left > right
          ? 1
          : 0
      : String(left) < String(right)
        ? -1
        : String(left) > String(right)
          ? 1
          : 0;
  if (operator === "<") return comparison < 0;
  if (operator === "<=") return comparison <= 0;
  if (operator === ">") return comparison > 0;
  return comparison >= 0;
}

function requireBoolean(value: JsonValue): boolean {
  if (typeof value !== "boolean") throw new RestrictedCelError("boolean operand required", 0);
  return value;
}

function requireNumber(value: JsonValue): number {
  if (typeof value !== "number") throw new RestrictedCelError("numeric operand required", 0);
  return value;
}

function assertNumber(value: number): number {
  if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
    throw new RestrictedCelError("numeric result is not JSON-safe", 0);
  }
  return value;
}

function jsonEquals(left: JsonValue, right: JsonValue): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((entry, index) => jsonEquals(entry, right[index]!))
    );
  }
  if (isJsonObject(left) && isJsonObject(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every((key) => Object.hasOwn(right, key) && jsonEquals(left[key]!, right[key]!))
    );
  }
  return false;
}

// ---------------------------------------------------------------- 生成期入口

/**
 * map 源 × 变量值 → JSON 对象（上游 compileModelOptionMap 语义：trim、输入值
 * 断言（string/有限数/安全整数）、顶层必须求值为对象、结果递归冻结
 * （freezeJson）；条件分支对象断言在求值后自然覆盖）。
 */
export function evaluateModelOptionMap(
  source: string,
  variableName: ModelOptionName,
  input: string | number,
): JsonObject {
  const normalized = source.trim();
  if (normalized.length === 0) throw new RestrictedCelError("expression must not be empty", 0);
  assertInputValue(input);
  const expression = parse(tokenize(normalized), variableName);
  const result = evaluate(expression, input);
  if (!isJsonObject(result)) {
    throw new RestrictedCelError("model option map must return a JSON object", 0);
  }
  return freezeJson(result);
}

/** 上游 assertRestrictedCelValue：数字必须有限且（整型时）安全。 */
function assertInputValue(input: string | number): void {
  if (typeof input === "string") return;
  if (!Number.isFinite(input) || (Number.isInteger(input) && !Number.isSafeInteger(input))) {
    throw new RestrictedCelError("input value must be a JSON-safe number", 0);
  }
}

/** 上游 freezeJson：结果对象与嵌套对象递归 Object.freeze（N6 vendoring 补齐）。 */
function freezeJson<T extends JsonValue>(value: T): T {
  if (Array.isArray(value)) {
    for (const entry of value) freezeJson(entry);
  } else if (isJsonObject(value)) {
    for (const entry of Object.values(value)) freezeJson(entry);
  } else {
    return value;
  }
  return Object.freeze(value);
}
