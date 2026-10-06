# Stand der Apps — Pocket 0.6.0

Home, der gemeinsame Workspace und Apps öffnen implementierte Pocket-Oberflächen. Der Zusammenhang aller Apps steht in [WORKFLOW.md](WORKFLOW.md). Pocket ist weiterhin ein Launcher mit eigenen Android-Apps auf Nothing OS. Eine vollständige System-ROM wurde nicht gebaut. Die Angaben unten beruhen auf Code, automatisierten Android-Tests und nativen Layout-Vorschauen; ein Nothing Phone (3a) ist hier nicht angeschlossen.

| App | Damit kannst du bereits arbeiten | Grenze im Alltag |
| --- | --- | --- |
| Notizen | Markdown, Formatierungsrad, Entwürfe, Teilen/Export, Aufgabe aus einer Notiz, Anheften; `>>`-Zeilen speichern Gedanken; erst Make task erzeugt eine verknüpfte Aufgabe. | Optionaler Drive-Sync; keine Google-Keep-Synchronisierung. Maximal 8.000 Zeichen pro Notiz. |
| Kalender / Agenda | Termine anlegen/bearbeiten, Start und Dauer bestimmen, Endzeit sehen, Entwurf fortsetzen, lokale Erinnerung. Plan time verknüpft einen Termin mit der gewählten Aufgabe. | Lokaler Pocket-Kalender ohne Google-Kalenderzugriff und ohne Drive-Sync; keine Wiederholungsregeln. Erinnerungen sind am Handy zu prüfen. |
| Uhr | Wecker, tägliche Wiederholung, bestehende Wecker bearbeiten, benannte Timer, Pause/Fortsetzen, Stoppuhr/Runden, Snooze. | Android muss genaue Alarme und Benachrichtigungen zulassen. Sperrbildschirm, Neustart und Nachtbetrieb sind am Handy zu prüfen. |
| Kontakte | Android-Adressbuch durchsuchen, Details, mehrere Nummern ansehen, primären Namen/Nummer/E-Mail bearbeiten, neue Kontakte, Anruf-/SMS-Übergabe, wiederaufnehmbarer Entwurf. | Androids Kontaktberechtigung erforderlich. Neue Kontakte sind lokal; bestehende Konto-Kontakte folgen Androids Sync. |
| Rechner | Dezimalrechnung, Klammern, Prozent, Verlauf wiederverwenden, Ergebnis kopieren und weiterrechnen. | Kein wissenschaftlicher Rechner. Prozent teilt den vorangehenden Wert durch 100: `200 × 10% = 20`. |
| Photos | Ausschließlich Pocket-Kamerafotos ansehen, zwischen Bildern blättern, Album aktualisieren, Foto ausdrücklich teilen. | Kein allgemeiner Dateibrowser, keine anderen Fotos, keine Bildbearbeitung. |
| Kamera | Eigene Vorschau/Aufnahme, Front/Rückkamera, Fokus, Belichtung, Blitz, sechs frühe Digitalfoto-Profile, Lautstärketaste als Auslöser. | Reale Kamera-, Blitz-, Orientierungs- und Qualitätsprüfung am Phone (3a) steht aus. |
| Nachrichten | Aktive Messenger-Benachrichtigungen öffnen, gegebenenfalls antworten, daraus eine Aufgabe machen. Separates SMS-Postfach, Entwürfe und empfangene MMS-Anhänge. | Keine vollständige WhatsApp-/Signal-Historie. SMS braucht die Standard-SMS-Rolle; kein RCS oder Versand von MMS-Anhängen. Eine Übergabe bestätigt keine Zustellung. |
| Telefon | Nummernfeld, Tastenfeld, Verlauf, SIM-Auswahl, eingehende/aktive Anrufsteuerung. | Standard-Telefon-Rolle und native Berechtigungen; echte SIM-Anrufe/Audiowege sind noch zu prüfen. Notruf geht zum System-Dialer. |
| Einstellungen | Launcher/Kacheln, Helligkeit, Lautstärke, DND und Übergabe an geschützte Android-Einstellungen. | Geschützte Android-Einstellungen bleiben unter Androids Kontrolle. App-Setup bleibt im jeweiligen Settings-Button. |
| Kachelgruppen | Eine Home-Kachel enthält bis zu neun Pocket- oder installierte Apps; Umbenennen, Verschieben, Entfernen. | Fehlende installierte Apps müssen ersetzt oder aus der Gruppe entfernt werden. |
| Dice | Würfel, d20, Münze und Auswahl aus einer eigenen Liste; Schütteln und Verlauf. | Nur die Auswahlliste wird optional synchronisiert. |
| Thoughts | Unentschiedene Ideen behalten, bearbeiten, optional erneut ansehen oder ausdrücklich zur Aufgabe machen; Quellen bleiben verknüpft. Alte Parking-Kacheln öffnen Thoughts. | Eine Review-Zeit erzeugt keine Aufgabe. Frühere bereits übernommene Aufgaben bleiben erhalten. |
| pip | Separat gespeicherte Chats und Entwürfe, Umbenennen/Löschen, Markdown während der Antwort, Pixel-Animation und aufklappbare API-Denkzusammenfassungen und Leseschritte. Nur vollständige Antworten gehen als Verlauf an die API zurück. | Eigener API-Key und Abrechnung beim gewählten Anbieter. Chats und Denkzusammenfassungen bleiben lokal, ohne Drive-Sync oder Android-Backup. Live-API und Animation am Handy sind noch zu prüfen. |
| Activity | Tagesprotokoll bewusster Pocket-Aktionen, eigene Textzeilen und Teilen. | Kein Geräteprotokoll; keine Überwachung anderer Apps. Begrenzte Aufbewahrung. |
| Paper | Papierseiten fotografieren/importieren, Original behalten, Transkript als verknüpfte Notiz anzeigen. | Lesen sendet die ausgewählte Seite an Anthropic mit eigenem API-Key und verursacht Kosten. Ohne Key bleiben Seiten lokal wartend. Live-API und Kameraübergabe sind nicht am Handy geprüft. |

