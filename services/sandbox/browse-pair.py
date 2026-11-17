#!/usr/bin/env python3
"""Pair a sandbox account's headless Chromium with its browse relay.

Run by /usr/local/bin/browse on first use, after Chromium has started with the browse extension. It asks the relay for
a one-time code (`browse pair`), enters that code and the relay's address into the extension's own settings page over
the Chrome DevTools Protocol, and waits until the extension reports the connection. Everything is per account: the
relay port and the Chromium profile (and therefore the extension's stored key) belong to one Unix user.
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request

BIN = '/usr/local/bin/browse-bin'
EXTENSION_ID = 'lojchoakeilecchdlgcpblpieghlpnmk'
SETTINGS_URL = 'chrome-extension://' + EXTENSION_ID + '/settings.html'


def cdp_targets(port):
    return json.load(urllib.request.urlopen('http://127.0.0.1:%d/json' % port, timeout=5))


def cdp_new_tab(port, url):
    request = urllib.request.Request('http://127.0.0.1:%d/json/new?%s' % (port, urllib.parse.quote(url, safe='')), method='PUT')
    return json.load(urllib.request.urlopen(request, timeout=10))


def cdp_eval(ws_url, expression, timeout=20):
    import websocket  # python3-websocket
    ws = websocket.create_connection(ws_url, timeout=timeout)
    try:
        ws.send(json.dumps({'id': 1, 'method': 'Runtime.evaluate',
                            'params': {'expression': expression, 'returnByValue': True, 'awaitPromise': True}}))
        while True:
            message = json.loads(ws.recv())
            if message.get('id') == 1:
                result = message.get('result', {})
                if 'exceptionDetails' in result:
                    raise RuntimeError(json.dumps(result['exceptionDetails'])[:400])
                return result.get('result', {}).get('value')
    finally:
        ws.close()


def settings_page(port):
    for target in cdp_targets(port):
        if target.get('type') == 'page' and target.get('url', '').endswith('/settings.html'):
            return target
    page = cdp_new_tab(port, SETTINGS_URL)
    time.sleep(1.5)
    return page


def find_code(log_path, process, seconds=20):
    deadline = time.time() + seconds
    while time.time() < deadline:
        try:
            with open(log_path, 'r', encoding='utf-8', errors='replace') as handle:
                match = re.search(r'Pairing code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})', handle.read())
            if match:
                return match.group(1)
        except FileNotFoundError:
            pass
        if process.poll() is not None:
            break
        time.sleep(0.3)
    return None


def main():
    relay_port = int(sys.argv[1])
    cdp_port = int(sys.argv[2])
    log_path = os.path.join(os.path.expanduser('~'), '.browse', 'logs', 'pair-relay.log')
    os.makedirs(os.path.dirname(log_path), exist_ok=True)
    web = 'http://127.0.0.1:%d' % cdp_port

    # A stale browser from a previous boot would leave the extension unpaired; wait for the current one.
    deadline = time.time() + 30
    while time.time() < deadline:
        try:
            urllib.request.urlopen(web + '/json/version', timeout=2).read()
            break
        except Exception:
            time.sleep(0.3)
    else:
        print('browse: the browser is not answering on ' + web, file=sys.stderr)
        return 1

    with open(log_path, 'w', encoding='utf-8') as relay_log:
        process = subprocess.Popen([BIN, 'pair', '--wait-seconds', '120'], stdout=relay_log, stderr=subprocess.STDOUT,
                                   env={**os.environ, 'OPENCODE_BROWSER_PORT': str(relay_port)})
    code = find_code(log_path, process)
    if not code:
        process.kill()
        print('browse: the relay did not print a pairing code (see ' + log_path + ')', file=sys.stderr)
        return 1

    page = settings_page(cdp_port)
    script = '''(() => {
      const form = document.querySelector('form.relay-form');
      if (!form) return 'no pairing form';
      const inputs = [...form.querySelectorAll('input')];
      const address = inputs.find(input => /19988|localhost/.test(input.placeholder || '')) || inputs[0];
      const code = inputs.find(input => /XXXX-XXXX/.test(input.placeholder || '')) || inputs[inputs.length - 1];
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(address, %s); address.dispatchEvent(new Event('input', { bubbles: true }));
      set.call(code, %s); code.dispatchEvent(new Event('input', { bubbles: true }));
      form.requestSubmit();
      return 'submitted';
    })()''' % (json.dumps('localhost:%d' % relay_port), json.dumps(code))
    print(cdp_eval(page['webSocketDebuggerUrl'], script))

    try:
        process.wait(timeout=120)
    except subprocess.TimeoutExpired:
        process.kill()
    success = False
    state = ''
    try:
        state = cdp_eval(page['webSocketDebuggerUrl'], 'JSON.stringify({head:(document.querySelector(".head-status")||{}).textContent||"", sub:(document.querySelector(".head-sub")||{}).textContent||""})')
        success = 'onnected' in (state or '') or 'aired' in (state or '')
    except Exception:
        success = process.returncode == 0
    if process.returncode not in (0, None):
        success = False
    print(('paired' if success else 'not paired') + ' on ' + str(relay_port) + ' (' + state + ')')
    return 0 if success else 1


if __name__ == '__main__':
    sys.exit(main())
