import { FunctionCall, NodeType, parse, QNode } from "./parseQuery";
import { parse as parseJS } from "meriyah";
import { isNodePath, VISITOR_KEYS, isAssignmentExpression, isBinding, isExportSpecifier, isFunctionDeclaration, isFunctionExpression, isIdentifier, isMemberExpression, isNode, isPrimitive, isScopable, isScope, isUpdateExpression, isVariableDeclaration, isVariableDeclarator } from "./nodeutils";
import { ESTree } from "meriyah";
import { isDefined, toArray } from "./utils";


const debugLogEnabled = false;

const log = debugLogEnabled ? {
  debug: (...args: unknown[]) => {
    console.debug(...args);
  }
} : undefined;

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
      // Optimize: combine empty check with manual flattening
      const flattened: Result[] = [];
      for (let i = 0; i < result.length; i++) {
        if (result[i].length === 0) return [];
        for (let j = 0; j < result[i].length; j++) {
          flattened.push(result[i][j]);
        }
      }
      return [flattened.join("")];
    }
  },
  "first": {
    fn: (result: Result[][]): Result[] => {
      if (result.length != 1) throw new Error("Invalid number of arugments for first");
      if (result[0].length == 0) return [];
      return [result[0][0]];
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
  result: Array<Result>,
  // Insertion order among active descendant selectors. Assigned when a
  // descendant FNode becomes active so that, when several descendant selectors
  // match the same node, we can dispatch them in the exact depth-major order the
  // old full-scan used (keeps result ordering stable).
  seq?: number
};

type State = {
  depth: number;
  child: FNode[][];
  descendant: FNode[][];
  // Lazily allocated per depth and keyed by the AST node, so looking up the
  // filters for a (selector, node) pair is O(1) even when many siblings at the
  // same depth carry filters. Most nodes carry no filter, so the Map itself is
  // only allocated when one appears at that depth.
  filtersMap: Array<Map<ASTNode, FilterResult[]> | undefined>;
  matches: [FNode, NodePath][][];
  functionCalls: FunctionCallResult[][];
  // Index of the currently-active descendant ("//") selectors, kept in lockstep
  // with `descendant`. Lets each visited node look up only the selectors that
  // could match its type instead of scanning every active descendant selector.
  // Arbitrary-depth matching is unchanged: selectors stay active for their whole
  // subtree; only the lookup is faster.
  descendantByType: Map<string, FNode[]>;
  descendantOther: FNode[]; // wildcard (//*) and attribute selectors: checked at every node
  descendantAttr: FNode[];  // attribute descendant selectors: used by the exit primitive pass
  descendantActiveCount: number;
  seqCounter: number;
}
type FilterCondition = {
  type: typeof NodeType.AND | typeof NodeType.OR | typeof NodeType.EQUALS;
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
    if (filter.type == NodeType.AND || filter.type == NodeType.OR || filter.type == NodeType.EQUALS) {
      return {
        type: filter.type,
        left: createFilter(filter.left, []),
        right: createFilter(filter.right, [])
      };
    } else if (filter.type == NodeType.LITERAL) {
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

  // Make a descendant FNode active: record it on the per-depth `descendant`
  // stack (unchanged) and mirror it into the type index so future nodes can
  // find it by their node type in O(1).
  function activateDescendant(fnode: FNode, state: State) {
    state.descendant[state.depth + 1].push(fnode);
    fnode.seq = state.seqCounter++;
    const value = fnode.node.value;
    if (fnode.node.attribute) {
      // Attribute selector (//:name): matches on key, so must be tried on every
      // node; also drives the primitive-attribute pass on exit.
      state.descendantOther.push(fnode);
      state.descendantAttr.push(fnode);
    } else if (value == "*") {
      state.descendantOther.push(fnode);
    } else if (value != undefined) {
      let bucket = state.descendantByType.get(value);
      if (!bucket) {
        bucket = [];
        state.descendantByType.set(value, bucket);
      }
      bucket.push(fnode);
    }
    state.descendantActiveCount++;
  }

  function removeFromBucket(arr: FNode[], fnode: FNode) {
    // Deactivation is LIFO with activation, so the target is at (or near) the
    // end; lastIndexOf keeps this close to O(1) for the tiny buckets involved.
    const i = arr.lastIndexOf(fnode);
    if (i >= 0) arr.splice(i, 1);
  }

  function deactivateDescendant(fnode: FNode, state: State) {
    const value = fnode.node.value;
    if (fnode.node.attribute) {
      removeFromBucket(state.descendantOther, fnode);
      removeFromBucket(state.descendantAttr, fnode);
    } else if (value == "*") {
      removeFromBucket(state.descendantOther, fnode);
    } else if (value != undefined) {
      const bucket = state.descendantByType.get(value);
      if (bucket) removeFromBucket(bucket, fnode);
    }
    state.descendantActiveCount--;
  }

  function addFilterChildrenToState(filter: FilterNode, state: State) {    
    if ("type" in filter && (filter.type == NodeType.AND || filter.type == NodeType.OR || filter.type == NodeType.EQUALS)) {
      addFilterChildrenToState(filter.left, state);
      addFilterChildrenToState(filter.right, state);
    } else if ("node" in filter) {
      if (filter.node.type == NodeType.CHILD) {
        log?.debug("ADDING FILTER CHILD", filter.node);
        state.child[state.depth+1].push(filter);
      }
      if (filter.node.type == NodeType.DESCENDANT) {
        log?.debug("ADDING FILTER DESCENDANT", filter.node);
        activateDescendant(filter, state);
      }
    }
  }

  function createFNodeAndAddToState(token: QNode, result: Array<Result>, state: State) : FNode {
    log?.debug("ADDING FNODE", token);
    const fnode = createFNode(token, result);
    if (token.type == NodeType.CHILD) {
      state.child[state.depth+1].push(fnode);
    } else if (token.type == NodeType.DESCENDANT) {
      activateDescendant(fnode, state);
    }
    return fnode;
  }

  // Matching needs only the node's type and its position keys, all available
  // without materializing a NodePath. Loose equality on `key` is intentional:
  // array indices are kept as numbers in the traversal frames while query
  // values are strings.
  function isMatch(fnode: FNode, node: ASTNode, key: string | number | undefined, parentKey: string | undefined) : boolean {
    if (fnode.node.attribute) {
      return fnode.node.value == parentKey || fnode.node.value == key;
    }
    if (fnode.node.value == "*") {
      return true;
    }
    return fnode.node.value == node.type;
  }

  // Records a match. The NodePath is only materialized by the caller when a
  // match actually occurs, so most visited nodes never allocate one.
  function addMatch(fnode: FNode, path: NodePath, state: State) {
    state.matches[state.depth].push([fnode, path]);
    if (fnode.node.filter) {
      const filter = createFilter(fnode.node.filter, []);
      const filteredResult: Array<Result> = [];
      const f = { filter: filter, qNode: fnode.node, node: path.node, result: filteredResult };
      let fmapContainer = state.filtersMap[state.depth];
      if (!fmapContainer) {
        fmapContainer = new Map();
        state.filtersMap[state.depth] = fmapContainer;
      }
      let fmap = fmapContainer.get(path.node);
      if (!fmap) {
        fmap = [];
        fmapContainer.set(path.node, fmap);
      }
      fmap.push(f);
      addFilterChildrenToState(filter, state);
      const child = fnode.node.child;
      if (child) {
        if (child.type == NodeType.FUNCTION) {
          const fr = addFunction(fnode, child, path, state);
          state.functionCalls[state.depth].push(fr);
        } else {
          createFNodeAndAddToState(child, filteredResult, state); 
        }
      }
    } else {
      const child = fnode.node.child;
      if (child?.type == NodeType.FUNCTION) {
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
      if (param.type == NodeType.LITERAL) {
        functionNode.parameters.push({ node: param, result: [param.value] });
      } else {
        if (param.type == NodeType.FUNCTION) {
          functionNode.parameters.push(addFunction(functionNode, param, path, state));
        } else {
          functionNode.parameters.push(createFNodeAndAddToState(param, [], state));
        }
      }
    }
    return functionNode;
  }


  function addPrimitiveAttributeIfMatch(fnode: FNode, node: ASTNode) {
    if (!fnode.node.attribute || fnode.node.value == undefined) return;
    if (fnode.node.child || fnode.node.filter) return;
    if (!Object.hasOwn(node, fnode.node.value)) return;
    const nodes = getPrimitiveChildren(fnode.node.value, node);
    if (nodes.length == 0) return;
    log?.debug("PRIMITIVE", fnode.node.value, nodes);
    fnode.result.push(...nodes);
  }

  function evaluateFilter(filter: FilterNode, path: NodePath) : Result[] {
    log?.debug("EVALUATING FILTER", filter, breadCrumb(path));
    if ("type" in filter) {
      if (filter.type == NodeType.AND) {
        const left = evaluateFilter(filter.left, path);
        if (left.length == 0) {
          return [];
        }
        const r = evaluateFilter(filter.right, path);
        return r;
      }
      if (filter.type == NodeType.OR) {
        const left = evaluateFilter(filter.left, path);
        if (left.length > 0) {
          return left;
        }
        const r = evaluateFilter(filter.right, path);
        return r;
      }
      if (filter.type == NodeType.EQUALS) {
        const left = evaluateFilter(filter.left, path);
        const right = evaluateFilter(filter.right, path);
        // Optimize: use Set for O(1) lookups instead of O(n) includes
        if (right.length > 3) {
          const rightSet = new Set(right);
          const r: Result[] = [];
          for (let i = 0; i < left.length; i++) {
            if (rightSet.has(left[i])) r.push(left[i]);
          }
          return r;
        }
        // For small arrays, includes is faster than Set creation
        const r: Result[] = [];
        for (let i = 0; i < left.length; i++) {
          if (right.includes(left[i])) r.push(left[i]);
        }
        return r;
      }
      throw new Error("Unknown filter type: " + filter.type);
    }
    if (filter.node.type == NodeType.PARENT) {
      const r = resolveFilterWithParent(filter.node, path);
      return r;
    }
    // If result is empty and node is an attribute selector, try resolving directly
    // (handles cases like /:value/:raw where value is a plain object, not an AST node)
    if (filter.result.length === 0 && filter.node.attribute) {
      return resolveDirectly(filter.node, path);
    }
    return filter.result;
  }


  function resolveBinding(path: NodePath) : NodePath | undefined {
    if (!isIdentifier(path.node)) return undefined;
    log?.debug("RESOLVING BINDING FOR ", path.node);
    const name = path.node.name;
    if (name == undefined || typeof name != "string") return undefined;
    //const binding = path.scope.getBinding(name);
    const binding = getBinding(path.scopeId, name);
    if (!binding) return undefined;
    log?.debug("THIS IS THE BINDING", binding);
    return binding.path;
  }

  function resolveFilterWithParent(node: QNode, path: NodePath) : Result[] {
    let startNode: QNode = node;
    let startPath = path;
    while(startNode.type == NodeType.PARENT) {
      if (!startNode.child) throw new Error("Parent filter must have child");
      if (!startPath.parentPath) return [];
      log?.debug("STEP OUT", startNode, breadCrumb(startPath));
      startNode = startNode.child;
      startPath = startPath.parentPath;
    }
    return resolveDirectly(startNode, startPath);
  }
  
  let subQueryCounter = 0;
  const memo = new Map<QNode, Map<NodePath | PrimitiveValue, Result[]>>();

  function resolveDirectly(node: QNode, path: NodePath) : Result[] {
    let startNode: QNode = node;
    const startPath = path;
    let paths: Array<PrimitiveValue | NodePath> = [startPath];
    while(startNode.attribute && startNode.type == NodeType.CHILD) {
      const lookup = startNode.value;
      if (!lookup) throw new Error("Selector must have a value");
      //log?.debug("STEP IN ", lookup, paths.map(p => breadCrumb(p)));
      
      // Optimize: avoid filter().map().flat() chain - use single loop
      const nodes: Array<PrimitiveValue | NodePath> = [];
      for (let i = 0; i < paths.length; i++) {
        const p = paths[i];
        if (!isNodePath(p)) continue;
        const arr = getPrimitiveChildrenOrNodePaths(lookup, p);
        for (let j = 0; j < arr.length; j++) {
          nodes.push(arr[j]);
        }
      }

      if (nodes.length == 0) return [];
      paths = nodes;
      if (startNode.resolve) {
        const resolved: NodePath[] = [];
        for (let i = 0; i < paths.length; i++) {
          const p = paths[i];
          if (!isNodePath(p)) continue;
          const binding = resolveBinding(p);
          if (!binding) continue;
          const children = getChildren("init", binding);
          for (let j = 0; j < children.length; j++) {
            resolved.push(children[j]);
          }
        }
        if (resolved.length > 0) paths = resolved;
      } else if (startNode.binding) {
        const bindings: NodePath[] = [];
        for (let i = 0; i < paths.length; i++) {
          const p = paths[i];
          if (!isNodePath(p)) continue;
          const binding = resolveBinding(p);
          if (binding) bindings.push(binding);
        }
        paths = bindings;
      }
      const filter = startNode.filter;
      if (filter) {
        const filtered: NodePath[] = [];
        for (let i = 0; i < paths.length; i++) {
          const p = paths[i];
          if (!isNodePath(p)) continue;
          if (travHandle({subquery: filter}, p).subquery.length > 0) {
            filtered.push(p);
          }
        }
        paths = filtered;
      }
      if (!startNode.child) {
        const results = new Array(paths.length);
        for (let i = 0; i < paths.length; i++) {
          const p = paths[i];
          results[i] = isPrimitive(p) ? p : p.node;
        }
        return results;
      }
      startNode = startNode.child;
    }
    //log?.debug("DIRECT TRAV RESOLVE", startNode, paths.map(p => breadCrumb(p)));
    const result = [];
    //console.log(paths.length, subQueryCounter);
    for (const path of paths) {
      if (isNodePath(path)) {
        let nodeMemo = memo.get(startNode);
        const cached = nodeMemo ? nodeMemo.get(path) : undefined;
        if (cached) {
          for (let i = 0; i < cached.length; i++) {
            result.push(cached[i]);
          }
        } else {
          const subQueryKey = "subquery-" + subQueryCounter++;
          const subQueryResult = travHandle({ [subQueryKey]: startNode }, path)[subQueryKey];
          if (!nodeMemo) {
            nodeMemo = new Map();
            memo.set(startNode, nodeMemo);
          }
          nodeMemo.set(path, subQueryResult);
          for (let i = 0; i < subQueryResult.length; i++) {
            result.push(subQueryResult[i]);
          }
        }
      }
    }
    log?.debug("DIRECT TRAV RESOLVE RESULT", result);
    return result;
  }

  function addResultIfTokenMatch(fnode: FNode, path: NodePath, state: State) {
    // Lazily allocated: the vast majority of matches carry no filter, and this
    // runs once per match.
    let matchingFilters: FilterResult[] | undefined;
    const fmapContainer = state.filtersMap[state.depth];
    const nodeFilters = fmapContainer ? fmapContainer.get(path.node) : undefined;
    if (nodeFilters) {
      let filterCount = 0;
      for (let i = 0; i < nodeFilters.length; i++) {
        const f = nodeFilters[i];
        if (f.qNode !== fnode.node) continue;
        filterCount++;
        if (evaluateFilter(f.filter, path).length > 0) {
          (matchingFilters ??= []).push(f);
        }
      }
      if (filterCount > 0 && matchingFilters == undefined) return;
    }

    if (fnode.node.resolve) {
      const binding = resolveBinding(path);
      const resolved = binding ? getChildren("init", binding)[0] : undefined;

      if (fnode.node.child) {
        const result = resolveDirectly(fnode.node.child, resolved ?? path);
        for (let i = 0; i < result.length; i++) {
          fnode.result.push(result[i]);
        }
      } else {
        fnode.result.push(path.node);
      }
    } else if (fnode.node.binding) {
      const binding = resolveBinding(path);
      if (binding) {
        if (fnode.node.child) {
          const result = resolveDirectly(fnode.node.child, binding);
          for (let i = 0; i < result.length; i++) {
            fnode.result.push(result[i]);
          }
        } else {
          fnode.result.push(binding.node);
        }
      } 
    } else if (!fnode.node.child) {
      fnode.result.push(path.node);
    } else if (fnode.node.child.type == NodeType.FUNCTION) {
      const functionCallResult = state.functionCalls[state.depth].find(f => f.node == fnode.node);
      if (!functionCallResult) throw new Error("Did not find expected function call for " + fnode.node.child.function);
      resolveFunctionCalls(fnode, functionCallResult, path, state);
    } else if (matchingFilters != undefined) {
      log?.debug("HAS MATCHING FILTER", fnode.result.length, matchingFilters.length, breadCrumb(path));
      for (let i = 0; i < matchingFilters.length; i++) {
        const filterResult = matchingFilters[i].result;
        for (let j = 0; j < filterResult.length; j++) {
          fnode.result.push(filterResult[j]);
        }
      }
    } else if (fnode.node.child.attribute) {
      // Handle attribute children that weren't resolved through normal traversal
      // (e.g., when accessing nested properties of non-AST objects like TemplateElement.value.raw)
      // Skip leaf attributes - they're handled by addPrimitiveAttributeIfMatch
      // Only process if there's a child chain (like /:value/:raw)
      if (fnode.node.child.child || fnode.node.child.filter) {
        const attrName = fnode.node.child.value;
        if (attrName) {
          const attrValue = (path.node as unknown as Record<string, unknown>)[attrName];
          // Check if the attribute value would NOT be traversed normally (i.e., not an AST node)
          const isASTNode = (v: unknown): boolean => 
            typeof v === 'object' && v !== null && 'type' in v;
          const wouldBeTraversed = isASTNode(attrValue) || 
            (Array.isArray(attrValue) && attrValue.length > 0 && isASTNode(attrValue[0]));
          if (!wouldBeTraversed) {
            const result = resolveDirectly(fnode.node.child, path);
            for (let i = 0; i < result.length; i++) {
              fnode.result.push(result[i]);
            }
          }
        }
      }
    }
  }

  function resolveFunctionCalls(fnode: FNode, functionCallResult: FunctionCallResult, path: NodePath, state: State) {
    const parameterResults: Result[][] = [];
    for (let i = 0; i < functionCallResult.parameters.length; i++) {
      const p = functionCallResult.parameters[i];
      if ("parameters" in p) {
        resolveFunctionCalls(p, p, path, state);
        parameterResults.push(p.result);
      } else {
        parameterResults.push(p.result);
      }
    }
    const functionResult = functions[functionCallResult.functionCall.function].fn(parameterResults);
    log?.debug("PARAMETER RESULTS", functionCallResult.functionCall.function, parameterResults, functionResult);
    for (let i = 0; i < functionResult.length; i++) {
      fnode.result.push(functionResult[i]);
    }
  }

  function travHandle<T extends Record<string, QNode>>(queries: T, root: NodePath) : Record<keyof T, Result[]> {
    // Optimize: create results object directly instead of Object.fromEntries + map
    const results = {} as Record<keyof T, Result[]>;
    const queryKeys = Object.keys(queries);
    for (let i = 0; i < queryKeys.length; i++) {
      results[queryKeys[i] as keyof T] = [];
    }
    
    const state: State = {
      depth: 0,
      child: [[],[]],
      descendant: [[],[]],
      filtersMap: [undefined, undefined],
      matches: [[]],
      functionCalls: [[]],
      descendantByType: new Map(),
      descendantOther: [],
      descendantAttr: [],
      descendantActiveCount: 0,
      seqCounter: 0
    };

    for (const [name, node] of Object.entries(queries)) {
      createFNodeAndAddToState(node, results[name], state);
    }

    // Optimize: replace forEach with for loop
    const childAtDepth = state.child[state.depth+1];
    for (let i = 0; i < childAtDepth.length; i++) {
      addPrimitiveAttributeIfMatch(childAtDepth[i], root.node);
    }
    // Only attribute descendant selectors do anything in the primitive pass.
    for (let i = 0; i < state.descendantAttr.length; i++) {
      addPrimitiveAttributeIfMatch(state.descendantAttr[i], root.node);
    }

    traverse(root.node, {
      enter(node, key, parentKey, materialize, state) {
        state.depth++;
        state.child.push([]);
        state.descendant.push([]);
        state.filtersMap.push(undefined);
        state.matches.push([]);
        state.functionCalls.push([]);
        const depth = state.depth;
        // Materialized lazily on the first match at this node; most nodes
        // match nothing and never pay for a NodePath.
        let path: NodePath | undefined;
        const childAtDepth = state.child[depth];
        for (let i = 0; i < childAtDepth.length; i++) {
          const fnode = childAtDepth[i];
          if (isMatch(fnode, node, key, parentKey)) {
            addMatch(fnode, path ?? (path = materialize(depth)), state);
          }
        }
        // Descendant selectors active for this node: only those targeting this
        // node's type (O(1) lookup) plus the always-checked wildcard/attribute
        // selectors. Each bucket is already in activation (seq) order, so when a
        // single source applies no sort is needed; only when both contribute do
        // we merge by seq to reproduce the old depth-major ordering. Lengths are
        // snapshotted so selectors this node activates for its children are not
        // matched against the node itself.
        const bucket = state.descendantByType.get(node.type);
        const other = state.descendantOther;
        const bucketLen = bucket ? bucket.length : 0;
        const otherLen = other.length;
        if (otherLen == 0) {
          // Bucket entries are keyed on node type, so the match is guaranteed.
          for (let i = 0; i < bucketLen; i++) {
            addMatch(bucket![i], path ?? (path = materialize(depth)), state);
          }
        } else if (bucketLen == 0) {
          for (let i = 0; i < otherLen; i++) {
            const fnode = other[i];
            if (isMatch(fnode, node, key, parentKey)) {
              addMatch(fnode, path ?? (path = materialize(depth)), state);
            }
          }
        } else {
          const cands: FNode[] = [];
          for (let i = 0; i < bucketLen; i++) cands.push(bucket![i]);
          for (let i = 0; i < otherLen; i++) cands.push(other[i]);
          cands.sort((a, b) => a.seq! - b.seq!);
          for (let i = 0; i < cands.length; i++) {
            const fnode = cands[i];
            if (isMatch(fnode, node, key, parentKey)) {
              addMatch(fnode, path ?? (path = materialize(depth)), state);
            }
          }
        }
      },
      exit(node, state) {
        // Check for attributes as not all attributes are visited
        // Optimize: replace forEach with for loop
        const childAtDepthPlusOne = state.child[state.depth + 1];
        for (let i = 0; i < childAtDepthPlusOne.length; i++) {
          addPrimitiveAttributeIfMatch(childAtDepthPlusOne[i], node);
        }
        // Equivalent to scanning every active descendant selector, but only
        // attribute selectors do any work here. descendantAttr is in activation
        // (depth-major) order, matching the old scan order.
        for (let i = 0; i < state.descendantAttr.length; i++) {
          addPrimitiveAttributeIfMatch(state.descendantAttr[i], node);
        }
        const matchesAtDepth = state.matches[state.depth];
        for (let i = 0; i < matchesAtDepth.length; i++) {
          addResultIfTokenMatch(matchesAtDepth[i][0], matchesAtDepth[i][1], state);
        }
        // Deactivate descendant selectors this node added for its subtree before
        // unwinding the per-depth stack, keeping the type index in lockstep.
        const leavingDescendants = state.descendant[state.descendant.length - 1];
        for (let i = 0; i < leavingDescendants.length; i++) {
          deactivateDescendant(leavingDescendants[i], state);
        }
        state.depth--;
        state.child.pop();
        state.descendant.pop();
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
    memo.clear();
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
  // Optimize: parse queries directly instead of Object.fromEntries + map
  const queries = {} as Record<keyof T, QNode>;
  const entries = Object.entries(namedQueries);
  for (let i = 0; i < entries.length; i++) {
    const [name, queryStr] = entries[i];
    queries[name as keyof T] = parse(queryStr);
  }
  const querier = createQuerier();
  const result = querier.beginHandle(queries, ast);
  log?.debug("Query time: ", Date.now() - start);
  if (returnAST) {
    return { ...result, __AST: ast };
  }
  return result;
}

export function parseSource(source: string, optimize: boolean = true) : ASTNode {
  const parsingOptions = optimize ? {loc: false, ranges: false } : {loc: true, ranges: true };
  const base = { next: true, validateRegex: false, ...parsingOptions };
  try {
    return parseJS(source, { ...base, sourceType: 'module' });
  } catch {
    try {
      return parseJS(source, { ...base, sourceType: 'script', webcompat: true });
    } catch {
      try {
        return parseJS(source, { ...base, sourceType: 'module', jsx: true });
      } catch {
        return parseJS(source, { ...base, sourceType: 'script', webcompat: true, jsx: true });
      }
    }
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


export type ASTNode = ESTree.Node & {
  // Internal: scope id assigned during binding registration. Stored as a flat
  // property (not a nested object) to avoid allocating a wrapper per AST node.
  scopeId?: number;
};

export type NodePath = {
  node: ASTNode;
  key?: string;
  parentPath?: NodePath;
  parentKey?: string;
  scopeId: number;
  functionScopeId: number;
};

// The visitor receives raw nodes plus their position keys; a NodePath is only
// created on demand via `materialize(depth)` (memoized per depth by the
// traversal), so nodes that match nothing never allocate one.
type Visitor<T> = {
  enter: (node: ASTNode, key: string | number | undefined, parentKey: string | undefined, materialize: (depth: number) => NodePath, state: T) => void;
  exit: (node: ASTNode, state: T) => void;
}

export default function createTraverser() {
  let scopeIdCounter = 0;
  const scopes = new Map<number, Scope | number>(); 
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
          const len = r.length;
          const result = new Array(len);
          for (let i = 0; i < len; i++) {
            result[i] = createNodePath(r[i], i, key, path.scopeId, path.functionScopeId, path);
          }
          return result;
        } else if (r != undefined) {
          return [createNodePath(r as ASTNode, key, key, path.scopeId, path.functionScopeId, path)];
        }
      }
      return [];
  }
  function getPrimitiveChildren(key: string, node: ASTNode) : PrimitiveValue[] {
    if (key in node) {
      const r = (node as unknown as Record<string, unknown>)[key];
      const arr = toArray(r);
      // Optimize: single loop instead of chained filter()
      const result: PrimitiveValue[] = [];
      for (let i = 0; i < arr.length; i++) {
        const item = arr[i];
        if (isDefined(item) && isPrimitive(item)) {
          result.push(item);
        }
      }
      return result;
    }
    return [];
  }
  function getPrimitiveChildrenOrNodePaths(key: string, path: NodePath) : Array<PrimitiveValue | NodePath> {
    if (key in path.node) {
      const r = (path.node as unknown as Record<string, unknown>)[key];
      if (Array.isArray(r)) {
        const len = r.length;
        const result = new Array(len);
        for (let i = 0; i < len; i++) {
          const n = r[i];
          result[i] = isPrimitive(n) ? n : createNodePath(n, i, key, path.scopeId, path.functionScopeId, path);
        }
        return result;
      } else if (r != undefined) {
        return [
          isPrimitive(r) ? r : 
          createNodePath(r as ASTNode, key, key, path.scopeId, path.functionScopeId, path)
        ];
      }
    }
    return [];
  }
  const nodePathMap = new WeakMap<ASTNode, NodePath>();

  function createNodePath(node: ASTNode, key: string | undefined | number, parentKey: string | undefined, scopeId: number | undefined, functionScopeId: number | undefined, nodePath?: NodePath) : NodePath {
    const existing = nodePathMap.get(node);
    if (existing) {
      const path = existing;
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

    const finalScope: number = (node.scopeId != undefined ? node.scopeId : scopeId) ?? createScope();
    const finalFScope: number = functionScopeId ?? finalScope;
    const path: NodePath = {
      node,
      scopeId: finalScope,
      functionScopeId: finalFScope,
      parentPath: nodePath,
      key: typeof(key) == "number" ? key.toString() : key,
      parentKey
    }
    if (isNode(node)) {
      nodePathMap.set(node, path);
    }
    if (debugLogEnabled) {
      nodePathsCreated[node.type] = (nodePathsCreated[node.type] ?? 0) + 1;
      pathsCreated++;
    }
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
    if (node.scopeId != undefined) return;
    node.scopeId = scopeId;
    if (debugLogEnabled) bindingNodesVisited++;
    const keys = VISITOR_KEYS[node.type];
    if (keys.length == 0) return;

    let childScopeId = scopeId;
    if (isScopable(node)) {
      childScopeId = createScope(scopeId);
    }
    for (let keyIdx = 0; keyIdx < keys.length; keyIdx++) {
      const key = keys[keyIdx];
      const childNodes = node[key as keyof ASTNode];
      if (childNodes == undefined) continue;
      // Visit children directly, avoiding a toArray wrapper per (node, key).
      if (Array.isArray(childNodes)) {
        for (let i = 0; i < childNodes.length; i++) {
          const child = childNodes[i];
          if (!isDefined(child) || !isNode(child)) continue;
          const f = key === "body" && (isFunctionDeclaration(node) || isFunctionExpression(node)) ? childScopeId : functionScopeId;
          stack.push(child);
          if (isIdentifier(child)) {
            registerBinding(stack, childScopeId, f, i, key);
          } else {
            registerBindings(stack, childScopeId, f);
          }
          stack.pop();
        }
      } else if (isNode(childNodes)) {
        const child = childNodes as ASTNode;
        const f = key === "body" && (isFunctionDeclaration(node) || isFunctionExpression(node)) ? childScopeId : functionScopeId;
        stack.push(child);
        if (isIdentifier(child)) {
          registerBinding(stack, childScopeId, f, key, key);
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

  const sOut: number[] = [];

  function traverse<T>(  node: ASTNode,
    visitor: Visitor<T>,
    scopeId: number | undefined,
    state: T,
    path?: NodePath) {
    const rootPath = path ?? createNodePath(node, undefined, undefined, scopeId, scopeId);
    // Per-traversal frame stacks, indexed by depth and reused across siblings.
    // They carry everything needed to materialize a NodePath on demand, so a
    // node that matches nothing never allocates one. The frames are local to
    // this call because filter subqueries re-enter traverse() while an outer
    // traversal is still live.
    const fNodes: ASTNode[] = [node];
    const fKeys: (string | number | undefined)[] = [undefined];
    const fParentKeys: (string | undefined)[] = [undefined];
    const fPaths: (NodePath | undefined)[] = [rootPath];
    const fScopes: number[] = [rootPath.scopeId];
    // The function scope only ever propagates the root's value down the
    // traversal (createNodePath always inherits the parent's), so it is a
    // per-traversal constant rather than a frame.
    const fScope = rootPath.functionScopeId;
    const bindingStack: ASTNode[] = [];

    // Create the NodePath for the frame at `depth`, materializing any missing
    // ancestors first so parentPath chains (needed by `../` filters) stay
    // intact. Memoized per depth; createNodePath itself dedupes via WeakMap.
    function materializePath(depth: number): NodePath {
      const existing = fPaths[depth];
      if (existing) return existing;
      const parent = materializePath(depth - 1);
      const p = createNodePath(fNodes[depth], fKeys[depth], fParentKeys[depth], fScopes[depth - 1], fScope, parent);
      fPaths[depth] = p;
      return p;
    }

    function traverseInner(node: ASTNode, depth: number) {
      // Register bindings for this subtree; already-registered nodes (the
      // common case once a top-level subtree has been walked) skip the call.
      if (depth > 0 && node.scopeId == undefined) {
        bindingStack.length = 0;
        if (depth > 1) bindingStack.push(fNodes[depth - 2]);
        bindingStack.push(fNodes[depth - 1], node);
        registerBindings(bindingStack, fScopes[depth], fScope);
      }

      // Optimization: Check if we need to traverse children at all
      // If there are no descendant queries and no child queries at next depth, skip traversal
      const stateTyped = state as unknown as State;
      if (stateTyped.descendantActiveCount === 0) {
        const childQueries = stateTyped.child[stateTyped.depth + 1];
        if (!childQueries || childQueries.length === 0) return;
      }

      const keys = VISITOR_KEYS[node.type];
      const scope = fScopes[depth];
      const childDepth = depth + 1;
      for (let keyIdx = 0; keyIdx < keys.length; keyIdx++) {
        const key = keys[keyIdx];
        const childNodes = node[key as keyof ASTNode];
        if (childNodes == undefined) continue;
        // Visit children directly, avoiding the per-key intermediate arrays.
        if (Array.isArray(childNodes)) {
          for (let i = 0; i < childNodes.length; i++) {
            const child = childNodes[i];
            if (!isNode(child)) continue;
            fNodes[childDepth] = child;
            fKeys[childDepth] = i;
            fParentKeys[childDepth] = key;
            fPaths[childDepth] = undefined;
            fScopes[childDepth] = child.scopeId != undefined ? child.scopeId : scope;
            visitor.enter(child, i, key, materializePath, state);
            traverseInner(child, childDepth);
            visitor.exit(child, state);
          }
        } else if (isNode(childNodes)) {
          const child = childNodes as ASTNode;
          fNodes[childDepth] = child;
          fKeys[childDepth] = key;
          fParentKeys[childDepth] = key;
          fPaths[childDepth] = undefined;
          fScopes[childDepth] = child.scopeId != undefined ? child.scopeId : scope;
          visitor.enter(child, key, key, materializePath, state);
          traverseInner(child, childDepth);
          visitor.exit(child, state);
        }
      }
    }

    traverseInner(node, 0);

    if (debugLogEnabled && !sOut.includes(scopeIdCounter)) {
      log?.debug("Scopes created", scopeIdCounter, " Scopes removed", removedScopes, "Paths created", pathsCreated, bindingNodesVisited);
      sOut.push(scopeIdCounter);
      const k = Object.fromEntries(Object.entries(nodePathsCreated).sort((a, b) => a[1] - b[1]));
      log?.debug("Node paths created", k);
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
