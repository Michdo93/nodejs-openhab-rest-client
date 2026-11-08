"""
Generates the REST classes of js-openhab-rest-client from python-openhab-rest-client.

The Python library is the reference: every method of a REST class is translated
statement by statement (same endpoint, headers, query parameters, body, status
handling and messages). Only a small, regular subset of Python is supported;
anything else raises an error so that nothing is translated silently wrong.

Usage: python3 py2js.py <path to python-openhab-rest-client/openhab> > classes.js
"""
import ast
import glob
import json
import os
import sys

# Methods that take their optional parameters as one options object in JS
# (kept from js-openhab-rest-client 1.x for compatibility).
OPTIONS_METHODS = {
    ("Items", "getItems"), ("Items", "getItem"),
    ("Persistence", "getItemPersistenceData"),
    ("Voice", "startDialog"), ("Voice", "listenAndAnswer"),
    ("Auth", "getToken"),
}
# Index of the first parameter that goes into the options object (default: first optional one)
OPTIONS_FROM = {("Persistence", "getItemPersistenceData"): 2, ("Voice", "listenAndAnswer"): 4}
SKIP_FILES = ("Async", "__", "Client", "SSE")


class Unsupported(Exception):
    pass


def js_str(s):
    return json.dumps(s, ensure_ascii=False)


