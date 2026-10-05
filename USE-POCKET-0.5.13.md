# Pocket Phone 0.5.13 verwenden

## Update installieren

1. `pocket-phone-0.5.13.apk` auf deinem Nothing Phone herunterladen und öffnen.
2. Falls Android es verlangt, Installation aus dieser Download-App erlauben.
3. **Als Update installieren; die vorhandene Pocket-Version behalten.** Paket und Signatur stimmen mit den bisherigen Versionen überein. So bleiben Notizen, Aufgaben, Termine, Entwürfe und Kachelbelegungen erhalten.
4. Pocket öffnen. Es werden keine zusätzlichen Berechtigungen angefordert.

Dies ist weiterhin der Launcher mit eigenen Apps auf deinem vorhandenen Nothing OS, keine flashbare System-ROM. Für Home: Pocket Settings → Use as home screen → in Android auswählen. Der Status muss Active anzeigen. Android/Nothing OS führt Home und Recents aus; die verbliebene kurze Nothing-Home-Einblendung ist hier nicht am Handy überprüfbar.

## Was jetzt besser funktioniert

- **Uhr:** eine vorhandene Weckerzeile antippen, Zeit/Name/Daily ändern und Save. Derselbe Wecker wird geändert; Off bleibt Off. Timer hat 5/25/50-Minuten-Schnellwerte und einen optionalen Namen. Pause/Fortsetzen und die Stoppuhr bleiben verfügbar.
- **Kalender:** Appointment → Duration. Schnellwert wählen oder Other duration verwenden; 1–1440 Minuten sind erlaubt. Until zeigt die Endzeit. Back bewahrt Dauer und Text als Entwurf; Continue draft setzt ihn fort. Die Erinnerung bleibt am Start. Alte Termine bleiben 60 Minuten lang.
- **Notizen:** Today → Note zum Schreiben. Gedrückt halten oder Format antippen öffnet das Formatierungsrad. Preview zeigt das native Markdown-Dokument; Edit kehrt zum Entwurf zurück. Eine gespeicherte Notiz gedrückt halten → Pin; alternativ Preview → More → Pin. Unpin löst die Anheftung. Share teilt ausdrücklich den Text; Task übernimmt die ausgewählte Notiz als Aufgabenquelle.
- **Kontakte:** Settings → Allow contacts, falls noch ausgeschaltet. Back/Home erhält den eingegebenen Kontaktentwurf getrennt vom gespeicherten Adressbuch. Continue draft nimmt ihn wieder auf; Save schreibt ausdrücklich. Discard draft verlangt Bestätigung. Ein bereits akzeptierter Speichervorgang erzeugt auf Retry keinen zweiten neuen Kontakt; neuere Änderungen bleiben erhalten.
- **Rechner:** nach `=` beginnt eine Ziffer eine neue Zahl; ein Operator rechnet mit dem Ergebnis weiter. History übernimmt ein Ergebnis, Copy schreibt es auf ausdrücklichen Tap in die Zwischenablage. Ungültige Rechnung bleibt zur Korrektur stehen. Prozent bedeutet `/100` für den davor stehenden Wert.
- **Fotos:** Files zeigt ausschließlich Pocket-Kameraaufnahmen. Previous/Next blättert im eigenen Album; Album/Back geht zur Liste zurück. Share photo öffnet Androids Teilen-Auswahl. Ein fremdes Foto wird weiterhin abgewiesen.
- **Nachrichten:** Inhalte stehen zuerst; SMS inbox und Apps sind unten erreichbar. Apps öffnet eine Auswahl der installierten unterstützten Messenger. Open/Reply/More bleiben große native Textaktionen. Reply gibt es nur, wenn die jeweilige Benachrichtigung das unterstützt.
- **Telefon:** größere Nummernanzeige; Plus und langes Drücken auf 0 fügen `+` an der Cursorposition ein. Ein Anruf beginnt erst beim bewussten Call-Tap.

Schwarzer Hintergrund, Monospace-Text, kleine Pixelüberschriften und sparsame gelbe Akzente bleiben. App-Setup liegt weiter im jeweiligen Settings-Button.

## Android-Freigaben

Die Freigaben sind voneinander getrennt: Kontakte und Kalender sind Provider-Zugriff; Telefon/SMS brauchen Androids Standard-App-Rollen; Pocket-Alarme brauchen genaue Alarme und eigene Benachrichtigungen. Die neuen Funktionen fügen keine Freigabe hinzu.

Für Messenger-Hinweise: Messages → Settings → Enable notification access. Zeigt Android „Restricted setting“ und bietet den Menüpunkt an, über Open app info → ⋮ → Allow restricted settings erlauben und anschließend zur Listener-Freigabe zurückkehren. Die Finanzdaten-Warnung erklärt, dass ein Listener auch sensible Benachrichtigungstexte sehen kann. Pocket kann diese Entscheidung nicht automatisch freischalten. Empfangenes wird nicht automatisch als Verlauf archiviert; More → Make task speichert nur die ausdrücklich ausgewählte Quelle.

SMS zeigt Androids SMS/MMS-Bestand und braucht die Standard-SMS-Rolle. WhatsApp/Signal/Telegram bleiben für den Empfang und den vollständigen Verlauf zuständig. Keine vollständige Messenger-Historie, kein RCS und kein Versand von MMS-Anhängen.

Optionaler Kalender: Agenda → Settings → Connect Google Calendar, Kalenderzugriff gewähren und einen bereits auf dem Handy synchronisierten beschreibbaren Google-Kalender auswählen. Wenn keiner erscheint, zuerst Androids Konto-/Kalendersynchronisierung einrichten. Android übernimmt die Übertragung; Pocket enthält keine Kontoanmeldung oder Internetberechtigung. Keep und Google Tasks sind nicht angebunden.

## Geprüfter Stand

815 automatisierte Android-Tests bestanden, keine Lint-Fehler, gleiche 28 Berechtigungen und gleicher Update-Schlüssel. Die Vorschauen sind echte native Layout-Renderings mit Beispieldaten; diese Daten stecken nicht in der APK. Sie sind keine Handyaufnahmen.

Echte SIM-Anrufe/Zustellung, Kamera-Hardware, Google-Kontosync, Nacht-/Neustartalarme und die Nothing-Home-Animation sind noch am Phone (3a) zu prüfen. Vollständiges Backup/Restore, Termin-Konfliktabgleich, Aufgabenwiederholung und eine Suche über alle Apps fehlen weiterhin. Die komplette App-Übersicht steht in `pocket-0.5.13-app-status.md` beziehungsweise `APP-STATUS.md` im Quellpaket.
