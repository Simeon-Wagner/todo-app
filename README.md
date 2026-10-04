# Kalender & To-dos

Android-App für Termine und To-do-Listen mit direkter Nextcloud-Anbindung (CalDAV).
Die Oberfläche liegt in `www/`, die Android-Hülle wird beim Bauen mit Capacitor erzeugt.

## APK über GitHub bauen (ohne eigene Werkzeuge)

1. Bei github.com anmelden und ein neues **privates** Repository anlegen (ohne README).
2. Auf der leeren Repository-Seite „uploading an existing file“ wählen und den **gesamten Inhalt**
   dieses Ordners hineinziehen, einschließlich des Ordners `.github`
   (unter macOS mit Cmd+Shift+Punkt sichtbar machen). Mit „Commit changes“ bestätigen.
3. Im Reiter **Actions** läuft jetzt „APK bauen“ (ca. 5 Minuten).
4. Danach erscheint rechts unter **Releases** die „Testversion 1“ mit der Datei `kalender-todos.apk`.
   Die Seite am Handy öffnen (bei GitHub angemeldet), die Datei laden und installieren.
   Android fragt dabei einmalig, ob der Browser Apps installieren darf.

Jede weitere Änderung im Repository baut automatisch eine neue Testversion, die sich über die alte installieren lässt.

Falls unter Actions nichts startet: Settings › Actions › General › „Allow all actions“ und
unter „Workflow permissions“ „Read and write permissions“ auswählen, dann unter Actions „Run workflow“.

## Anmelden

- **Mit Nextcloud anmelden:** Adresse eingeben, im Browser anmelden und den Zugriff erlauben.
  Die Nextcloud erzeugt dabei selbst ein App-Passwort.
- **Mit App-Passwort:** In der Nextcloud unter Einstellungen › Sicherheit › Geräte & Sitzungen
  ein App-Passwort erzeugen und zusammen mit dem Benutzernamen eingeben.

## So legt die App die Daten ab

- Termine: normale Kalendereinträge im gewählten Kalender.
- Tagesaufgaben: Nextcloud-Aufgaben mit Fälligkeitsdatum.
- Wochenliste: Aufgaben mit Schlagwort „Woche“, fällig am Sonntag der Woche.
- Monatsliste: Aufgaben mit Schlagwort „Monat“, fällig am letzten Tag des Monats.

Alles bleibt in Nextcloud Kalender und Nextcloud Tasks sichtbar und bearbeitbar.

## Grenzen dieser Testversion

- Serientermine werden angezeigt, lassen sich aber nur in der Nextcloud bearbeiten.
- Termine werden von 3 Monate zurück bis 2 Jahre voraus geladen.
- Wird derselbe Eintrag offline und gleichzeitig woanders geändert, gilt der Stand vom Server.
- Keine Erinnerungen/Benachrichtigungen.
- Das App-Passwort liegt im privaten Speicher der App auf dem Gerät.
- Der Test-Schlüssel (`android-overlay/test-keystore.jks`) ist nur für Testversionen gedacht;
  deshalb das Repository privat halten.

## Am Rechner im Browser testen (optional)

```
npm install
node scripts/dev-server.mjs https://eure-nextcloud.de
```

Dann http://localhost:8080 öffnen und als Adresse `http://localhost:8080` eingeben
(Anmeldung hier nur mit App-Passwort).
