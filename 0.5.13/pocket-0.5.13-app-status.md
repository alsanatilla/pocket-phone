# Stand der Apps — Pocket 0.5.13

Alle neun Standardkacheln öffnen implementierte Pocket-Oberflächen. Pocket ist weiterhin ein Launcher mit eigenen Android-Apps auf Nothing OS. Eine vollständige System-ROM wurde nicht gebaut. Die Angaben unten beruhen auf Code, automatisierten Android-Tests und nativen Layout-Vorschauen; ein Nothing Phone (3a) ist hier nicht angeschlossen.

| App | Damit kannst du bereits arbeiten | Grenze im Alltag |
| --- | --- | --- |
| Notizen | Markdown schreiben, Vorschau, Formatierungsrad, Entwürfe, Teilen/Export, Aufgabe aus einer Notiz, gespeicherte Notizen anheften. | Lokal; keine Google-Keep-Synchronisierung. Maximal 8.000 Zeichen pro Notiz. |
| Kalender / Agenda | Termine anlegen/bearbeiten, Start und Dauer bestimmen, Endzeit sehen, Entwurf fortsetzen, lokale Erinnerung. Optional in einen ausgewählten Android-Google-Kalender schreiben. | Keine eigenen Wiederholungsregeln oder vollständige Konflikt-/Löschabstimmung mit Google. Echte Kontosynchronisierung ist noch am Handy zu prüfen. |
| Uhr | Wecker, tägliche Wiederholung, bestehende Wecker bearbeiten, benannte Timer, Pause/Fortsetzen, Stoppuhr/Runden, Snooze. | Android muss genaue Alarme und Benachrichtigungen zulassen. Sperrbildschirm, Neustart und Nachtbetrieb sind am Handy zu prüfen. |
| Kontakte | Android-Adressbuch durchsuchen, Details, mehrere Nummern ansehen, primären Namen/Nummer/E-Mail bearbeiten, neue Kontakte, Anruf-/SMS-Übergabe, wiederaufnehmbarer Entwurf. | Androids Kontaktberechtigung erforderlich. Neue Kontakte sind lokal; bestehende Konto-Kontakte folgen Androids Sync. |
| Rechner | Dezimalrechnung, Klammern, Prozent, Verlauf wiederverwenden, Ergebnis kopieren und weiterrechnen. | Kein wissenschaftlicher Rechner. Prozent teilt den vorangehenden Wert durch 100: `200 × 10% = 20`. |
| Files | Ausschließlich Pocket-Kamerafotos ansehen, zwischen Bildern blättern, Album aktualisieren, Foto ausdrücklich teilen. | Kein allgemeiner Dateibrowser, keine anderen Fotos, keine Bildbearbeitung. |
| Kamera | Eigene Vorschau/Aufnahme, Front/Rückkamera, Fokus, Belichtung, Blitz, sechs frühe Digitalfoto-Profile, Lautstärketaste als Auslöser. | Reale Kamera-, Blitz-, Orientierungs- und Qualitätsprüfung am Phone (3a) steht aus. |
| Nachrichten | Aktive Messenger-Benachrichtigungen öffnen, gegebenenfalls antworten, daraus eine Aufgabe machen. Separates SMS-Postfach, Entwürfe und empfangene MMS-Anhänge. | Keine vollständige WhatsApp-/Signal-Historie. SMS braucht die Standard-SMS-Rolle; kein RCS oder Versand von MMS-Anhängen. Eine Übergabe bestätigt keine Zustellung. |
| Telefon | Nummernfeld, Tastenfeld, Verlauf, SIM-Auswahl, eingehende/aktive Anrufsteuerung. | Standard-Telefon-Rolle und native Berechtigungen; echte SIM-Anrufe/Audiowege sind noch zu prüfen. Notruf geht zum System-Dialer. |
| Einstellungen | Launcher/Kacheln, Helligkeit, Lautstärke, DND und Übergabe an geschützte Android-Einstellungen. | Geschützte Android-Einstellungen bleiben unter Androids Kontrolle. App-Setup bleibt im jeweiligen Settings-Button. |

## Neue Bedienung

- **Notiz anheften:** eine gespeicherte Notiz in Today gedrückt halten → Pin; alternativ Preview → More → Pin. Pinned erscheint als kleine Metadatenzeile. Unpin nimmt die Anheftung zurück. Der Markdown-Text bleibt unverändert.
- **Wecker ändern:** die Weckerzeile antippen, Zeit/Name/Daily bearbeiten, Save. Ein ausgeschalteter Wecker bleibt ausgeschaltet; es entsteht kein zweiter Wecker.
- **Timer:** 5, 25 oder 50 Minuten wählen oder Minuten eingeben; ein optionaler Name unterscheidet mehrere Timer. Start timer startet ausdrücklich.
- **Termindauer:** im Termin Duration öffnen, einen Schnellwert oder Other duration wählen. 1 bis 1440 Minuten sind erlaubt. Until zeigt das tatsächliche Ende, auch über Mitternacht; die Erinnerung liegt weiterhin am Start.
- **Kontaktentwurf:** Back/Home hält eingegebenen Text getrennt vom gespeicherten Android-Kontakt. Continue draft setzt ihn fort. Save schreibt ausdrücklich ins Adressbuch; Discard draft verlangt Bestätigung. Ein vorhandener anderer Entwurf wird vor dem Ersetzen angeboten.
- **Rechner:** nach `=` beginnt eine Ziffer eine neue Zahl. Ein Operator rechnet mit dem Ergebnis weiter. History übernimmt ein früheres Ergebnis; Copy schreibt erst beim Antippen in die Zwischenablage.
- **Fotos:** im Viewer Previous/Next verwenden; Album oder Back geht zur Liste. Share photo öffnet Androids Teilen-Auswahl. Alle Bilder werden erneut gegen das eigene Kameraalbum geprüft.
- **Nachrichten:** die aktiven Nachrichten stehen zuerst. SMS inbox und Apps sind unten erreichbar. Apps öffnet eine Auswahl der bereits installierten unterstützten Messenger.

## Berechtigungen und Daten

Dieses Update fügt keine Berechtigungen hinzu. Es enthält keine Internetberechtigung, Analytics oder Kontoanmeldung. Kontaktentwürfe sind ausschließlich eingegebener Text plus der lokale Bezug zum ausdrücklich gespeicherten Kontakt, privat in der App. Ein verspätet akzeptierter Speichervorgang darf seinen bereits gespeicherten Text nicht als neuen Entwurf wiederherstellen; neuere Änderungen bleiben getrennt erhalten.

Androids Warnung für Benachrichtigungszugriff ist reale Android-Einwilligung. Wenn Android für diese APK „Restricted setting“ anzeigt und es anbietet: App info → ⋮ → Allow restricted settings, dann zurück zur Listener-Freigabe. Pocket kann das nicht selbst freischalten. Benachrichtigungszugriff, normale Benachrichtigungen, Kontakte, Kalender und die Telefon-/SMS-Rollen sind unterschiedliche Freigaben.

Es gibt noch keine vollständige lokale Sicherung mit Wiederherstellung, keine Google-Tasks-/Keep-Anbindung und keine gemeinsame Suche über alle Apps. Diese Grenzen und die ausstehende Prüfung echter Anrufe, Nachrichten, Aufnahmen und Alarme sind kein Nachweis der täglichen Zuverlässigkeit am Handy. Installiere das Update über die vorhandene Version, damit die App-Daten erhalten bleiben.
