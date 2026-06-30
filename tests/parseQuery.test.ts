import { describe, test } from 'node:test';
import { expect } from 'expect';
import { tokenize, parse, Condition, FunctionCall, NodeType, TokenType } from '../src/parseQuery';

describe('tokenization', () => {
  
  test('single descendant', () => {
    const tokens = tokenize("//abc");
    expect(tokens.length).toEqual(2);
    expect(tokens[0]).toEqual({ tokenType: TokenType.DESCENDANT });
    expect(tokens[1]).toEqual({ tokenType:  TokenType.IDENTIFIER, value: "abc" });
  });
  test('single child', () => {
    const tokens = tokenize("/abc");
    expect(tokens.length).toEqual(2);
    expect(tokens[0]).toEqual({ tokenType: TokenType.CHILD });
    expect(tokens[1]).toEqual({ tokenType: TokenType.IDENTIFIER, value: "abc" });
  });
  test('two children', () => {
    const tokens = tokenize("/abc/def");
    expect(tokens.length).toEqual(4);
    expect(tokens[0]).toEqual({ tokenType: TokenType.CHILD });
    expect(tokens[1]).toEqual({ tokenType: TokenType.IDENTIFIER, value: "abc" });
    expect(tokens[2]).toEqual({ tokenType: TokenType.CHILD });
    expect(tokens[3]).toEqual({ tokenType: TokenType.IDENTIFIER, value: "def" });
  });
  test('attribute', () => {
    const tokens = tokenize("/:abc");
    expect(tokens.length).toEqual(3);
    expect(tokens[0]).toEqual({ tokenType: TokenType.CHILD });
    expect(tokens[1]).toEqual({ tokenType: TokenType.ATTRIBUTESELECTOR });
    expect(tokens[2]).toEqual({ tokenType: TokenType.IDENTIFIER, value: "abc" });
  });
  test('single filter', () => {
    const tokens = tokenize("/abc[/def]");
    expect(tokens.length).toEqual(6);
    expect(tokens[0]).toEqual({ tokenType: TokenType.CHILD });
    expect(tokens[1]).toEqual({ tokenType: TokenType.IDENTIFIER, value: "abc" });
    expect(tokens[2]).toEqual({ tokenType: TokenType.FILTERBEGIN});
    expect(tokens[3]).toEqual({ tokenType: TokenType.CHILD});
    expect(tokens[4]).toEqual({ tokenType: TokenType.IDENTIFIER, value: "def" });
    expect(tokens[5]).toEqual({ tokenType: TokenType.FILTEREND});
  });
  test('and filter', () => {
    const tokens = tokenize("/abc[/def && /ghi]");
    expect(tokens.length).toEqual(9);
    expect(tokens[0]).toEqual({ tokenType: TokenType.CHILD });
    expect(tokens[1]).toEqual({ tokenType: TokenType.IDENTIFIER, value: "abc" });
    expect(tokens[2]).toEqual({ tokenType: TokenType.FILTERBEGIN});
    expect(tokens[3]).toEqual({ tokenType: TokenType.CHILD});
    expect(tokens[4]).toEqual({ tokenType: TokenType.IDENTIFIER, value: "def" });
    expect(tokens[5]).toEqual({ tokenType: TokenType.AND});
    expect(tokens[6]).toEqual({ tokenType: TokenType.CHILD});
    expect(tokens[7]).toEqual({ tokenType: TokenType.IDENTIFIER, value: "ghi" });
    expect(tokens[8]).toEqual({ tokenType: TokenType.FILTEREND});
  });
  test('or filter', () => {
    const tokens = tokenize("/abc[/def || /ghi]");
    expect(tokens.length).toEqual(9);
    expect(tokens[0]).toEqual({ tokenType: TokenType.CHILD });
    expect(tokens[1]).toEqual({ tokenType: TokenType.IDENTIFIER, value: "abc" });
    expect(tokens[2]).toEqual({ tokenType: TokenType.FILTERBEGIN});
    expect(tokens[3]).toEqual({ tokenType: TokenType.CHILD});
    expect(tokens[4]).toEqual({ tokenType: TokenType.IDENTIFIER, value: "def" });
    expect(tokens[5]).toEqual({ tokenType: TokenType.OR});
    expect(tokens[6]).toEqual({ tokenType: TokenType.CHILD});
    expect(tokens[7]).toEqual({ tokenType: TokenType.IDENTIFIER, value: "ghi" });
    expect(tokens[8]).toEqual({ tokenType: TokenType.FILTEREND});
  });
  test('== filter', () => {
    const tokens = tokenize("/abc[/def == '12 3']");
    expect(tokens.length).toEqual(8);
    expect(tokens[0]).toEqual({ tokenType: TokenType.CHILD });
    expect(tokens[1]).toEqual({ tokenType: TokenType.IDENTIFIER, value: "abc" });
    expect(tokens[2]).toEqual({ tokenType: TokenType.FILTERBEGIN});
    expect(tokens[3]).toEqual({ tokenType: TokenType.CHILD});
    expect(tokens[4]).toEqual({ tokenType: TokenType.IDENTIFIER, value: "def" });
    expect(tokens[5]).toEqual({ tokenType: TokenType.EQUALS});
    expect(tokens[6]).toEqual({ tokenType: TokenType.LITERAL, value: "12 3" });
    expect(tokens[7]).toEqual({ tokenType: TokenType.FILTEREND});
  });
  test('child filter child', () => {
    const tokens = tokenize("/abc[/def]/ghi");
    expect(tokens.length).toEqual(8);
    expect(tokens[0]).toEqual({ tokenType: TokenType.CHILD });
    expect(tokens[1]).toEqual({ tokenType: TokenType.IDENTIFIER, value: "abc" });
    expect(tokens[2]).toEqual({ tokenType: TokenType.FILTERBEGIN});
    expect(tokens[3]).toEqual({ tokenType: TokenType.CHILD});
    expect(tokens[4]).toEqual({ tokenType: TokenType.IDENTIFIER, value: "def" });
    expect(tokens[5]).toEqual({ tokenType: TokenType.FILTEREND});
    expect(tokens[6]).toEqual({ tokenType: TokenType.CHILD});
    expect(tokens[7]).toEqual({ tokenType: TokenType.IDENTIFIER, value: "ghi" });
  });
  test('nested filter child', () => {
    const tokens = tokenize("/abc[/def[/ghi]]");
    expect(tokens.length).toEqual(10);
    expect(tokens[0]).toEqual({ tokenType: TokenType.CHILD });
    expect(tokens[1]).toEqual({ tokenType: TokenType.IDENTIFIER, value: "abc" });
    expect(tokens[2]).toEqual({ tokenType: TokenType.FILTERBEGIN});
    expect(tokens[3]).toEqual({ tokenType: TokenType.CHILD});
    expect(tokens[4]).toEqual({ tokenType: TokenType.IDENTIFIER, value: "def" });
    expect(tokens[5]).toEqual({ tokenType: TokenType.FILTERBEGIN});
    expect(tokens[6]).toEqual({ tokenType: TokenType.CHILD});
    expect(tokens[7]).toEqual({ tokenType: TokenType.IDENTIFIER, value: "ghi" });
    expect(tokens[8]).toEqual({ tokenType: TokenType.FILTEREND});
    expect(tokens[9]).toEqual({ tokenType: TokenType.FILTEREND});
  });
});


