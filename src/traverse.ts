
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
  parentScope?: Scope;
  id: number;
};

let scopeId = 0;

function createScope(parentScope?: Scope) {
  const id = scopeId++;
  const bindings: Record<string, Binding> = {};
  return {
    bindings,
    id,
    parentScope
  }
}
export function getBinding(scope: Scope, name: string) {
  const s = scope.bindings[name];
  if (s) return s;
  if (scope.parentScope) {
    return getBinding(scope.parentScope, name);
  }
  return undefined;
}
function setBinding(scope: Scope, name: string, binding: Binding) {
  scope.bindings[name] = binding;
}


const voidFn = () => {};

export type NodePath<T> = {
  node: T;
  key?: string;
  parentPath?: NodePath<T>;
  parentKey?: string;
  stop: () => void;
  get(key: string): NodePath<Babel.Node>[];
  scope: Scope,
  shouldStop: boolean;
};

type Visitor<T> = {
  enter: (path: NodePath<Babel.Node>, state: T) => void;
  exit?: (path: NodePath<Babel.Node>, state: T) => void;
}

function createNodePath(node: Babel.Node, key: string | undefined, parentKey: string | undefined, scope: Scope | undefined, nodePath?: NodePath<Babel.Node>) : NodePath<Babel.Node> {
  if (node.extra && node.extra["babel-q-path"]) {
    const path = node.extra["babel-q-path"] as NodePath<Babel.Node>;
    path.key = key;
    path.parentKey = parentKey;
    path.parentPath = nodePath;
    return path;
  }
  const finalScope: Scope = ((node.extra && node.extra["scope"]) ? node.extra["scope"] as Scope : scope) ?? createScope();
  
  const path = {
      node,
      scope: finalScope,
      shouldStop: false,
      stop: voidFn,
      get: (key: string) => {
        if (key in node) {
          const r = (node as unknown as Record<string, unknown>)[key];
          if (Array.isArray(r)) {
            return r.map((n, i) => createNodePath(n, i.toString(), key, scope, nodePath));
          } else if (r != undefined) {
            return [createNodePath(r as Babel.Node, key, key, scope, nodePath)];
          }
        }
        return [];
      },
      parentPath: nodePath,
      key,
      parentKey
    }
    path.stop = () => { path.shouldStop = true; };
    return path;
}


function registerBinding(node: Babel.Node, parentNode: Babel.Node, grandParentNode: Babel.Node | undefined, scope: Scope) {
  if (t.isBinding(node, parentNode, grandParentNode) && !t.isMemberExpression(node)) {
    if (t.isIdentifier(node) && !t.isAssignmentExpression(parentNode)) {
      if (t.isFunctionDeclaration(parentNode) || t.isFunctionExpression(parentNode) || t.isScope(node, parentNode)) {  
        setBinding(scope, node.name, { path: createNodePath(node, undefined, undefined, scope) });
      } else {
        setBinding(scope, node.name, { path: createNodePath(parentNode, undefined, undefined, scope) });            
      }
    }
  }
}

function registerBindings(node: Babel.Node, parentNode: Babel.Node, grandParentNode: Babel.Node | undefined, scope: Scope) {
  if (typeof node == "object" && node != null) {
    node.extra = node.extra ?? {};
    if (node.extra["scope"]) return;
    node.extra["scope"] = scope;
  }
  const keys = t.VISITOR_KEYS[node.type];
  let childScope = scope;
  if (t.isScope(node, parentNode) || t.isExportSpecifier(node)) {
    childScope = createScope(scope);
  }

  for (const key of keys) {
    const childNodes = node[key as keyof Babel.Node];
    const children = Array.isArray(childNodes) ? childNodes : childNodes ? [childNodes] : [];
    children.forEach((child) => {
      if (isNode(child)) {
        registerBinding(child, node, parentNode, childScope);
        registerBindings(child, node, parentNode, childScope);
      }
    });

  }
}

function isNode(candidate: unknown): candidate is Babel.Node {
  //return typeof candidate === "object" && candidate != null && "type" in candidate;
  return t.isNode(candidate);
}

function traverseInner<T>(
  node: Babel.Node,
  visitor: Visitor<T>,
  scope: Scope | undefined, 
  state: T, 
  path?: NodePath<Babel.Node>
  ) {
    const nodePath = path ?? createNodePath(node, undefined, undefined, scope);
    const keys = t.VISITOR_KEYS[node.type];
    
    if (nodePath.parentPath) registerBindings(nodePath.node, nodePath.parentPath.node, nodePath.parentPath.parentPath?.node, nodePath.scope);
    
    for (const key of keys) {
      const childNodes = node[key as keyof Babel.Node];
      const children = Array.isArray(childNodes) ? childNodes : childNodes ? [childNodes] : [];
      const nodePaths = children.map((child, i) => {
        if (isNode(child)) {
          return createNodePath(child, key, Array.isArray(childNodes) ? i.toString() : key, nodePath.scope, nodePath);
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
        traverseInner(childPath.node, visitor, nodePath.scope, state, childPath);
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
  scope: Scope | undefined, 
  state: T, 
  path?: NodePath<Babel.Node>) {
  traverseInner(node, visitor, scope, state, path);
  if (!sOut.includes(scopeId)) {
    log.debug("Scopes created", scopeId);
    sOut.push(scopeId);
  }
  
}