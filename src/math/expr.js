/**
 * A tiny arithmetic expression compiler.
 *
 * There is one non-negotiable reason this exists instead of `eval` or
 * `new Function`: shapes travel in the URL hash, so an expression is untrusted
 * input arriving from a link somebody else wrote. Handing that to a JavaScript
 * evaluator would turn every shared drum into a script-injection vector. A
 * recursive-descent parser over a closed vocabulary cannot execute anything; the
 * worst a hostile input can do is fail to parse, or evaluate to NaN.
 *
 * It also buys better errors. `eval` reports a SyntaxError against JavaScript,
 * which is not the language the user thinks they are writing: `2sin(t)` and
 * `r = 1 + cos t` are the mistakes people actually make, and both get named here.
 *
 * Grammar, loosest to tightest:
 *
 *   sum     := product (('+' | '-') product)*
 *   product := unary (('*' | '/' | '%') unary)*        // implicit '*' allowed
 *   unary   := ('-' | '+')* power
 *   power   := atom ('^' unary)?                        // right associative
 *   atom    := number | constant | name '(' args ')' | '(' sum ')' | '|' sum '|'
 */

// Null-prototyped, and this is load bearing rather than tidiness. With an ordinary
// object literal, `CONSTANTS['constructor']` is inherited from Object.prototype and
// is not undefined, so the name `constructor` resolved as a "constant" whose value
// was a function. The same held for toString, valueOf and hasOwnProperty. Nothing
// executable escaped - the evaluator only ever does arithmetic on what it gets, so
// the result was NaN - but a lookup table consulted with untrusted keys must not
// have a prototype, and relying on the layer above to be harmless is not a defence.
const CONSTANTS = Object.assign(Object.create(null), {
  pi: Math.PI,
  tau: 2 * Math.PI,
  e: Math.E,
  phi: (1 + Math.sqrt(5)) / 2,
});

// Every callable, with its arity. Arity is checked at parse time so a typo is a
// message about your formula rather than a NaN two layers downstream.
const FUNCTIONS = Object.assign(Object.create(null), {
  sin: [1, Math.sin],
  cos: [1, Math.cos],
  tan: [1, Math.tan],
  asin: [1, Math.asin],
  acos: [1, Math.acos],
  atan: [1, Math.atan],
  atan2: [2, Math.atan2],
  sinh: [1, Math.sinh],
  cosh: [1, Math.cosh],
  tanh: [1, Math.tanh],
  exp: [1, Math.exp],
  log: [1, Math.log],
  ln: [1, Math.log],
  log2: [1, Math.log2],
  log10: [1, Math.log10],
  sqrt: [1, Math.sqrt],
  cbrt: [1, Math.cbrt],
  abs: [1, Math.abs],
  sign: [1, Math.sign],
  floor: [1, Math.floor],
  ceil: [1, Math.ceil],
  round: [1, Math.round],
  hypot: [2, Math.hypot],
  pow: [2, Math.pow],
  mod: [2, (a, b) => a - b * Math.floor(a / b)],
  min: [2, Math.min],
  max: [2, Math.max],
  clamp: [3, (v, lo, hi) => Math.min(Math.max(v, lo), hi)],
  // Handy for outlines: a square wave and a triangle wave, both period tau, so
  // polygonal and faceted shapes are reachable without a piecewise notation.
  square: [1, (t) => (Math.sin(t) >= 0 ? 1 : -1)],
  tri: [1, (t) => 1 - 4 * Math.abs(Math.round(t / (2 * Math.PI)) - t / (2 * Math.PI))],
});

export const FUNCTION_NAMES = Object.keys(FUNCTIONS).sort();
export const CONSTANT_NAMES = Object.keys(CONSTANTS).sort();

class ParseError extends Error {}

function fail(message) {
  throw new ParseError(message);
}

/* ------------------------------------------------------------------ tokenizer */

const NAME_START = /[a-z_]/i;
const NAME_PART = /[a-z0-9_]/i;

