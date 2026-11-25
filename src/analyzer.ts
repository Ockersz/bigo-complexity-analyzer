import * as ts from 'typescript';

export interface BottleneckLocation {
  line: number;
  column: number;
  startOffset: number;
  endOffset: number;
  description: string;
}

export interface TimeTerm {
  kind: 'poly' | 'sort' | 'exp';
  polyDegree: number;
  logPower: number;
  score: number;
}

export interface ResolvedImportSource {
  fileName: string;
  sourceText: string;
}

export interface AnalyzeOptions {
  hotspotThreshold?: number;
  resolveImport?: (specifier: string, fromFile: string) => ResolvedImportSource | null;
}

export interface FunctionComplexity {
  name: string;
  kind: 'function' | 'method' | 'arrow' | 'functionExpression';
  startOffset: number;
  endOffset: number;
  headerStartOffset: number;
  headerEndOffset: number;
  startLine: number;
  endLine: number;
  timeComplexity: string;
  spaceComplexity: string;
  selfTimeComplexity: string;
  selfSpaceComplexity: string;
  bottleneckScore: number;
  isHotspot: boolean;
  ignored: boolean;
  reasons: string[];
  bottleneckLocation: BottleneckLocation | null;
  optimizationTip: string | null;
}

type FunctionNode =
  | ts.FunctionDeclaration
  | ts.MethodDeclaration
  | ts.ArrowFunction
  | ts.FunctionExpression;

interface CandidateComplexity {
  term: TimeTerm;
  complexity: string;
  score: number;
  depth: number;
  reason: string;
  location: BottleneckLocation;
  category: 'recursion-exp' | 'recursion-linear' | 'sort' | 'array-lookup' | 'loop';
}

interface CallSite {
  calleeName: string;
  namespaceName: string | null;
  isThisCall: boolean;
  polyDepth: number;
  logDepth: number;
  outerStack: string[];
  location: BottleneckLocation;
}

interface LocalFunctionAnalysis {
  id: number;
  parentFunctionId: number | null;
  classNode: ts.ClassLikeDeclaration | null;
  selfName: string | null;
  isClassMember: boolean;
  isExported: boolean;
  isDefaultExport: boolean;
  displayName: string;
  kind: FunctionComplexity['kind'];
  ignored: boolean;
  startOffset: number;
  endOffset: number;
  headerStartOffset: number;
  headerEndOffset: number;
  startLine: number;
  endLine: number;
  selfTimeTerm: TimeTerm;
  selfTimeComplexity: string;
  selfSpaceDepth: number;
  selfSpaceComplexity: string;
  localCandidates: CandidateComplexity[];
  localReasons: string[];
  localSpaceReasons: string[];
  callSites: CallSite[];
}

interface ResolvedSummary {
  timeTerm: TimeTerm;
  spaceDepth: number;
  result: FunctionComplexity;
}

interface ImportedBinding {
  specifier: string;
  importedName: string;
}

interface ImportTable {
  namedOrDefault: Map<string, ImportedBinding>;
  namespaces: Map<string, string>;
}

interface AnalyzedModule {
  functions: FunctionComplexity[];
  summaries: ResolvedSummary[];
  locals: LocalFunctionAnalysis[];
  namedExports: Map<string, number>;
  defaultExportId: number | null;
}

const CALLBACK_ITERATION_METHODS = new Set([
  'map',
  'filter',
  'forEach',
  'reduce',
  'reduceRight',
  'some',
  'every',
  'find',
  'findIndex',
  'flatMap',
]);

const LINEAR_LOOKUP_METHODS = new Set(['includes', 'indexOf', 'lastIndexOf']);

const ARRAY_ALLOCATING_METHODS = new Set([
  'map',
  'filter',
  'slice',
  'concat',
  'flat',
  'flatMap',
]);

const ALLOCATING_CONSTRUCTORS = new Set([
  'Array',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'Int8Array',
  'Uint8Array',
  'Uint8ClampedArray',
  'Int16Array',
  'Uint16Array',
  'Int32Array',
  'Uint32Array',
  'Float32Array',
  'Float64Array',
  'BigInt64Array',
  'BigUint64Array',
]);

const MUTATING_GROWTH_METHODS = new Set(['push', 'unshift']);

const SUPERSCRIPTS: Record<number, string> = {
  2: '²',
  3: '³',
};

const DEFAULT_HOTSPOT_THRESHOLD = 30;
const MAX_IMPORT_DEPTH = 2;
const CONSTANT_LOOP_BOUND_LIMIT = 1000;

function formatPower(base: string, exponent: number): string {
  if (exponent <= 0) {
    return '1';
  }
  if (exponent === 1) {
    return base;
  }
  const sup = SUPERSCRIPTS[exponent];
  return sup ? `${base}${sup}` : `${base}^${exponent}`;
}

function formatBigON(depth: number): string {
  if (depth <= 0) {
    return 'O(1)';
  }
  return `O(${formatPower('n', depth)})`;
}

function formatLogPower(logPower: number): string {
  if (logPower <= 1) {
    return 'log n';
  }
  const sup = SUPERSCRIPTS[logPower];
  return sup ? `log${sup} n` : `log^${logPower} n`;
}

function formatSortBigO(loopDepth: number): string {
  if (loopDepth <= 0) {
    return 'O(n log n)';
  }
  if (loopDepth === 1) {
    return 'O(n * m log m)';
  }
  return `O(${formatPower('n', loopDepth)} * m log m)`;
}

function scoreForPolyLog(polyDegree: number, logPower: number): number {
  if (polyDegree <= 0) {
    if (logPower <= 0) {
      return 1;
    }
    return logPower === 1 ? 5 : 8;
  }
  const logBonus = logPower > 0 ? 5 : 0;
  if (polyDegree === 1) {
    return 10 + logBonus;
  }
  if (polyDegree === 2) {
    return 35 + logBonus;
  }
  if (polyDegree === 3) {
    return 60 + logBonus;
  }
  return 60 + (polyDegree - 3) * 20 + logBonus;
}

function scoreForSort(loopDepth: number): number {
  if (loopDepth <= 0) {
    return 15;
  }
  if (loopDepth === 1) {
    return 25;
  }
  return 35 + (loopDepth - 1) * 15;
}

export function formatTimeTerm(term: TimeTerm): string {
  if (term.kind === 'exp') {
    return 'O(2^n)';
  }
  if (term.kind === 'sort') {
    return formatSortBigO(term.polyDegree);
  }
  if (term.polyDegree <= 0 && term.logPower <= 0) {
    return 'O(1)';
  }
  if (term.polyDegree <= 0) {
    return `O(${formatLogPower(term.logPower)})`;
  }
  if (term.logPower <= 0) {
    return formatBigON(term.polyDegree);
  }
  return `O(${formatPower('n', term.polyDegree)} ${formatLogPower(term.logPower)})`;
}

