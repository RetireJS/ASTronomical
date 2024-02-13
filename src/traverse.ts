
import * as Babel from "@babel/types";
import * as t from '@babel/types';

export type Binding = {
  path: NodePath<Babel.Node>;
}

export type Scope = {
  getBinding(name: string): Binding | undefined;
  setBinding(name: string, binding: Binding): void;
  bindings: Record<string, Binding>;
  id: number;
};
let scopeId = 0;

function createScope(parentScope?: Scope) {
  const id = scopeId++;
  const bindings: Record<string, Binding> = {};
  /*if (parentScope) {
    for (const [key, value] of parentScope.bindings.entries()) {
      bindings.set(key, value);
    }
  }*/
  return {
    bindings,
    getBinding(name: string) {
      //console.log("Looking for binding:", id, parentScope?.id, name, bindings, parentScope?.bindings);
      const s = bindings[name];
      //if (name == "me") console.log(Array.from(bindings.keys()), s, parentScope?.bindings.get(name));
      //console.log("I has a binding", s);
      if (s) return s;
      if (parentScope) {
        return parentScope.getBinding(name);
      }
      return undefined;
    },
    setBinding(name: string, binding: Binding) {
      bindings[name] = binding;
      //console.log("Adding binding: ", id, parentScope?.id, name, Array.from(bindings.keys()), binding.path.node.type);
    },
    id
  }
}

export type NodePath<T> = {
  node: T;
  key?: string;
  parentPath?: NodePath<T>;
  parentKey?: string;
  stop: () => void;
  get(key: string): NodePath<Babel.Node>[];
  scope: Scope,
  shouldStop: { shouldStop: boolean };
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
  
  const flagHolder = { shouldStop: false };
  const path = {
      node,
      scope: finalScope,
      shouldStop: flagHolder,
      stop: () => { flagHolder.shouldStop = true; },
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
    //console.log("Creating path", node);
    /*if (typeof node == "object" && node != null) {
      node.extra = node.extra ?? {};
      node.extra["babel-q-path"] = path;
    }*/
    return path;
}


/*function registerBinding(nodePath: NodePath<Babel.Node>) {
  const node = nodePath.node;
  if (nodePath.parentPath && t.isBinding(node, nodePath.parentPath!.node, nodePath.parentPath!.parentPath?.node) && !t.isMemberExpression(node)) {
    if (t.isIdentifier(node) && !t.isAssignmentExpression(nodePath.parentPath?.node)) {
      if (t.isFunctionDeclaration(nodePath.parentPath?.node) || t.isFunctionExpression(nodePath.parentPath?.node)) {
        //console.log("I am a function", nodePath.node.type, nodePath.parentPath?.node.type, t.isIdentifier(node));
        nodePath.scope.setBinding(node.name, { path: nodePath });
      } else {
        //console.log("I am a bingind", nodePath.node.type, nodePath.parentPath?.node.type, t.isIdentifier(node));
        nodePath.scope.setBinding(node.name, { path: nodePath.parentPath });            
      }
    }
  }
}*/

function registerBinding(node: Babel.Node, parentNode: Babel.Node, grandParentNode: Babel.Node | undefined, scope: Scope) {
  if (t.isBinding(node, parentNode, grandParentNode) && !t.isMemberExpression(node)) {
    if (t.isIdentifier(node) && !t.isAssignmentExpression(parentNode)) {
      if (t.isFunctionDeclaration(parentNode) || t.isFunctionExpression(parentNode) || t.isScopable(parentNode)) {
        //console.log("I am a function", nodePath.node.type, nodePath.parentPath?.node.type, t.isIdentifier(node));
        scope.setBinding(node.name, { path: createNodePath(node, undefined, undefined, scope) });
      } else {
        /*if (node.name == "me") {
          console.log("I am a binging", node.name, nodePath.node.type, nodePath.parentPath?.node.type, t.isIdentifier(node));
        }*/
        //console.log("I am a bingind", nodePath.node.type, nodePath.parentPath?.node.type, t.isIdentifier(node));
        scope.setBinding(node.name, { path: createNodePath(parentNode, undefined, undefined, scope) });            
      }
    }
  }
}
//const scopeStarting = [ "BlockStatement", "FunctionExpression", "ArrowFunctionExpression"];

function registerBindings(node: Babel.Node, parentNode: Babel.Node, grandParentNode: Babel.Node | undefined, scope: Scope, depth: number = 0) {
  if (typeof node == "object" && node != null) {
    node.extra = node.extra ?? {};
    if (node.extra["scope"]) return;
    node.extra["scope"] = scope;
  }
  const keys = t.VISITOR_KEYS[node.type];
  let childScope = scope;
  //if (scopeStarting.includes(node.type)){
  //if (t.isScope(node, parentNode)) {
  if (t.isScope(node, parentNode) || t.isExportSpecifier(node)) {
     //if (depth > 1) return;
    childScope = createScope(scope);
    depth++;
  }

  for (const key of keys) {
    const childNodes = node[key as keyof Babel.Node];
    const children = Array.isArray(childNodes) ? childNodes : childNodes ? [childNodes] : [];
    /*const nodePaths = children.map((child, i) => {
      if (!(child && typeof child === "object")) return undefined
      return createNodePath(
        child as unknown as Babel.Node, 
        Array.isArray(childNodes) ? i.toString() : key, 
        key, 
        childScope, 
        nodePath
      );
    }).filter(x => x != undefined) as NodePath<Babel.Node>[];*/
    children.map((child) => {
      if (!(child && typeof child === "object")) return undefined
      // @ts-ignore
      registerBinding(child as Babel.Node, node, parentNode, childScope);
      // @ts-ignore
      registerBindings(child as Babel.Node, node, parentNode, childScope, depth);
    });    
  }
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


    /*if (t.isIdentifier(node)) {
      if (nodePath.parentPath) {
        console.log(node, nodePath.node.type, nodePath.parentPath.node.type, nodePath.key, nodePath.parentKey, t.isBinding(node));
      }
    }*/
    
    if (nodePath.parentPath) registerBindings(nodePath.node, nodePath.parentPath.node, nodePath.parentPath.parentPath?.node, nodePath.scope);
    
    for (const key of keys) {
      const childNodes = node[key as keyof Babel.Node];
      const children = Array.isArray(childNodes) ? childNodes : childNodes ? [childNodes] : [];
      const nodePaths = children.map((child, i) => {
        if (!(child && typeof child === "object")) return undefined;
        // @ts-ignore
        return createNodePath(child as Babel.Node, key, Array.isArray(childNodes) ? i.toString() : key, nodePath.scope, nodePath);
      }).filter(x => x != undefined) as NodePath<Babel.Node>[];
      nodePaths.forEach((childPath) => {
        visitor.enter(childPath, state);
        if (childPath.shouldStop.shouldStop) {
          childPath.shouldStop.shouldStop = false;
          nodePath.stop();
          return;
        }      
        traverseInner(childPath.node, visitor, nodePath.scope, state, childPath);
        if (visitor.exit) visitor.exit(childPath, state);
        /*if (Object.keys(nodePath.scope.bindings).length == 0 && nodePath.node.extra) {
          nodePath.node.extra["scope"] = undefined;
        }*/
        if (childPath.shouldStop.shouldStop) {
          childPath.shouldStop.shouldStop = false;
          nodePath.stop();
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
    console.log("Scopes created", scopeId);
    sOut.push(scopeId);
  }
  
}