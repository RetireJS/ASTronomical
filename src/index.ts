import { FunctionCall, parse, QNode } from "./parseQuery";
import { parseScript } from "meriyah";
import { isNodePath, VISITOR_KEYS, isAssignmentExpression, isBinding, isExportSpecifier, isFunctionDeclaration, isFunctionExpression, isIdentifier, isMemberExpression, isNode, isPrimitive, isScopable, isScope, isUpdateExpression, isVariableDeclaration, isVariableDeclarator } from "./nodeutils";
import { ESTree } from "meriyah";
import { isDefined, toArray } from "./utils";


const debugLogEnabled = false;
const log = {
  debug: debugLogEnabled ? (...args: unknown[]) => {
    if (debugLogEnabled) console.debug(...args);
  } : () => {}
};

export const functions = {
  "join": {
    fn: (result: Result[][]): Result[] =>{
      if (result.length != 2) throw new Error("Invalid number of arugments for join");
      const [values, separators] = result;
      if (separators.length != 1) throw new Error("Invalid number of separators for join");
      const separator = separators[0];
      if (typeof separator != "string") throw new Error("Separator must be a string");
      if (values.length == 0) return [];
      return [values.join(separator as string)];
    }
  },
  "concat": {
    fn: (result: Result[][]): Result[] => {
      if (result.some(x => x.length == 0)) return [];
      return [result.flat().join("")];
    }
  },
  "first": {
    fn: (result: Result[][]): Result[] => {
      if (result.length != 1) throw new Error("Invalid number of arugments for first");
      if (result[0].length == 0) return [];
      return [result.map(r => r[0])[0]];
    }
  },
  "nthchild" : {
    fn: (result: Result[][]): Result[] => {
      if (result.length != 2) throw new Error("Invalid number of arguments for nthchild");
      if (result[1].length != 1) throw new Error("Invalid number of arguments for nthchild");
      const x = result[1][0];
      const number = typeof x == "number" ? x : parseInt(x as string);
      return [result[0][number]];
    }
  }

}
const functionNames = new Set(Object.keys(functions));
export type AvailableFunction = keyof typeof functions;
export function isAvailableFunction(name: string) : name is AvailableFunction {
  return functionNames.has(name);
}


export type PrimitiveValue = string | number | boolean;

type Result = ASTNode | PrimitiveValue;


type FNode = {
  node: QNode, 
  result: Array<Result>
};

type State = {
  depth: number;
  child: FNode[][];
  descendant: FNode[][];
  filters: FilterResult[][];
  filtersMap: Array<Map<QNode, FilterResult[]>>;
  matches: [FNode, NodePath][][];
  functionCalls: FunctionCallResult[][];
}
type FilterCondition = {
  type: "and" | "or" | "equals";
  left: FilterNode;
  right: FilterNode;
}
type FilterNode = (FilterCondition | FNode);

type FilterResult = {
  qNode: QNode;
  filter: FilterNode;
  node: ASTNode;
  result: Array<Result>;
}
type FunctionCallResult = {
  node: QNode;
  functionCall: FunctionCall;
  parameters: (FNode | FunctionCallResult)[];
  result: Array<Result>;
}

function breadCrumb(path: NodePath) {
  if (!debugLogEnabled) return "";
  return { //Using the toString trick here to avoid calculating the breadcrumb if debug logging is off
    valueOf() : string {
      if (path.parentPath == undefined) return "@" + path.node.type;
      return breadCrumb(path.parentPath) + "." + (path.parentKey == path.key ? path.key : path.parentKey + "[" + path.key + "]") + "@" + path.node.type;
    }
  }
}