function composeTimeTerm(
  calleeTerm: TimeTerm,
  callPolyDepth: number,
  callLogDepth: number
): TimeTerm {
  if (calleeTerm.kind === 'exp') {
    return { kind: 'exp', polyDegree: 0, logPower: 0, score: 100 };
  }
  const combinedPoly = calleeTerm.polyDegree + callPolyDepth;
  const combinedLog = calleeTerm.logPower + callLogDepth;
  if (calleeTerm.kind === 'sort') {
    return {
      kind: 'sort',
      polyDegree: combinedPoly,
      logPower: combinedLog,
      score: scoreForSort(combinedPoly),
    };
  }
  return {
    kind: 'poly',
    polyDegree: combinedPoly,
    logPower: combinedLog,
    score: scoreForPolyLog(combinedPoly, combinedLog),
  };
}

function getScriptKind(fileName: string): ts.ScriptKind {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.tsx')) {
    return ts.ScriptKind.TSX;
  }
  if (lower.endsWith('.jsx')) {
    return ts.ScriptKind.JSX;
  }
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function isFunctionNode(node: ts.Node): node is FunctionNode {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node)
  );
}

function isInlineArrayMethodCallback(node: FunctionNode): boolean {
  if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) {
    return false;
  }
  const parent = node.parent;
  if (!parent || !ts.isCallExpression(parent)) {
    return false;
  }
  if (!parent.arguments.includes(node)) {
    return false;
  }
  const expr = parent.expression;
  if (!ts.isPropertyAccessExpression(expr)) {
    return false;
  }
  const methodName = expr.name.text;
  return CALLBACK_ITERATION_METHODS.has(methodName) || methodName === 'sort';
}

function getEnclosingClass(node: ts.Node): ts.ClassLikeDeclaration | null {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isClassDeclaration(current) || ts.isClassExpression(current)) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

function getPropertyNameText(name: ts.PropertyName | undefined): string | null {
  if (!name) {
    return null;
  }
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  if (ts.isPrivateIdentifier(name)) {
    return name.text;
  }
  return null;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  if (!ts.canHaveModifiers(node)) {
    return false;
  }
  const modifiers = ts.getModifiers(node);
  return Boolean(modifiers?.some((m) => m.kind === kind));
}

function hasBigoIgnoreComment(
  sourceFile: ts.SourceFile,
  headerStartOffset: number
): boolean {
  const text = sourceFile.text;
  const lineStarts = sourceFile.getLineStarts();
  const lineIdx = sourceFile.getLineAndCharacterOfPosition(headerStartOffset).line;
  const startLineIdx = Math.max(0, lineIdx - 1);
  const sliceStart = lineStarts[startLineIdx] ?? 0;
  const sliceEnd =
    lineIdx + 1 < lineStarts.length ? lineStarts[lineIdx + 1] : text.length;
  const snippet = text.slice(sliceStart, sliceEnd);
  return /(\/\/|\/\*)\s*bigo-ignore\b/i.test(snippet);
}

interface FunctionIdentity {
  displayName: string;
  selfName: string | null;
  isClassMember: boolean;
  isExported: boolean;
  isDefaultExport: boolean;
  classNode: ts.ClassLikeDeclaration | null;
  kind: FunctionComplexity['kind'];
  headerStartOffset: number;
  headerEndOffset: number;
}

function resolveFunctionIdentity(
  node: FunctionNode,
  sourceFile: ts.SourceFile
): FunctionIdentity {
  const defaultHeaderStart = node.getStart(sourceFile);
  let headerEndOffset = node.body ? node.body.getStart(sourceFile) : node.getEnd();

  if (ts.isArrowFunction(node)) {
    headerEndOffset = node.equalsGreaterThanToken.getEnd();
  }

  if (ts.isFunctionDeclaration(node)) {
    const name = node.name?.text ?? '<anonymous>';
    const isExported = hasModifier(node, ts.SyntaxKind.ExportKeyword);
    const isDefaultExport =
      isExported && hasModifier(node, ts.SyntaxKind.DefaultKeyword);
    return {
      displayName: name,
      selfName: node.name?.text ?? null,
      isClassMember: false,
      isExported,
      isDefaultExport,
      classNode: null,
      kind: 'function',
      headerStartOffset: defaultHeaderStart,
      headerEndOffset,
    };
  }

  if (ts.isMethodDeclaration(node)) {
    const methodName = getPropertyNameText(node.name) ?? '<anonymous>';
    const classNode = getEnclosingClass(node);
    const className = classNode?.name?.text ?? null;
    const displayName = className ? `${className}.${methodName}` : methodName;
    return {
      displayName,
      selfName: getPropertyNameText(node.name),
      isClassMember: true,
      isExported: false,
      isDefaultExport: false,
      classNode,
      kind: 'method',
      headerStartOffset: defaultHeaderStart,
      headerEndOffset,
    };
  }

  const kind: FunctionComplexity['kind'] = ts.isArrowFunction(node)
    ? 'arrow'
    : 'functionExpression';

  const parent = node.parent;
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    const varName = parent.name.text;
    let headerStart = parent.getStart(sourceFile);
    let isExported = false;
    const varList = parent.parent;
    if (varList && ts.isVariableDeclarationList(varList)) {
      const varStmt = varList.parent;
      if (varStmt && ts.isVariableStatement(varStmt)) {
        isExported = hasModifier(varStmt, ts.SyntaxKind.ExportKeyword);
        if (varList.declarations.length === 1) {
          headerStart = varStmt.getStart(sourceFile);
        }
      }
    }
    return {
      displayName: varName,
      selfName: ts.isFunctionExpression(node) && node.name ? node.name.text : varName,
      isClassMember: false,
      isExported,
      isDefaultExport: false,
      classNode: null,
      kind,
      headerStartOffset: headerStart,
      headerEndOffset,
    };
  }

  if (parent && ts.isPropertyAssignment(parent)) {
    const propName = getPropertyNameText(parent.name);
    if (propName) {
      return {
        displayName: propName,
        selfName: ts.isFunctionExpression(node) && node.name ? node.name.text : propName,
        isClassMember: false,
        isExported: false,
        isDefaultExport: false,
        classNode: null,
        kind,
        headerStartOffset: parent.getStart(sourceFile),
        headerEndOffset,
      };
    }
  }

  if (parent && ts.isPropertyDeclaration(parent)) {
    const propName = getPropertyNameText(parent.name);
    if (propName) {
      const classNode = getEnclosingClass(parent);
      const className = classNode?.name?.text ?? null;
      return {
        displayName: className ? `${className}.${propName}` : propName,
        selfName: propName,
        isClassMember: true,
        isExported: false,
        isDefaultExport: false,
        classNode,
        kind,
        headerStartOffset: parent.getStart(sourceFile),
        headerEndOffset,
      };
    }
  }

  if (parent && ts.isExportAssignment(parent) && !parent.isExportEquals) {
    const fnName =
      ts.isFunctionExpression(node) && node.name ? node.name.text : 'default';
    return {
      displayName: fnName,
      selfName: ts.isFunctionExpression(node) && node.name ? node.name.text : null,
      isClassMember: false,
      isExported: true,
      isDefaultExport: true,
      classNode: null,
      kind,
      headerStartOffset: parent.getStart(sourceFile),
      headerEndOffset,
    };
  }

  if (ts.isFunctionExpression(node) && node.name) {
    return {
      displayName: node.name.text,
      selfName: node.name.text,
      isClassMember: false,
      isExported: false,
      isDefaultExport: false,
      classNode: null,
      kind,
      headerStartOffset: defaultHeaderStart,
      headerEndOffset,
    };
  }

  return {
    displayName: '<anonymous>',
    selfName: null,
    isClassMember: false,
    isExported: false,
    isDefaultExport: false,
    classNode: null,
    kind,
    headerStartOffset: defaultHeaderStart,
    headerEndOffset,
  };
}

