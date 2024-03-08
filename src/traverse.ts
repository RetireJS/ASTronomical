import { VISITOR_KEYS, isAssignmentExpression, isBinding, isExportSpecifier, isFunctionDeclaration, isFunctionExpression, isIdentifier, isMemberExpression, isNode, isPrimitive, isScopable, isScope, isUpdateExpression, isVariableDeclaration, isVariableDeclarator } from "./nodeutils";
import { ESTree } from "meriyah";
import { isDefined, toArray } from "./utils";
import { PrimitiveValue } from ".";

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
    if (s != undefined) return s;
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
      children.forEach((child, i) => {
        if (!isNode(child)) return;
        const f = key == "body" && (isFunctionDeclaration(node) || isFunctionExpression(node)) ? childScopeId : functionScopeId;
        stack.push(child);
        if (isIdentifier(child)) {
          const k = Array.isArray(childNodes) ? i : key;
          registerBinding(stack, childScopeId, f, k, key);
        } else {
          registerBindings(stack, childScopeId, f);
        }
        stack.pop();
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
        const nodePaths = children.map((child, i) => {
          if (isNode(child)) {
            return createNodePath(child, Array.isArray(childNodes) ? i : key, key, nodePath.scopeId, nodePath.functionScopeId, nodePath);
          }
          return undefined;
        }).filter(x => x != undefined) as NodePath[];
        nodePaths.forEach((childPath) => {
          visitor.enter(childPath, state);   
          traverseInner(childPath.node, visitor, nodePath.scopeId, nodePath.functionScopeId, state, childPath);
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
