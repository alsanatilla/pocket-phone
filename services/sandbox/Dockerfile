# Pip's sandbox: a separate Fly machine where the code Pip writes runs, reached only over SSH on Fly's private
# network by OpenClaw's SSH sandbox backend. It holds no Pocket secret: not the database token, not the encryption
# secret, not a provider key. What it needs for that backend: /bin/sh, python3, GNU stat and readlink.
#   fly deploy -c services/sandbox/fly.toml        (from the repository root)
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      openssh-server ca-certificates coreutils curl git jq unzip zip less file procps \
      python3 python3-pip python3-venv python3-websocket python3-numpy python3-pandas python3-matplotlib python3-requests python3-bs4 python3-lxml poppler-utils \
      nodejs npm sqlite3 \
      chromium xvfb fonts-liberation \
    && rm -rf /var/lib/apt/lists/* /etc/ssh/ssh_host_* \
    && useradd --create-home --home-dir /home/pip --shell /bin/bash --uid 1000 pip \
    && usermod -p '*' pip \
    && mkdir -p /run/sshd /workspace && chown pip:pip /workspace
# browse: the relay/MCP server plus its unpacked extension, so every account gets a headless Chromium of its own.
# The wrapper (/usr/local/bin/browse) starts that browser on demand; browse-bin is the real binary.
RUN XDG_BIN_HOME=/usr/local/bin curl -fsSL https://opencode.ai/browse/install | XDG_BIN_HOME=/usr/local/bin sh -s -- --no-setup \
    && mv /usr/local/bin/browse /usr/local/bin/browse-bin \
    && mkdir -p /opt/browse-extension \
    && curl -fsSL -o /tmp/browse-extension.zip https://anoma.ly/release/browse/extension/stable/chromium \
    && unzip -q /tmp/browse-extension.zip -d /opt/browse-extension \
    && rm /tmp/browse-extension.zip \
    && test -f /opt/browse-extension/manifest.json
RUN groupadd pip-sandbox
# gog: Gmail, Calendar and Drive over the HTTPS API. SMTP is blocked here, and the
# API is what Pip's mailbox uses. One binary, no runtime.
ARG GOG_VERSION=0.48.1
RUN curl -fsSL -o /tmp/gog.tgz "https://github.com/openclaw/gogcli/releases/download/v${GOG_VERSION}/gogcli_${GOG_VERSION}_linux_amd64.tar.gz" \
    && tar -xzf /tmp/gog.tgz -C /usr/local/bin ./gog \
    && rm /tmp/gog.tgz && chmod 755 /usr/local/bin/gog \
    && /usr/local/bin/gog --version
COPY accounts.py /usr/local/bin/accounts.py
COPY browse.sh /usr/local/bin/browse
COPY browse-pair.py /usr/local/bin/browse-pair.py
COPY pip-mail /usr/local/bin/pip-mail
COPY pip-mail-connect /usr/local/bin/pip-mail-connect
COPY pip-image /usr/local/bin/pip-image
COPY pip-file /usr/local/bin/pip-file
COPY sshd_config /etc/ssh/sshd_config
COPY start.sh /usr/local/bin/start.sh
RUN chmod 755 /usr/local/bin/start.sh /usr/local/bin/browse /usr/local/bin/browse-pair.py /usr/local/bin/pip-mail /usr/local/bin/pip-mail-connect /usr/local/bin/pip-image /usr/local/bin/pip-file
EXPOSE 2222
CMD ["/usr/local/bin/start.sh"]
