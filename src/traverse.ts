import { VISITOR_KEYS, isAssignmentExpression, isBinding, isIdentifier, isMemberExpression, isNode, isScopable, isScope } from "./nodeutils";
import { ESTree } from "meriyah";
import { isDefined, toArray } from "./utils";

const debugLogEnabled = false;

const log = {
  debug: (...args: unknown[]) => {
    if (debugLogEnabled) console.debug(...args);
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

const scopes: Array<Scope | number> = new Array(100000);

export type ASTNode = ESTree.Node & {
  extra?: {
    scopeId?: number;
    nodePath?: NodePath;
  }
};

export type NodePath = {
  node: ASTNode;
  key?: string;
  parentPath?: NodePath;
  parentKey?: string;
  scopeId: number;
};

type Visitor<T> = {
  enter: (path: NodePath, state: T) => void;
  exit: (path: NodePath, state: T) => void;
}

export default function createTraverser() {
  let scopeIdCounter = 0;
  let removedScopes = 0;

  function createScope(parentScopeId?: number): number {
    const id = scopeIdCounter++;
    scopes[id] = parentScopeId ?? -1;
    return id;
  }

  function getBinding(scopeId: number, name: string) {
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
      };
      scopes[scopeId] = scope;
    } else {
      scope = s;
    }
    scope.bindings[name] = binding;
  }



  let pathsCreated = 0;

  function getChildren(key: string, path: NodePath) : NodePath[] {
      if (key in path.node) {
        const r = (path.node as unknown as Record<string, unknown>)[key];
        if (Array.isArray(r)) {
          return r.map((n, i) => createNodePath(n, i.toString(), key, path.scopeId, path));
        } else if (r != undefined) {
          return [createNodePath(r as ASTNode, key, key, path.scopeId, path)];
        }
      }
      return [];
  }


  function createNodePath(node: ASTNode, key: string | undefined, parentKey: string | undefined, scopeId: number | undefined, nodePath?: NodePath) : NodePath {
    if (node.extra?.nodePath) {
      const path = node.extra.nodePath;
      path.key = key;
      path.parentKey = parentKey;
      path.parentPath = nodePath;
      return path;
    }
    const finalScope: number = ((node.extra && node.extra["scopeId"]) ? node.extra["scopeId"] as number : scopeId) ?? createScope();
    
    const path = {
      node,
      scopeId: finalScope,
      parentPath: nodePath,
      key,
      parentKey
    }
    if (isNode(node)) {
      node.extra = node.extra ?? {};
      node.extra.nodePath = path;
      Object.defineProperty(node.extra, "nodePath", { enumerable: false });
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
    if (keys.length == 0) return;

    let childScopeId = scopeId;
    // This is also buggy. Need to investigate what creates a new scope
    if (isScopable(node)) {
      childScopeId = createScope(scopeId);
    }
    for (const key of keys) {
      const childNodes = node[key as keyof ASTNode];
      const children = toArray(childNodes).filter(isDefined);
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
    path?: NodePath
    ) {
      const nodePath = path ?? createNodePath(node, undefined, undefined, scopeId);
      const keys = VISITOR_KEYS[node.type] ?? [];
      
      if (nodePath.parentPath) registerBindings(nodePath.node, nodePath.parentPath.node, nodePath.parentPath.parentPath?.node, nodePath.scopeId);

      for (const key of keys) {
        const childNodes = node[key as keyof ASTNode];
        const children = Array.isArray(childNodes) ? childNodes : childNodes ? [childNodes] : [];
        const nodePaths = children.map((child, i) => {
          if (isNode(child)) {
            return createNodePath(child, key, Array.isArray(childNodes) ? i.toString() : key, nodePath.scopeId, nodePath);
          }
          return undefined;
        }).filter(x => x != undefined) as NodePath[];
        nodePaths.forEach((childPath) => {
          visitor.enter(childPath, state);   
          traverseInner(childPath.node, visitor, nodePath.scopeId, state, childPath);
          visitor.exit(childPath, state);   
        });
      }
  }

  const sOut: number[] = [];

  function traverse<T>(  node: ASTNode,
    visitor: Visitor<T>,
    scopeId: number | undefined, 
    state: T, 
    path?: NodePath) {
    traverseInner(node, visitor, scopeId, state, path);
    if (!sOut.includes(scopeIdCounter)) {
      log.debug("Scopes created", scopeIdCounter, " Scopes removed", removedScopes, "Paths created", pathsCreated);
      sOut.push(scopeIdCounter);
    }
  }
  return {
    traverse,
    createNodePath,
    getChildren,
    getBinding
  }
}