class Translator:
    def __init__(self, cls, method):
        self.cls, self.method = cls, method
        self.declared = set()

    # ------------------------------------------------------------------ expressions
    def expr(self, n):
        m = getattr(self, "e_" + type(n).__name__, None)
        if not m:
            raise Unsupported(f"{self.cls}.{self.method}: expression {ast.unparse(n)}")
        return m(n)

    def e_Constant(self, n):
        if n.value is None:
            return "null"
        if n.value is True:
            return "true"
        if n.value is False:
            return "false"
        if isinstance(n.value, str):
            return js_str(n.value)
        return repr(n.value)

    def e_Name(self, n):
        return {"self": "this"}.get(n.id, n.id)

    def e_JoinedStr(self, n):
        out = ""
        for v in n.values:
            if isinstance(v, ast.Constant):
                out += v.value.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")
            elif isinstance(v, ast.FormattedValue):
                if v.format_spec is not None:
                    raise Unsupported(f"{self.cls}.{self.method}: format spec")
                inner = self.expr(v.value)
                out += "${" + inner + "}"
        return "`" + out + "`"

    def e_Dict(self, n):
        parts = []
        for k, v in zip(n.keys, n.values):
            if k is None:
                parts.append("..." + self.expr(v))
            elif isinstance(k, ast.Constant) and isinstance(k.value, str):
                key = k.value if k.value.isidentifier() else js_str(k.value)
                val = self.expr(v)
                parts.append(key if (val == key and k.value.isidentifier()) else f"{key}: {val}")
            else:
                parts.append(f"[{self.expr(k)}]: {self.expr(v)}")
        return "{ " + ", ".join(parts) + " }" if parts else "{}"

    def e_List(self, n):
        return "[" + ", ".join(self.expr(e) for e in n.elts) + "]"

    e_Tuple = e_List

    def e_Subscript(self, n):
        sl = n.slice
        if isinstance(sl, ast.UnaryOp) and isinstance(sl.op, ast.USub):
            return f"{self.expr(n.value)}.at({self.expr(sl)})"
        if isinstance(sl, ast.Slice):
            raise Unsupported(f"{self.cls}.{self.method}: slice")
        return f"{self.expr(n.value)}[{self.expr(sl)}]"

    def e_Attribute(self, n):
        src = ast.unparse(n)
        if src == "err.response.status_code":
            return "err.status"
        if src == "err.response":
            return "err.response"
        return f"{self.expr(n.value)}.{n.attr}"

    def e_BoolOp(self, n):
        op = " && " if isinstance(n.op, ast.And) else " || "
        return "(" + op.join(self.expr(v) for v in n.values) + ")"

    def e_UnaryOp(self, n):
        if isinstance(n.op, ast.Not):
            return f"!({self.expr(n.operand)})"
        if isinstance(n.op, ast.USub):
            return f"-{self.expr(n.operand)}"
        raise Unsupported(ast.unparse(n))

    def e_BinOp(self, n):
        if isinstance(n.op, ast.Add):
            return f"({self.expr(n.left)} + {self.expr(n.right)})"
        raise Unsupported(f"{self.cls}.{self.method}: {ast.unparse(n)}")

    def e_IfExp(self, n):
        return f"({self.expr(n.test)} ? {self.expr(n.body)} : {self.expr(n.orelse)})"

    def e_Compare(self, n):
        if len(n.ops) != 1:
            raise Unsupported(ast.unparse(n))
        op, left, right = n.ops[0], n.left, n.comparators[0]
        L, R = self.expr(left), self.expr(right)
        if isinstance(op, (ast.Is, ast.Eq)):
            return f"{L} === {R}" if R != "null" else f"({L} === null || {L} === undefined)"
        if isinstance(op, (ast.IsNot, ast.NotEq)):
            return f"{L} !== {R}" if R != "null" else f"({L} !== null && {L} !== undefined)"
        if isinstance(op, ast.In):
            return f"_contains({R}, {L})"
        if isinstance(op, ast.NotIn):
            return f"!_contains({R}, {L})"
        sym = {ast.Lt: "<", ast.Gt: ">", ast.LtE: "<=", ast.GtE: ">="}[type(op)]
        return f"{L} {sym} {R}"

    def e_DictComp(self, n):
        gen = n.generators[0]
        src = ast.unparse(gen.iter)
        if not src.endswith(".items()"):
            raise Unsupported(ast.unparse(n))
        obj = self.expr(gen.iter.func.value)
        k, v = (e.id for e in gen.target.elts)
        conds = " && ".join(self.expr(c) for c in gen.ifs) or "true"
        return (f"Object.fromEntries(Object.entries({obj}).filter(([{k}, {v}]) => {conds})"
                f".map(([{k}, {v}]) => [{self.expr(n.key)}, {self.expr(n.value)}]))")

    def kw(self, call):
        return {k.arg: self.expr(k.value) for k in call.keywords}

    def e_Call(self, n):
        f = n.func
        args = [self.expr(a) for a in n.args]
        kws = self.kw(n)
        # self.client.<verb>(...)
        if isinstance(f, ast.Attribute) and ast.unparse(f.value) == "self.client":
            verb = f.attr
            if verb in ("get", "post", "put", "delete"):
                path = args[0] if args else kws.pop("endpoint")
                headers = kws.get("headers", "{}")
                params = kws.get("params", "null")
                data = kws.get("data", "null")
                if verb == "get":
                    return f"await this.client.get({path}, {headers}, {params})"
                return f"await this.client.{verb}({path}, {headers}, {data}, {params})"
            if verb == "executeSSE":
                return f"await this.client.executeSSE({args[0]}, {kws.get('headers', 'null')}, {kws.get('params', 'null')})"
        if isinstance(f, ast.Attribute) and isinstance(f.value, ast.Name) and f.value.id == "self":
            return f"this.{f.attr}({', '.join(args + list(kws.values()))})" if not kws else \
                f"this.{f.attr}({', '.join(args)}{', ' if args else ''}{', '.join(kws.values())})"
        if isinstance(f, ast.Name):
            name = f.id
            if name == "str":
                a = n.args[0]
                if isinstance(a, ast.Name) and a.id == "err":
                    return "err.message"
                return f"String({args[0]})"
            if name == "isinstance":
                t = ast.unparse(n.args[1])
                if t == "StatusResponse":
                    return f"({args[0]} instanceof StatusResponse)"
                if t == "dict":
                    return f"_isPlainObject({args[0]})"
                if t in ("list", "(list, tuple)"):
                    return f"Array.isArray({args[0]})"
                if t == "str":
                    return f"(typeof {args[0]} === \"string\")"
                if t == "bool":
                    return f"(typeof {args[0]} === \"boolean\")"
                raise Unsupported(f"isinstance {t}")
            if name == "quote":
                return f"encodeURIComponent({args[0]})"
            if name == "urlencode":
                return f"_urlencode({args[0]})"
            if name == "dict":
                return "{ ..." + args[0] + " }"
            if name == "len":
                return f"{args[0]}.length"
            if name == "_openStream":
                opts = ", ".join(f"{k}: {v}" for k, v in kws.items())
                rest = args[1:]
                return f"_openStream(this.client, {rest[0] if rest else 'null'}{', { ' + opts + ' }' if opts else ''})"
            raise Unsupported(f"{self.cls}.{self.method}: call {name}")
        if isinstance(f, ast.Attribute):
            obj = self.expr(f.value)
            a = f.attr
            src = ast.unparse(f.value)
            if src in ("json",) and a == "dumps":
                return f"JSON.stringify({args[0]})"
            if src in ("urllib.parse",) and a == "quote":
                return f"encodeURIComponent({args[0]})"
            if a == "get":  # dict.get
                return f"({obj}[{args[0]}] ?? {args[1] if len(args) > 1 else 'null'})" if len(args) > 1 \
                    else f"({obj}[{args[0]}] ?? null)"
            if a == "lower":
                return f"{obj}.toLowerCase()"
            if a == "strip":
                return f"{obj}.trim()"
            if a == "rstrip":
                ch = n.args[0].value
                return f"{obj}.replace(/{ch.replace('/', '\\/')}+$/, \"\")"
            if a == "split":
                return f"{obj}.split({args[0]})"
            if a == "join":
                return f"{args[0]}.join({obj})"
            if a == "items":
                return f"Object.entries({obj})"
        raise Unsupported(f"{self.cls}.{self.method}: call {ast.unparse(n)}")

    # ------------------------------------------------------------------ statements
    def block(self, stmts, ind):
        out = []
        for s in stmts:
            out += self.stmt(s, ind)
        return out

    def stmt(self, s, ind):
        p = "  " * ind
        if isinstance(s, ast.Expr) and isinstance(s.value, ast.Constant):
            return []  # docstring
        if isinstance(s, ast.Return):
            return [p + "return " + (self.expr(s.value) if s.value else "undefined") + ";"]
        if isinstance(s, ast.Assign):
            t = s.targets[0]
            if isinstance(t, ast.Name):
                kw = "" if t.id in self.declared else "let "
                self.declared.add(t.id)
                return [f"{p}{kw}{t.id} = {self.expr(s.value)};"]
            return [f"{p}{self.expr(t)} = {self.expr(s.value)};"]
        if isinstance(s, ast.If):
            out = [f"{p}if ({self.strip_parens(self.expr(s.test))}) {{"] + self.block(s.body, ind + 1)
            orelse = s.orelse
            while len(orelse) == 1 and isinstance(orelse[0], ast.If):
                e = orelse[0]
                out += [f"{p}}} else if ({self.strip_parens(self.expr(e.test))}) {{"] + self.block(e.body, ind + 1)
                orelse = e.orelse
            if orelse:
                out += [f"{p}}} else {{"] + self.block(orelse, ind + 1)
            return out + [p + "}"]
        if isinstance(s, ast.Try):
            # Variables assigned inside try are used after it -> declare up front
            names = sorted({t.id for n in ast.walk(s) if isinstance(n, ast.Assign)
                            for t in n.targets if isinstance(t, ast.Name)} - self.declared)
            out = [f"{p}let {', '.join(names)};"] if names else []
            self.declared |= set(names)
            out += [p + "try {"] + self.block(s.body, ind + 1) + [p + "} catch (err) {"]
            http = req = None
            for h in s.handlers:
                t = ast.unparse(h.type)
                if t.endswith("HTTPError"):
                    http = h
                elif t.endswith("RequestException"):
                    req = h
                else:
                    raise Unsupported(f"{self.cls}.{self.method}: except {t}")
            out += [p + "  if (!(err instanceof OpenHABHTTPError)) {"]
            out += self.block(req.body, ind + 2) if req else [p + "    throw err;"]
            out += [p + "  }"]
            if http:
                out += self.block(http.body, ind + 1)
            else:
                out += [p + "  throw err;"]
            if s.orelse or s.finalbody:
                raise Unsupported("try/else/finally")
            return out + [p + "}"]
        if isinstance(s, ast.Pass):
            return []
        raise Unsupported(f"{self.cls}.{self.method}: statement {type(s).__name__}: {ast.unparse(s)[:80]}")

    @staticmethod
    def strip_parens(x):
        if x.startswith("(") and x.endswith(")"):
            depth = 0
            for i, ch in enumerate(x):
                depth += ch == "("
                depth -= ch == ")"
                if depth == 0 and i < len(x) - 1:
                    return x
            return x[1:-1]
        return x