function getNumericLiteralValue(expr: ts.Expression): number | null {
  if (ts.isNumericLiteral(expr)) {
    return Number(expr.text);
  }
  if (ts.isPrefixUnaryExpression(expr) && ts.isNumericLiteral(expr.operand)) {
    const val = Number(expr.operand.text);
    if (expr.operator === ts.SyntaxKind.MinusToken) {
      return -val;
    }
    if (expr.operator === ts.SyntaxKind.PlusToken) {
      return val;
    }
  }
  return null;
}

function isSimpleStepIncrementor(expr: ts.Expression): boolean {
  if (ts.isPostfixUnaryExpression(expr) || ts.isPrefixUnaryExpression(expr)) {
    return (
      expr.operator === ts.SyntaxKind.PlusPlusToken ||
      expr.operator === ts.SyntaxKind.MinusMinusToken
    );
  }
  if (ts.isBinaryExpression(expr)) {
    return (
      expr.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken ||
      expr.operatorToken.kind === ts.SyntaxKind.MinusEqualsToken
    );
  }
  return false;
}

function isConstantBoundedForLoop(node: ts.ForStatement): boolean {
  if (!node.initializer || !node.condition || !node.incrementor) {
    return false;
  }
  if (!isSimpleStepIncrementor(node.incrementor)) {
    return false;
  }

  let loopVarName: string | null = null;
  let initVal: number | null = null;

  if (ts.isVariableDeclarationList(node.initializer) && node.initializer.declarations.length === 1) {
    const decl = node.initializer.declarations[0];
    if (ts.isIdentifier(decl.name) && decl.initializer) {
      loopVarName = decl.name.text;
      initVal = getNumericLiteralValue(decl.initializer);
    }
  } else if (
    ts.isBinaryExpression(node.initializer) &&
    node.initializer.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isIdentifier(node.initializer.left)
  ) {
    loopVarName = node.initializer.left.text;
    initVal = getNumericLiteralValue(node.initializer.right);
  }

  if (loopVarName === null || initVal === null) {
    return false;
  }

  if (!ts.isBinaryExpression(node.condition)) {
    return false;
  }

  const op = node.condition.operatorToken.kind;
  const isBoundOp =
    op === ts.SyntaxKind.LessThanToken ||
    op === ts.SyntaxKind.LessThanEqualsToken ||
    op === ts.SyntaxKind.GreaterThanToken ||
    op === ts.SyntaxKind.GreaterThanEqualsToken;
  if (!isBoundOp) {
    return false;
  }

  let boundVal: number | null = null;
  if (ts.isIdentifier(node.condition.left) && node.condition.left.text === loopVarName) {
    boundVal = getNumericLiteralValue(node.condition.right);
  } else if (ts.isIdentifier(node.condition.right) && node.condition.right.text === loopVarName) {
    boundVal = getNumericLiteralValue(node.condition.left);
  }

  if (boundVal === null) {
    return false;
  }

  return Math.abs(boundVal - initVal) <= CONSTANT_LOOP_BOUND_LIMIT;
}

function containsLogarithmicOperator(node: ts.Node): boolean {
  let found = false;
  function scan(n: ts.Node): void {
    if (found) {
      return;
    }
    if (ts.isBinaryExpression(n)) {
      const k = n.operatorToken.kind;
      if (
        k === ts.SyntaxKind.AsteriskToken ||
        k === ts.SyntaxKind.SlashToken ||
        k === ts.SyntaxKind.GreaterThanGreaterThanToken ||
        k === ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken ||
        k === ts.SyntaxKind.LessThanLessThanToken
      ) {
        found = true;
        return;
      }
    }
    ts.forEachChild(n, scan);
  }
  scan(node);
  return found;
}

function isLogarithmicUpdateExpr(expr: ts.Expression): boolean {
  if (!ts.isBinaryExpression(expr)) {
    return false;
  }
  const op = expr.operatorToken.kind;
  if (
    op === ts.SyntaxKind.AsteriskEqualsToken ||
    op === ts.SyntaxKind.SlashEqualsToken ||
    op === ts.SyntaxKind.GreaterThanGreaterThanEqualsToken ||
    op === ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken ||
    op === ts.SyntaxKind.LessThanLessThanEqualsToken
  ) {
    return true;
  }
  if (op === ts.SyntaxKind.EqualsToken && ts.isIdentifier(expr.left)) {
    const varName = expr.left.text;
    let referencesSelf = false;
    const checkRef = (n: ts.Node) => {
      if (referencesSelf) {
        return;
      }
      if (ts.isIdentifier(n) && n.text === varName) {
        referencesSelf = true;
        return;
      }
      ts.forEachChild(n, checkRef);
    };
    checkRef(expr.right);
    if (referencesSelf && containsLogarithmicOperator(expr.right)) {
      return true;
    }
  }
  return false;
}

function isBinaryMidpointExpression(expr: ts.Expression): boolean {
  let found = false;
  function scan(n: ts.Node): void {
    if (found) {
      return;
    }
    if (ts.isBinaryExpression(n)) {
      const op = n.operatorToken.kind;
      const rightVal = getNumericLiteralValue(n.right);
      if (
        (op === ts.SyntaxKind.SlashToken && rightVal === 2) ||
        ((op === ts.SyntaxKind.GreaterThanGreaterThanToken ||
          op === ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken) &&
          rightVal === 1)
      ) {
        found = true;
        return;
      }
    }
    ts.forEachChild(n, scan);
  }
  scan(expr);
  return found;
}

function isLogarithmicForLoop(node: ts.ForStatement): boolean {
  if (!node.incrementor) {
    return false;
  }
  if (isLogarithmicUpdateExpr(node.incrementor)) {
    return true;
  }
  if (ts.isCommaListExpression(node.incrementor)) {
    return node.incrementor.elements.some((el) => isLogarithmicUpdateExpr(el));
  }
  return false;
}

function isLogarithmicWhileLoop(node: ts.WhileStatement | ts.DoStatement): boolean {
  let found = false;
  function scan(n: ts.Node): void {
    if (found) {
      return;
    }
    if (isFunctionNode(n) && !isInlineArrayMethodCallback(n)) {
      return;
    }
    if (ts.isExpression(n) && isLogarithmicUpdateExpr(n)) {
      found = true;
      return;
    }
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer &&
      isBinaryMidpointExpression(n.initializer)
    ) {
      found = true;
      return;
    }
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      isBinaryMidpointExpression(n.right)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(n, scan);
  }
  scan(node.statement);
  return found;
}

