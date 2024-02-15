
import * as Babel from "@babel/types";
import * as t from '@babel/types';

const debugLogEnabled = false;

const log = {
  debug: (...args: unknown[]) => {
    if (debugLogEnabled) console.debug(...args);
  }
}
export type Binding = {
  path: NodePath<Babel.Node>;
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
  get(key: string): NodePath<Babel.Node>[];
  scopeId: number;
  shouldStop: boolean;
};

type Visitor<T> = {
  enter: (path: NodePath<Babel.Node>, state: T) => void;
  exit?: (path: NodePath<Babel.Node>, state: T) => void;
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
  if (scope.parentScopeId) {
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

function createNodePath(node: Babel.Node, key: string | undefined, parentKey: string | undefined, scopeId: number | undefined, nodePath?: NodePath<Babel.Node>) : NodePath<Babel.Node> {
  if (node.extra && node.extra["babel-q-path"]) {
    const path = node.extra["babel-q-path"] as NodePath<Babel.Node>;
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
          return [createNodePath(r as Babel.Node, key, key, scopeId, nodePath)];
        }
      }
      return [];
    },
    parentPath: nodePath,
    key,
    parentKey
  }
  path.stop = () => { path.shouldStop = true; };
  if (t.isNode(node)) {
    node.extra = node.extra ?? {};
    node.extra["babel-q-path"] = path;
  }
  pathsCreated++;
  return path;
}


function registerBinding(node: Babel.Node, parentNode: Babel.Node, grandParentNode: Babel.Node | undefined, scopeId: number) {
  if (t.isBinding(node, parentNode, grandParentNode) && !t.isMemberExpression(node)) {
    if (t.isIdentifier(node) && !t.isAssignmentExpression(parentNode)) {
      //A bit of a hack here as well. Needs some further investigation
      if (t.isFunctionDeclaration(parentNode) || t.isFunctionExpression(parentNode) || t.isScope(node, parentNode)) {  
        setBinding(scopeId, node.name, { path: createNodePath(node, undefined, undefined, scopeId) });
      } else {
        setBinding(scopeId, node.name, { path: createNodePath(parentNode, undefined, undefined, scopeId) });            
      }
    }
  }
}

function registerBindings(node: Babel.Node, parentNode: Babel.Node, grandParentNode: Babel.Node | undefined, scopeId: number) {
  if (typeof node == "object" && node != null) {
    node.extra = node.extra ?? {};
    if (node.extra["scopeId"]) return;
    node.extra["scopeId"] = scopeId;
  }
  const keys = t.VISITOR_KEYS[node.type];

  let childScopeId = scopeId;
  // This is also buggy. Need to investigate what creates a new scope
  if (t.isScopable(node) || t.isExportSpecifier(node)) {
    childScopeId = createScope(scopeId);
  }
  for (const key of keys) {
    const childNodes = node[key as keyof Babel.Node];
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

function isNode(candidate: unknown): candidate is Babel.Node {
  //return typeof candidate === "object" && candidate != null && "type" in candidate;
  return t.isNode(candidate);
}

function traverseInner<T>(
  node: Babel.Node,
  visitor: Visitor<T>,
  scopeId: number | undefined, 
  state: T, 
  path?: NodePath<Babel.Node>
  ) {
    const nodePath = path ?? createNodePath(node, undefined, undefined, scopeId);
    const keys = t.VISITOR_KEYS[node.type];
    
    if (nodePath.parentPath) registerBindings(nodePath.node, nodePath.parentPath.node, nodePath.parentPath.parentPath?.node, nodePath.scopeId);
    
    for (const key of keys) {
      const childNodes = node[key as keyof Babel.Node];
      const children = Array.isArray(childNodes) ? childNodes : childNodes ? [childNodes] : [];
      const nodePaths = children.map((child, i) => {
        if (isNode(child)) {
          return createNodePath(child, key, Array.isArray(childNodes) ? i.toString() : key, nodePath.scopeId, nodePath);
        }
        return undefined;
      }).filter(x => x != undefined) as NodePath<Babel.Node>[];
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
export default function traverse<T>(  node: Babel.Node,
  visitor: Visitor<T>,
  scopeId: number | undefined, 
  state: T, 
  path?: NodePath<Babel.Node>) {
  traverseInner(node, visitor, scopeId, state, path);
  if (!sOut.includes(scopeIdCounter)) {
    log.debug("Scopes created", scopeIdCounter, " Scopes removed", removedScopes);
    console.log("Scopes created", scopeIdCounter, " Scopes removed", removedScopes, "Paths created", pathsCreated);
    sOut.push(scopeIdCounter);
  }
}