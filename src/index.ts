import traverse, { getBinding, NodePath } from "./traverse";
import * as Babel from "@babel/types";
import { parseSync } from "@babel/core";
import { FunctionCall, parse, QNode } from "./parseQuery";
import { ParseResult } from "@babel/parser";
import { isIdentifier } from "@babel/types";

const debugLogEnabled = false;

const log = {
  debug: (...args: unknown[]) => {
    if (debugLogEnabled) console.debug(...args.map( x => typeof(x) == "object" && x != null ? x.toString() : x ));
  }
}

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
const functionNames = Object.keys(functions);
export type AvailableFunction = keyof typeof functions;
export function isAvailableFunction(name: string) : name is AvailableFunction {
  return functionNames.includes(name);
}

function beginHandle<T extends Record<string, QNode>>(queries: T, path: ParseResult<Babel.File>) : Record<keyof T, Result[]> {
  let rootPath: NodePath<Babel.Node> | undefined = undefined;
  traverse(path, { 
    enter(path) {
      if (path.node.type == "Program") {
        rootPath = path;
        path.stop();
      }
    }
  }, undefined, {});
  if (rootPath == undefined) throw new Error("No root path found");
  log.debug("Found rootNode");
  return travHandle(queries, rootPath);
}

type Result = Babel.Node | string | number | boolean;


type FNode = {
  node: QNode, 
  result: Array<Result>
};

type State = {
  depth: number;
  child: FNode[][];
  descendant: FNode[][];
  filters: FilterResult[][];
  matches: [FNode, NodePath<Babel.Node>][][];
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
  node: Babel.Node;
  result: Array<Result>;
}
type FunctionCallResult = {
  node: QNode;
  functionCall: FunctionCall;
  parameters: (FNode | FunctionCallResult)[];
  result: Array<Result>;
}

function breadCrumb(path: NodePath<Babel.Node>) {
  return { //Using the toString trick here to avoid calculating the breadcrumb if debug logging is off
    toString() : string {
      if (path.parentPath == undefined) return "@" + path.node.type;
      return breadCrumb(path.parentPath) + "." + (path.parentKey == path.key ? path.key : path.parentKey + "[" + path.key + "]") + "@" + path.node.type;
    }
  }
}

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