def signature(cls, fn):
    a = fn.args
    names = [x.arg for x in a.args][1:]
    defaults = [None] * (len(names) - len(a.defaults)) + list(a.defaults)
    tr = Translator(cls, fn.name)
    req, opt = [], []
    for n, d in zip(names, defaults):
        (req if d is None else opt).append((n, tr.expr(d) if d is not None else None))
    if (cls, fn.name) in OPTIONS_METHODS and opt:
        allp = req + opt
        k = OPTIONS_FROM.get((cls, fn.name), len(req))
        pos, rest = allp[:k], allp[k:]
        inner = ", ".join(f"{n} = {d if d is not None else 'null'}" for n, d in rest)
        head = [n if d is None else f"{n} = {d}" for n, d in pos]
        return ", ".join(head + [f"{{ {inner} }} = {{}}"])
    return ", ".join([n for n, _ in req] + [f"{n} = {d}" for n, d in opt])


def jsdoc(fn, ind):
    doc = ast.get_docstring(fn)
    if not doc:
        return []
    doc = js_words(doc)
    p = "  " * ind
    lines = [l.rstrip() for l in doc.splitlines()]
    out = [p + "/**"]
    for l in lines:
        l = l.replace(":param ", "@param ").replace(":return:", "@returns").replace("*/", "* /")
        out.append(p + (" * " + l if l else " *"))
    return out + [p + " */"]


