import { ASTNode, VISITOR_KEYS, isAssignmentExpression, isBinding, isIdentifier, isMemberExpression, isNode, isScopable, isScope } from "./nodeutils";

const debugLogEnabled = false;

const log = {
  debug: (...args: unknown[]) => {
    if (debugLogEnabled) console.debug(...args);
  }
}
export type Binding = {
  path: NodePath<ASTNode>;
}

export type Scope = {
  bindings: Record<string, Binding>;
  parentScopeId?: number;
  id: number;
  hasEntries: boolean;
};

const scopes: Array<Scope | number> = new Array(100000);

const voidFn = () => {};

export type NodePath<T> = {
  node: T;
  key?: string;
  parentPath?: NodePath<T>;
  parentKey?: string;
  stop: () => void;
  get(key: string): NodePath<ASTNode>[];
  scopeId: number;
  shouldStop: boolean;
};

type Visitor<T> = {
  enter: (path: NodePath<ASTNode>, state: T) => void;
  exit?: (path: NodePath<ASTNode>, state: T) => void;
}


let scopeIdCounter = 0;
let removedScopes = 0;

function createScope(parentScopeId?: number): number {
  const id = scopeIdCounter++;
  /*const bindings: Record<string, Binding> = {};
  const s: Scope = {
    bindings,
    id,
    parentScopeId,
    hasEntries: false
  }*/
  scopes[id] = parentScopeId ?? -1;
  return id;
}

export function getBinding(scopeId: number, name: string) {
  const scope = scopes[scopeId];
  if (typeof scope == "number") {
    if (scope == -1) return undefined;
    return getBinding(scope, name);
  }
  const s = scope.bindings[name];
  if (s) return s;
  if (scope.parentScopeId != undefined && scope.parentScopeId >= 0) {
    return getBinding(scope.parentScopeId, name);
  }
  return undefined;
}
function setBinding(scopeId: number, name: string, binding: Binding) {
  let scope: Scope;
  const s = scopes[scopeId];
  if (typeof s == "number") {
    scope = {
      bindings: {},
      id: scopeId,
      parentScopeId: s == -1 ? undefined : s,
      hasEntries: false
    };
    scopes[scopeId] = scope;
  } else {
    scope = s;
  }
  scope.bindings[name] = binding;
  scope.hasEntries = true;
}



let pathsCreated = 0;
const nodeKey = "ASTronomical-path";

export function createNodePath(node: ASTNode, key: string | undefined, parentKey: string | undefined, scopeId: number | undefined, nodePath?: NodePath<ASTNode>) : NodePath<ASTNode> {
  if (node.extra && node.extra[nodeKey]) {
    const path = node.extra[nodeKey] as NodePath<ASTNode>;
    path.key = key;
    path.parentKey = parentKey;
    path.parentPath = nodePath;
    return path;
  }
  const finalScope: number = ((node.extra && node.extra["scopeId"]) ? node.extra["scopeId"] as number : scopeId) ?? createScope();
  
  const path = {
    node,
    scopeId: finalScope,
    shouldStop: false,
    stop: voidFn,
    get: (key: string) => {
      if (key in node) {
        const r = (node as unknown as Record<string, unknown>)[key];
        if (Array.isArray(r)) {
          return r.map((n, i) => createNodePath(n, i.toString(), key, scopeId, nodePath));
        } else if (r != undefined) {
          return [createNodePath(r as ASTNode, key, key, scopeId, nodePath)];
        }
      }
      return [];
    },
    parentPath: nodePath,
    key,
    parentKey
  }
  path.stop = () => { path.shouldStop = true; };
  if (isNode(node)) {
    node.extra = node.extra ?? {};
    node.extra[nodeKey] = path;
    Object.defineProperty(node.extra, nodeKey, { enumerable: false });
  }
  pathsCreated++;
  return path;
}