function createQuerier() {

  const traverser = createTraverser();
  const { getChildren, getPrimitiveChildren, getPrimitiveChildrenOrNodePaths, getBinding, createNodePath, traverse } = traverser;

  function createFilter(filter: QNode, filterResult: Array<Result>) : FilterNode {
    if (filter.type == "and" || filter.type == "or" || filter.type == "equals") {
      return {
        type: filter.type,
        left: createFilter(filter.left, []),
        right: createFilter(filter.right, [])
      };
    } else if (filter.type == "literal") {
      const r = [ filter.value ];
      return {
        node: filter,
        result: r
      };
    }
    return createFNode(filter, filterResult);
  }

  function createFNode(token: QNode, result: Array<Result>) : FNode {
    return {
      node: token,
      result: result
    };
  }

  function addFilterChildrenToState(filter: FilterNode, state: State) {
    if ("type" in filter && (filter.type == "and" || filter.type == "or" || filter.type == "equals")) {
      addFilterChildrenToState(filter.left, state);
      addFilterChildrenToState(filter.right, state);
    } else if ("node" in filter) {
      if (filter.node.type == "child") {
        log.debug("ADDING FILTER CHILD", filter.node);
        state.child[state.depth+1].push(filter);
      }
      if (filter.node.type == "descendant") {
        log.debug("ADDING FILTER DESCENDANT", filter.node);
        state.descendant[state.depth+1].push(filter);
      }
    }
  }

  function createFNodeAndAddToState(token: QNode, result: Array<Result>, state: State) : FNode {
    log.debug("ADDING FNODE", token);
    const fnode = createFNode(token, result);
    if (token.type == "child") {
      state.child[state.depth+1].push(fnode);
    } else if (token.type == "descendant") {
      state.descendant[state.depth+1].push(fnode);
    }
    return fnode;
  }

  function isMatch(fnode: FNode, path: NodePath) : boolean {
    if (fnode.node.attribute) {
      const m = fnode.node.value == path.parentKey || fnode.node.value == path.key
      if (m) log.debug("ATTR MATCH", fnode.node.value, breadCrumb(path));
      return m;
    }
    if (fnode.node.value == "*") {
      return true;
    }
    const m = fnode.node.value == path.node.type
    if (m) log.debug("NODE MATCH", fnode.node.value, breadCrumb(path));
    return m;
  }

  function addIfTokenMatch(fnode: FNode, path: NodePath, state: State) {
    if (!isMatch(fnode, path)) return;
    state.matches[state.depth].push([fnode, path]);
    if (fnode.node.filter) {
      const filter = createFilter(fnode.node.filter, []);
      const filteredResult: Array<Result> = [];
      const f = { filter: filter, qNode: fnode.node, node: path.node, result: filteredResult };
      state.filters[state.depth].push(f);
      let fmap = state.filtersMap[state.depth].get(fnode.node);
      if (!fmap) {
        fmap = [];
        state.filtersMap[state.depth].set(fnode.node, fmap);
      }
      fmap.push(f);
      addFilterChildrenToState(filter, state);
      const child = fnode.node.child;
      if (child) {
        if (child.type == "function") {
          const fr = addFunction(fnode, child, path, state);
          state.functionCalls[state.depth].push(fr);
        } else {
          createFNodeAndAddToState(child, filteredResult, state); 
        }
      }
    } else {
      const child = fnode.node.child;
      if (child?.type == "function") {
        const fr = addFunction(fnode, child, path, state);
        state.functionCalls[state.depth].push(fr);
      } else if (child && !fnode.node.binding && !fnode.node.resolve) {
        createFNodeAndAddToState(child, fnode.result, state); 
      }  
    }
  }

  function addFunction(rootNode: FNode, functionCall: FunctionCall, path: NodePath, state: State): FunctionCallResult {
    const functionNode: FunctionCallResult = { node: rootNode.node, functionCall: functionCall, parameters: [], result: [] };
    for (const param of functionCall.parameters) {
      if (param.type == "literal") {
        functionNode.parameters.push({ node: param, result: [param.value] });
      } else {
        if (param.type == "function") {
          functionNode.parameters.push(addFunction(functionNode, param, path, state));
        } else {
          functionNode.parameters.push(createFNodeAndAddToState(param, [], state));
        }
      }
    }
    return functionNode;
  }


  function addPrimitiveAttributeIfMatch(fnode: FNode, path: NodePath) {
    if (!fnode.node.attribute || fnode.node.value == undefined) return;
    if (fnode.node.child || fnode.node.filter) return;
    if (!Object.hasOwn(path.node, fnode.node.value)) return;
    const nodes = getPrimitiveChildren(fnode.node.value, path);
    if (nodes.length == 0) return;
    log.debug("PRIMITIVE", fnode.node.value, nodes);
    fnode.result.push(...nodes);
  }

  function evaluateFilter(filter: FilterNode, path: NodePath) : Result[] {
    log.debug("EVALUATING FILTER", filter, breadCrumb(path));
    if ("type" in filter) {
      if (filter.type == "and") {
        const left = evaluateFilter(filter.left, path);
        if (left.length == 0) {
          return [];
        }
        const r = evaluateFilter(filter.right, path);
        return r;
      }
      if (filter.type == "or") {
        const left = evaluateFilter(filter.left, path);
        if (left.length > 0) {
          return left;
        }
        const r = evaluateFilter(filter.right, path);
        return r;
      }
      if (filter.type == "equals") {
        const left = evaluateFilter(filter.left, path);
        const right = evaluateFilter(filter.right, path);
        const r = left.filter(x => right.includes(x));
        return r;
      }
      throw new Error("Unknown filter type: " + filter.type);
    }
    if (filter.node.type == "parent") {
      const r = resolveFilterWithParent(filter.node, path);
      return r;
    }
    return filter.result;
  }


  function resolveBinding(path: NodePath) : NodePath | undefined {
    if (!isIdentifier(path.node)) return undefined;
    log.debug("RESOLVING BINDING FOR ", path.node);
    const name = path.node.name;
    if (name == undefined || typeof name != "string") return undefined;
    //const binding = path.scope.getBinding(name);
    const binding = getBinding(path.scopeId, name);
    if (!binding) return undefined;
    log.debug("THIS IS THE BINDING", binding);
    return binding.path;
  }

  function resolveFilterWithParent(node: QNode, path: NodePath) : Result[] {
    let startNode: QNode = node;
    let startPath = path;
    while(startNode.type == "parent") {
      if (!startNode.child) throw new Error("Parent filter must have child");
      if (!startPath.parentPath) return [];
      log.debug("STEP OUT", startNode, breadCrumb(startPath));
      startNode = startNode.child;
      startPath = startPath.parentPath;
    }
    return resolveDirectly(startNode, startPath);
  }
  
  function isDefined<T>(value: T | undefined | null) : value is T {
    return value != undefined && value != null;
  }
  let subQueryCounter = 0;
  
  const memo = new Map<QNode, Map<NodePath | PrimitiveValue, Result[]>>();

  function resolveDirectly(node: QNode, path: NodePath) : Result[] {
    let startNode: QNode = node;
    const startPath = path;
    let paths: Array<PrimitiveValue | NodePath> = [startPath];
    while(startNode.attribute && startNode.type == "child") {
      const lookup = startNode.value;
      if (!lookup) throw new Error("Selector must have a value");
      //log.debug("STEP IN ", lookup, paths.map(p => breadCrumb(p)));
      const nodes = paths.filter(isNodePath).map(n => getPrimitiveChildrenOrNodePaths(lookup, n)).flat();
      //log.debug("LOOKUP", lookup, path.node.type, nodes.map(n => n.node));
      //console.log(nodes);
      if (nodes.length == 0) return [];
      paths = nodes;
      if (startNode.resolve) {
        const resolved = paths.filter(isNodePath).map(p => resolveBinding(p)).filter(isDefined).map(p => getChildren("init", p)).flat();
        if (resolved.length > 0) paths = resolved;
      } else if (startNode.binding) {
        paths = paths.filter(isNodePath).map(p => resolveBinding(p)).filter(isDefined);
      }
      const filter = startNode.filter;
      if (filter) {
        paths = paths.filter(isNodePath).filter(p => travHandle({subquery: filter}, p).subquery.length > 0);
      }
      if (!startNode.child) {
        return paths.map(p => isPrimitive(p) ? p : p.node);
      }
      startNode = startNode.child;
    }
    //log.debug("DIRECT TRAV RESOLVE", startNode, paths.map(p => breadCrumb(p)));
    const result = [];
    //console.log(paths.length, subQueryCounter);
    for (const path of paths) {
      if (isNodePath(path)) {
        if (memo.has(startNode) && memo.get(startNode)!.has(path)) {
          result.push(...memo.get(startNode)!.get(path)!);
        } else {
          const subQueryKey = "subquery-" + subQueryCounter++;
          const subQueryResult = travHandle({ [subQueryKey]: startNode }, path)[subQueryKey];
          if (!memo.has(startNode)) memo.set(startNode, new Map());
          memo.get(startNode)?.set(path, subQueryResult);
          result.push(...subQueryResult);  
        }
      }
    }
    log.debug("DIRECT TRAV RESOLVE RESULT", result);
    return result;
  }

  function addResultIfTokenMatch(fnode: FNode, path: NodePath, state: State) {
    const matchingFilters = [];
    //console.log("FILTERS", state.filters[state.depth].length, state.filtersMap[state.depth].get(fnode.node)?.length);
    const filters = [];
    const nodeFilters = state.filtersMap[state.depth].get(fnode.node);
    if (nodeFilters) {
      for (const f of nodeFilters) {
        if (f.qNode !== fnode.node) continue;
        if (f.node !== path.node) continue;
        filters.push(f);
      }
      
      for (const f of filters) {
        if (evaluateFilter(f.filter, path).length > 0) {
          matchingFilters.push(f);
        }
      }
      if (filters.length > 0 && matchingFilters.length == 0) return;
    }

    if (fnode.node.resolve) {
      const binding = resolveBinding(path);
      const resolved = binding ? getChildren("init", binding)[0] : undefined;

      if (fnode.node.child) {
        const result = resolveDirectly(fnode.node.child, resolved ?? path);
        fnode.result.push(...result);
      } else {
        fnode.result.push(path.node);
      }
    } else if (fnode.node.binding) {
      const binding = resolveBinding(path);
      if (binding) {
        if (fnode.node.child) {
          const result = resolveDirectly(fnode.node.child, binding);
          fnode.result.push(...result);
        } else {
          fnode.result.push(binding.node);
        }
      } 
    } else if (!fnode.node.child) {
      fnode.result.push(path.node);
    } else if (fnode.node.child.type == "function") {
      const functionCallResult = state.functionCalls[state.depth].find(f => f.node == fnode.node);
      if (!functionCallResult) throw new Error("Did not find expected function call for " + fnode.node.child.function);
      resolveFunctionCalls(fnode, functionCallResult, path, state);
    } else if (matchingFilters.length > 0) {
      log.debug("HAS MATCHING FILTER", fnode.result.length, matchingFilters.length, breadCrumb(path));
      fnode.result.push(...matchingFilters.flatMap(f => f.result));
    } 
  }

  function resolveFunctionCalls(fnode: FNode, functionCallResult: FunctionCallResult, path: NodePath, state: State) {
    const parameterResults: Result[][] = [];
    for (const p of functionCallResult.parameters) {
      if ("parameters" in p) {
        resolveFunctionCalls(p, p, path, state);
        parameterResults.push(p.result);
      } else {
        parameterResults.push(p.result);
      }
    }
    const functionResult = functions[functionCallResult.functionCall.function].fn(parameterResults);
    log.debug("PARAMETER RESULTS", functionCallResult.functionCall.function, parameterResults, functionResult);
    fnode.result.push(...functionResult);
  }

  function travHandle<T extends Record<string, QNode>>(queries: T, root: NodePath) : Record<keyof T, Result[]> {
    const results = Object.fromEntries(Object.keys(queries).map(name => [name, [] as Result[]])) as Record<keyof T, Result[]>;
    const state: State = {
      depth: 0,
      child: [[],[]],
      descendant: [[],[]],
      filters: [[],[]],
      filtersMap: [new Map(), new Map()],
      matches: [[]],
      functionCalls: [[]]
    };

    for (const [name, node] of Object.entries(queries)) {
      createFNodeAndAddToState(node, results[name], state);
    }
    state.child[state.depth+1].forEach(fnode => addPrimitiveAttributeIfMatch(fnode, root));
    state.descendant.slice(0, state.depth+1).forEach(fnodes => fnodes.forEach(fnode => addPrimitiveAttributeIfMatch(fnode, root)));

    traverse(root.node, {
      enter(path, state) {
        //log.debug("ENTER", breadCrumb(path));
        state.depth++;
        state.child.push([]);
        state.descendant.push([]);
        state.filters.push([]);
        state.filtersMap.push(new Map());
        state.matches.push([]);
        state.functionCalls.push([]);
        for (const fnode of state.child[state.depth]) {
          addIfTokenMatch(fnode, path, state);
        }
        for (const fnodes of state.descendant.slice(0, state.depth + 1)) {
          for (const fnode of fnodes) {
            addIfTokenMatch(fnode, path, state);
          }
        }
      },
      exit(path, state) {
        log.debug("EXIT", breadCrumb(path));
        // Check for attributes as not all attributes are visited
        state.child[state.depth +1].forEach(fnode => addPrimitiveAttributeIfMatch(fnode, path));
        for (const fnodes of state.descendant) {
          for (const fnode of fnodes) {
            addPrimitiveAttributeIfMatch(fnode, path);
          }
        }
        for (const [fNode, path] of state.matches[state.depth]) {
          addResultIfTokenMatch(fNode, path, state);
        }
        state.depth--;
        state.child.pop();
        state.descendant.pop();
        state.filters.pop();
        state.filtersMap.pop();
        state.matches.pop();
        state.functionCalls.pop();
      }
    }, root.scopeId, state, root);
    return results;
  }

  function beginHandle<T extends Record<string, QNode>>(queries: T, path: ASTNode) : Record<keyof T, Result[]> {
    const rootPath: NodePath = createNodePath(path, undefined, undefined, undefined, undefined);
    const r = travHandle(queries, rootPath);
    return r;
  }
  return {
    beginHandle
  }
}