def translate_file(path):
    tree = ast.parse(open(path, encoding="utf-8").read())
    out = []
    for c in tree.body:
        if not isinstance(c, ast.ClassDef):
            continue
        out.append(f"class {c.name} {{")
        out.append("  constructor(client) {")
        out.append("    this.client = client;")
        out.append("  }")
        for fn in c.body:
            if not isinstance(fn, ast.FunctionDef) or fn.name == "__init__":
                continue
            tr = Translator(c.name, fn.name)
            tr.declared = {x.arg for x in fn.args.args}
            body = tr.block(fn.body, 2)
            is_async = any("await " in l for l in body)
            out.append("")
            out += jsdoc(fn, 1)
            out.append(f"  {'async ' if is_async else ''}{fn.name}({signature(c.name, fn)}) {{")
            out += body
            out.append("  }")
        out.append("}")
        out.append("")
        out.append(f"class Async{c.name} extends {c.name} {{}}")
        out.append("")
    return out, [c.name for c in tree.body if isinstance(c, ast.ClassDef)]


def main():
    src = sys.argv[1]
    files = sorted(f for f in glob.glob(os.path.join(src, "*.py"))
                   if not os.path.basename(f).startswith(SKIP_FILES))
    names = []
    for f in files:
        lines, cls = translate_file(f)
        names += cls
        bar = "// " + "=" * 77
        print(bar)
        print("// " + ", ".join(cls) + f"  (generated from {os.path.basename(f)})")
        print(bar)
        print()
        print("\n".join(lines))
    print("const __generatedClasses = { " + ", ".join(
        f"{n}, Async{n}" for n in names) + " };")




# ---------------------------------------------------------------------- README reference
PY_WORDS = [("(Dictionary)", "(object)"), ("Dictionary", "object"), ("dictionary", "object"),
            ("True", "true"), ("False", "false"), ("None", "null"), (" dict", " object"),
            ("requests.Response", "fetch Response"), ("iter_lines()", "iterSSEEvents()")]


def js_words(text):
    for a, b in PY_WORDS:
        text = text.replace(a, b)
    return text


def parse_doc(doc):
    """Splits a docstring into description, params and return text."""
    desc, params, ret = [], [], ""
    cur = None
    for line in (doc or "").splitlines():
        s = line.strip()
        if s.startswith(":param "):
            name, _, text = s[7:].partition(":")
            params.append([name.strip(), text.strip()])
            cur = params[-1]
        elif s.startswith(":return:"):
            ret = s[8:].strip()
            cur = "ret"
        elif s and cur == "ret":
            ret += " " + s
        elif s and cur:
            cur[1] += " " + s
        elif s and not params:
            desc.append(s)
    return " ".join(desc), params, ret


def markdown(src):
    files = sorted(f for f in glob.glob(os.path.join(src, "*.py"))
                   if not os.path.basename(f).startswith(SKIP_FILES))
    out = []
    for f in files:
        tree = ast.parse(open(f, encoding="utf-8").read())
        for c in [n for n in tree.body if isinstance(n, ast.ClassDef)]:
            out += [f"### {c.name}", ""]
            cdoc = ast.get_docstring(c)
            if cdoc:
                out += [js_words(cdoc.strip()), ""]
            var = c.name[0].lower() + c.name[1:]
            out += ["```js", f"const {var} = new {c.name}(client);   // or new Async{c.name}(client)", "```", ""]
            for fn in c.body:
                if not isinstance(fn, ast.FunctionDef) or fn.name.startswith("_"):
                    continue
                desc, params, ret = parse_doc(js_words(ast.get_docstring(fn) or ""))
                out += [f"#### `{fn.name}({signature(c.name, fn)})`", ""]
                if desc:
                    out += [desc, ""]
                if params:
                    out += [f"- `{n}` – {t}" for n, t in params] + [""]
                if ret:
                    out += [f"**Returns:** {ret}", ""]
            out += ["---", ""]
    return "\n".join(out)


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[2] == "--markdown":
        print(markdown(sys.argv[1]))
    else:
        main()