function registerBinding(node: ASTNode, parentNode: ASTNode, grandParentNode: ASTNode | undefined, scopeId: number) {
  //console.log("x registerBinding?", isIdentifier(node) ? node.name : node.type, parentNode.type, grandParentNode?.type, scopeId, isBinding(node, parentNode, grandParentNode));
  if (isBinding(node, parentNode, grandParentNode) ) {
    if (isIdentifier(node) && !isAssignmentExpression(parentNode) && !isMemberExpression(parentNode)) {
      //console.log("x registerBinding!", node.name, parentNode.type, grandParentNode?.type, scopeId);
      //A bit of a hack here as well. Needs some further investigation
      if (isScope(node, parentNode)) {  
        setBinding(scopeId, node.name, { path: createNodePath(node, undefined, undefined, scopeId) });
      } else {
        setBinding(scopeId, node.name, { path: createNodePath(parentNode, undefined, undefined, scopeId) });            
      }
    }
  }
}




function registerBindings(node: ASTNode, parentNode: ASTNode, grandParentNode: ASTNode | undefined, scopeId: number) {
  if (typeof node == "object" && node != null) {
    node.extra = node.extra ?? {};
    if (node.extra["scopeId"]) return;
    node.extra["scopeId"] = scopeId;
  }
  const keys = VISITOR_KEYS[node.type];
  //console.log(keys, node);
  if (!keys) {
    return;
  }
  let childScopeId = scopeId;
  // This is also buggy. Need to investigate what creates a new scope
  if (isScopable(node)) {
    childScopeId = createScope(scopeId);
  }
  for (const key of keys) {
    const childNodes = node[key as keyof ASTNode];
    const children = Array.isArray(childNodes) ? childNodes : childNodes ? [childNodes] : [];
    children.forEach((child) => {
      if (isNode(child)) {
        // This feels like a hack. Need to figure out how to make this work 
        // for other types of scopes as well (classes, etc.)
        const s = key == "id" ? scopeId : childScopeId;
        registerBinding(child, node, parentNode, s);
        registerBindings(child, node, parentNode, s);
      }
    });
  }
  if (childScopeId != scopeId && typeof scopes[childScopeId] == "number") { // Scope has not been populated
    scopes[childScopeId] = scopes[scopeId];
    removedScopes++;
  }
}

function traverseInner<T>(
  node: ASTNode,
  visitor: Visitor<T>,
  scopeId: number | undefined, 
  state: T, 
  path?: NodePath<ASTNode>
  ) {
    const nodePath = path ?? createNodePath(node, undefined, undefined, scopeId);
    const keys = VISITOR_KEYS[node.type];
    
    if (nodePath.parentPath) registerBindings(nodePath.node, nodePath.parentPath.node, nodePath.parentPath.parentPath?.node, nodePath.scopeId);
    
    if (!keys) {
      return;
    }  

    for (const key of keys) {
      const childNodes = node[key as keyof ASTNode];
      const children = Array.isArray(childNodes) ? childNodes : childNodes ? [childNodes] : [];
      const nodePaths = children.map((child, i) => {
        if (isNode(child)) {
          return createNodePath(child, key, Array.isArray(childNodes) ? i.toString() : key, nodePath.scopeId, nodePath);
        }
        return undefined;
      }).filter(x => x != undefined) as NodePath<ASTNode>[];
      nodePaths.forEach((childPath) => {
        visitor.enter(childPath, state);
        if (childPath.shouldStop) {
          childPath.shouldStop = false;
          nodePath.shouldStop = true;
          return;
        }      
        traverseInner(childPath.node, visitor, nodePath.scopeId, state, childPath);
        if (visitor.exit) visitor.exit(childPath, state);

        if (childPath.shouldStop) {
          childPath.shouldStop = false;
          nodePath.shouldStop = true;
          return;
        }      
      });
    }
}

const sOut: number[] = [];
export default function traverse<T>(  node: ASTNode,
  visitor: Visitor<T>,
  scopeId: number | undefined, 
  state: T, 
  path?: NodePath<ASTNode>) {
  traverseInner(node, visitor, scopeId, state, path);
  if (!sOut.includes(scopeIdCounter)) {
    log.debug("Scopes created", scopeIdCounter, " Scopes removed", removedScopes, "Paths created", pathsCreated);
    sOut.push(scopeIdCounter);
  }
}