function containsReturnStatement(node: ts.Node): boolean {
  let hasReturn = false;
  function scan(n: ts.Node): void {
    if (hasReturn) {
      return;
    }
    if (isFunctionNode(n)) {
      return;
    }
    if (ts.isReturnStatement(n)) {
      hasReturn = true;
      return;
    }
    ts.forEachChild(n, scan);
  }
  scan(node);
  return hasReturn;
}

function isCacheLookupCondition(expr: ts.Expression): boolean {
  let found = false;
  function scan(n: ts.Node): void {
    if (found) {
      return;
    }
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === 'has'
    ) {
      found = true;
      return;
    }
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.InKeyword
    ) {
      found = true;
      return;
    }
    if (ts.isElementAccessExpression(n)) {
      found = true;
      return;
    }
    ts.forEachChild(n, scan);
  }
  scan(expr);
  return found;
}

function hasMemoizationPattern(body: ts.Node): boolean {
  let hasCacheReadReturn = false;
  let hasCacheWrite = false;

  function scan(n: ts.Node): void {
    if (hasCacheReadReturn && hasCacheWrite) {
      return;
    }
    if (isFunctionNode(n) && !isInlineArrayMethodCallback(n)) {
      return;
    }
    if (
      ts.isIfStatement(n) &&
      isCacheLookupCondition(n.expression) &&
      containsReturnStatement(n.thenStatement)
    ) {
      hasCacheReadReturn = true;
    }
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === 'set'
    ) {
      hasCacheWrite = true;
    }
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isElementAccessExpression(n.left)
    ) {
      hasCacheWrite = true;
    }
    ts.forEachChild(n, scan);
  }

  scan(body);
  return hasCacheReadReturn && hasCacheWrite;
}

function getLoopLabel(node: ts.Node): string | null {
  if (ts.isForStatement(node)) {
    return 'for loop';
  }
  if (ts.isForOfStatement(node)) {
    return 'for-of loop';
  }
  if (ts.isForInStatement(node)) {
    return 'for-in loop';
  }
  if (ts.isWhileStatement(node)) {
    return 'while loop';
  }
  if (ts.isDoStatement(node)) {
    return 'do-while loop';
  }
  return null;
}

function makeLocation(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  description: string
): BottleneckLocation {
  const startOffset = node.getStart(sourceFile);
  const endOffset = node.getEnd();
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(startOffset);
  return {
    line: line + 1,
    column: character + 1,
    startOffset,
    endOffset,
    description,
  };
}

function buildOptimizationTip(
  best: CandidateComplexity | null,
  isHotspot: boolean
): string | null {
  if (!isHotspot || !best) {
    return null;
  }

  switch (best.category) {
    case 'recursion-exp':
      return 'Use memoization (a cache/Map) or bottom-up dynamic programming to collapse overlapping subproblems from O(2^n) to O(n).';
    case 'array-lookup':
      return 'Pre-index lookups into a Set or Map outside the loop so repeated .includes() / .indexOf() / .find() calls drop from O(n) to O(1).';
    case 'sort':
      return 'Hoist .sort() outside the enclosing loop or sort once beforehand to avoid repeated O(m log m) sorting per iteration.';
    case 'loop':
      return 'Consider replacing nested iteration with a hash Map/Set lookup, pre-computed index, or two-pointer/sliding-window pass.';
    default:
      return 'Consider caching intermediate results or restructuring nested work to reduce asymptotic growth.';
  }
}

function pickBestCandidate(candidates: CandidateComplexity[]): CandidateComplexity | null {
  let best: CandidateComplexity | null = null;
  for (const candidate of candidates) {
    if (
      !best ||
      candidate.score > best.score ||
      (candidate.score === best.score && candidate.depth > best.depth)
    ) {
      best = candidate;
    }
  }
  return best;
}

function collectImportTable(sourceFile: ts.SourceFile): ImportTable {
  const namedOrDefault = new Map<string, ImportedBinding>();
  const namespaces = new Map<string, string>();

  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) {
      continue;
    }
    const specifier = stmt.moduleSpecifier.text;
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
      continue;
    }
    const clause = stmt.importClause;
    if (!clause) {
      continue;
    }
    if (clause.name) {
      namedOrDefault.set(clause.name.text, { specifier, importedName: 'default' });
    }
    if (clause.namedBindings) {
      if (ts.isNamespaceImport(clause.namedBindings)) {
        namespaces.set(clause.namedBindings.name.text, specifier);
      } else if (ts.isNamedImports(clause.namedBindings)) {
        for (const el of clause.namedBindings.elements) {
          const localName = el.name.text;
          const importedName = el.propertyName ? el.propertyName.text : localName;
          namedOrDefault.set(localName, { specifier, importedName });
        }
      }
    }
  }

  return { namedOrDefault, namespaces };
}