function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    if (c >= '0' && c <= '9') {
      out.push({ kind: 'num', value: readNumber(), at: i });
      continue;
    }
    if (c === '.') {
      // A bare dot only starts a number; otherwise it is not part of the language.
      if (src[i + 1] >= '0' && src[i + 1] <= '9') {
        out.push({ kind: 'num', value: readNumber(), at: i });
        continue;
      }
      fail('A lone "." does not mean anything here. Use a digit on both sides.');
    }
    if (NAME_START.test(c)) {
      let j = i;
      while (j < src.length && NAME_PART.test(src[j])) j++;
      out.push({ kind: 'name', value: src.slice(i, j).toLowerCase(), at: i });
      i = j;
      continue;
    }
    if ('+-*/%^(),|'.includes(c)) {
      out.push({ kind: c, at: i });
      i++;
      continue;
    }
    // Common typographic look-alikes, named rather than rejected generically.
    if (c === '\u00d7' || c === '\u22c5') fail('Use "*" for multiplication, not "' + c + '".');
    if (c === '\u00f7') fail('Use "/" for division, not "' + c + '".');
    if (c === '\u2212') fail('Use "-" for minus, not the typographic dash.');
    if (c === '=') fail('Write the right-hand side only. Drop the "=" and what is before it.');
    if (c === '[' || c === ']' || c === '{' || c === '}') fail('Use round brackets "(" and ")".');
    fail(`"${c}" is not something this understands.`);
  }
  return out;

  function readNumber() {
    const start = i;
    while (i < src.length && src[i] >= '0' && src[i] <= '9') i++;
    if (src[i] === '.') {
      i++;
      while (i < src.length && src[i] >= '0' && src[i] <= '9') i++;
    }
    if (src[i] === 'e' || src[i] === 'E') {
      // Only an exponent if it really is one, so `2e` stays the number 2 times e.
      let j = i + 1;
      if (src[j] === '+' || src[j] === '-') j++;
      if (src[j] >= '0' && src[j] <= '9') {
        i = j;
        while (i < src.length && src[i] >= '0' && src[i] <= '9') i++;
      }
    }
    return Number(src.slice(start, i));
  }
}

/* --------------------------------------------------------------------- parser */

/**
 * Parses `source` into an evaluator. Returns
 * `{ ok: true, fn, references }` or `{ ok: false, error }`.
 *
 * `fn(scope)` takes a plain object of variable values. `references` is the set of
 * declared variables the expression actually used, which is how the sampler can
 * tell a constant outline from one that varies.
 *
 * @param {string} source
 * @param {string[]} variables names the expression is allowed to use
 */
