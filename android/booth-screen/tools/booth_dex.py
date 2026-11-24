"""Assemble classes.dex for the booth screen app without a JDK or D8.

This exists for one reason: the booth's own build environment has no JDK, no Android SDK and no
access to Maven, so ``javac``/``d8`` cannot run there. The class assembled here is
``MainActivity.java`` in this folder, instruction for instruction — if you edit the Java source,
edit ``main_activity()`` below to match, or simply build with Gradle/D8 and ignore this file.

Output is a v035 dex: header, string/type/proto/method id tables, one class_def, then the data
section (string data, type lists, code items, class data, map list).
"""
import hashlib
import struct
import zlib

CLASS = "Lph/photobooth/screen/MainActivity;"
ACTIVITY = "Landroid/app/Activity;"
CONTEXT = "Landroid/content/Context;"
INTENT = "Landroid/content/Intent;"
BUNDLE = "Landroid/os/Bundle;"
VIEW = "Landroid/view/View;"
WINDOW = "Landroid/view/Window;"
WSETTINGS = "Landroid/webkit/WebSettings;"
WEBVIEW = "Landroid/webkit/WebView;"
STRING = "Ljava/lang/String;"
VOID, BOOL, INT = "V", "Z", "I"

BOOTH_PREFIX = "http://127.0.0.1:47626"
NO_BOOTH_PAGE = (
    "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'>"
    "<style>html,body{height:100%}body{margin:0;display:flex;align-items:center;justify-content:center;"
    "background:#0b0f17;color:#f8fafc;font:16px system-ui,sans-serif;text-align:center}"
    "main{max-width:38ch;padding:24px}h1{font-size:22px;margin:0 0 12px}"
    "p{margin:0 0 10px;line-height:1.5;color:#cbd5e1}</style>"
    "<main><h1>Booth Screen</h1>"
    "<p>This phone is ready. On the computer, open the photo booth and press "
    "<b>Connect over USB</b> in the <b>USB cable screen</b> card.</p>"
    "<p>The screen opens by itself once the cable link is up.</p>"
    "<p>Keeping the app open on this screen is fine, and the USB cable must stay plugged in.</p>"
    "</main>"
)
SYSTEM_UI = 0x1106       # FULLSCREEN | HIDE_NAVIGATION | IMMERSIVE_STICKY | LAYOUT_STABLE
KEEP_SCREEN_ON = 0x80    # WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
BLACK = 0xFF000000

# --- opcodes used ------------------------------------------------------------------------------
RETURN_VOID, MOVE_RESULT, MOVE_RESULT_OBJECT = 0x0E, 0x0A, 0x0C
CONST_4, CONST_16, CONST_HIGH16, CONST_STRING, NEW_INSTANCE = 0x12, 0x13, 0x15, 0x1A, 0x22
GOTO, IF_EQZ = 0x28, 0x38
INVOKE_VIRTUAL, INVOKE_SUPER, INVOKE_DIRECT, INVOKE_VIRTUAL_RANGE = 0x6E, 0x6F, 0x70, 0x74

# --- symbolic instructions ---------------------------------------------------------------------
def vcall(method, *regs):    return ("invoke", INVOKE_VIRTUAL, method, tuple(regs), 35)
def scall(method, *regs):    return ("invoke", INVOKE_SUPER, method, tuple(regs), 35)
def dcall(method, *regs):    return ("invoke", INVOKE_DIRECT, method, tuple(regs), 35)
def vcall_range(method, first, count): return ("invoke", INVOKE_VIRTUAL_RANGE, method, first, count)
def const4(a, lit):          return ("const4", a, lit)
def const16(a, lit):         return ("const16", a, lit)
def consth16(a, lit):         return ("consth16", a, lit)
def const_str(a, s):         return ("str", a, s)
def new(a, t):               return ("new", a, t)
def result_obj(a):           return ("result_obj", a)
def result_int(a):           return ("result_int", a)
def ret_void():              return ("ret",)
def if_eqz(a, lbl):          return ("if_eqz", a, lbl)
def mark(name):              return ("label", name)
def jump(lbl):               return ("goto", lbl)