function analyzeFunctionLocal(
  fnNode: FunctionNode,
  id: number,
  parentFunctionId: number | null,
  sourceFile: ts.SourceFile,
  importTable: ImportTable
): LocalFunctionAnalysis {
  const identity = resolveFunctionIdentity(fnNode, sourceFile);
  const ignored = hasBigoIgnoreComment(sourceFile, identity.headerStartOffset);
  const startOffset = fnNode.getStart(sourceFile);
  const endOffset = fnNode.getEnd();
  const startPos = sourceFile.getLineAndCharacterOfPosition(identity.headerStartOffset);
  const endPos = sourceFile.getLineAndCharacterOfPosition(endOffset);

  const localCandidates: CandidateComplexity[] = [];
  const localReasons: string[] = [];
  const localReasonSet = new Set<string>();
  const callSites: CallSite[] = [];

  const addReason = (reason: string) => {
    if (!localReasonSet.has(reason)) {
      localReasonSet.add(reason);
      localReasons.push(reason);
    }
  };

  let maxPolyDepth = 0;
  let maxLogDepth = 0;
  let maxSpaceDepth = 0;
  const localSpaceReasons: string[] = [];
  const spaceReasonSet = new Set<string>();

  const recordSpace = (depth: number, reason: string) => {
    if (depth > maxSpaceDepth) {
      maxSpaceDepth = depth;
    }
    if (!spaceReasonSet.has(reason)) {
      spaceReasonSet.add(reason);
      localSpaceReasons.push(reason);
    }
  };

  let recursiveCallCount = 0;
  let recursiveInLoop = false;
  let firstRecursiveLoc: BottleneckLocation | null = null;

  function isSelfCall(callExpr: ts.CallExpression): boolean {
    if (!identity.selfName) {
      return false;
    }
    const target = callExpr.expression;
    if (!identity.isClassMember && ts.isIdentifier(target)) {
      return target.text === identity.selfName;
    }
    if (
      identity.isClassMember &&
      ts.isPropertyAccessExpression(target) &&
      target.expression.kind === ts.SyntaxKind.ThisKeyword &&
      target.name.text === identity.selfName
    ) {
      return true;
    }
    return false;
  }

  function formatContext(outerStack: string[]): string {
    if (outerStack.length === 0) {
      return '';
    }
    return ` inside ${outerStack[outerStack.length - 1]}`;
  }

  function visit(
    node: ts.Node,
    polyDepth: number,
    logDepth: number,
    outerStack: string[]
  ): void {
    if (node !== fnNode && isFunctionNode(node) && !isInlineArrayMethodCallback(node)) {
      return;
    }

    const loopLabel = getLoopLabel(node);
    if (loopLabel) {
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

      if (ts.isForStatement(node) && isConstantBoundedForLoop(node)) {
        const context = formatContext(outerStack);
        addReason(`Constant-bounded for loop${context} at line ${line} (O(1))`);
        ts.forEachChild(node, (child) => visit(child, polyDepth, logDepth, outerStack));
        return;
      }

      const isLogLoop =
        (ts.isForStatement(node) && isLogarithmicForLoop(node)) ||
        ((ts.isWhileStatement(node) || ts.isDoStatement(node)) &&
          isLogarithmicWhileLoop(node));

      if (isLogLoop) {
        const nextLogDepth = logDepth + 1;
        if (nextLogDepth > maxLogDepth) {
          maxLogDepth = nextLogDepth;
        }
        const term: TimeTerm = {
          kind: 'poly',
          polyDegree: polyDepth,
          logPower: nextLogDepth,
          score: scoreForPolyLog(polyDepth, nextLogDepth),
        };
        const context = formatContext(outerStack);
        const description = context
          ? `Logarithmic ${loopLabel}${context} at line ${line} (${formatTimeTerm(term)})`
          : `Logarithmic ${loopLabel} at line ${line} (${formatTimeTerm(term)})`;
        addReason(description);
        localCandidates.push({
          term,
          complexity: formatTimeTerm(term),
          score: term.score,
          depth: polyDepth + nextLogDepth,
          reason: description,
          location: makeLocation(node, sourceFile, description),
          category: 'loop',
        });

        const nextStack = [...outerStack, `logarithmic ${loopLabel}`];
        ts.forEachChild(node, (child) => visit(child, polyDepth, nextLogDepth, nextStack));
        return;
      }

      const nextPolyDepth = polyDepth + 1;
      if (nextPolyDepth > maxPolyDepth) {
        maxPolyDepth = nextPolyDepth;
      }
      const context = formatContext(outerStack);
      const description = context
        ? `Nested ${loopLabel}${context} at line ${line}`
        : `${loopLabel.charAt(0).toUpperCase() + loopLabel.slice(1)} at line ${line}`;

      const term: TimeTerm = {
        kind: 'poly',
        polyDegree: nextPolyDepth,
        logPower: logDepth,
        score: scoreForPolyLog(nextPolyDepth, logDepth),
      };
      addReason(description);
      localCandidates.push({
        term,
        complexity: formatTimeTerm(term),
        score: term.score,
        depth: nextPolyDepth + logDepth,
        reason: description,
        location: makeLocation(node, sourceFile, description),
        category: 'loop',
      });

      const nextStack = [...outerStack, loopLabel];
      ts.forEachChild(node, (child) => visit(child, nextPolyDepth, logDepth, nextStack));
      return;
    }

    if (ts.isCallExpression(node)) {
      if (isSelfCall(node)) {
        recursiveCallCount += 1;
        if (polyDepth >= 1 || logDepth >= 1) {
          recursiveInLoop = true;
        }
        if (!firstRecursiveLoc) {
          const line =
            sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
          firstRecursiveLoc = makeLocation(
            node,
            sourceFile,
            `Recursive call to ${identity.displayName}() at line ${line}`
          );
        }
      } else if (ts.isIdentifier(node.expression)) {
        const line =
          sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        callSites.push({
          calleeName: node.expression.text,
          namespaceName: null,
          isThisCall: false,
          polyDepth,
          logDepth,
          outerStack: [...outerStack],
          location: makeLocation(
            node,
            sourceFile,
            `Call to ${node.expression.text}() at line ${line}`
          ),
        });
      } else if (ts.isPropertyAccessExpression(node.expression)) {
        const exprObj = node.expression.expression;
        const propName = node.expression.name.text;
        const line =
          sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

        if (exprObj.kind === ts.SyntaxKind.ThisKeyword) {
          callSites.push({
            calleeName: propName,
            namespaceName: null,
            isThisCall: true,
            polyDepth,
            logDepth,
            outerStack: [...outerStack],
            location: makeLocation(
              node,
              sourceFile,
              `Call to this.${propName}() at line ${line}`
            ),
          });
        } else if (ts.isIdentifier(exprObj) && importTable.namespaces.has(exprObj.text)) {
          callSites.push({
            calleeName: propName,
            namespaceName: exprObj.text,
            isThisCall: false,
            polyDepth,
            logDepth,
            outerStack: [...outerStack],
            location: makeLocation(
              node,
              sourceFile,
              `Call to ${exprObj.text}.${propName}() at line ${line}`
            ),
          });
        }
      }

      if (ts.isPropertyAccessExpression(node.expression)) {
        const methodName = node.expression.name.text;
        const line =
          sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

        if (methodName === 'sort') {
          const term: TimeTerm = {
            kind: 'sort',
            polyDegree: polyDepth,
            logPower: logDepth,
            score: scoreForSort(polyDepth),
          };
          const sortComplexity = formatTimeTerm(term);
          const context = formatContext(outerStack);
          const description = context
            ? `.sort()${context} at line ${line} (${sortComplexity})`
            : `.sort() call at line ${line} (${sortComplexity})`;
          addReason(description);
          localCandidates.push({
            term,
            complexity: sortComplexity,
            score: term.score,
            depth: polyDepth + 1,
            reason: description,
            location: makeLocation(node, sourceFile, description),
            category: 'sort',
          });

          visit(node.expression, polyDepth, logDepth, outerStack);
          for (const arg of node.arguments) {
            if (isFunctionNode(arg) && arg.body) {
              visit(arg.body, polyDepth, logDepth, outerStack);
            } else {
              visit(arg, polyDepth, logDepth, outerStack);
            }
          }
          return;
        }

        if (CALLBACK_ITERATION_METHODS.has(methodName)) {
          const nextPolyDepth = polyDepth + 1;
          if (nextPolyDepth > maxPolyDepth) {
            maxPolyDepth = nextPolyDepth;
          }
          const context = formatContext(outerStack);
          const prefix = context ? 'Nested ' : '';
          const description = `${prefix}.${methodName}()${context} at line ${line}`;
          addReason(description);

          const isLookupLike =
            methodName === 'find' ||
            methodName === 'findIndex' ||
            methodName === 'some' ||
            methodName === 'every' ||
            methodName === 'filter';

          const term: TimeTerm = {
            kind: 'poly',
            polyDegree: nextPolyDepth,
            logPower: logDepth,
            score: scoreForPolyLog(nextPolyDepth, logDepth),
          };
          localCandidates.push({
            term,
            complexity: formatTimeTerm(term),
            score: term.score,
            depth: nextPolyDepth + logDepth,
            reason: description,
            location: makeLocation(node, sourceFile, description),
            category: polyDepth >= 1 && isLookupLike ? 'array-lookup' : 'loop',
          });

          if (ARRAY_ALLOCATING_METHODS.has(methodName)) {
            const allocDepth = polyDepth + 1;
            const allocDesc = context
              ? `.${methodName}() allocates a new array${context} at line ${line}`
              : `.${methodName}() allocates a new array at line ${line}`;
            recordSpace(allocDepth, allocDesc);
          }

          visit(node.expression, polyDepth, logDepth, outerStack);
          const nextStack = [...outerStack, `.${methodName}()`];
          for (const arg of node.arguments) {
            if (isFunctionNode(arg) && arg.body) {
              visit(arg.body, nextPolyDepth, logDepth, nextStack);
            } else {
              visit(arg, nextPolyDepth, logDepth, nextStack);
            }
          }
          return;
        }

        if (LINEAR_LOOKUP_METHODS.has(methodName)) {
          const nextPolyDepth = polyDepth + 1;
          if (nextPolyDepth > maxPolyDepth) {
            maxPolyDepth = nextPolyDepth;
          }
          const context = formatContext(outerStack);
          const prefix = context ? 'Nested ' : '';
          const description = `${prefix}.${methodName}() linear scan${context} at line ${line}`;
          addReason(description);
          const term: TimeTerm = {
            kind: 'poly',
            polyDegree: nextPolyDepth,
            logPower: logDepth,
            score: scoreForPolyLog(nextPolyDepth, logDepth),
          };
          localCandidates.push({
            term,
            complexity: formatTimeTerm(term),
            score: term.score,
            depth: nextPolyDepth + logDepth,
            reason: description,
            location: makeLocation(node, sourceFile, description),
            category: polyDepth >= 1 ? 'array-lookup' : 'loop',
          });
        } else if (ARRAY_ALLOCATING_METHODS.has(methodName)) {
          const allocDepth = polyDepth + 1;
          const context = formatContext(outerStack);
          recordSpace(
            allocDepth,
            `.${methodName}() allocates a new array${context} at line ${line}`
          );
        }

        if (MUTATING_GROWTH_METHODS.has(methodName) && polyDepth >= 1) {
          const context = formatContext(outerStack);
          recordSpace(
            polyDepth,
            `Array .${methodName}() growth${context} at line ${line}`
          );
        }

        if (ts.isIdentifier(node.expression.expression)) {
          const targetObj = node.expression.expression.text;
          if (
            (targetObj === 'Array' && methodName === 'from') ||
            (targetObj === 'Object' &&
              (methodName === 'keys' ||
                methodName === 'values' ||
                methodName === 'entries'))
          ) {
            const context = formatContext(outerStack);
            recordSpace(
              polyDepth + 1,
              `${targetObj}.${methodName}() allocation${context} at line ${line}`
            );
          }
        }
      }
    }

    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
      const ctorName = node.expression.text;
      if (ALLOCATING_CONSTRUCTORS.has(ctorName)) {
        const line =
          sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        const context = formatContext(outerStack);
        recordSpace(
          polyDepth + 1,
          `new ${ctorName}() allocation${context} at line ${line}`
        );
      }
    }

    if (ts.isArrayLiteralExpression(node)) {
      const hasSpread = node.elements.some((el) => ts.isSpreadElement(el));
      if (hasSpread) {
        const line =
          sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        const context = formatContext(outerStack);
        recordSpace(
          polyDepth + 1,
          `Array spread copy [... ]${context} at line ${line}`
        );
      }
    }

    ts.forEachChild(node, (child) => visit(child, polyDepth, logDepth, outerStack));
  }

  if (fnNode.body) {
    visit(fnNode.body, 0, 0, []);
  }

  const isMemoized =
    recursiveCallCount >= 1 && fnNode.body ? hasMemoizationPattern(fnNode.body) : false;

  if (
    (recursiveCallCount >= 2 || (recursiveCallCount >= 1 && recursiveInLoop)) &&
    !isMemoized
  ) {
    const loc =
      firstRecursiveLoc ??
      makeLocation(
        fnNode,
        sourceFile,
        `Exponential recursion in ${identity.displayName}()`
      );
    const reason = recursiveInLoop
      ? `Recursive call to ${identity.displayName}() inside a loop at line ${loc.line}`
      : `Multiple recursive calls (${recursiveCallCount}) to ${identity.displayName}() causing exponential branching at line ${loc.line}`;
    addReason(reason);
    localCandidates.push({
      term: { kind: 'exp', polyDegree: 0, logPower: 0, score: 100 },
      complexity: 'O(2^n)',
      score: 100,
      depth: maxPolyDepth + 2,
      reason,
      location: { ...loc, description: reason },
      category: 'recursion-exp',
    });
    recordSpace(
      Math.max(1, maxPolyDepth),
      `Recursive call stack depth in ${identity.displayName}() at line ${loc.line}`
    );
  } else if (recursiveCallCount >= 1) {
    const loc =
      firstRecursiveLoc ??
      makeLocation(fnNode, sourceFile, `Linear recursion in ${identity.displayName}()`);
    const effectiveDepth = maxPolyDepth + 1;
    const term: TimeTerm = {
      kind: 'poly',
      polyDegree: effectiveDepth,
      logPower: maxLogDepth,
      score: scoreForPolyLog(effectiveDepth, maxLogDepth),
    };
    const reason = isMemoized
      ? `Memoized recursion in ${identity.displayName}() at line ${loc.line} — reduced from O(2^n) to ${formatTimeTerm(term)}`
      : maxPolyDepth === 0
        ? `Linear recursion calling ${identity.displayName}() at line ${loc.line}`
        : `Recursive call to ${identity.displayName}() combined with loop depth ${maxPolyDepth} at line ${loc.line}`;
    addReason(reason);
    localCandidates.push({
      term,
      complexity: formatTimeTerm(term),
      score: term.score,
      depth: effectiveDepth + maxLogDepth,
      reason,
      location: { ...loc, description: reason },
      category: effectiveDepth >= 2 ? 'loop' : 'recursion-linear',
    });
    recordSpace(
      Math.max(1, maxPolyDepth),
      `Recursive call stack depth in ${identity.displayName}() at line ${loc.line}`
    );
  }

  const selfBest = pickBestCandidate(localCandidates);
  const selfTimeTerm: TimeTerm = selfBest
    ? selfBest.term
    : { kind: 'poly', polyDegree: 0, logPower: 0, score: 1 };

  return {
    id,
    parentFunctionId,
    classNode: identity.classNode,
    selfName: identity.selfName,
    isClassMember: identity.isClassMember,
    isExported: identity.isExported,
    isDefaultExport: identity.isDefaultExport,
    displayName: identity.displayName,
    kind: identity.kind,
    ignored,
    startOffset,
    endOffset,
    headerStartOffset: identity.headerStartOffset,
    headerEndOffset: identity.headerEndOffset,
    startLine: startPos.line + 1,
    endLine: endPos.line + 1,
    selfTimeTerm,
    selfTimeComplexity: formatTimeTerm(selfTimeTerm),
    selfSpaceDepth: maxSpaceDepth,
    selfSpaceComplexity: formatBigON(maxSpaceDepth),
    localCandidates,
    localReasons,
    localSpaceReasons,
    callSites,
  };
}

