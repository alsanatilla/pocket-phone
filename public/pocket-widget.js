// Paste into Scriptable. Run once in the app to store your Pocket URL and key.
const slot = 'pocket-ios';
if (!config.runsInWidget) {
  const a = new Alert(); a.title = 'Pocket widget';
  a.addTextField('Pocket URL', 'https://pocket-phone.fly.dev');
  a.addSecureTextField('iPhone key'); a.addAction('Save'); a.addCancelAction('Cancel');
  if (await a.presentAlert() === 0) {
    const url = a.textFieldValue(0).replace(/\/$/, '');
    if (!url.startsWith('https://')) throw new Error('Use an HTTPS address.');
    Keychain.set(slot, JSON.stringify({url, key:a.textFieldValue(1).trim()}));
  }
}
const w = new ListWidget();
w.backgroundColor = new Color('12110f');
w.addText('POCKET').textColor = new Color('ecc981'); w.addSpacer(8);
try {
  const {url,key} = JSON.parse(Keychain.get(slot));
  const r = new Request(url + '/api/ios/today');
  r.headers = {Authorization:'Bearer ' + key}; r.timeoutInterval = 15;
  const data = await r.loadJSON();
  if (r.response.statusCode !== 200) throw new Error(data.error || 'Unavailable');
  const t = w.addText(data.text); t.textColor = Color.white(); t.font = Font.systemFont(16);
  if (data.due) { w.addSpacer(4); w.addText(data.due).textColor = new Color('ecc981'); }
  w.url = url;
} catch(e) { w.addText('Open Scriptable to check your connection or key.').textColor = Color.white(); }
w.refreshAfterDate = new Date(Date.now()+15*60*1000);
Script.setWidget(w);
if (!config.runsInWidget) await w.presentSmall();
Script.complete();
