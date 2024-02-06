import { tokenize, parse, Condition } from '../src/parseQuery';

describe('tokenization', () => {
  test('single descendant', () => {
    const tokens = tokenize("//abc");
    expect(tokens.length).toEqual(2);
    expect(tokens[0]).toEqual({ type: "descendant" });
    expect(tokens[1]).toEqual({ type: "identifier", value: "abc" });
  });
  test('single child', () => {
    const tokens = tokenize("/abc");
    expect(tokens.length).toEqual(2);
    expect(tokens[0]).toEqual({ type: "child" });
    expect(tokens[1]).toEqual({ type: "identifier", value: "abc" });
  });
  test('two children', () => {
    const tokens = tokenize("/abc/def");
    expect(tokens.length).toEqual(4);
    expect(tokens[0]).toEqual({ type: "child" });
    expect(tokens[1]).toEqual({ type: "identifier", value: "abc" });
    expect(tokens[2]).toEqual({ type: "child" });
    expect(tokens[3]).toEqual({ type: "identifier", value: "def" });
  });
  test('attribute', () => {
    const tokens = tokenize("/:abc");
    expect(tokens.length).toEqual(3);
    expect(tokens[0]).toEqual({ type: "child" });
    expect(tokens[1]).toEqual({ type: "attributeSelector" });
    expect(tokens[2]).toEqual({ type: "identifier", value: "abc" });
  });
  test('single filter', () => {
    const tokens = tokenize("/abc[/def]");
    expect(tokens.length).toEqual(6);
    expect(tokens[0]).toEqual({ type: "child" });
    expect(tokens[1]).toEqual({ type: "identifier", value: "abc" });
    expect(tokens[2]).toEqual({ type: "filterBegin"});
    expect(tokens[3]).toEqual({ type: "child"});
    expect(tokens[4]).toEqual({ type: "identifier", value: "def" });
    expect(tokens[5]).toEqual({ type: "filterEnd"});
  });
  test('and filter', () => {
    const tokens = tokenize("/abc[/def && /ghi]");
    expect(tokens.length).toEqual(9);
    expect(tokens[0]).toEqual({ type: "child" });
    expect(tokens[1]).toEqual({ type: "identifier", value: "abc" });
    expect(tokens[2]).toEqual({ type: "filterBegin"});
    expect(tokens[3]).toEqual({ type: "child"});
    expect(tokens[4]).toEqual({ type: "identifier", value: "def" });
    expect(tokens[5]).toEqual({ type: "and"});
    expect(tokens[6]).toEqual({ type: "child"});
    expect(tokens[7]).toEqual({ type: "identifier", value: "ghi" });
    expect(tokens[8]).toEqual({ type: "filterEnd"});
  });
  test('or filter', () => {
    const tokens = tokenize("/abc[/def || /ghi]");
    expect(tokens.length).toEqual(9);
    expect(tokens[0]).toEqual({ type: "child" });
    expect(tokens[1]).toEqual({ type: "identifier", value: "abc" });
    expect(tokens[2]).toEqual({ type: "filterBegin"});
    expect(tokens[3]).toEqual({ type: "child"});
    expect(tokens[4]).toEqual({ type: "identifier", value: "def" });
    expect(tokens[5]).toEqual({ type: "or"});
    expect(tokens[6]).toEqual({ type: "child"});
    expect(tokens[7]).toEqual({ type: "identifier", value: "ghi" });
    expect(tokens[8]).toEqual({ type: "filterEnd"});
  });
  test('== filter', () => {
    const tokens = tokenize("/abc[/def == '12 3']");
    expect(tokens.length).toEqual(8);
    expect(tokens[0]).toEqual({ type: "child" });
    expect(tokens[1]).toEqual({ type: "identifier", value: "abc" });
    expect(tokens[2]).toEqual({ type: "filterBegin"});
    expect(tokens[3]).toEqual({ type: "child"});
    expect(tokens[4]).toEqual({ type: "identifier", value: "def" });
    expect(tokens[5]).toEqual({ type: "eq"});
    expect(tokens[6]).toEqual({ type: "literal", value: "12 3" });
    expect(tokens[7]).toEqual({ type: "filterEnd"});
  });
  test('child filter child', () => {
    const tokens = tokenize("/abc[/def]/ghi");
    expect(tokens.length).toEqual(8);
    expect(tokens[0]).toEqual({ type: "child" });
    expect(tokens[1]).toEqual({ type: "identifier", value: "abc" });
    expect(tokens[2]).toEqual({ type: "filterBegin"});
    expect(tokens[3]).toEqual({ type: "child"});
    expect(tokens[4]).toEqual({ type: "identifier", value: "def" });
    expect(tokens[5]).toEqual({ type: "filterEnd"});
    expect(tokens[6]).toEqual({ type: "child"});
    expect(tokens[7]).toEqual({ type: "identifier", value: "ghi" });
  });
  test('nested filter child', () => {
    const tokens = tokenize("/abc[/def[/ghi]]");
    expect(tokens.length).toEqual(10);
    expect(tokens[0]).toEqual({ type: "child" });
    expect(tokens[1]).toEqual({ type: "identifier", value: "abc" });
    expect(tokens[2]).toEqual({ type: "filterBegin"});
    expect(tokens[3]).toEqual({ type: "child"});
    expect(tokens[4]).toEqual({ type: "identifier", value: "def" });
    expect(tokens[5]).toEqual({ type: "filterBegin"});
    expect(tokens[6]).toEqual({ type: "child"});
    expect(tokens[7]).toEqual({ type: "identifier", value: "ghi" });
    expect(tokens[8]).toEqual({ type: "filterEnd"});
    expect(tokens[9]).toEqual({ type: "filterEnd"});
  });
});