function collectExportedRebindings(
  sourceFile: ts.SourceFile,
  locals: LocalFunctionAnalysis[]
): { namedExports: Map<string, number>; defaultExportId: number | null } {
  const namedExports = new Map<string, number>();
  let defaultExportId: number | null = null;

  for (const fn of locals) {
    if (fn.parentFunctionId !== null || fn.isClassMember) {
      continue;
    }
    if (fn.isDefaultExport) {
      defaultExportId = fn.id;
    }
    if (fn.isExported && fn.selfName && !fn.isDefaultExport) {
      namedExports.set(fn.selfName, fn.id);
    }
  }

  for (const stmt of sourceFile.statements) {
    if (ts.isExportDeclaration(stmt) && !stmt.moduleSpecifier && stmt.exportClause) {
      if (ts.isNamedExports(stmt.exportClause)) {
        for (const el of stmt.exportClause.elements) {
          const localName = el.propertyName ? el.propertyName.text : el.name.text;
          const exportedName = el.name.text;
          const match = locals.find(
            (fn) => fn.parentFunctionId === null && !fn.isClassMember && fn.selfName === localName
          );
          if (match) {
            namedExports.set(exportedName, match.id);
          }
        }
      }
    } else if (
      ts.isExportAssignment(stmt) &&
      !stmt.isExportEquals &&
      ts.isIdentifier(stmt.expression)
    ) {
      const targetName = stmt.expression.text;
      const match = locals.find(
        (fn) => fn.parentFunctionId === null && !fn.isClassMember && fn.selfName === targetName
      );
      if (match) {
        defaultExportId = match.id;
      }
    }
  }

  return { namedExports, defaultExportId };
}

