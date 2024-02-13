
import * as Babel from "@babel/types";
import * as t from '@babel/types';

export type Binding = {
  path: NodePath<Babel.Node>;
}

export type Scope = {
  getBinding(name: string): Binding | undefined;
  setBinding(name: string, binding: Binding): void;
  bindings: Map<string, Binding>;
  id: number;
};
let scopeId = 0;

function createScope(parentScope?: Scope) {
  const id = scopeId++;
  const bindings = new Map<string, Binding>();
  /*if (parentScope) {
    for (const [key, value] of parentScope.bindings.entries()) {
      bindings.set(key, value);
    }
  }*/
  return {
    bindings,
    getBinding(name: string) {
      //console.log("Looking for binding:", id, parentScope?.id, name, bindings, parentScope?.bindings);
      const s = bindings.get(name);
      //console.log("I has a binding", s);
      if (s) return s;
      if (parentScope) {
        return parentScope.getBinding(name);
      }
      return undefined;
    },
    setBinding(name: string, binding: Binding) {
      bindings.set(name, binding);
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
  const flagHolder = { shouldStop: false };
  return {
      node,
      scope: scope ?? createScope(),
      shouldStop: flagHolder,
      stop: () => { flagHolder.shouldStop = true; },
      get: (key: string) => {
        if (key in node) {
          const r = (node as unknown as Record<string, unknown>)[key];
          if (Array.isArray(r)) {
            return r.map((n, i) => createNodePath(n, i.toString(), key, scope, nodePath));
          } else if (r) {
            return [createNodePath(r as Babel.Node, key, key, scope, nodePath)];
          }
        }
        return [];
      },
      parentPath: nodePath,
      key,
      parentKey
    }
}


export default function traverse<T>(
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

    let childScope = nodePath.scope;
    if (t.SCOPABLE_TYPES.includes(node.type)){
      childScope = createScope(nodePath.scope);
    }
    for (const key of keys) {
      const childNodes = node[key as keyof Babel.Node];
      const children = Array.isArray(childNodes) ? childNodes : childNodes ? [childNodes] : [];

      children.forEach((child, i) => {
        if (child && typeof child === "object") {
          //console.log("Visiting child", key, Array.isArray(childNodes) ? i : key, (child as unknown as Babel.Node).type);
          const childPath = createNodePath(
            child as unknown as Babel.Node, 
            Array.isArray(childNodes) ? i.toString() : key, 
            key, 
            childScope, 
            nodePath
          )
          visitor.enter(childPath, state);
          if (childPath.shouldStop.shouldStop) {
            childPath.shouldStop.shouldStop = false;
            nodePath.stop();
            return;
          }      
          traverse(child as unknown as Babel.Node, visitor, nodePath.scope, state, childPath);
          if (visitor.exit) visitor.exit(childPath, state);
          if (childPath.shouldStop.shouldStop) {
            childPath.shouldStop.shouldStop = false;
            nodePath.stop();
            return;
          }      
        }
      });
    }
}