const defaultKey = "__default__";

export function query(code: string | ASTNode, query: string, returnAST?: boolean) : Result[] & { __AST?: ASTNode } {
  const result = multiQuery(code, { [defaultKey]: query }, returnAST);
  if (returnAST) {
    const r = result[defaultKey] as Result[] & { __AST?: ASTNode };
    r.__AST = result.__AST;
    return r;
  }
  return result[defaultKey];
}

export function multiQuery<T extends Record<string, string>>(code: string | ASTNode, namedQueries: T, returnAST?: boolean) : Record<keyof T, Result[]> & { __AST?: ASTNode } {
  const start = Date.now();
  const ast = typeof code == "string" ? parseSource(code) : code;
  if (ast == null) throw new Error("Could not pase code");
  const queries = Object.fromEntries(Object.entries(namedQueries).map(([name, query]) => [name, parse(query)])) as Record<keyof T, QNode>;
  const querier = createQuerier();
  const result = querier.beginHandle(queries, ast);
  log.debug("Query time: ", Date.now() - start);
  if (returnAST) {
    return { ...result, __AST: ast };
  }
  return result;
}

export function parseSource(source: string) : ASTNode {
  try {
    return parseScript(source, { module: true, next: true, specDeviation:  true});
  } catch(e) {
    return parseScript(source, { module: false, next: true, specDeviation:  true});
  }
}



