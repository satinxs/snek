class Variable { constructor(scope, value) { this.scope = scope; this.value = value; } }

export function interpret(nodes) {
    let scope = 0; let variables = new Map();

    const _startScope = () => scope += 1;
    const _endScope = () => {
        for (const [k, v] of variables.entries())
            if (v.scope === scope) variables.delete(k);
        scope -= 1;
    };
    const _get = k => variables.get(k) ? variables.get(k).value : null;
    const _set = (k, v) => {
        if (variables.has(k)) variables.get(k).value = v;
        else variables.set(k, new Variable(scope, v));
    };

    const _runFunctionDef = f => {
        console.log(f);
    };

    //Main walk function
    const walk = node => {
        try {
            switch (node.type) {
                case 'Def': return _runFunctionDef(node);
                default:
                // throw new Error(`Unexpected AST node = "${JSON.stringify(node)}"`);
            }

        } catch (error) {
            console.error('Encountered an error when executing your program.', error);
        }
    };

    //Actual execution loop
    for (const node in nodes)
        walk(node);
}