describe('testing index file', () => {
  test('dummy', () => {})

  test('single descendant', () => {
    const node = parse("//FunctionDeclaration");
    expect(node).toMatchObject({ type: "descendant", value: "FunctionDeclaration" });
  });
  test('single child', () => {
    const node = parse("/FunctionDeclaration");
    expect(node).toMatchObject({ type: "child", value: "FunctionDeclaration" });
  });
  
  test('single child', () => {
    const node = parse("/FunctionDeclaration/:bb");
    expect(node.type).toEqual("child");
    expect(node.child).toMatchObject({ type: "child", value: "bb", attribute: true });
  });
  
  
  test('descendant / child', () => {
    const node = parse("//FunctionDeclaration/AssignmentExpression");
    expect(node?.type).toEqual("descendant");
    expect(node?.child).toMatchObject({ type: "child", value: "AssignmentExpression" });

  });
  
  test('child / descendant', () => {
    const node = parse("/FunctionDeclaration//AssignmentExpression");
    expect(node?.type).toEqual("child");
    expect(node?.child).toMatchObject({ type: "descendant", value: "AssignmentExpression" });

  });
  
  test('child / descendant / child', () => {
    const node = parse("/FunctionDeclaration//ExpressionStatement/AssignmentExpression");
    expect(node?.type).toEqual("child");
    expect(node?.child?.type).toEqual("descendant");
    expect(node?.child?.child?.type).toEqual("child");
  });
  
  test('single filter condition', () => {
    const node = parse("/FunctionDeclaration[/ExpressionStatement]");
    expect(node?.type).toEqual("child");
    expect(node?.filter).toMatchObject({type: "child", value: "ExpressionStatement"});
  });
  

  test('double filter condition', () => {
    const node = parse("/FunctionDeclaration[/ExpressionStatement && /AssignmentExpression]");
    expect(node?.type).toEqual("child");
    expect(node?.filter?.type).toEqual("and");
    const and = node?.filter as Condition;
    expect(and.left).toMatchObject({type: "child", value: "ExpressionStatement"});
    expect(and.right).toMatchObject({type: "child", value: "AssignmentExpression"});
  });
  
  

  test('nested filter condition', () => {
    const node = parse("/FunctionDeclaration[/ExpressionStatement[/AssignmentExpression]]");
    expect(node?.type).toEqual("child");
    expect(node?.filter?.type).toEqual("child");
    expect(node?.filter?.filter).toMatchObject({type: "child", value: "AssignmentExpression"});
  });
    

  test('single equals condition', () => {
    const node = parse('/FunctionDeclaration[/:x == "2"]');
    expect(node?.filter?.type).toEqual("equals");
    const filter = node.filter as Condition;
    expect(filter.left).toMatchObject({type: "child", value: "x"});
    expect(filter.right).toMatchObject({type: "literal", value: "2"});
  });

  test('double equals condition', () => {
    const node = parse('/FunctionDeclaration[/:x == "2" && /:y == "3"]');
    expect(node?.filter?.type).toEqual("and");
    const condition = node.filter as Condition;
    expect(condition.left.type).toEqual("equals");
    const leftCondition = condition.left as Condition;
    expect(leftCondition.left).toMatchObject({type: "child", value: "x"});
    expect(leftCondition.right).toMatchObject({type: "literal", value: "2"});
    expect(condition.right.type).toEqual("equals");
    const rightCondition = condition.right as Condition;
    expect(rightCondition.left).toMatchObject({type: "child", value: "y"});
    expect(rightCondition.right).toMatchObject({type: "literal", value: "3"});
  });

  test('continue after filter', () => {
    const node = parse('/FunctionDeclaration[/:x]/:y');
    expect(node?.filter).toMatchObject({ type:"child", value: "x" });
    expect(node?.child).toMatchObject({ type:"child", value: "y" });
  });
  
  test('descendant variable', () => {
    const node = parse('/FunctionDeclaration[//:x == "2"]');
    expect(node?.filter).toMatchObject({ type: "equals" });
    const condition = node?.filter as Condition;
    expect(condition.left).toMatchObject({ type: "descendant", value: "x", attribute: true });
    expect(condition.right).toMatchObject({ type: "literal" });
  });
  
  test('assignment to parameter', () => {
    const node = parse("//FunctionDeclaration[/:params/:name == //AssignmentExpression/:left/:name]");
    expect(node?.filter).toMatchObject({ type: "equals" });
  });
  
  test('access parent in filter', () => {
    const node = parse(`//FunctionDeclaration//AssignmentExpression[
      ../../:params/:name == /:left/:object/:name
    ]`);
    expect(node).toMatchObject({ type: "descendant", value: "FunctionDeclaration" });
    expect(node?.child).toMatchObject({ type: "descendant", value: "AssignmentExpression" });
    expect(node?.child?.filter).toMatchObject({ type: "equals" });
    const condition = node?.child?.filter as Condition;
    expect(condition.left).toMatchObject({ type: "parent" });
    expect(condition.left.child).toMatchObject({ type: "parent" });
  })

  test('assignment to parameter', () => {
    const node = parse(`//FunctionDeclaration/*
    /AssignmentExpression`);
    expect(node).toMatchObject({ type: "descendant", value: "FunctionDeclaration" });
    expect(node?.child).toMatchObject({ type: "child", value: "*" });
    expect(node?.child?.child).toMatchObject({ type: "child", value: "AssignmentExpression" });
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
    expect(node).toMatchObject({ type: "descendant", value: "AssignmentExpression" });
    expect(node?.child).toMatchObject({ type: "child", resolve: true });
  })
});