export type Binding = {
  path: NodePath;
}

export type Scope = {
  bindings: Record<string, Binding>;
  parentScopeId?: number;
  id: number;
};

const scopes = new Map<number, Scope | number>(); 

export type ASTNode = ESTree.Node & {
  extra?: {
    scopeId?: number;
    functionScopeId?: number;
    nodePath?: NodePath;
  }
};

export type NodePath = {
  node: ASTNode;
  key?: string;
  parentPath?: NodePath;
  parentKey?: string;
  scopeId: number;
  functionScopeId: number;
};

type Visitor<T> = {
  enter: (path: NodePath, state: T) => void;
  exit: (path: NodePath, state: T) => void;
}

export default function createTraverser() {
  let scopeIdCounter = 0;
  let removedScopes = 0;
  const nodePathsCreated: Record<string, number> = {}

  function createScope(parentScopeId?: number): number {
    const id = scopeIdCounter++;
    if (parentScopeId != undefined) {
      scopes.set(id, parentScopeId ?? -1);
    }
    return id;
  }

  function getBinding(scopeId: number, name: string): Binding | undefined {
    let currentScope = scopes.get(scopeId);
  
    while (currentScope !== undefined) {
      if (typeof currentScope !== "number") {
        // Full scope: Check for binding
        if (currentScope.bindings[name]) {
          return currentScope.bindings[name];
        }
        // Move to parent scope
        if (currentScope.parentScopeId === -1) break; // No parent scope
        currentScope = scopes.get(currentScope.parentScopeId!);
      } else {
        // Lightweight scope: Retrieve parent scope
        if (currentScope === -1 || currentScope == undefined) break; // No parent scope
        currentScope = scopes.get(currentScope);
      }
    }
  
    return undefined; // Binding not found
  }
  


  function setBinding(scopeId: number, name: string, binding: Binding) {
    let scope = scopes.get(scopeId);
  
    if (typeof scope === "number" || scope === undefined) {
      // Upgrade the lightweight scope to a full scope
      scope = { bindings: {}, id: scopeId, parentScopeId: scope };
      scopes.set(scopeId, scope);
    }
  
    if (scope && typeof scope !== "number") {
      scope.bindings[name] = binding;
    }
  }

  let pathsCreated = 0;

  function getChildren(key: string, path: NodePath) : NodePath[] {
      if (key in path.node) {
        const r = (path.node as unknown as Record<string, unknown>)[key];
        if (Array.isArray(r)) {
          return r.map((n, i) => createNodePath(n, i, key, path.scopeId, path.functionScopeId, path));
        } else if (r != undefined) {
          return [createNodePath(r as ASTNode, key, key, path.scopeId, path.functionScopeId, path)];
        }
      }
      return [];
  }
  function getPrimitiveChildren(key: string, path: NodePath) : PrimitiveValue[] {
    if (key in path.node) {
      const r = (path.node as unknown as Record<string, unknown>)[key];
      return toArray(r).filter(isDefined).filter(isPrimitive);
    }
    return [];
  }
  function getPrimitiveChildrenOrNodePaths(key: string, path: NodePath) : Array<PrimitiveValue | NodePath> {
    if (key in path.node) {
      const r = (path.node as unknown as Record<string, unknown>)[key];
      if (Array.isArray(r)) {
        return r.map((n, i) => 
          isPrimitive(n) ? n : 
          // isLiteral(n) ? n.value as PrimitiveValue :
          createNodePath(n, i, key, path.scopeId, path.functionScopeId, path));
      } else if (r != undefined) {
        return [
          isPrimitive(r) ? r : 
          // isLiteral(r) ? r.value as PrimitiveValue :
          createNodePath(r as ASTNode, key, key, path.scopeId, path.functionScopeId, path)
        ];
      }
    }
    return [];
  }


  function createNodePath(node: ASTNode, key: string | undefined | number, parentKey: string | undefined, scopeId: number | undefined, functionScopeId: number | undefined, nodePath?: NodePath) : NodePath {
    if (node.extra?.nodePath) {
      const path = node.extra.nodePath;
      if (nodePath && isExportSpecifier(nodePath.node) && key == "exported" && path.key == "local") {
        //Special handling for "export { someName }" as id is both local and exported
        path.key = "exported"; 
        path.parentPath = nodePath;
        return path;
      }
      if (key != undefined) path.key = typeof(key) == "number" ? key.toString() : key;
      if (parentKey != undefined) path.parentKey = parentKey;
      if (nodePath != undefined) path.parentPath = nodePath;
      
      return path;
    }

    const finalScope: number = ((node.extra && node.extra.scopeId != undefined) ? node.extra.scopeId : scopeId) ?? createScope();
    const finalFScope: number = ((node.extra && node.extra.functionScopeId != undefined) ? node.extra.functionScopeId : functionScopeId) ?? finalScope;
    const path: NodePath = {
      node,
      scopeId: finalScope,
      functionScopeId: finalFScope,
      parentPath: nodePath,
      key: typeof(key) == "number" ? key.toString() : key,
      parentKey
    }
    if (isNode(node)) {
      node.extra = node.extra ?? {};
      node.extra.nodePath = path;
      Object.defineProperty(node.extra, "nodePath", { enumerable: false });
    }
    nodePathsCreated[node.type] = (nodePathsCreated[node.type] ?? 0) + 1;
    pathsCreated++;
    return path;
  }




  function registerBinding(stack: ASTNode[], scopeId: number, functionScopeId: number, key: string | number, parentKey: string) {
    //console.log("x registerBinding?", isIdentifier(node) ? node.name : node.type, parentNode.type, grandParentNode?.type, scopeId, isBinding(node, parentNode, grandParentNode));
    const node = stack[stack.length - 1];
    if (!isIdentifier(node)) return;
    const parentNode = stack[stack.length - 2];
    if (isAssignmentExpression(parentNode) || isMemberExpression(parentNode) || isUpdateExpression(parentNode) || isExportSpecifier(parentNode)) return;
    const grandParentNode = stack[stack.length - 3];
    if (!isBinding(node, parentNode, grandParentNode)) return;

    if (key == "id" && !isVariableDeclarator(parentNode)) {
      setBinding(functionScopeId, node.name, { path: createNodePath(node, undefined, undefined, scopeId, functionScopeId) });
      return;
    }
    if (isVariableDeclarator(parentNode) && isVariableDeclaration(grandParentNode)) {
      if (grandParentNode.kind == "var") {
        setBinding(functionScopeId, node.name, { path: createNodePath(parentNode, undefined, undefined, scopeId, functionScopeId) });
        return;
      } else {
        setBinding(scopeId, node.name, { path: createNodePath(parentNode, undefined, undefined, scopeId, functionScopeId) }); 
        return;
      }
    }
    
    if (isScope(node, parentNode)) {  
      setBinding(scopeId, node.name, { path: createNodePath(node, key, parentKey, scopeId, functionScopeId) });
    } /*else {
      console.log(node.type, parentNode.type, grandParentNode?.type);
    }*/
  }



  let bindingNodesVisited = 0;
  function registerBindings(stack: ASTNode[], scopeId: number, functionScopeId: number) {
    const node = stack[stack.length - 1];
    if (!isNode(node)) return
    if (node.extra?.scopeId != undefined) return;
    node.extra = node.extra ?? {};
    node.extra.scopeId = scopeId;
    bindingNodesVisited++;
    const keys = VISITOR_KEYS[node.type];
    if (keys.length == 0) return;

    let childScopeId = scopeId;
    if (isScopable(node)) {
      childScopeId = createScope(scopeId);
    }
    for (const key of keys) {
      const childNodes = node[key as keyof ASTNode];
      const children = toArray(childNodes).filter(isDefined);
      for (const [i, child] of children.entries()) {
        if (!isNode(child)) continue;
        const f = key === "body" && (isFunctionDeclaration(node) || isFunctionExpression(node)) ? childScopeId : functionScopeId;
        stack.push(child);
        if (isIdentifier(child)) {
          const k = Array.isArray(childNodes) ? i : key;
          registerBinding(stack, childScopeId, f, k, key);
        } else {
          registerBindings(stack, childScopeId, f);
        }
        stack.pop();
      }
    }
    if (childScopeId != scopeId && typeof scopes.get(childScopeId) == "number") { // Scope has not been populated
      scopes.set(childScopeId, scopes.get(scopeId)!);
      removedScopes++;
    }
  }

  function traverseInner<T>(
    node: ASTNode,
    visitor: Visitor<T>,
    scopeId: number | undefined,
    functionScopeId: number | undefined,
    state: T, 
    path?: NodePath
    ) {
      const nodePath = path ?? createNodePath(node, undefined, undefined, scopeId, functionScopeId);
      const keys = VISITOR_KEYS[node.type] ?? [];
      
      if (nodePath.parentPath) registerBindings([nodePath.parentPath.parentPath?.node, nodePath.parentPath.node, nodePath.node].filter(isDefined), nodePath.scopeId, nodePath.functionScopeId);

      for (const key of keys) {
        const childNodes = node[key as keyof ASTNode];
        const children = Array.isArray(childNodes) ? childNodes : childNodes ? [childNodes] : [];
        const nodePaths: NodePath[] = [];
        for (const [i, child] of children.entries()) {
          if (isNode(child)) {
            const childPath = createNodePath(child, Array.isArray(childNodes) ? i : key, key, nodePath.scopeId, nodePath.functionScopeId, nodePath);
            nodePaths.push(childPath);
          }
        }
        for (const childPath of nodePaths) {
          visitor.enter(childPath, state);
          traverseInner(childPath.node, visitor, nodePath.scopeId, nodePath.functionScopeId, state, childPath);
          visitor.exit(childPath, state);
        }
      }
  }

  const sOut: number[] = [];

  function traverse<T>(  node: ASTNode,
    visitor: Visitor<T>,
    scopeId: number | undefined, 
    state: T, 
    path?: NodePath) {
    const fscope = path?.functionScopeId ?? node.extra?.functionScopeId ?? scopeId;
    traverseInner(node, visitor, scopeId, fscope, state, path);
    if (!sOut.includes(scopeIdCounter)) {
      log.debug("Scopes created", scopeIdCounter, " Scopes removed", removedScopes, "Paths created", pathsCreated, bindingNodesVisited);
      sOut.push(scopeIdCounter);
      const k = Object.fromEntries(Object.entries(nodePathsCreated).sort((a, b) => a[1] - b[1]));
      log.debug("Node paths created", k);
    }


  }
  return {
    traverse,
    createNodePath,
    getChildren,
    getPrimitiveChildren,
    getPrimitiveChildrenOrNodePaths,
    getBinding
  }
}