## Neue Bedienung

- **Notiz anheften:** eine gespeicherte Notiz im Notes-Tab gedrückt halten → Pin; alternativ Preview → More → Pin. Pinned erscheint als kleine Metadatenzeile. Unpin nimmt die Anheftung zurück. Der Markdown-Text bleibt unverändert.
- **Wecker ändern:** die Weckerzeile antippen, Zeit/Name/Daily bearbeiten, Save. Ein ausgeschalteter Wecker bleibt ausgeschaltet; es entsteht kein zweiter Wecker.
- **Timer:** 5, 25 oder 50 Minuten wählen oder Minuten eingeben; ein optionaler Name unterscheidet mehrere Timer. Start timer startet ausdrücklich.
- **Termindauer:** im Termin Duration öffnen, einen Schnellwert oder Other duration wählen. 1 bis 1440 Minuten sind erlaubt. Until zeigt das tatsächliche Ende, auch über Mitternacht; die Erinnerung liegt weiterhin am Start.
- **Kontaktentwurf:** Back/Home hält eingegebenen Text getrennt vom gespeicherten Android-Kontakt. Continue draft setzt ihn fort. Save schreibt ausdrücklich ins Adressbuch; Discard draft verlangt Bestätigung. Ein vorhandener anderer Entwurf wird vor dem Ersetzen angeboten.
- **Rechner:** nach `=` beginnt eine Ziffer eine neue Zahl. Ein Operator rechnet mit dem Ergebnis weiter. History übernimmt ein früheres Ergebnis; Copy schreibt erst beim Antippen in die Zwischenablage.
- **Fotos:** im Viewer Previous/Next verwenden; Album oder Back geht zur Liste. Share photo öffnet Androids Teilen-Auswahl. Alle Bilder werden erneut gegen das eigene Kameraalbum geprüft.
- **Nachrichten:** die aktiven Nachrichten stehen zuerst. SMS inbox und Apps sind unten erreichbar. Apps öffnet eine Auswahl der bereits installierten unterstützten Messenger.

## Berechtigungen und Daten

Die optionalen Online-Funktionen nutzen die bestehenden Internet- und Netzwerkstatus-Berechtigungen. Drive-Sync ist zunächst aus und braucht explizite Google-Freigabe sowie die OAuth-Einrichtung aus CLOUD.md. Er umfasst Notizen, gespeicherte Aufgaben, Thoughts, Receipt, Dice-Listen und Journal-Seitenfotos. Journal-Lesen ist davon getrennt: erst ein selbst eingetragener, im Android Keystore verschlüsselter Anthropic-Key aktiviert die Übertragung ausgewählter Papierseiten. Kontaktentwürfe bleiben privater eingegebener Text plus der Bezug zum ausdrücklich gespeicherten Kontakt. Chats, Chat-Entwürfe, Denkzusammenfassungen, Aufgabenerinnerungen, Pocket-Kameraalbum, Anrufe, SMS und Kontakte werden durch diesen Drive-Sync nicht hochgeladen.

Androids Warnung für Benachrichtigungszugriff ist reale Android-Einwilligung. Wenn Android für diese APK „Restricted setting“ anzeigt und es anbietet: App info → ⋮ → Allow restricted settings, dann zurück zur Listener-Freigabe. Pocket kann das nicht selbst freischalten. Benachrichtigungszugriff, normale Benachrichtigungen, Kontakte, Kalender und die Telefon-/SMS-Rollen sind unterschiedliche Freigaben.

Es gibt noch keine vollständige lokale Sicherung mit Wiederherstellung, keine Google-Tasks-/Keep-Anbindung und keine gemeinsame Suche über alle Apps. Diese Grenzen und die ausstehende Prüfung echter Anrufe, Nachrichten, Aufnahmen und Alarme sind kein Nachweis der täglichen Zuverlässigkeit am Handy. Installiere das Update über die vorhandene Version, damit die App-Daten erhalten bleiben.
