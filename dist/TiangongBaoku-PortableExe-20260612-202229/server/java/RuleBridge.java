import org.mozilla.javascript.*;
import java.io.*;
import java.net.URI;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.regex.*;

/**
 * Legado @js: rule execution bridge.
 *
 * Usage: java RuleBridge < sourceUrl < rule_key > [page]
 *   stdin  = JavaScript code (the portion after @js:)
 *   arg[0] = source URL (bookSourceUrl)
 *   arg[1] = rule key (search keyword or result data)
 *   arg[2] = page number (optional, default 1)
 *   stdout = JSON with { result, error? }
 */
public class RuleBridge {

    private static final Map<String, String> sessionStore = new LinkedHashMap<>();
    private static final Map<String, String> cookieStore = new LinkedHashMap<>();
    private static String sourceUrl = "";

    public static void main(String[] args) throws Exception {
        if (args.length < 2) {
            System.err.println("Usage: java RuleBridge <sourceUrl> <key> [page]");
            System.exit(1);
        }

        sourceUrl = args[0];
        String key = args[1];
        int page = args.length > 2 ? Integer.parseInt(args[2]) : 1;

        // Read JS code from stdin
        StringBuilder jsCode = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                jsCode.append(line).append('\n');
            }
        }

        Context cx = Context.enter();
        try {
            cx.setOptimizationLevel(-1);
            cx.setLanguageVersion(Context.VERSION_ES6);
            Scriptable scope = cx.initStandardObjects();

            // Expose java.* polyfills
            Scriptable javaObj = cx.newObject(scope);
            exposeJavaApi(cx, scope, javaObj);
            ScriptableObject.putProperty(scope, "java", javaObj);

            // Expose source polyfill
            Scriptable sourceObj = cx.newObject(scope);
            exposeSourceApi(cx, scope, sourceObj);
            ScriptableObject.putProperty(scope, "source", sourceObj);

            // Expose cookie polyfill
            Scriptable cookieObj = cx.newObject(scope);
            exposeCookieApi(cx, scope, cookieObj);
            ScriptableObject.putProperty(scope, "cookie", cookieObj);

            // Expose global variables
            ScriptableObject.putProperty(scope, "result", "");
            ScriptableObject.putProperty(scope, "baseUrl", sourceUrl);
            ScriptableObject.putProperty(scope, "key", key);
            ScriptableObject.putProperty(scope, "page", page);

            // Execute JS
            Object jsResult = cx.evaluateString(scope, jsCode.toString(), "rule.js", 1, null);

            // Get result
            Object result = ScriptableObject.getProperty(scope, "result");
            String output = result != null ? Context.toString(result) : "";
            if (output.isEmpty() && jsResult != null && !(jsResult instanceof Undefined)) {
                output = Context.toString(jsResult);
            }

            System.out.println(output);

        } catch (Exception e) {
            System.err.println("JS Error: " + e.getMessage());
            e.printStackTrace(System.err);
            System.out.println("");  // Empty result on error
        } finally {
            Context.exit();
        }
    }

    private static void exposeJavaApi(Context cx, Scriptable scope, Scriptable javaObj) {
        // java.ajax(url) - HTTP GET
        Function ajax = new BaseFunction() {
            @Override
            public Object call(Context cx, Scriptable s, Scriptable thisObj, Object[] args) {
                try {
                    String url = args.length > 0 ? Context.toString(args[0]) : "";
                    HttpClient client = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NORMAL).build();
                    HttpRequest req = HttpRequest.newBuilder()
                        .uri(URI.create(url))
                        .header("User-Agent", "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36")
                        .timeout(java.time.Duration.ofSeconds(10))
                        .GET().build();
                    HttpResponse<String> resp = client.send(req, HttpResponse.BodyHandlers.ofString());
                    return resp.body();
                } catch (Exception e) {
                    return "";
                }
            }
        };
        ScriptableObject.putProperty(javaObj, "ajax", ajax);

        // java.get(key)
        Function getFn = new BaseFunction() {
            @Override public Object call(Context cx, Scriptable s, Scriptable thisObj, Object[] args) {
                String k = args.length > 0 ? Context.toString(args[0]) : "";
                return sessionStore.getOrDefault(k, "");
            }
        };
        ScriptableObject.putProperty(javaObj, "get", getFn);

        // java.put(key, value)
        Function putFn = new BaseFunction() {
            @Override public Object call(Context cx, Scriptable s, Scriptable thisObj, Object[] args) {
                if (args.length >= 2) {
                    sessionStore.put(Context.toString(args[0]), Context.toString(args[1]));
                }
                return args.length >= 2 ? args[1] : "";
            }
        };
        ScriptableObject.putProperty(javaObj, "put", putFn);

        // java.getWebViewUA()
        ScriptableObject.putProperty(javaObj, "getWebViewUA", new BaseFunction() {
            @Override public Object call(Context cx, Scriptable s, Scriptable thisObj, Object[] args) {
                return "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36";
            }
        });

        // java.md5Encode(str)
        ScriptableObject.putProperty(javaObj, "md5Encode", new BaseFunction() {
            @Override public Object call(Context cx, Scriptable s, Scriptable thisObj, Object[] args) {
                try {
                    String str = args.length > 0 ? Context.toString(args[0]) : "";
                    MessageDigest md = MessageDigest.getInstance("MD5");
                    byte[] digest = md.digest(str.getBytes(StandardCharsets.UTF_8));
                    StringBuilder sb = new StringBuilder();
                    for (byte b : digest) sb.append(String.format("%02x", b));
                    return sb.toString();
                } catch (Exception e) { return ""; }
            }
        });

        // java.base64Encode
        ScriptableObject.putProperty(javaObj, "base64Encode", new BaseFunction() {
            @Override public Object call(Context cx, Scriptable s, Scriptable thisObj, Object[] args) {
                String str = args.length > 0 ? Context.toString(args[0]) : "";
                return Base64.getEncoder().encodeToString(str.getBytes(StandardCharsets.UTF_8));
            }
        });

        // java.base64Decode
        ScriptableObject.putProperty(javaObj, "base64Decode", new BaseFunction() {
            @Override public Object call(Context cx, Scriptable s, Scriptable thisObj, Object[] args) {
                try {
                    String str = args.length > 0 ? Context.toString(args[0]) : "";
                    return new String(Base64.getDecoder().decode(str), StandardCharsets.UTF_8);
                } catch (Exception e) { return ""; }
            }
        });

        // java.hexDecodeToString
        ScriptableObject.putProperty(javaObj, "hexDecodeToString", new BaseFunction() {
            @Override public Object call(Context cx, Scriptable s, Scriptable thisObj, Object[] args) {
                try {
                    String hex = args.length > 0 ? Context.toString(args[0]) : "";
                    byte[] bytes = new byte[hex.length() / 2];
                    for (int i = 0; i < bytes.length; i++) {
                        bytes[i] = (byte) Integer.parseInt(hex.substring(i*2, i*2+2), 16);
                    }
                    return new String(bytes, StandardCharsets.UTF_8);
                } catch (Exception e) { return ""; }
            }
        });

        // java.t2s (traditional to simplified) — simplified stub
        ScriptableObject.putProperty(javaObj, "t2s", new BaseFunction() {
            @Override public Object call(Context cx, Scriptable s, Scriptable thisObj, Object[] args) {
                return args.length > 0 ? Context.toString(args[0]) : "";
            }
        });

        // java.s2t — simplified stub
        ScriptableObject.putProperty(javaObj, "s2t", new BaseFunction() {
            @Override public Object call(Context cx, Scriptable s, Scriptable thisObj, Object[] args) {
                return args.length > 0 ? Context.toString(args[0]) : "";
            }
        });

        // java.timeFormat(timestamp)
        ScriptableObject.putProperty(javaObj, "timeFormat", new BaseFunction() {
            @Override public Object call(Context cx, Scriptable s, Scriptable thisObj, Object[] args) {
                try {
                    long ts = Long.parseLong(Context.toString(args.length > 0 ? args[0] : "0"));
                    return new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(new java.util.Date(ts));
                } catch (Exception e) { return ""; }
            }
        });

        // java.toast / java.longToast / java.log — no-ops
        ScriptableObject.putProperty(javaObj, "toast", new BaseFunction() {
            @Override public Object call(Context cx, Scriptable s, Scriptable thisObj, Object[] args) { return null; }
        });
        ScriptableObject.putProperty(javaObj, "longToast", new BaseFunction() {
            @Override public Object call(Context cx, Scriptable s, Scriptable thisObj, Object[] args) { return null; }
        });
        ScriptableObject.putProperty(javaObj, "log", new BaseFunction() {
            @Override public Object call(Context cx, Scriptable s, Scriptable thisObj, Object[] args) { return null; }
        });

        // java.startBrowser — returns URL
        ScriptableObject.putProperty(javaObj, "startBrowser", new BaseFunction() {
            @Override public Object call(Context cx, Scriptable s, Scriptable thisObj, Object[] args) {
                return args.length > 0 ? Context.toString(args[0]) : "";
            }
        });

        // java.openUrl
        ScriptableObject.putProperty(javaObj, "openUrl", new BaseFunction() {
            @Override public Object call(Context cx, Scriptable s, Scriptable thisObj, Object[] args) {
                return args.length > 0 ? Context.toString(args[0]) : "";
            }
        });

        // java.setCookie / getCookie / removeCookie
        ScriptableObject.putProperty(javaObj, "setCookie", new BaseFunction() {
            @Override public Object call(Context cx, Scriptable s, Scriptable thisObj, Object[] args) {
                if (args.length >= 2) cookieStore.put(Context.toString(args[0]), Context.toString(args[1]));
                return null;
            }
        });
        ScriptableObject.putProperty(javaObj, "getCookie", new BaseFunction() {
            @Override public Object call(Context cx, Scriptable s, Scriptable thisObj, Object[] args) {
                return cookieStore.getOrDefault(args.length > 0 ? Context.toString(args[0]) : "", "");
            }
        });
        ScriptableObject.putProperty(javaObj, "removeCookie", new BaseFunction() {
            @Override public Object call(Context cx, Scriptable s, Scriptable thisObj, Object[] args) {
                if (args.length > 0) cookieStore.remove(Context.toString(args[0]));
                return null;
            }
        });

        // Packages.android.text.TextUtils.isEmpty
        Scriptable packagesObj = cx.newObject(scope);
        Scriptable androidObj = cx.newObject(scope);
        Scriptable textObj = cx.newObject(scope);
        Scriptable textUtils = cx.newObject(scope);
        ScriptableObject.putProperty(textUtils, "isEmpty", new BaseFunction() {
            @Override public Object call(Context cx, Scriptable s, Scriptable thisObj, Object[] args) {
                String str = args.length > 0 ? Context.toString(args[0]) : "";
                return str == null || str.isEmpty();
            }
        });
        ScriptableObject.putProperty(textObj, "TextUtils", textUtils);
        ScriptableObject.putProperty(androidObj, "text", textObj);
        ScriptableObject.putProperty(packagesObj, "android", androidObj);
        ScriptableObject.putProperty(scope, "Packages", packagesObj);

        // java.string a shorthand
        Scriptable langObj = cx.newObject(scope);
        ScriptableObject.putProperty(langObj, "String", "java.lang.String");
        ScriptableObject.putProperty(packagesObj, "java", langObj);

        // javax.crypto stubs
        Scriptable javaxObj = cx.newObject(scope);
        Scriptable cryptoObj = cx.newObject(scope);
        Scriptable cipherObj = cx.newObject(scope);
        ScriptableObject.putProperty(cipherObj, "getInstance", new BaseFunction() {
            @Override public Object call(Context cx, Scriptable s, Scriptable thisObj, Object[] args) {
                Scriptable instance = cx.newObject(scope);
                ScriptableObject.putProperty(instance, "init", new BaseFunction() {
                    @Override public Object call(Context cx2, Scriptable s2, Scriptable t2, Object[] a2) { return null; }
                });
                ScriptableObject.putProperty(instance, "doFinal", new BaseFunction() {
                    @Override public Object call(Context cx2, Scriptable s2, Scriptable t2, Object[] a2) { return ""; }
                });
                return instance;
            }
        });
        ScriptableObject.putProperty(cryptoObj, "Cipher", cipherObj);
        ScriptableObject.putProperty(cryptoObj, "spec", cx.newObject(scope));
        ScriptableObject.putProperty(javaxObj, "crypto", cryptoObj);
        ScriptableObject.putProperty(packagesObj, "javax", javaxObj);

        // java.util.Base64 stubs
        Scriptable utilObj = cx.newObject(scope);
        Scriptable base64Obj = cx.newObject(scope);
        Scriptable decoderObj = cx.newObject(scope);
        ScriptableObject.putProperty(decoderObj, "decode", new BaseFunction() {
            @Override public Object call(Context cx2, Scriptable s2, Scriptable t2, Object[] a2) {
                try {
                    String str = a2.length > 0 ? Context.toString(a2[0]) : "";
                    return Base64.getDecoder().decode(str);
                } catch (Exception e) { return new byte[0]; }
            }
        });
        ScriptableObject.putProperty(base64Obj, "getDecoder", new BaseFunction() {
            @Override public Object call(Context cx2, Scriptable s2, Scriptable t2, Object[] a2) { return decoderObj; }
        });
        ScriptableObject.putProperty(utilObj, "Base64", base64Obj);
        ScriptableObject.putProperty(utilObj, "Arrays", cx.newObject(scope));
        ScriptableObject.putProperty(packagesObj, "java", langObj);
    }

    private static void exposeSourceApi(Context cx, Scriptable scope, Scriptable source) {
        ScriptableObject.putProperty(source, "getKey", new BaseFunction() {
            @Override public Object call(Context cx, Scriptable s, Scriptable thisObj, Object[] args) {
                return sourceUrl;
            }
        });
        ScriptableObject.putProperty(source, "bookSourceUrl", sourceUrl);
        ScriptableObject.putProperty(source, "key", sourceUrl);
        ScriptableObject.putProperty(source, "get", new BaseFunction() {
            @Override public Object call(Context cx, Scriptable s, Scriptable thisObj, Object[] args) {
                return sessionStore.getOrDefault("source_" + (args.length > 0 ? Context.toString(args[0]) : ""), "");
            }
        });
        ScriptableObject.putProperty(source, "put", new BaseFunction() {
            @Override public Object call(Context cx, Scriptable s, Scriptable thisObj, Object[] args) {
                if (args.length >= 2) sessionStore.put("source_" + Context.toString(args[0]), Context.toString(args[1]));
                return args.length >= 2 ? args[1] : "";
            }
        });
        ScriptableObject.putProperty(source, "getVariable", new BaseFunction() {
            @Override public Object call(Context cx, Scriptable s, Scriptable thisObj, Object[] args) {
                return sessionStore.getOrDefault("source_variable", "{}");
            }
        });
        ScriptableObject.putProperty(source, "setVariable", new BaseFunction() {
            @Override public Object call(Context cx, Scriptable s, Scriptable thisObj, Object[] args) {
                if (args.length > 0) sessionStore.put("source_variable", Context.toString(args[0]));
                return null;
            }
        });
        ScriptableObject.putProperty(source, "getLoginInfoMap", new BaseFunction() {
            @Override public Object call(Context cx, Scriptable s, Scriptable thisObj, Object[] args) {
                Scriptable map = cx.newObject(scope);
                ScriptableObject.putProperty(map, "get", new BaseFunction() {
                    @Override public Object call(Context cx2, Scriptable s2, Scriptable t2, Object[] a2) {
                        return sessionStore.getOrDefault("login_" + (a2.length > 0 ? Context.toString(a2[0]) : ""), "");
                    }
                });
                return map;
            }
        });
    }

    private static void exposeCookieApi(Context cx, Scriptable scope, Scriptable cookieObj) {
        ScriptableObject.putProperty(cookieObj, "getKey", new BaseFunction() {
            @Override public Object call(Context cx, Scriptable s, Scriptable thisObj, Object[] args) {
                if (args.length >= 2) return cookieStore.getOrDefault(Context.toString(args[0]) + "_" + Context.toString(args[1]), "");
                return "";
            }
        });
        ScriptableObject.putProperty(cookieObj, "setKey", new BaseFunction() {
            @Override public Object call(Context cx, Scriptable s, Scriptable thisObj, Object[] args) {
                if (args.length >= 3) cookieStore.put(Context.toString(args[0]) + "_" + Context.toString(args[1]), Context.toString(args[2]));
                return null;
            }
        });
        ScriptableObject.putProperty(cookieObj, "removeCookie", new BaseFunction() {
            @Override public Object call(Context cx, Scriptable s, Scriptable thisObj, Object[] args) {
                if (args.length > 0) {
                    String prefix = Context.toString(args[0]);
                    cookieStore.keySet().removeIf(k -> k.startsWith(prefix));
                }
                return null;
            }
        });
        ScriptableObject.putProperty(cookieObj, "getCookie", new BaseFunction() {
            @Override public Object call(Context cx, Scriptable s, Scriptable thisObj, Object[] args) {
                return cookieStore.getOrDefault(args.length > 0 ? Context.toString(args[0]) : "", "");
            }
        });
    }
}