describe('testing index file', () => {
  test('dummy', () => {})

  test('single descendant', () => {
    const node = parse("//FunctionDeclaration");
    expect(node).toMatchObject({ type: NodeType.DESCENDANT, value: "FunctionDeclaration" });
  });
  test('single child', () => {
    const node = parse("/FunctionDeclaration");
    expect(node).toMatchObject({ type: NodeType.CHILD, value: "FunctionDeclaration" });
  });
  
  test('single child', () => {
    const node = parse("/FunctionDeclaration/:bb");
    expect(node.type).toEqual(NodeType.CHILD);
    expect(node.child).toMatchObject({ type: NodeType.CHILD, value: "bb", attribute: true });
  });
  
  
  test('descendant / child', () => {
    const node = parse("//FunctionDeclaration/AssignmentExpression");
    expect(node?.type).toEqual(NodeType.DESCENDANT);
    expect(node?.child).toMatchObject({ type: NodeType.CHILD, value: "AssignmentExpression" });

  });
  
  test('child / descendant', () => {
    const node = parse("/FunctionDeclaration//AssignmentExpression");
    expect(node?.type).toEqual(NodeType.CHILD);
    expect(node?.child).toMatchObject({ type: NodeType.DESCENDANT, value: "AssignmentExpression" });

  });
  
  test('child / descendant / child', () => {
    const node = parse("/FunctionDeclaration//ExpressionStatement/AssignmentExpression");
    expect(node?.type).toEqual(NodeType.CHILD);
    expect(node?.child?.type).toEqual(NodeType.DESCENDANT);
    expect(node?.child?.child?.type).toEqual(NodeType.CHILD);
  });
  
  test('single filter condition', () => {
    const node = parse("/FunctionDeclaration[/ExpressionStatement]");
    expect(node?.type).toEqual(NodeType.CHILD);
    expect(node?.filter).toMatchObject({type: NodeType.CHILD, value: "ExpressionStatement"});
  });
  

  test('double filter condition', () => {
    const node = parse("/FunctionDeclaration[/ExpressionStatement && /AssignmentExpression]");
    expect(node?.type).toEqual(NodeType.CHILD);
    expect(node?.filter?.type).toEqual(NodeType.AND);
    const and = node?.filter as Condition;
    expect(and.left).toMatchObject({type: NodeType.CHILD, value: "ExpressionStatement"});
    expect(and.right).toMatchObject({type: NodeType.CHILD, value: "AssignmentExpression"});
  });
  
  

  test('nested filter condition', () => {
    const node = parse("/FunctionDeclaration[/ExpressionStatement[/AssignmentExpression]]");
    expect(node?.type).toEqual(NodeType.CHILD);
    expect(node?.filter?.type).toEqual(NodeType.CHILD);
    expect(node?.filter?.filter).toMatchObject({type: NodeType.CHILD, value: "AssignmentExpression"});
  });
    

  test('single equals condition', () => {
    const node = parse('/FunctionDeclaration[/:x == "2"]');
    expect(node?.filter?.type).toEqual(NodeType.EQUALS);
    const filter = node.filter as Condition;
    expect(filter.left).toMatchObject({type: NodeType.CHILD, value: "x"});
    expect(filter.right).toMatchObject({type: NodeType.LITERAL, value: "2"});
  });

  test('double equals condition', () => {
    const node = parse('/FunctionDeclaration[/:x == "2" && /:y == "3"]');
    expect(node?.filter?.type).toEqual(NodeType.AND);
    const condition = node.filter as Condition;
    expect(condition.left.type).toEqual(NodeType.EQUALS);
    const leftCondition = condition.left as Condition;
    expect(leftCondition.left).toMatchObject({type: NodeType.CHILD, value: "x"});
    expect(leftCondition.right).toMatchObject({type: NodeType.LITERAL, value: "2"});
    expect(condition.right.type).toEqual(NodeType.EQUALS);
    const rightCondition = condition.right as Condition;
    expect(rightCondition.left).toMatchObject({type: NodeType.CHILD, value: "y"});
    expect(rightCondition.right).toMatchObject({type: NodeType.LITERAL, value: "3"});
  });

  test('continue after filter', () => {
    const node = parse('/FunctionDeclaration[/:x]/:y');
    expect(node?.filter).toMatchObject({ type: NodeType.CHILD, value: "x" });
    expect(node?.child).toMatchObject({ type: NodeType.CHILD, value: "y" });
  });
  
  test('descendant variable', () => {
    const node = parse('/FunctionDeclaration[//:x == "2"]');
    expect(node?.filter).toMatchObject({ type: NodeType.EQUALS });
    const condition = node?.filter as Condition;
    expect(condition.left).toMatchObject({ type: NodeType.DESCENDANT, value: "x", attribute: true });
    expect(condition.right).toMatchObject({ type: NodeType.LITERAL });
  });
  
  test('assignment to parameter', () => {
    const node = parse("//FunctionDeclaration[/:params/:name == //AssignmentExpression/:left/:name]");
    expect(node?.filter).toMatchObject({ type: NodeType.EQUALS });
  });
  
  test('access parent in filter', () => {
    const node = parse(`//FunctionDeclaration//AssignmentExpression[
      ../../:params/:name == /:left/:object/:name
    ]`);
    expect(node).toMatchObject({ type: NodeType.DESCENDANT, value: "FunctionDeclaration" });
    expect(node?.child).toMatchObject({ type: NodeType.DESCENDANT, value: "AssignmentExpression" });
    expect(node?.child?.filter).toMatchObject({ type: NodeType.EQUALS });
    const condition = node?.child?.filter as Condition;
    expect(condition.left).toMatchObject({ type: NodeType.PARENT });
    expect(condition.left.child).toMatchObject({ type: NodeType.PARENT });
  })

  test('assignment to parameter', () => {
    const node = parse(`//FunctionDeclaration/*
    /AssignmentExpression`);
    expect(node).toMatchObject({ type: NodeType.DESCENDANT, value: "FunctionDeclaration" });
    expect(node?.child).toMatchObject({ type: NodeType.CHILD, value: "*" });
    expect(node?.child?.child).toMatchObject({ type: NodeType.CHILD, value: "AssignmentExpression" });
  });

  test('variable is bound to parameter', () => {
    const node = parse(`//FunctionDeclaration/*
    /*
    /AssignmentExpression[
      /$:left == ../../:params
    ]`);
    //expect(node?.child?.child?.child?.filter).toMatchObject({ type: "binding" });
    const condition = node?.child?.child?.child?.filter as Condition;
    expect(condition.left.binding).toEqual(true);
  });
  test('auto resolve value', () => {
    const node = parse(`//AssignmentExpression/$$:right/:value`);
    expect(node).toMatchObject({ type: NodeType.DESCENDANT, value: "AssignmentExpression" });
    expect(node?.child).toMatchObject({ type: NodeType.CHILD, resolve: true });
  });
  
  test('invoke joining of values function', () => {
    const node = parse('//ObjectExpression/:properties/fn:join(/:value, ".")');
    expect(node).toMatchObject({ type: NodeType.DESCENDANT, value: "ObjectExpression" });
    expect(node?.child).toMatchObject({ type: NodeType.CHILD, attribute: true, value: "properties" });
    expect(node?.child?.child).toMatchObject({ type: NodeType.FUNCTION, function: "join" });
    const fn = node?.child?.child as FunctionCall;
    expect(fn.parameters[0]).toMatchObject({ type: NodeType.CHILD, value: "value" });
    expect(fn.parameters[1]).toMatchObject({ type: NodeType.LITERAL, value: "." });
  });

  test('function in function', () => {
    const node = parse("//ObjectExpression/fn:concat(/fn:first(/:properties/:value/:value), 'ms')");
    expect(node).toMatchObject({ type: NodeType.DESCENDANT, value: "ObjectExpression" });
    expect(node?.child).toMatchObject({ type: NodeType.FUNCTION, function: "concat" });
    const fn = node?.child as FunctionCall;
    expect(fn.parameters[0]).toMatchObject({ type: NodeType.FUNCTION, function: "first" });
    expect(fn.parameters[1]).toMatchObject({ type: NodeType.LITERAL, value: "ms" });
    const fn2 = fn.parameters[0] as FunctionCall;
    expect(fn2.parameters[0]).toMatchObject({ type: NodeType.CHILD, value: "properties" });
  });
  test('should parse', () => {
    const node = parse(`//ObjectExpression/fn:join(/:value/:value, ".")`);
    expect(node).toMatchObject({ type: NodeType.DESCENDANT, value: "ObjectExpression" });
  })
});