function isMatch(fnode: FNode, path: NodePath<Babel.Node>) : boolean {
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

function addIfTokenMatch(fnode: FNode, path: NodePath<Babel.Node>, state: State) {
  if (!isMatch(fnode, path)) return;
  state.matches[state.depth].push([fnode, path]);
  if (fnode.node.filter) {
    const filter = createFilter(fnode.node.filter, []);
    const filteredResult: Array<Result> = [];
    state.filters[state.depth].push({ filter: filter, qNode: fnode.node, node: path.node, result: filteredResult });
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

function addFunction(rootNode: FNode, functionCall: FunctionCall, path: NodePath<Babel.Node>, state: State): FunctionCallResult {
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


function isPrimitive(value: unknown) : boolean {
  return typeof value == "string" || typeof value == "number" || typeof value == "boolean";
}

function addPrimitiveAttributeIfMatch(fnode: FNode, path: NodePath<Babel.Node>) {
  if (!fnode.node.attribute || !fnode.node.value) return;
  if (fnode.node.child || fnode.node.filter) return;
  if (!Object.hasOwn(path.node, fnode.node.value)) return;
  const lookup = path.get(fnode.node.value);
  const nodes = (Array.isArray(lookup) ? lookup : [lookup])
    .filter(n => n.node != undefined)
    .filter(n => isPrimitive(n.node));
  if (nodes.length == 0) return;
  log.debug("PRIMITIVE", fnode.node.value, nodes.map(n => n.node));
  fnode.result.push(...nodes.map(n => n.node));
}

function evaluateFilter(filter: FilterNode, path: NodePath<Babel.Node>) : Result[] {
  log.debug("EVALUATING FILTER", filter);
  if ("type" in filter) {
    if (filter.type == "and") {
      const left = evaluateFilter(filter.left, path);
      if (left.length == 0) return [];
      return evaluateFilter(filter.right, path);
    }
    if (filter.type == "or") {
      const left = evaluateFilter(filter.left, path);
      if (left.length > 0) return left;
      return evaluateFilter(filter.right, path);
    }
    if (filter.type == "equals") {
      const left = evaluateFilter(filter.left, path);
      const right = evaluateFilter(filter.right, path);
      return left.filter(x => right.includes(x));
    }
    throw new Error("Unknown filter type: " + filter.type);
  }
  if (filter.node.type == "parent") {
    return resolveFilterWithParent(filter.node, path);
  }
  return filter.result;
}
function resolveBinding(path: NodePath<Babel.Node>) : NodePath<Babel.Node> | undefined {
  if (!isIdentifier(path.node)) return undefined;
  log.debug("RESOLVING BINDING FOR ", path.node);
  const name = path.node.name;
  if (name == undefined || typeof name != "string") return undefined;
  //const binding = path.scope.getBinding(name);
  const binding = getBinding(path.scope, name);
  if (!binding) return undefined;
  log.debug("THIS IS THE BINDING", binding);
  return binding.path;
}

function resolveFilterWithParent(node: QNode, path: NodePath<Babel.Node>) : Result[] {
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
const toArray = <T>(value: T | T[]) : T[] => Array.isArray(value) ? value : [value];

function isDefined<T>(value: T | undefined | null) : value is T {
  return value != undefined && value != null;
}
let subQueryCounter = 0;
function resolveDirectly(node: QNode, path: NodePath<Babel.Node>) : Result[] {
  let startNode: QNode = node;
  const startPath = path;
  let paths = [startPath];
  while(startNode.attribute) {
    const lookup = startNode.value;
    if (!lookup) throw new Error("Selector must have a value");
    log.debug("STEP IN ", lookup, paths.map(p => breadCrumb(p)));
    const nodes = paths.map(n => n.get(lookup)).map(toArray).flat().filter(n => n.node != undefined);
    log.debug("LOOKUP", lookup, nodes.map(n => n.node), nodes.filter(n => n.node == undefined));
    if (nodes.length == 0) return [];
    paths = nodes;
    if (startNode.resolve) {
      const resolved = paths.map(p => resolveBinding(p)).filter(isDefined).map(p => p.get("init")).flatMap(toArray).filter(p => p.node != undefined).filter(isDefined);
      if (resolved.length > 0) paths = resolved;
    } else if (startNode.binding) {
      paths = paths.map(p => resolveBinding(p)).filter(isDefined);
    }
    if (!startNode.child) {
      return paths.map(p => p.node);
    }
    startNode = startNode.child;
  }
  log.debug("DIRECT TRAV RESOLVE", startNode, paths.map(p => breadCrumb(p)));
  const result = paths.flatMap(path => {
    const subQueryKey = "subquery-" + subQueryCounter++;
    return travHandle({[subQueryKey]:startNode}, path)[subQueryKey];
  });
  log.debug("DIRECT TRAV RESOLVE RESULT", result);
  return result;
}

function addResultIfTokenMatch(fnode: FNode, path: NodePath<Babel.Node>, state: State) {
  const filters = state.filters[state.depth].filter(f => f.node == path.node && f.qNode == fnode.node);
  const matchingFilters = filters.filter(f => evaluateFilter(f.filter, path).length > 0);
  log.debug("RESULT MATCH", fnode.node.value, breadCrumb(path), filters.length, matchingFilters.length);
  if (filters.length > 0 && matchingFilters.length == 0) return;

  if (fnode.node.resolve) {
    const [resolved] = toArray(resolveBinding(path)?.get("init")).filter(isDefined).filter(p => p.node != undefined);
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

function resolveFunctionCalls(fnode: FNode, functionCallResult: FunctionCallResult, path: NodePath<Babel.Node>, state: State) {
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


function travHandle<T extends Record<string, QNode>>(queries: T, root: NodePath<Babel.Node>) : Record<keyof T, Result[]> {
  const results = Object.fromEntries(Object.keys(queries).map(name => [name, [] as Result[]])) as Record<keyof T, Result[]>;
  const state: State = {
    depth: 0,
    child: [[],[]],
    descendant: [[],[]],
    filters: [[],[]],
    matches: [[]],
    functionCalls: [[]]
  };
  Object.entries(queries).forEach(([name, node]) => {
    createFNodeAndAddToState(node, results[name], state);
  });
  state.child[state.depth+1].forEach(fnode => addPrimitiveAttributeIfMatch(fnode, root));
  state.descendant.slice(0, state.depth+1).forEach(fnodes => fnodes.forEach(fnode => addPrimitiveAttributeIfMatch(fnode, root)));

  traverse(root.node, {
    enter(path, state) {
      log.debug("ENTER", breadCrumb(path));
      state.depth++;
      state.child.push([]);
      state.descendant.push([]);
      state.filters.push([]);
      state.matches.push([]);
      state.functionCalls.push([]);
      state.child[state.depth].forEach(fnode => addIfTokenMatch(fnode, path, state));
      state.descendant.slice(0, state.depth+1).forEach(fnodes => 
        fnodes.forEach(fnode => addIfTokenMatch(fnode, path, state))
      );
    },
    exit(path, state) {
      log.debug("EXIT", breadCrumb(path));
      // Check for attributes as not all attributes are visited
      state.child[state.depth +1].forEach(fnode => addPrimitiveAttributeIfMatch(fnode, path));
      state.descendant.forEach(fnodes => 
        fnodes.forEach(fnode => addPrimitiveAttributeIfMatch(fnode, path))
      );

      state.matches[state.depth].forEach(([fNode, path]) => addResultIfTokenMatch(fNode, path, state));
      state.depth--;
      state.child.pop();
      state.descendant.pop();
      state.filters.pop();
      state.matches.pop();
      state.functionCalls.pop();
    }
  }, root.scope, state, root);
  return results;
}


const defaultKey = "__default__";

export function query(code: ParseResult<Babel.File> | string, query: string) : Result[] {
  return multiQuery(code, { [defaultKey]: query })[defaultKey];
}

export function multiQuery<T extends Record<string, string>>(code: ParseResult<Babel.File> | string, namedQueries: T) : Record<keyof T, Result[]> {
  const start = Date.now();
  const ast = typeof code == "string" ? parseSync(code, { sourceType: "unambiguous" }) : code;
  if (ast == null) throw new Error("Could not pase code");
  const queries = Object.fromEntries(Object.entries(namedQueries).map(([name, query]) => [name, parse(query)])) as Record<keyof T, QNode>;
  const result =  beginHandle(queries, ast);
  log.debug("Query time: ", Date.now() - start);
  return result;
}
