package de.kalendertodos.app;

import android.content.Intent;
import android.net.Uri;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.Locale;
import java.util.concurrent.TimeUnit;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * Schickt Anfragen direkt vom Geraet an die Nextcloud (auch PROPFIND und REPORT),
 * ohne die Beschraenkungen, die fuer Webseiten im Browser gelten.
 */
@CapacitorPlugin(name = "Dav")
public class DavPlugin extends Plugin {

    private final OkHttpClient client = new OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(90, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .build();

    @PluginMethod
    public void request(final PluginCall call) {
        String url = call.getString("url");
        String method = call.getString("method", "GET");
        JSObject headers = call.getObject("headers", new JSObject());
        String body = call.getString("body");
        if (url == null || method == null) {
            call.reject("Adresse fehlt");
            return;
        }
        method = method.toUpperCase(Locale.ROOT);
        try {
            Request.Builder builder = new Request.Builder().url(url);
            String contentType = null;
            if (headers != null) {
                Iterator<String> keys = headers.keys();
                while (keys.hasNext()) {
                    String key = keys.next();
                    String value = headers.getString(key);
                    if (value == null) {
                        continue;
                    }
                    if (key.equalsIgnoreCase("content-type")) {
                        contentType = value;
                    } else {
                        builder.header(key, value);
                    }
                }
            }
            RequestBody requestBody = null;
            if (!method.equals("GET") && !method.equals("HEAD")) {
                byte[] bytes = body == null ? new byte[0] : body.getBytes(StandardCharsets.UTF_8);
                MediaType mediaType = contentType == null ? null : MediaType.parse(contentType);
                requestBody = RequestBody.create(mediaType, bytes);
            }
            builder.method(method, requestBody);

            client.newCall(builder.build()).enqueue(new Callback() {
                @Override
                public void onFailure(Call c, IOException e) {
                    call.reject(e.getMessage() == null ? "Keine Verbindung" : e.getMessage());
                }

                @Override
                public void onResponse(Call c, Response response) {
                    try {
                        JSObject result = new JSObject();
                        result.put("status", response.code());
                        JSObject responseHeaders = new JSObject();
                        for (String name : response.headers().names()) {
                            responseHeaders.put(name.toLowerCase(Locale.ROOT), response.header(name));
                        }
                        result.put("headers", responseHeaders);
                        ResponseBody responseBody = response.body();
                        result.put("body", responseBody == null ? "" : responseBody.string());
                        call.resolve(result);
                    } catch (Exception e) {
                        call.reject(e.getMessage() == null ? "Antwort nicht lesbar" : e.getMessage());
                    } finally {
                        response.close();
                    }
                }
            });
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "Anfrage fehlgeschlagen" : e.getMessage());
        }
    }

    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            call.reject("Adresse fehlt");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "Browser konnte nicht geöffnet werden" : e.getMessage());
        }
    }
}
