/**
 * Sicherer mathematischer Ausdruck-Auswerter (Recursive-Descent-Parser).
 *
 * Ersetzt die vorherige `new Function(...)`-Variante, die entgegen der
 * Dokumentation einem eval entsprach und beliebigen Code ausführen konnte.
 * Dieser Parser akzeptiert ausschließlich:
 *   - Zahlen (inkl. Dezimalpunkt und deutschem Komma: 1,5 === 1.5)
 *   - Operatoren + - * / % ^ (Potenz), Klammern
 *   - Funktionen: sqrt, abs, cbrt, pow, exp, ln, log, log2, log10, sin, cos,
 *     tan, asin, acos, atan, floor, ceil, round, min, max
 *   - Konstanten: pi, e (auch Π/π)
 * Alles andere (Zugriff auf Objekte, Bezeichner, Anweisungen) führt zu einem
 * Fehler – Codeausführung ist strukturell unmöglich.
 */

type NumberFn = (...args: number[]) => number;

const FUNCTIONS: Record<string, NumberFn> = {
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  pow: Math.pow,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log,       // natürlicher Logarithmus (Taschenrechner-Konvention teils anders; dokumentiert)
  log2: Math.log2,
  log10: Math.log10,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  min: Math.min,
  max: Math.max,
};

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  'π': Math.PI,
  'Π': Math.PI,
  e: Math.E,
};

export class SafeMathError extends Error {}

/**
 * Wandelt deutsche Zahlformatierung in eine kanonische Form um:
 *  - "1.234,56" -> "1234.56"  (Punkt = Tausendertrennzeichen, Komma = Dezimal)
 *  - "1,5"      -> "1.5"      (Komma als Dezimaltrennzeichen)
 *  - "1.5"      -> "1.5"      (englische Schreibweise bleibt unverändert)
 */
export function normalizeGermanNumbers(expr: string): string {
  return expr.replace(
    /\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?/g,
    (match) => {
      if (/^\d{1,3}(?:\.\d{3})+/.test(match)) {
        // Punkt-Tausendergruppen: alle Punkte entfernen, Komma -> Punkt
        return match.replace(/\./g, '').replace(',', '.');
      }
      // Einfache Zahl: höchstens ein Komma als Dezimaltrenner umwandeln
      return match.includes(',') ? match.replace(',', '.') : match;
    }
  );
}

/**
 * Liest im Parser eine Zahl. Akzeptiert nur ASCII-Ziffern und '.' –
 * Aufrufer sollte vorab normalizeGermanNumbers() verwenden.
 */
function tokenize(input: string): Array<{ t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string }> {
  const tokens: Array<{ t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string }> = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (/[0-9.]/.test(ch)) {
      let num = '';
      while (i < input.length && /[0-9.]/.test(input[i])) { num += input[i++]; }
      if (!/^(\d+\.?\d*|\.\d+)$/.test(num) || num.split('.').length > 2) {
        throw new SafeMathError(`Ungültige Zahl: "${num}"`);
      }
      const value = parseFloat(num);
      if (!Number.isFinite(value)) throw new SafeMathError(`Ungültige Zahl: "${num}"`);
      tokens.push({ t: 'num', v: value });
      continue;
    }
    if (/[a-zA-Z_πΠ]/.test(ch)) {
      let id = '';
      while (i < input.length && /[a-zA-Z_πΠ0-9]/.test(input[i])) { id += input[i++]; }
      tokens.push({ t: 'id', v: id.toLowerCase() });
      continue;
    }
    if ('+-*/%^(),'.includes(ch)) {
      tokens.push({ t: 'op', v: ch });
      i++;
      continue;
    }
    throw new SafeMathError(`Unbekanntes Zeichen: "${ch}"`);
  }
  return tokens;
}

export function evaluateExpression(rawExpr: string): number {
  if (!rawExpr || !rawExpr.trim()) throw new SafeMathError('Leerer Ausdruck');
  const expr = normalizeGermanNumbers(rawExpr);
  const tokens = tokenize(expr);
  if (tokens.length === 0) throw new SafeMathError('Leerer Ausdruck');

  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function isOp(v: string): boolean {
    const t = peek();
    return !!t && t.t === 'op' && t.v === v;
  }

  // parseExpr := parseTerm (('+'|'-') parseTerm)*
  function parseExpr(): number {
    let value = parseTerm();
    while (isOp('+') || isOp('-')) {
      const op = (next() as { t: 'op'; v: string }).v;
      const rhs = parseTerm();
      value = op === '+' ? value + rhs : value - rhs;
    }
    return value;
  }

  // parseTerm := parseFactor (('*'|'/'|'%') parseFactor)*
  function parseTerm(): number {
    let value = parseFactor();
    while (isOp('*') || isOp('/') || isOp('%')) {
      const op = (next() as { t: 'op'; v: string }).v;
      const rhs = parseFactor();
      if (op === '*') value = value * rhs;
      else if (op === '/') {
        if (rhs === 0) throw new SafeMathError('Division durch null');
        value = value / rhs;
      } else {
        if (rhs === 0) throw new SafeMathError('Modulo durch null');
        value = value % rhs;
      }
    }
    return value;
  }

  // parseFactor := ('-'|'+') parseFactor | parsePower
  // parsePower   := parsePrimary ('^' parseFactor)?   (rechtsassoziativ)
  function parseFactor(): number {
    if (isOp('-')) { next(); return -parseFactor(); }
    if (isOp('+')) { next(); return parseFactor(); }
    return parsePower();
  }

  function parsePower(): number {
    const base = parsePrimary();
    if (isOp('^')) {
      next();
      const exponent = parseFactor(); // rechtsassoziativ, erlaubt -Exponenten
      return Math.pow(base, exponent);
    }
    return base;
  }

  function parsePrimary(): number {
    const token = peek();
    if (!token) throw new SafeMathError('Unerwartetes Ende des Ausdrucks');

    if (token.t === 'num') { next(); return token.v; }

    if (token.t === 'op' && token.v === '(') {
      next();
      const value = parseExpr();
      if (!isOp(')')) throw new SafeMathError('Schließende Klammer fehlt');
      next();
      return value;
    }

    if (token.t === 'id') {
      next();
      const name = token.v;
      if (peek() && peek().t === 'op' && (peek() as { v: string }).v === '(') {
        const fn = FUNCTIONS[name];
        if (!fn) throw new SafeMathError(`Unbekannte Funktion: "${name}"`);
        next(); // '('
        const args: number[] = [];
        if (!isOp(')')) {
          args.push(parseExpr());
          while (isOp(',')) { next(); args.push(parseExpr()); }
        }
        if (!isOp(')')) throw new SafeMathError('Schließende Klammer fehlt');
        next(); // ')'
        const result = fn(...args);
        if (!Number.isFinite(result) && !(Number.isNaN(result))) {
          throw new SafeMathError('Nicht endliches Ergebnis');
        }
        return result;
      }
      if (name in CONSTANTS) return CONSTANTS[name];
      throw new SafeMathError(`Unbekannter Bezeichner: "${name}"`);
    }

    throw new SafeMathError(`Unerwarteter Token: ${JSON.stringify(token)}`);
  }

  const result = parseExpr();
  if (pos < tokens.length) throw new SafeMathError('Ausdruck endet unerwartet');
  if (Number.isNaN(result)) throw new SafeMathError('Ergebnis ist keine Zahl');
  if (!Number.isFinite(result)) throw new SafeMathError('Ergebnis ist unendlich');
  return result;
}