export function compileExpression(source, variables = []) {
  const allowed = new Set(variables.map((v) => v.toLowerCase()));
  const used = new Set();

  try {
    if (typeof source !== 'string' || !source.trim()) {
      fail('Nothing to read. Type an expression.');
    }
    if (source.length > 400) fail('That expression is far longer than anything this needs.');

    const tokens = tokenize(source);
    if (!tokens.length) fail('Nothing to read. Type an expression.');

    let pos = 0;
    const peek = () => tokens[pos];
    const at = (kind) => pos < tokens.length && tokens[pos].kind === kind;
    const eat = (kind) => (at(kind) ? (pos++, true) : false);

    const node = parseSum();
    if (pos < tokens.length) {
      const t = tokens[pos];
      if (t.kind === ')') fail('There is a ")" with no "(" to close.');
      fail(`Cannot make sense of the rest, starting at character ${t.at + 1}.`);
    }

    return { ok: true, fn: node, references: used };

    function parseSum() {
      let left = parseProduct();
      for (;;) {
        if (eat('+')) {
          const right = parseProduct();
          const l = left;
          left = (s) => l(s) + right(s);
        } else if (eat('-')) {
          const right = parseProduct();
          const l = left;
          left = (s) => l(s) - right(s);
        } else return left;
      }
    }

    function parseProduct() {
      let left = parseUnary();
      for (;;) {
        if (eat('*')) {
          const right = parseUnary();
          const l = left;
          left = (s) => l(s) * right(s);
        } else if (eat('/')) {
          const right = parseUnary();
          const l = left;
          left = (s) => l(s) / right(s);
        } else if (eat('%')) {
          const right = parseUnary();
          const l = left;
          left = (s) => l(s) % right(s);
        } else if (startsAtom()) {
          // Implicit multiplication: `2t`, `3cos(t)`, `2(1+t)`. People write this
          // and mean it, so accepting it is not laxness. It binds exactly as
          // tightly as an explicit `*`, so `1/2t` is `(1/2)*t`, same as algebra.
          const right = parseUnary();
          const l = left;
          left = (s) => l(s) * right(s);
        } else return left;
      }
    }

    // Deliberately excludes '|'. A bar is both an opening and a closing delimiter,
    // so if it could also begin an implicit product then `|cos(t)|^4` parses as
    // `|cos(t)| * |^4 ...|` and swallows the rest of the expression. That was not a
    // hypothetical: it is exactly what the squircle example did. Ordinary
    // mathematics has the same ambiguity and resolves it by context, which a
    // one-token lookahead does not have, so `2|t|` needs its `*` written out.
    function startsAtom() {
      if (pos >= tokens.length) return false;
      const k = tokens[pos].kind;
      return k === 'num' || k === 'name' || k === '(';
    }

    function parseUnary() {
      if (eat('-')) {
        const inner = parseUnary();
        return (s) => -inner(s);
      }
      if (eat('+')) return parseUnary();
      return parsePower();
    }

    function parsePower() {
      const base = parseAtom();
      if (eat('^')) {
        // Right associative, and the exponent may be signed: 2^-t.
        const exp = parseUnary();
        return (s) => Math.pow(base(s), exp(s));
      }
      return base;
    }

    function parseAtom() {
      if (pos >= tokens.length) fail('The expression stops in the middle of something.');
      const t = tokens[pos];

      if (t.kind === 'num') {
        pos++;
        const v = t.value;
        return () => v;
      }

      if (t.kind === '(') {
        pos++;
        const inner = parseSum();
        if (!eat(')')) fail('A "(" is never closed.');
        return inner;
      }

      if (t.kind === '|') {
        pos++;
        const inner = parseSum();
        if (!eat('|')) fail('A "|" is never closed.');
        return (s) => Math.abs(inner(s));
      }

      if (t.kind === 'name') {
        pos++;
        const name = t.value;

        if (at('(')) {
          const spec = FUNCTIONS[name];
          if (!spec) {
            if (allowed.has(name) || CONSTANTS[name] !== undefined) {
              fail(`"${name}" is a value, not a function, so it cannot be called.`);
            }
            fail(`There is no function called "${name}".`);
          }
          pos++;
          const args = [];
          if (!at(')')) {
            do {
              args.push(parseSum());
            } while (eat(','));
          }
          if (!eat(')')) fail(`The brackets after "${name}" are never closed.`);
          const [arity, impl] = spec;
          if (args.length !== arity) {
            fail(
              `"${name}" takes ${arity} ${arity === 1 ? 'value' : 'values'}, ` +
                `but ${args.length} ${args.length === 1 ? 'was' : 'were'} given.`,
            );
          }
          if (arity === 1) return (s) => impl(args[0](s));
          if (arity === 2) return (s) => impl(args[0](s), args[1](s));
          return (s) => impl(args[0](s), args[1](s), args[2](s));
        }

        if (allowed.has(name)) {
          used.add(name);
          return (s) => s[name];
        }
        if (CONSTANTS[name] !== undefined) {
          const v = CONSTANTS[name];
          return () => v;
        }
        if (FUNCTIONS[name]) {
          fail(`"${name}" needs brackets around what it acts on, as in ${name}(t).`);
        }
        const hint = allowed.size ? ` Available: ${[...allowed].join(', ')}.` : '';
        fail(`"${name}" is not a name this knows.${hint}`);
      }

      if (t.kind === ')') fail('There is a ")" with nothing inside it.');
      fail(`Something is missing before character ${t.at + 1}.`);
    }
  } catch (err) {
    if (err instanceof ParseError) return { ok: false, error: err.message };
    return { ok: false, error: 'That expression could not be read.' };
  }
}