def uleb(n):
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        out.append(b | 0x80 if n else b)
        if not n:
            return bytes(out)


def mutf8(s):
    out = bytearray()
    for ch in s:
        cp = ord(ch)
        if cp == 0:
            out += b"\xc0\x80"
        elif cp < 0x80:
            out.append(cp)
        elif cp < 0x800:
            out += bytes([0xC0 | (cp >> 6), 0x80 | (cp & 0x3F)])
        else:
            out += bytes([0xE0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F)])
    return bytes(out)


def shorty(t):
    return t if t in ("V", "Z", "I", "J", "F", "D", "B", "S", "C") else "L"


class Dex:
    def __init__(self):
        self.methods = []   # (cls, name, (ret, params), access, code|None)

    def add(self, cls, name, ret, params, access, code):
        self.methods.append((cls, name, (ret, tuple(params)), access, code))

    # ------------------------------------------------------------------ tables
    def _tables(self):
        strings, types, protos, meths = set(), {CLASS, ACTIVITY, VOID, BOOL, INT}, set(), set()
        for cls, name, (ret, params), _a, code in self.methods:
            types.add(cls); types.add(ret); types.update(params)
            protos.add((ret, params)); meths.add((cls, name, (ret, params)))
            strings.update([name, ret, *params])
            for ins in (code["insns"] if code else []):
                if ins[0] == "invoke":
                    m = ins[2]
                    types.add(m[0]); types.add(m[2][0]); types.update(m[2][1])
                    protos.add(m[2]); meths.add(m)
                    strings.update([m[1], m[2][0], *m[2][1]])
                elif ins[0] == "str":
                    strings.add(ins[2])
                elif ins[0] == "new":
                    types.add(ins[2])
        strings |= types
        strings.add("MainActivity.java")
        strings |= {shorty(ret) + "".join(shorty(t) for t in params) for ret, params in protos}
        self.strings = sorted(strings)
        self.types = sorted(types)
        self.protos = sorted(protos, key=lambda p: (self.types.index(p[0]), [self.types.index(t) for t in p[1]]))
        self.meths = sorted(meths, key=lambda m: (self.types.index(m[0]), self.strings.index(m[1]),
                                                   self.protos.index(m[2])))
        self.si = {s: i for i, s in enumerate(self.strings)}
        self.ti = {t: i for i, t in enumerate(self.types)}
        self.pi = {p: i for i, p in enumerate(self.protos)}
        self.mi = {m: i for i, m in enumerate(self.meths)}

    # ------------------------------------------------------------------ code
    def _encode(self, code):
        insns = code["insns"]
        labels, pos = {}, 0
        for item in insns:
            if item[0] == "label":
                labels[item[1]] = pos
            elif item[0] == "invoke":
                pos += 3
            else:
                pos += self._size(item)
        units, outs = [], 0
        for item in insns:
            kind = item[0]
            if kind == "label":
                continue
            if kind == "invoke":
                _, op, method, regs_or_first, form = item
                idx = self.mi[method]
                if form == 35:
                    regs = list(regs_or_first)
                    outs = max(outs, len(regs))
                    g = regs[4] if len(regs) == 5 else 0
                    c = (regs + [0, 0, 0, 0])[:4]
                    units += [op | (g << 8) | (len(regs) << 12), idx,
                              c[0] | (c[1] << 4) | (c[2] << 8) | (c[3] << 12)]
                else:
                    outs = max(outs, form)
                    units += [op | (form << 8), idx, regs_or_first]
            elif kind == "const4":
                units.append(CONST_4 | (item[1] << 8) | ((item[2] & 0xF) << 12))
            elif kind == "const16":
                units += [CONST_16 | (item[1] << 8), item[2] & 0xFFFF]
            elif kind == "consth16":
                units += [CONST_HIGH16 | (item[1] << 8), (item[2] >> 16) & 0xFFFF]
            elif kind == "str":
                units += [CONST_STRING | (item[1] << 8), self.si[item[2]]]
            elif kind == "new":
                units += [NEW_INSTANCE | (item[1] << 8), self.ti[item[2]]]
            elif kind == "result_obj":
                units.append(MOVE_RESULT_OBJECT | (item[1] << 8))
            elif kind == "result_int":
                units.append(MOVE_RESULT | (item[1] << 8))
            elif kind == "ret":
                units.append(RETURN_VOID)
            elif kind == "if_eqz":
                off = labels[item[2]] - len(units)
                units += [IF_EQZ | (item[1] << 8), off & 0xFFFF]
            elif kind == "goto":
                off = labels[item[1]] - len(units)
                units.append(GOTO | ((off & 0xFF) << 8))
            else:
                raise AssertionError(kind)
        return {"registers": code["registers"], "ins": code["ins"], "outs": outs, "units": units}

    def _size(self, item):
        return {"const4": 1, "const16": 2, "consth16": 2, "str": 2, "new": 2,
                "result_obj": 1, "result_int": 1, "ret": 1, "if_eqz": 2, "goto": 1}[item[0]]

    # ------------------------------------------------------------------ assemble
    def build(self):
        self._tables()
        n_str, n_type, n_proto, n_meth = len(self.strings), len(self.types), len(self.protos), len(self.meths)
        n_class = len({m[0] for m in self.methods})
        off = 0x70
        string_ids_off = off; off += 4 * n_str
        type_ids_off = off;   off += 4 * n_type
        proto_ids_off = off;  off += 12 * n_proto
        method_ids_off = off; off += 8 * n_meth
        class_defs_off = off; off += 32 * n_class
        data_off = off
        data = bytearray()
        string_off = []
        for s in self.strings:
            string_off.append(len(data))
            data += uleb(len(s.encode("utf-16-le")) // 2) + mutf8(s) + b"\x00"

        def align():
            while len(data) % 4:
                data.append(0)

        align()
        params_off = []
        for ret, params in self.protos:
            if not params:
                params_off.append(0)
                continue
            align()
            params_off.append(len(data))
            data += struct.pack("<I", len(params))
            for t in params:
                data += struct.pack("<H", self.ti[t])
            if len(params) % 2:
                data += b"\x00\x00"

        code_off = []
        for cls, name, proto, access, code in self.methods:
            if code is None:
                code_off.append(0)
                continue
            align()
            enc = self._encode(code)
            code_off.append(len(data))
            blob = struct.pack("<HHHHII", enc["registers"], enc["ins"], enc["outs"], 0, 0, len(enc["units"]))
            for u in enc["units"]:
                blob += struct.pack("<H", u)
            while len(blob) % 4:
                blob += b"\x00"
            data += blob

        by_class = {}
        for i, m in enumerate(self.methods):
            by_class.setdefault(m[0], []).append(i)
        class_data_off = {}
        for cls, idxs in by_class.items():
            direct = sorted([i for i in idxs if self.methods[i][3] & (0x2 | 0x10000)],
                            key=lambda i: self.mi[(self.methods[i][0], self.methods[i][1], self.methods[i][2])])
            virt = sorted([i for i in idxs if i not in direct],
                          key=lambda i: self.mi[(self.methods[i][0], self.methods[i][1], self.methods[i][2])])
            blob = bytearray()
            blob += uleb(0) + uleb(0) + uleb(len(direct)) + uleb(len(virt))
            for group in (direct, virt):
                prev = 0
                for i in group:
                    m = (self.methods[i][0], self.methods[i][1], self.methods[i][2])
                    idx = self.mi[m]
                    blob += uleb(idx - prev) + uleb(self.methods[i][3]) + uleb((data_off + code_off[i]) if code_off[i] else 0)
                    prev = idx
            class_data_off[cls] = len(data)
            data += blob

        align()
        map_off = data_off + len(data)
        entries = [(0x0000, 1, 0), (0x0001, n_str, string_ids_off), (0x0002, n_type, type_ids_off),
                   (0x0003, n_proto, proto_ids_off), (0x0005, n_meth, method_ids_off),
                   (0x0006, n_class, class_defs_off), (0x2002, n_str, data_off)]
        if any(params_off):
            entries.append((0x1001, sum(1 for o in params_off if o), data_off + min(o for o in params_off if o)))
        if any(code_off):
            entries.append((0x2001, sum(1 for o in code_off if o), data_off + min(o for o in code_off if o)))
            entries.append((0x2000, n_class, data_off + min(class_data_off.values())))
        entries.append((0x1000, 1, map_off))
        entries.sort(key=lambda e: e[2])
        data += struct.pack("<I", len(entries))
        for t, size, o in entries:
            data += struct.pack("<HHII", t, 0, size, o)

        string_ids = b"".join(struct.pack("<I", data_off + o) for o in string_off)
        type_ids = b"".join(struct.pack("<I", self.si[t]) for t in self.types)
        protos = b"".join(struct.pack("<III", self.si[shorty(ret) + "".join(shorty(p) for p in params)],
                                      self.ti[ret], (data_off + params_off[i]) if params_off[i] else 0)
                          for i, (ret, params) in enumerate(self.protos))
        methods = b"".join(struct.pack("<HHI", self.ti[cls], self.pi[proto], self.si[name])
                           for cls, name, proto in self.meths)
        class_defs = b"".join(struct.pack("<IIIIIIII", self.ti[cls], 0x21, self.ti[ACTIVITY], 0,
                                          self.si["MainActivity.java"], 0, data_off + class_data_off[cls], 0)
                              for cls in by_class)

        body = string_ids + type_ids + protos + methods + class_defs + bytes(data)
        header = bytearray(0x70)
        header[0:8] = b"dex\n035\x00"
        struct.pack_into("<I", header, 32, 0x70 + len(body))
        struct.pack_into("<I", header, 36, 0x70)
        struct.pack_into("<I", header, 40, 0x12345678)
        struct.pack_into("<I", header, 52, map_off)
        struct.pack_into("<II", header, 56, n_str, string_ids_off)
        struct.pack_into("<II", header, 64, n_type, type_ids_off)
        struct.pack_into("<II", header, 72, n_proto, proto_ids_off)
        struct.pack_into("<II", header, 80, 0, 0)
        struct.pack_into("<II", header, 88, n_meth, method_ids_off)
        struct.pack_into("<II", header, 96, n_class, class_defs_off)
        struct.pack_into("<II", header, 104, len(data), data_off)
        out = bytearray(header) + body
        out[12:32] = hashlib.sha1(out[32:]).digest()
        struct.pack_into("<I", out, 8, zlib.adler32(bytes(out[12:])) & 0xFFFFFFFF)
        return bytes(out)


def main_activity():
    """Mirrors MainActivity.java exactly; the two are built from the same source of truth."""
    d = Dex()
    d.add(CLASS, "<init>", VOID, [], 0x10001, {
        "registers": 1, "ins": 1,
        "insns": [dcall((ACTIVITY, "<init>", (VOID, ())), 0), ret_void()]})
    hide = dcall((CLASS, "hideSystemBars", (VOID, ())), 6)
    d.add(CLASS, "onCreate", VOID, [BUNDLE], 0x4, {
        "registers": 8, "ins": 2,
        "insns": [
            scall((ACTIVITY, "onCreate", (VOID, (BUNDLE,))), 6, 7),
            vcall((ACTIVITY, "getWindow", (WINDOW, ())), 6), result_obj(1),
            const16(2, KEEP_SCREEN_ON),
            vcall((WINDOW, "addFlags", (VOID, (INT,))), 1, 2),
            new(0, WEBVIEW),
            dcall((WEBVIEW, "<init>", (VOID, (CONTEXT,))), 0, 6),
            consth16(1, BLACK),
            vcall((WEBVIEW, "setBackgroundColor", (VOID, (INT,))), 0, 1),
            vcall((WEBVIEW, "getSettings", (WSETTINGS, ())), 0), result_obj(1),
            const4(3, 1), const4(4, 0),
            vcall((WSETTINGS, "setJavaScriptEnabled", (VOID, (BOOL,))), 1, 3),
            vcall((WSETTINGS, "setDomStorageEnabled", (VOID, (BOOL,))), 1, 3),
            vcall((WSETTINGS, "setUseWideViewPort", (VOID, (BOOL,))), 1, 3),
            vcall((WSETTINGS, "setLoadWithOverviewMode", (VOID, (BOOL,))), 1, 3),
            vcall((WSETTINGS, "setSupportZoom", (VOID, (BOOL,))), 1, 4),
            vcall((WSETTINGS, "setBuiltInZoomControls", (VOID, (BOOL,))), 1, 4),
            vcall((WSETTINGS, "setDisplayZoomControls", (VOID, (BOOL,))), 1, 4),
            vcall((WSETTINGS, "setMediaPlaybackRequiresUserGesture", (VOID, (BOOL,))), 1, 3),
            vcall((ACTIVITY, "setContentView", (VOID, (VIEW,))), 6, 0),
            hide,
            vcall((ACTIVITY, "getIntent", (INTENT, ())), 6), result_obj(2),
            if_eqz(2, "fallback"),
            vcall((INTENT, "getDataString", (STRING, ())), 2), result_obj(2),
            if_eqz(2, "fallback"),
            const_str(5, BOOTH_PREFIX),
            vcall((STRING, "startsWith", (BOOL, (STRING,))), 2, 5), result_int(3),
            if_eqz(3, "fallback"),
            vcall((WEBVIEW, "loadUrl", (VOID, (STRING,))), 0, 2),
            ret_void(),
            mark("fallback"),
            const4(1, 0),
            const_str(2, NO_BOOTH_PAGE),
            const_str(3, "text/html"),
            const_str(4, "utf-8"),
            const4(5, 0),
            vcall_range((WEBVIEW, "loadDataWithBaseURL",
                         (VOID, (STRING, STRING, STRING, STRING, STRING))), 0, 6),
            ret_void()]})
    d.add(CLASS, "onNewIntent", VOID, [INTENT], 0x4, {
        "registers": 7, "ins": 2,
        "insns": [
            scall((ACTIVITY, "onNewIntent", (VOID, (INTENT,))), 5, 6),
            vcall((ACTIVITY, "setIntent", (VOID, (INTENT,))), 5, 6),
            vcall((ACTIVITY, "recreate", (VOID, ())), 5),
            ret_void()]})
    d.add(CLASS, "onResume", VOID, [], 0x4, {
        "registers": 4, "ins": 1,
        "insns": [scall((ACTIVITY, "onResume", (VOID, ())), 3),
                  dcall((CLASS, "hideSystemBars", (VOID, ())), 3), ret_void()]})
    d.add(CLASS, "hideSystemBars", VOID, [], 0x2, {
        "registers": 4, "ins": 1,
        "insns": [
            vcall((ACTIVITY, "getWindow", (WINDOW, ())), 3), result_obj(0),
            vcall((WINDOW, "getDecorView", (VIEW, ())), 0), result_obj(0),
            const16(1, SYSTEM_UI),
            vcall((VIEW, "setSystemUiVisibility", (VOID, (INT,))), 0, 1),
            ret_void()]})
    return d.build()


if __name__ == "__main__":
    import sys
    open(sys.argv[1] if len(sys.argv) > 1 else "classes.dex", "wb").write(main_activity())