function analyzeModule(
  sourceText: string,
  fileName: string,
  options: AnalyzeOptions,
  importDepth: number,
  visitedFiles: Set<string>
): AnalyzedModule {
  const hotspotThreshold = options.hotspotThreshold ?? DEFAULT_HOTSPOT_THRESHOLD;
  const scriptKind = getScriptKind(fileName);
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind
  );

  const importTable = collectImportTable(sourceFile);
  const importedModules = new Map<string, AnalyzedModule | null>();

  function getImportedModule(specifier: string): AnalyzedModule | null {
    if (importedModules.has(specifier)) {
      return importedModules.get(specifier) ?? null;
    }
    if (!options.resolveImport || importDepth >= MAX_IMPORT_DEPTH) {
      importedModules.set(specifier, null);
      return null;
    }
    const target = options.resolveImport(specifier, fileName);
    if (!target || visitedFiles.has(target.fileName)) {
      importedModules.set(specifier, null);
      return null;
    }
    const nextVisited = new Set(visitedFiles);
    nextVisited.add(target.fileName);
    const mod = analyzeModule(
      target.sourceText,
      target.fileName,
      options,
      importDepth + 1,
      nextVisited
    );
    importedModules.set(specifier, mod);
    return mod;
  }

  // Pass 1: Collect functions and compute local complexity + call sites
  const localAnalyses: LocalFunctionAnalysis[] = [];
  const byId = new Map<number, LocalFunctionAnalysis>();

  function collectFunctions(node: ts.Node, parentFunctionId: number | null): void {
    let nextParentId = parentFunctionId;
    if (isFunctionNode(node) && !isInlineArrayMethodCallback(node)) {
      const id = localAnalyses.length;
      const analysis = analyzeFunctionLocal(
        node,
        id,
        parentFunctionId,
        sourceFile,
        importTable
      );
      localAnalyses.push(analysis);
      byId.set(id, analysis);
      nextParentId = id;
    }
    ts.forEachChild(node, (child) => collectFunctions(child, nextParentId));
  }

  collectFunctions(sourceFile, null);

  function resolveLocalCallee(
    caller: LocalFunctionAnalysis,
    call: CallSite
  ): LocalFunctionAnalysis | null {
    if (call.namespaceName) {
      return null;
    }
    if (call.isThisCall) {
      if (!caller.classNode) {
        return null;
      }
      return (
        localAnalyses.find(
          (fn) =>
            fn.id !== caller.id &&
            fn.isClassMember &&
            fn.classNode === caller.classNode &&
            fn.selfName === call.calleeName
        ) ?? null
      );
    }

    let scopeId: number | null = caller.id;
    while (true) {
      const match = localAnalyses.find(
        (fn) =>
          fn.id !== caller.id &&
          !fn.isClassMember &&
          fn.parentFunctionId === scopeId &&
          fn.selfName === call.calleeName
      );
      if (match) {
        return match;
      }
      if (scopeId === null) {
        break;
      }
      const scopeFn = byId.get(scopeId);
      scopeId = scopeFn ? scopeFn.parentFunctionId : null;
    }

    return null;
  }

  function resolveImportedCallee(
    call: CallSite
  ): { specifier: string; name: string; summary: ResolvedSummary } | null {
    if (call.isThisCall) {
      return null;
    }

    let binding: ImportedBinding | undefined;
    if (call.namespaceName) {
      const spec = importTable.namespaces.get(call.namespaceName);
      if (spec) {
        binding = { specifier: spec, importedName: call.calleeName };
      }
    } else {
      binding = importTable.namedOrDefault.get(call.calleeName);
    }

    if (!binding) {
      return null;
    }

    const mod = getImportedModule(binding.specifier);
    if (!mod) {
      return null;
    }

    const targetId =
      binding.importedName === 'default'
        ? mod.defaultExportId
        : mod.namedExports.get(binding.importedName);
    if (targetId === undefined || targetId === null) {
      return null;
    }

    const summary = mod.summaries[targetId];
    if (!summary) {
      return null;
    }

    return {
      specifier: binding.specifier,
      name: summary.result.name,
      summary,
    };
  }

  // Pass 2: Propagate callee complexities bottom-up with cycle guard
  const resolved = new Map<number, ResolvedSummary>();
  const visiting = new Set<number>();

  function resolveFunction(fnId: number): ResolvedSummary {
    const cached = resolved.get(fnId);
    if (cached) {
      return cached;
    }

    const fn = byId.get(fnId)!;
    visiting.add(fnId);

    const candidates: CandidateComplexity[] = [...fn.localCandidates];
    const reasons: string[] = [];
    const reasonSet = new Set<string>();
    const addReason = (r: string) => {
      if (!reasonSet.has(r)) {
        reasonSet.add(r);
        reasons.push(r);
      }
    };

    for (const r of fn.localReasons) {
      addReason(r);
    }

    let maxSpaceDepth = fn.selfSpaceDepth;
    const spaceReasons: string[] = [...fn.localSpaceReasons];
    const spaceReasonSet = new Set<string>(fn.localSpaceReasons);
    const addSpaceReason = (sr: string) => {
      if (!spaceReasonSet.has(sr)) {
        spaceReasonSet.add(sr);
        spaceReasons.push(sr);
      }
    };

    for (const call of fn.callSites) {
      const outerContext =
        call.outerStack.length > 0
          ? ` inside ${call.outerStack[call.outerStack.length - 1]}`
          : '';

      const localCallee = resolveLocalCallee(fn, call);
      if (localCallee) {
        if (visiting.has(localCallee.id)) {
          const effectivePoly = 1 + call.polyDepth;
          const term: TimeTerm = {
            kind: 'poly',
            polyDegree: effectivePoly,
            logPower: call.logDepth,
            score: scoreForPolyLog(effectivePoly, call.logDepth),
          };
          const composedStr = formatTimeTerm(term);
          const reason = `Mutual recursion calling ${localCallee.displayName}()${outerContext} at line ${call.location.line} → ${composedStr}`;
          addReason(reason);
          candidates.push({
            term,
            complexity: composedStr,
            score: term.score,
            depth: effectivePoly + call.logDepth,
            reason,
            location: { ...call.location, description: reason },
            category: effectivePoly >= 2 ? 'loop' : 'recursion-linear',
          });
          const stackDepth = Math.max(1, call.polyDepth);
          if (stackDepth > maxSpaceDepth) {
            maxSpaceDepth = stackDepth;
          }
          addSpaceReason(
            `Mutual recursion call stack with ${localCallee.displayName}() at line ${call.location.line}`
          );
          continue;
        }

        const calleeSummary = resolveFunction(localCallee.id);

        if (calleeSummary.timeTerm.score > 1) {
          const composed = composeTimeTerm(
            calleeSummary.timeTerm,
            call.polyDepth,
            call.logDepth
          );
          const calleeTimeStr = formatTimeTerm(calleeSummary.timeTerm);
          const composedStr = formatTimeTerm(composed);
          const reason = `Calls ${localCallee.displayName}() (${calleeTimeStr})${outerContext} at line ${call.location.line} → ${composedStr}`;
          addReason(reason);
          candidates.push({
            term: composed,
            complexity: composedStr,
            score: composed.score,
            depth: composed.polyDegree + composed.logPower + (composed.kind === 'sort' ? 1 : 0),
            reason,
            location: { ...call.location, description: reason },
            category:
              composed.kind === 'exp'
                ? 'recursion-exp'
                : composed.kind === 'sort'
                  ? 'sort'
                  : 'loop',
          });
        }

        if (calleeSummary.spaceDepth > 0) {
          if (calleeSummary.spaceDepth > maxSpaceDepth) {
            maxSpaceDepth = calleeSummary.spaceDepth;
          }
          addSpaceReason(
            `Calls ${localCallee.displayName}() (${formatBigON(calleeSummary.spaceDepth)} space) at line ${call.location.line}`
          );
        }
        continue;
      }

      const importedCallee = resolveImportedCallee(call);
      if (importedCallee) {
        const { specifier, name: importedDisplayName, summary: calleeSummary } =
          importedCallee;

        if (calleeSummary.timeTerm.score > 1) {
          const composed = composeTimeTerm(
            calleeSummary.timeTerm,
            call.polyDepth,
            call.logDepth
          );
          const calleeTimeStr = formatTimeTerm(calleeSummary.timeTerm);
          const composedStr = formatTimeTerm(composed);
          const reason = `Calls imported ${importedDisplayName}() from '${specifier}' (${calleeTimeStr})${outerContext} at line ${call.location.line} → ${composedStr}`;
          addReason(reason);
          candidates.push({
            term: composed,
            complexity: composedStr,
            score: composed.score,
            depth: composed.polyDegree + composed.logPower + (composed.kind === 'sort' ? 1 : 0),
            reason,
            location: { ...call.location, description: reason },
            category:
              composed.kind === 'exp'
                ? 'recursion-exp'
                : composed.kind === 'sort'
                  ? 'sort'
                  : 'loop',
          });
        }

        if (calleeSummary.spaceDepth > 0) {
          if (calleeSummary.spaceDepth > maxSpaceDepth) {
            maxSpaceDepth = calleeSummary.spaceDepth;
          }
          addSpaceReason(
            `Calls imported ${importedDisplayName}() from '${specifier}' (${formatBigON(calleeSummary.spaceDepth)} space) at line ${call.location.line}`
          );
        }
      }
    }

    visiting.delete(fnId);

    const best = pickBestCandidate(candidates);
    const finalTimeTerm: TimeTerm = best
      ? best.term
      : { kind: 'poly', polyDegree: 0, logPower: 0, score: 1 };
    const timeComplexity = formatTimeTerm(finalTimeTerm);
    const bottleneckScore = best ? best.score : 1;
    const spaceComplexity = formatBigON(maxSpaceDepth);

    for (const sr of spaceReasons) {
      addReason(`Space: ${sr}`);
    }

    if (reasons.length === 0) {
      reasons.push('Constant-time operations with no loops, recursion, or dynamic allocations.');
    }

    const isHotspot = !fn.ignored && bottleneckScore >= hotspotThreshold;

    const result: FunctionComplexity = {
      name: fn.displayName,
      kind: fn.kind,
      startOffset: fn.startOffset,
      endOffset: fn.endOffset,
      headerStartOffset: fn.headerStartOffset,
      headerEndOffset: fn.headerEndOffset,
      startLine: fn.startLine,
      endLine: fn.endLine,
      timeComplexity,
      spaceComplexity,
      selfTimeComplexity: fn.selfTimeComplexity,
      selfSpaceComplexity: fn.selfSpaceComplexity,
      bottleneckScore,
      isHotspot,
      ignored: fn.ignored,
      reasons,
      bottleneckLocation: best ? best.location : null,
      optimizationTip: buildOptimizationTip(best, isHotspot),
    };

    const summary: ResolvedSummary = {
      timeTerm: finalTimeTerm,
      spaceDepth: maxSpaceDepth,
      result,
    };
    resolved.set(fnId, summary);
    return summary;
  }

  const summaries = localAnalyses.map((fn) => resolveFunction(fn.id));
  const { namedExports, defaultExportId } = collectExportedRebindings(
    sourceFile,
    localAnalyses
  );

  return {
    functions: summaries.map((s) => s.result),
    summaries,
    locals: localAnalyses,
    namedExports,
    defaultExportId,
  };
}

export function analyzeCode(
  sourceText: string,
  fileName = 'file.ts',
  options: AnalyzeOptions = {}
): FunctionComplexity[] {
  const visitedFiles = new Set<string>([fileName]);
  return analyzeModule(sourceText, fileName, options, 0, visitedFiles).functions;
}
